# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Making one backup.

Layout at every storage destination:

    <prefix>/snapshots/<folder>/database.dump   PostgreSQL custom-format dump
    <prefix>/snapshots/<folder>/files.json.gz   list of uploaded files in this backup
    <prefix>/snapshots/<folder>/manifest.json   written last; its presence means "complete"
    <prefix>/files/<key>                        uploaded files, shared by all backups

Uploaded files are immutable in the platform (each upload gets a new key), so files
already present at a destination are skipped. After the first backup only new
uploads are copied.

Keeping the platform responsive while this runs:
- pg_dump reads a consistent snapshot and takes no locks that block normal use.
- pg_dump and pg_restore run at a lower CPU priority.
- Only one backup runs at a time.
- Disk space is checked before the dump starts, and the temporary dump is always removed.
"""

import gzip
import hashlib
import json
import logging
import os
import shutil
import subprocess
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.db import connection
from django.db.migrations.recorder import MigrationRecorder
from django.utils import timezone

from plane.backup.destinations import (
    DestinationError,
    PostgresDriver,
    driver_for,
    format_bytes,
    iter_source_files,
    source_bucket_client,
)
from plane.backup.models import (
    BackupCopy,
    BackupDestination,
    BackupSchedule,
    BackupSnapshot,
    CopyStatus,
    SnapshotStatus,
    SnapshotTrigger,
)
from plane.backup.schedule import RetentionCandidate, select_expired

logger = logging.getLogger("plane.worker")

MANIFEST_VERSION = 1
FREE_SPACE_MARGIN = 256 * 1024 * 1024
PROGRESS_EVERY = 50


class BackupFailed(Exception):
    """Stops the backup with a message the admin can read."""


def work_dir() -> Path:
    return Path(getattr(settings, "BACKUP_WORK_DIR", "/tmp/sgtpm-backups"))


def dump_timeout() -> int:
    return int(getattr(settings, "BACKUP_DB_TIMEOUT_SECONDS", 6 * 3600))


def tools_available() -> bool:
    return shutil.which("pg_dump") is not None and shutil.which("pg_restore") is not None


def make_folder_name(snapshot_id, now) -> str:
    return f"{now:%Y%m%d-%H%M%S}-{str(snapshot_id)[:8]}"


def _set_progress(snapshot: BackupSnapshot, text: str) -> None:
    snapshot.progress = text[:255]
    BackupSnapshot.objects.filter(pk=snapshot.pk).update(progress=snapshot.progress)


def _database_env() -> dict:
    db = settings.DATABASES["default"]
    env = os.environ.copy()
    env.update(
        {
            "PGHOST": str(db.get("HOST") or "localhost"),
            "PGPORT": str(db.get("PORT") or 5432),
            "PGDATABASE": str(db.get("NAME") or ""),
            "PGUSER": str(db.get("USER") or ""),
            "PGPASSWORD": str(db.get("PASSWORD") or ""),
        }
    )
    sslmode = (db.get("OPTIONS") or {}).get("sslmode")
    if sslmode:
        env["PGSSLMODE"] = sslmode
    return env


def _lower_priority() -> None:  # pragma: no cover - runs in the child process
    try:
        os.nice(10)
    except OSError:
        pass


def database_size() -> int:
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_database_size(current_database())")
        return int(cursor.fetchone()[0])


def check_free_space(directory: Path, needed: int) -> None:
    free = shutil.disk_usage(directory).free
    if free < needed + FREE_SPACE_MARGIN:
        raise BackupFailed(
            f"Not enough free disk space on the server to prepare the backup "
            f"(needs about {format_bytes(needed + FREE_SPACE_MARGIN)}, has {format_bytes(free)})."
        )


def dump_database(target: Path) -> None:
    binary = shutil.which("pg_dump")
    if not binary:
        raise BackupFailed("The server is missing the database backup tool (pg_dump).")
    command = [
        binary,
        "--format=custom",
        "--compress=6",
        # Give up instead of queueing behind a schema change, which would block other queries.
        "--lock-wait-timeout=60000",
        f"--file={target}",
    ]
    try:
        result = subprocess.run(
            command,
            env=_database_env(),
            capture_output=True,
            timeout=dump_timeout(),
            preexec_fn=_lower_priority if os.name == "posix" else None,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        raise BackupFailed("Saving the database took too long and was stopped.") from error
    if result.returncode != 0:
        detail = result.stderr.decode(errors="replace")[-2000:]
        logger.error("pg_dump failed: %s", detail)
        if "lock" in detail.lower():
            raise BackupFailed("The database was busy with an update. The backup will be tried again next time.")
        if "server version mismatch" in detail.lower():
            raise BackupFailed("The backup tool is older than the database server. Ask your IT team to update it.")
        raise BackupFailed("Saving the database failed. Details are in the server logs.")


def file_checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def latest_migrations() -> dict:
    recorder = MigrationRecorder(connection)
    if not recorder.has_table():
        return {}
    latest: dict[str, str] = {}
    for app, name in recorder.migration_qs.values_list("app", "name"):
        if name > latest.get(app, ""):
            latest[app] = name
    return latest


def postgres_version() -> str:
    with connection.cursor() as cursor:
        cursor.execute("SHOW server_version")
        return str(cursor.fetchone()[0]).split(" ")[0]


def app_version() -> str:
    from plane.license.models import Instance

    instance = Instance.objects.only("current_version").first()
    return instance.current_version if instance else ""


def content_stats() -> dict:
    """Row counts shown to the admin as "what's inside" this backup."""
    from plane.db.models import Issue, Page, Project, User, Workspace

    stats = {}
    for key, model in (
        ("workspaces", Workspace),
        ("projects", Project),
        ("work_items", Issue),
        ("pages", Page),
        ("users", User),
    ):
        try:
            # The default managers already leave out soft-deleted rows.
            stats[key] = model.objects.count()
        except Exception:  # noqa: BLE001 - stats are informational only
            logger.exception("Could not count %s for the backup summary", key)
    return stats


def build_manifest(snapshot: BackupSnapshot) -> dict:
    return {
        "format": "sgtpm-backup",
        "version": MANIFEST_VERSION,
        "id": str(snapshot.id),
        "folder": snapshot.folder,
        "created_at": snapshot.started_at.isoformat() if snapshot.started_at else None,
        "trigger": snapshot.trigger,
        "note": snapshot.note,
        "app_version": snapshot.app_version,
        "postgres_version": snapshot.postgres_version,
        "migrations": snapshot.migrations,
        "stats": snapshot.stats,
        "database": {
            "file": "database.dump",
            "size": snapshot.database_size,
            "sha256": snapshot.database_checksum,
        },
        "files": {
            "included": snapshot.include_files,
            "index": "files.json.gz" if snapshot.include_files else None,
            "count": snapshot.files_count,
            "size": snapshot.files_size,
        },
    }


def _copy_files(snapshot, copy, driver, files, source) -> int:
    """Copy uploaded files not yet at the destination. Returns bytes copied."""
    copied = 0
    total = len(files)
    for index, (key, size) in enumerate(files, start=1):
        if index == 1 or index % PROGRESS_EVERY == 0:
            _set_progress(snapshot, f"Copying files to {copy.destination_name} ({index} of {total})")
        target = f"files/{key}"
        if driver.has_file(target, size):
            continue
        try:
            body = source.get_object(Bucket=settings.AWS_STORAGE_BUCKET_NAME, Key=key)["Body"]
        except Exception as error:  # noqa: BLE001
            # A file deleted while the backup runs is not a failure.
            code = getattr(error, "response", {}).get("Error", {}).get("Code")
            if code in ("NoSuchKey", "404"):
                continue
            raise
        try:
            driver.write_stream(target, body, size)
        finally:
            body.close()
        copied += size
    return copied


def _save_to_destination(snapshot, copy, destination, dump_path, files, files_index, source) -> None:
    driver = driver_for(destination)
    copy.status = CopyStatus.RUNNING
    copy.location = driver.location("" if not driver.stores_files else f"snapshots/{snapshot.folder}")
    copy.save(update_fields=["status", "location"])

    if isinstance(driver, PostgresDriver):
        _set_progress(snapshot, f"Loading the standby database {destination.name}")
        driver.load_dump(dump_path, dump_timeout())
        copy.size = snapshot.database_size
        return

    base = f"snapshots/{snapshot.folder}"
    _set_progress(snapshot, f"Saving the database to {destination.name}")
    driver.write_file(f"{base}/database.dump", dump_path)
    size = snapshot.database_size
    if snapshot.include_files:
        size += _copy_files(snapshot, copy, driver, files, source)
        driver.write_bytes(f"{base}/files.json.gz", files_index)
    # Last: a backup folder without a manifest is incomplete.
    driver.write_bytes(f"{base}/manifest.json", json.dumps(build_manifest(snapshot), indent=2).encode())
    copy.size = size


def run_backup(snapshot_id) -> BackupSnapshot:
    snapshot = BackupSnapshot.objects.get(pk=snapshot_id)
    if snapshot.status != SnapshotStatus.QUEUED:
        return snapshot

    snapshot.status = SnapshotStatus.RUNNING
    snapshot.started_at = timezone.now()
    snapshot.progress = "Starting"
    snapshot.save(update_fields=["status", "started_at", "progress"])

    temp = work_dir() / snapshot.folder
    try:
        destinations = list(BackupDestination.objects.filter(is_enabled=True))
        if not destinations:
            raise BackupFailed("There is no destination to save the backup to. Add one in the Destinations tab.")
        copies = {
            d.id: BackupCopy.objects.create(
                snapshot=snapshot, destination=d, destination_name=d.name, destination_kind=d.kind
            )
            for d in destinations
        }

        temp.mkdir(parents=True, exist_ok=True)
        check_free_space(temp, database_size())

        snapshot.app_version = app_version()
        snapshot.postgres_version = postgres_version()
        snapshot.migrations = latest_migrations()
        snapshot.stats = content_stats()

        _set_progress(snapshot, "Saving the database")
        dump_path = temp / "database.dump"
        dump_database(dump_path)
        snapshot.database_size = dump_path.stat().st_size
        snapshot.database_checksum = file_checksum(dump_path)

        files: list[tuple[str, int]] = []
        files_index = b""
        source = None
        needs_files = snapshot.include_files and any(d.kind != "postgres" for d in destinations)
        if needs_files:
            _set_progress(snapshot, "Listing uploaded files")
            try:
                source = source_bucket_client()
                files = list(iter_source_files(source))
            except Exception as error:  # noqa: BLE001
                logger.exception("Listing uploaded files for backup failed")
                raise BackupFailed(
                    "Couldn't read the uploaded files from the platform's storage. Ask your IT team to check "
                    "that the server can reach it (BACKUP_SOURCE_S3_ENDPOINT_URL)."
                ) from error
            snapshot.files_count = len(files)
            snapshot.files_size = sum(size for _, size in files)
            files_index = gzip.compress(json.dumps([{"key": k, "size": s} for k, s in files]).encode())
        snapshot.save()

        for destination in destinations:
            copy = copies[destination.id]
            try:
                _save_to_destination(snapshot, copy, destination, dump_path, files, files_index, source)
                copy.status = CopyStatus.SUCCEEDED
            except DestinationError as error:
                copy.status, copy.error = CopyStatus.FAILED, str(error)
            except Exception:  # noqa: BLE001 - one destination must not stop the others
                logger.exception("Saving backup %s to %s failed", snapshot.folder, destination.name)
                copy.status, copy.error = CopyStatus.FAILED, "Unexpected error. Details are in the server logs."
            copy.finished_at = timezone.now()
            copy.save(update_fields=["status", "error", "size", "finished_at"])

        results = [c.status for c in copies.values()]
        if all(s == CopyStatus.SUCCEEDED for s in results):
            snapshot.status = SnapshotStatus.SUCCEEDED
        elif any(s == CopyStatus.SUCCEEDED for s in results):
            snapshot.status = SnapshotStatus.PARTIAL
            snapshot.error = "Some destinations could not be reached."
        else:
            snapshot.status = SnapshotStatus.FAILED
            snapshot.error = "The backup could not be saved to any destination."
    except BackupFailed as error:
        snapshot.status = SnapshotStatus.FAILED
        snapshot.error = str(error)
    except Exception:  # noqa: BLE001
        logger.exception("Backup %s failed", snapshot.folder)
        snapshot.status = SnapshotStatus.FAILED
        snapshot.error = "Unexpected error. Details are in the server logs."
    finally:
        shutil.rmtree(temp, ignore_errors=True)

    BackupCopy.objects.filter(snapshot=snapshot, status__in=[CopyStatus.PENDING, CopyStatus.RUNNING]).update(
        status=CopyStatus.FAILED, error="Not attempted.", finished_at=timezone.now()
    )
    snapshot.finished_at = timezone.now()
    snapshot.progress = ""
    snapshot.save()

    if snapshot.trigger == SnapshotTrigger.SCHEDULED and snapshot.status != SnapshotStatus.FAILED:
        apply_retention()
    return snapshot


# ---------------------------------------------------------------------------
# Deleting and retention
# ---------------------------------------------------------------------------


def delete_snapshot_data(snapshot: BackupSnapshot) -> list[str]:
    """Remove a backup's folder from every destination. Returns problems as readable text.

    Shared uploaded files stay: other backups may still need them.
    """
    problems = []
    for copy in snapshot.copies.select_related("destination"):
        destination = copy.destination
        if destination is None or copy.status != CopyStatus.SUCCEEDED:
            continue
        if destination.kind == "postgres":
            continue
        try:
            driver_for(destination).delete_folder(f"snapshots/{snapshot.folder}")
        except DestinationError as error:
            problems.append(f"{destination.name}: {error}")
        except Exception:  # noqa: BLE001
            logger.exception("Deleting backup %s from %s failed", snapshot.folder, destination.name)
            problems.append(f"{destination.name}: unexpected error.")
    return problems


def apply_retention() -> list:
    schedule = BackupSchedule.get_solo()
    candidates = [
        RetentionCandidate(s.id, s.trigger, s.status, s.is_pinned, s.created_at)
        for s in BackupSnapshot.objects.filter(trigger=SnapshotTrigger.SCHEDULED).only(
            "id", "trigger", "status", "is_pinned", "created_at"
        )
    ]
    expired = select_expired(candidates, schedule.keep_last, timezone.now())
    for snapshot in BackupSnapshot.objects.filter(id__in=expired):
        problems = delete_snapshot_data(snapshot)
        if problems:
            # Keep the record so the admin can see it and retry the delete.
            logger.warning("Retention could not remove %s: %s", snapshot.folder, problems)
            continue
        snapshot.delete()
    return expired


def mark_stale_runs(now=None) -> int:
    """Fail backups left "running" by a worker that restarted, so a new one can start."""
    now = now or timezone.now()
    stale_after = timedelta(seconds=dump_timeout() + 3600)
    stale = BackupSnapshot.objects.filter(
        status=SnapshotStatus.RUNNING, started_at__lt=now - stale_after
    ) | BackupSnapshot.objects.filter(status=SnapshotStatus.QUEUED, created_at__lt=now - timedelta(hours=6))
    count = 0
    for snapshot in stale:
        snapshot.status = SnapshotStatus.FAILED
        snapshot.error = "The backup stopped unexpectedly, probably because the server restarted."
        snapshot.finished_at = now
        snapshot.progress = ""
        snapshot.save(update_fields=["status", "error", "finished_at", "progress"])
        snapshot.copies.filter(status__in=[CopyStatus.PENDING, CopyStatus.RUNNING]).update(
            status=CopyStatus.FAILED, error="Not finished.", finished_at=now
        )
        count += 1
    return count
