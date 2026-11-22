# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Inspecting a backup and putting it back.

How a restore works, and why it is safe to try:

1. Inspect: the backup is fetched (or unpacked from an upload), its checksum verified, and
   its database loaded into a separate *staging* database. Nothing live is touched. The
   admin sees what is inside and how it compares with today before deciding.
2. Restore (after the admin confirms):
   - a safety backup of the current state is made first;
   - the staging database is upgraded to the running platform version;
   - maintenance mode starts and the backup history is copied into the staging database,
     so the restored platform still knows about every backup and this restore;
   - the databases are swapped by renaming: live -> "<name>_before_restore",
     staging -> live. The swap takes seconds and is undone if it fails half-way;
   - uploaded files missing from storage are put back (existing files are never deleted);
   - caches are cleared and maintenance mode ends.
3. Undo (for 24 hours): the swap is reversed, so the database from before the restore is
   live again.

Sign-ins go back to how they were when the backup was made: sessions are stored in the database.
"""

import gzip
import hashlib
import json
import logging
import shutil
import subprocess
import time
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path
from typing import Optional

from django.conf import settings
from django.core.management import call_command
from django.db import connections
from django.utils import timezone

from plane.backup import maintenance
from plane.backup.bundle import (
    DATABASE,
    FILES_DIR,
    FILES_INDEX,
    MANIFEST,
    BundleError,
    bundle_file_reader,
    extract_bundle,
    read_manifest,
    shared_dir,
)
from plane.backup.destinations import DestinationError, driver_for, format_bytes, source_bucket_client
from plane.backup.models import (
    BackupCopy,
    BackupDestination,
    BackupExport,
    BackupRestore,
    BackupSchedule,
    BackupSnapshot,
    BackupUpload,
    CopyStatus,
    RestoreSource,
    RestoreStatus,
    SnapshotStatus,
    SnapshotTrigger,
)

logger = logging.getLogger("plane.worker")

UNDO_WINDOW = timedelta(hours=24)
STAGING_LIFETIME = timedelta(hours=12)
PROGRESS_EVERY = 50
COUNT_QUERIES = {
    "workspaces": "SELECT count(*) FROM workspaces WHERE deleted_at IS NULL",
    "projects": "SELECT count(*) FROM projects WHERE deleted_at IS NULL",
    "work_items": "SELECT count(*) FROM issues WHERE deleted_at IS NULL",
    "pages": "SELECT count(*) FROM pages WHERE deleted_at IS NULL",
    "users": "SELECT count(*) FROM users WHERE is_bot = false",
}


class RestoreFailed(Exception):
    """Stops a restore with a message the admin can read."""


# ---------------------------------------------------------------------------
# Database names and server-level operations
# ---------------------------------------------------------------------------


def live_name() -> str:
    return settings.DATABASES["default"]["NAME"]


def staging_name() -> str:
    return f"{live_name()}_restore_staging"[:63]


def previous_name() -> str:
    return f"{live_name()}_before_restore"[:63]


def undone_name() -> str:
    return f"{live_name()}_undone"[:63]


def restore_dir(restore_id) -> Path:
    return shared_dir() / "restores" / str(restore_id)


def _server_connection():
    import psycopg

    db = settings.DATABASES["default"]
    params = dict(
        host=db.get("HOST") or "localhost",
        port=int(db.get("PORT") or 5432),
        user=db.get("USER"),
        password=db.get("PASSWORD"),
        autocommit=True,
        connect_timeout=10,
    )
    sslmode = (db.get("OPTIONS") or {}).get("sslmode")
    if sslmode:
        params["sslmode"] = sslmode
    try:
        return psycopg.connect(dbname="postgres", **params)
    except psycopg.OperationalError:
        return psycopg.connect(dbname="template1", **params)


def _ident(name: str):
    from psycopg import sql

    return sql.Identifier(name)


def _execute(statement: str, *names: str) -> None:
    from psycopg import sql

    with _server_connection() as conn:
        conn.execute(sql.SQL(statement).format(*[_ident(n) for n in names]))


def database_exists(name: str) -> bool:
    with _server_connection() as conn:
        return conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone() is not None


def drop_database(name: str) -> None:
    if name == live_name():
        raise RestoreFailed("Refused to delete the live database.")
    _execute("DROP DATABASE IF EXISTS {} WITH (FORCE)", name)


def create_empty_database(name: str) -> None:
    drop_database(name)
    _execute("CREATE DATABASE {}", name)


def privilege_problem() -> Optional[str]:
    """Why this server can't swap databases, or None when it can."""
    try:
        with _server_connection() as conn:
            row = conn.execute(
                "SELECT r.rolsuper, r.rolcreatedb, pg_get_userbyid(d.datdba) = current_user "
                "FROM pg_roles r, pg_database d WHERE r.rolname = current_user AND d.datname = %s",
                (live_name(),),
            ).fetchone()
    except Exception:  # noqa: BLE001
        logger.exception("Could not check database privileges for a restore")
        return "The platform couldn't connect to the database server to prepare the restore."
    if row is None:
        return "The platform couldn't find its own database on the server."
    is_super, can_create, owns_live = row
    if is_super or (can_create and owns_live):
        return None
    return (
        "The platform's database user isn't allowed to create and rename databases. "
        "Ask your IT team to grant CREATEDB and make that user the owner of the database."
    )


def _restore_env() -> dict:
    from plane.backup.runner import _database_env

    return _database_env()


def load_dump_into(name: str, dump_path: Path) -> None:
    binary = shutil.which("pg_restore")
    if not binary:
        raise RestoreFailed("The server is missing the database restore tool (pg_restore).")
    command = [binary, "--no-owner", "--no-privileges", "--exit-on-error", f"--dbname={name}", str(dump_path)]
    try:
        result = subprocess.run(
            command,
            env=_restore_env(),
            capture_output=True,
            timeout=int(getattr(settings, "BACKUP_DB_TIMEOUT_SECONDS", 6 * 3600)),
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        raise RestoreFailed("Loading the backup's database took too long and was stopped.") from error
    if result.returncode != 0:
        logger.error("pg_restore into %s failed: %s", name, result.stderr.decode(errors="replace")[-3000:])
        raise RestoreFailed("The database inside this backup couldn't be loaded. The file may be damaged.")


@contextmanager
def database_alias(name: str):
    """A temporary Django connection to another database on the same server."""
    alias = f"backup_{name}"[:60]
    connections.databases[alias] = {**connections.databases["default"], "NAME": name}
    try:
        yield alias
    finally:
        try:
            connections[alias].close()
            del connections[alias]
        except Exception:  # noqa: BLE001
            pass
        connections.databases.pop(alias, None)


def _terminate(conn, *names: str) -> None:
    conn.execute(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ANY(%s) AND pid <> pg_backend_pid()",
        (list(names),),
    )


def swap_live(new_live: str, keep_old_as: str) -> None:
    """Make `new_live` the live database and rename the current one to `keep_old_as`.

    Connections are blocked and closed for the few seconds the renames take. If the
    second rename fails, the first is reversed so the platform keeps its database.
    """
    from psycopg import errors, sql

    live = live_name()
    connections.close_all()
    with _server_connection() as conn:
        conn.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(_ident(keep_old_as)))
        conn.execute(sql.SQL("ALTER DATABASE {} WITH ALLOW_CONNECTIONS false").format(_ident(live)))
        old_name = live
        try:
            for attempt in range(10):
                _terminate(conn, live, new_live)
                try:
                    conn.execute(sql.SQL("ALTER DATABASE {} RENAME TO {}").format(_ident(live), _ident(keep_old_as)))
                    old_name = keep_old_as
                    break
                except errors.ObjectInUse:
                    time.sleep(0.5 * (attempt + 1))
            else:
                raise RestoreFailed("The database stayed busy, so the switch was cancelled. Nothing changed.")
            try:
                _terminate(conn, new_live)
                conn.execute(sql.SQL("ALTER DATABASE {} RENAME TO {}").format(_ident(new_live), _ident(live)))
            except Exception:
                conn.execute(sql.SQL("ALTER DATABASE {} RENAME TO {}").format(_ident(keep_old_as), _ident(live)))
                old_name = live
                raise
        finally:
            conn.execute(sql.SQL("ALTER DATABASE {} WITH ALLOW_CONNECTIONS true").format(_ident(old_name)))
    connections.close_all()


# ---------------------------------------------------------------------------
# Reading what is inside a database
# ---------------------------------------------------------------------------


def _scalar(cursor, query: str, params=()):
    try:
        cursor.execute(query, params)
        row = cursor.fetchone()
        return row[0] if row else None
    except Exception:  # noqa: BLE001 - older schemas may lack a table; the summary simply omits it
        return None


def collect_counts(alias: str) -> dict:
    counts = {}
    with connections[alias].cursor() as cursor:
        for key, query in COUNT_QUERIES.items():
            value = _scalar(cursor, query)
            if value is not None:
                counts[key] = int(value)
        last = _scalar(cursor, "SELECT max(updated_at) FROM issues")
        counts["last_activity"] = last.isoformat() if last else None
    return counts


def _applied_migrations(cursor) -> set:
    try:
        cursor.execute("SELECT app, name FROM django_migrations")
        return set(cursor.fetchall())
    except Exception:  # noqa: BLE001
        return set()


def collect_preview(alias: str) -> dict:
    preview: dict = {"workspaces": [], "admins": [], "instance_name": None}
    with connections[alias].cursor() as cursor:
        try:
            cursor.execute(
                "SELECT w.name, w.slug, (SELECT count(*) FROM projects p "
                "WHERE p.workspace_id = w.id AND p.deleted_at IS NULL) "
                "FROM workspaces w WHERE w.deleted_at IS NULL ORDER BY w.created_at LIMIT 25"
            )
            preview["workspaces"] = [{"name": n, "slug": s, "projects": int(p)} for n, s, p in cursor.fetchall()]
        except Exception:  # noqa: BLE001
            pass
        try:
            cursor.execute(
                "SELECT u.email FROM instance_admins a JOIN users u ON u.id = a.user_id "
                "WHERE a.deleted_at IS NULL ORDER BY u.email"
            )
            preview["admins"] = [row[0] for row in cursor.fetchall()]
        except Exception:  # noqa: BLE001
            pass
        preview["instance_name"] = _scalar(cursor, "SELECT instance_name FROM instances LIMIT 1")
        preview["secret_key_matches"] = _secret_key_matches(cursor)
        preview["_migrations"] = sorted(_applied_migrations(cursor))
    return preview


def _secret_key_matches(cursor) -> Optional[bool]:
    """Whether saved passwords in the backup can be read with this server's SECRET_KEY."""
    from cryptography.fernet import Fernet, InvalidToken

    from plane.license.utils.encryption import derive_key

    try:
        cursor.execute("SELECT value FROM instance_configurations WHERE is_encrypted AND value <> '' LIMIT 3")
        values = [row[0] for row in cursor.fetchall()]
    except Exception:  # noqa: BLE001
        return None
    if not values:
        return None
    cipher = Fernet(derive_key(settings.SECRET_KEY))
    try:
        for value in values:
            cipher.decrypt(value.encode())
        return True
    except (InvalidToken, ValueError):
        return False


def migration_compatibility(applied: set) -> tuple[list, int]:
    """(unknown migrations from a newer version, number of upgrades still to apply)."""
    from django.db.migrations.loader import MigrationLoader

    loader = MigrationLoader(None, ignore_no_migrations=True)
    known = set(loader.disk_migrations.keys())
    apps = loader.migrated_apps
    applied = {(app, name) for app, name in applied if app in apps}
    unknown = sorted(applied - known)
    pending = len({m for m in known if m[0] in {a for a, _ in applied}} - applied)
    return unknown, pending


# ---------------------------------------------------------------------------
# Getting the backup's files ready
# ---------------------------------------------------------------------------


def pick_copy(snapshot: BackupSnapshot) -> BackupCopy:
    """The saved copy to read from: a server folder first (fastest), then cloud storage."""
    copies = [
        c
        for c in snapshot.copies.select_related("destination")
        if c.status == CopyStatus.SUCCEEDED and c.destination is not None and c.destination.kind != "postgres"
    ]
    if not copies:
        raise RestoreFailed(
            "None of the places this backup was saved to are available any more, so it can't be restored."
        )
    copies.sort(key=lambda c: 0 if c.destination.kind == "local" else 1)
    return copies[0]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch_backup(restore: BackupRestore, progress) -> dict:
    """Put manifest.json, database.dump (and files.json.gz) in the restore folder. Returns the manifest."""
    folder = restore_dir(restore.id)
    folder.mkdir(parents=True, exist_ok=True)

    if restore.source == RestoreSource.SNAPSHOT:
        if restore.snapshot is None:
            raise RestoreFailed("This backup was deleted.")
        copy = pick_copy(restore.snapshot)
        driver = driver_for(copy.destination)
        base = f"snapshots/{restore.snapshot.folder}"
        progress(f"Reading the backup from {copy.destination.name}")
        try:
            manifest = read_manifest(driver.read_bytes(f"{base}/{MANIFEST}"))
            (folder / MANIFEST).write_bytes(json.dumps(manifest).encode())
            progress(f"Copying the database from {copy.destination.name}")
            driver.download_file(f"{base}/{DATABASE}", folder / DATABASE)
            if manifest.get("files", {}).get("included"):
                (folder / FILES_INDEX).write_bytes(driver.read_bytes(f"{base}/{FILES_INDEX}"))
        except BundleError as error:
            raise RestoreFailed(str(error)) from error
        except DestinationError as error:
            raise RestoreFailed(f"{copy.destination.name}: {error}") from error
        return manifest

    upload = restore.upload
    bundle = upload_path(upload.id) if upload else None
    if upload is None or bundle is None or not bundle.is_file():
        raise RestoreFailed("The uploaded file is no longer on the server. Upload it again.")
    progress("Unpacking the uploaded backup")
    # The archive is compressed; allow it to unpack to a few times its upload limit.
    max_unpacked = getattr(settings, "BACKUP_MAX_UPLOAD_BYTES", 50 * 1024**3) * 4
    try:
        manifest = extract_bundle(bundle, folder, max_bytes=max_unpacked, progress=progress)
    except BundleError as error:
        raise RestoreFailed(str(error)) from error
    # The unpacked copy is all we need from here on.
    bundle.unlink(missing_ok=True)
    return manifest


def upload_path(upload_id) -> Path:
    return shared_dir() / "uploads" / f"{upload_id}.tar.gz"


# ---------------------------------------------------------------------------
# Inspect
# ---------------------------------------------------------------------------


def _check(level: str, text: str) -> dict:
    return {"level": level, "text": text}


def _major(version: str) -> int:
    try:
        return int(str(version).split(".")[0])
    except (TypeError, ValueError):
        return 0


def inspect_restore(restore_id) -> BackupRestore:
    restore = BackupRestore.objects.select_related("snapshot", "upload", "created_by").get(pk=restore_id)
    if restore.status != RestoreStatus.INSPECTING:
        return restore

    def progress(text: str) -> None:
        restore.progress = text[:255]
        BackupRestore.objects.filter(pk=restore.pk).update(progress=restore.progress)
        maintenance.publish_status(restore.id, status=RestoreStatus.INSPECTING, progress=text)

    checks: list = []
    staging = staging_name()
    try:
        problem = privilege_problem()
        if problem:
            raise RestoreFailed(problem)

        manifest = fetch_backup(restore, progress)
        restore.manifest = manifest
        folder = restore_dir(restore.id)

        progress("Checking the backup isn't damaged")
        expected = (manifest.get("database") or {}).get("sha256")
        actual = _sha256(folder / DATABASE)
        if expected and expected != actual:
            raise RestoreFailed("The database file in this backup is damaged (its checksum doesn't match).")
        checks.append(_check("ok", "The backup file is complete and undamaged."))

        progress("Loading the backup into a separate preview database")
        create_empty_database(staging)
        load_dump_into(staging, folder / DATABASE)

        progress("Reading what is inside")
        with database_alias(staging) as alias:
            backup_counts = collect_counts(alias)
            preview = collect_preview(alias)
        current_counts = collect_counts("default")
        restore.comparison = {"backup": backup_counts, "current": current_counts}

        applied = {tuple(m) for m in preview.pop("_migrations", [])}
        unknown, pending = migration_compatibility(applied)
        if unknown:
            checks.append(
                _check(
                    "blocker",
                    "This backup was made by a newer version of the platform than the one running now. "
                    "Upgrade the platform first, then restore.",
                )
            )
        elif pending:
            checks.append(
                _check(
                    "info",
                    f"This backup is from an older version. It will be upgraded automatically ({pending} updates).",
                )
            )
        else:
            checks.append(_check("ok", "The backup matches the platform version running now."))

        backup_pg, live_pg = _major(manifest.get("postgres_version", "")), _major(_server_version())
        if backup_pg and live_pg and backup_pg > live_pg:
            checks.append(
                _check(
                    "warning",
                    f"The backup came from PostgreSQL {backup_pg}, newer than this server's {live_pg}. "
                    "It loaded fine, but keep an eye out for problems.",
                )
            )

        current_email = restore.created_by.email if restore.created_by else None
        if preview.get("admins"):
            if current_email and current_email not in preview["admins"]:
                checks.append(
                    _check(
                        "warning",
                        f"Your account ({current_email}) is not an admin in this backup. After the restore, "
                        f"sign in as one of: {', '.join(preview['admins'][:5])}.",
                    )
                )
        else:
            checks.append(
                _check("warning", "This backup has no instance admin. Someone with server access will need to add one.")
            )

        if preview.get("secret_key_matches") is False:
            checks.append(
                _check(
                    "warning",
                    "This backup was made on a server with a different secret key. Saved passwords inside it "
                    "(email settings, backup destinations) won't work and must be entered again.",
                )
            )

        files = manifest.get("files") or {}
        if not files.get("included"):
            checks.append(_check("info", "This backup has no uploaded files. Attachments stay as they are now."))
        elif restore.source == RestoreSource.UPLOAD and not (folder / FILES_DIR).is_dir():
            checks.append(_check("info", "The uploaded file holds no attachments. Current ones are kept."))
        else:
            checks.append(
                _check(
                    "info",
                    f"{files.get('count', 0):,} uploaded files ({format_bytes(files.get('size', 0))}) will be put back "
                    "if they are missing. Files added since are kept.",
                )
            )

        has_safety_target = BackupDestination.objects.filter(is_enabled=True).exclude(kind="postgres").exists()
        if has_safety_target:
            checks.append(_check("ok", "A safety backup of the current data will be made first."))
        else:
            checks.append(
                _check(
                    "warning",
                    "There is no destination for a safety backup. The current database is still kept for 24 hours "
                    "so the restore can be undone.",
                )
            )
        checks.append(
            _check(
                "info",
                "Sign-ins go back to how they were at backup time. Anyone who signed in later must sign in again.",
            )
        )

        restore.preview = preview
        restore.checks = checks
        restore.can_restore = not any(c["level"] == "blocker" for c in checks)
        restore.status = RestoreStatus.READY if restore.can_restore else RestoreStatus.INVALID
        if not restore.can_restore:
            drop_database(staging)
    except RestoreFailed as error:
        restore.status = RestoreStatus.INVALID
        restore.error = str(error)
        restore.checks = checks + [_check("blocker", str(error))]
        _quiet_drop(staging)
    except Exception:  # noqa: BLE001
        logger.exception("Inspecting restore %s failed", restore.id)
        restore.status = RestoreStatus.INVALID
        restore.error = "Unexpected error while checking the backup. Details are in the server logs."
        restore.checks = checks + [_check("blocker", restore.error)]
        _quiet_drop(staging)

    restore.progress = ""
    restore.inspected_at = timezone.now()
    restore.save()
    if restore.status == RestoreStatus.INVALID:
        shutil.rmtree(restore_dir(restore.id), ignore_errors=True)
    maintenance.publish_status(restore.id, status=restore.status, progress="", error=restore.error)
    return restore


def _server_version() -> str:
    with connections["default"].cursor() as cursor:
        cursor.execute("SHOW server_version")
        return str(cursor.fetchone()[0])


def _quiet_drop(name: str) -> None:
    try:
        drop_database(name)
    except Exception:  # noqa: BLE001
        logger.exception("Could not drop %s", name)


# ---------------------------------------------------------------------------
# Restore and undo
# ---------------------------------------------------------------------------

CARRIED_MODELS = (
    BackupDestination,
    BackupSchedule,
    BackupSnapshot,
    BackupCopy,
    BackupUpload,
    BackupExport,
    BackupRestore,
)


def carry_backup_records(source_alias: str, target_alias: str) -> None:
    """Replace the backup history in `target` with the one in `source`.

    Rows point at users through created_by and similar fields. Users that don't exist in
    the target database are dropped from those fields instead of failing the copy.
    """
    from django.contrib.auth import get_user_model
    from django.db import transaction

    user_model = get_user_model()
    target_users = set(user_model.objects.using(target_alias).values_list("id", flat=True))
    with transaction.atomic(using=target_alias):
        for model in reversed(CARRIED_MODELS):
            model.objects.using(target_alias).all().delete()
        for model in CARRIED_MODELS:
            # bulk_create stamps auto_now / auto_now_add fields with "now"; the history must keep its dates.
            stamped = [
                f.attname
                for f in model._meta.concrete_fields
                if getattr(f, "auto_now", False) or getattr(f, "auto_now_add", False)
            ]
            rows, originals = [], []
            for obj in model.objects.using(source_alias).all().iterator():
                for field in model._meta.concrete_fields:
                    if field.is_relation and field.related_model is user_model:
                        if getattr(obj, field.attname) not in target_users:
                            setattr(obj, field.attname, None)
                obj._state.db = target_alias
                obj._state.adding = True
                originals.append({name: getattr(obj, name) for name in stamped})
                rows.append(obj)
            model.objects.using(target_alias).bulk_create(rows, batch_size=500)
            if stamped and rows:
                for obj, values in zip(rows, originals):
                    for name, value in values.items():
                        setattr(obj, name, value)
                model.objects.using(target_alias).bulk_update(rows, stamped, batch_size=500)


def _restore_files(restore: BackupRestore, progress) -> tuple[int, int]:
    """Put back uploaded files that are missing from storage. Returns (restored, failed)."""
    manifest = restore.manifest or {}
    if not (manifest.get("files") or {}).get("included"):
        return 0, 0
    folder = restore_dir(restore.id)
    if restore.source == RestoreSource.UPLOAD:
        if not (folder / FILES_DIR).is_dir():
            return 0, 0
        reader = bundle_file_reader(folder)
    else:
        if restore.snapshot is None:
            return 0, 0
        reader = driver_for(pick_copy(restore.snapshot).destination)
    index_path = folder / FILES_INDEX
    if not index_path.is_file():
        return 0, 0
    files = json.loads(gzip.decompress(index_path.read_bytes()))
    bucket = settings.AWS_STORAGE_BUCKET_NAME
    client = source_bucket_client()
    restored = failed = 0
    for number, item in enumerate(files, start=1):
        if number == 1 or number % PROGRESS_EVERY == 0:
            progress(f"Checking uploaded files ({number} of {len(files)})")
        key, size = item["key"], int(item["size"])
        try:
            head = client.head_object(Bucket=bucket, Key=key)
            if int(head.get("ContentLength", -1)) == size:
                continue
        except Exception:  # noqa: BLE001 - missing; put it back below
            pass
        try:
            stream = reader.open_read(f"files/{key}")
            try:
                client.upload_fileobj(stream, bucket, key)
            finally:
                stream.close()
            restored += 1
        except Exception:  # noqa: BLE001
            logger.exception("Could not restore uploaded file %s", key)
            failed += 1
    return restored, failed


def _clear_app_cache() -> None:
    from django.core.cache import cache

    try:
        # Only the cache's own keys: Redis also holds the maintenance flag and restore status.
        cache.delete_pattern("*")
    except Exception:  # noqa: BLE001
        logger.exception("Could not clear the cache after a restore")


def _safety_backup(restore: BackupRestore, progress) -> Optional[BackupSnapshot]:
    from plane.backup.runner import run_backup
    from plane.backup.tasks import create_snapshot

    if not BackupDestination.objects.filter(is_enabled=True).exclude(kind="postgres").exists():
        return None
    progress("Making a safety backup of the current data")
    snapshot = create_snapshot(
        trigger=SnapshotTrigger.SAFETY,
        include_files=False,
        note=f"Before restoring {restore.label}"[:200],
        user=restore.confirmed_by,
    )
    snapshot = run_backup(snapshot.id)
    if snapshot.status == SnapshotStatus.FAILED:
        raise RestoreFailed(f"The safety backup failed, so nothing was restored. {snapshot.error}")
    return snapshot


def run_restore(restore_id) -> None:
    restore = BackupRestore.objects.select_related("snapshot", "upload", "confirmed_by").get(pk=restore_id)
    if restore.status != RestoreStatus.QUEUED:
        return

    def progress(text: str, step: str = "") -> None:
        maintenance.publish_status(restore.id, status=RestoreStatus.RUNNING, progress=text, step=step or text)
        try:
            BackupRestore.objects.filter(pk=restore.pk).update(progress=text[:255])
        except Exception:  # noqa: BLE001 - the database may be mid-swap
            pass

    restore.status = RestoreStatus.RUNNING
    restore.started_at = timezone.now()
    restore.save(update_fields=["status", "started_at"])
    staging = staging_name()
    switched = False
    try:
        restore.safety_snapshot = _safety_backup(restore, progress)
        restore.save(update_fields=["safety_snapshot"])

        if not database_exists(staging):
            raise RestoreFailed("The checked copy of this backup has expired. Check the backup again, then restore.")

        progress("Upgrading the backup to the current platform version")
        with database_alias(staging) as alias:
            call_command("migrate", database=alias, interactive=False, verbosity=0)

            progress("Pausing the platform")
            maintenance.set_maintenance(f"restore:{restore.id}")
            restore.progress = "Switching to the restored data"
            restore.save(update_fields=["progress"])
            carry_backup_records("default", alias)

        progress("Switching to the restored data")
        swap_live(new_live=staging, keep_old_as=previous_name())
        switched = True

        restore = BackupRestore.objects.select_related("snapshot", "upload").get(pk=restore_id)
        restored, failed = _restore_files(restore, progress)
        restore.files_restored, restore.files_failed = restored, failed
        if failed:
            restore.error = f"{failed} uploaded files couldn't be put back. Details are in the server logs."
        restore.status = RestoreStatus.SUCCEEDED
        restore.undo_until = timezone.now() + UNDO_WINDOW
    except RestoreFailed as error:
        restore.status = RestoreStatus.FAILED
        restore.error = str(error)
    except Exception:  # noqa: BLE001
        logger.exception("Restore %s failed", restore_id)
        restore.status = RestoreStatus.SUCCEEDED if switched else RestoreStatus.FAILED
        restore.error = (
            "The data was restored, but a final step failed. Details are in the server logs."
            if switched
            else "Unexpected error. Nothing was changed. Details are in the server logs."
        )
        if switched:
            restore.undo_until = timezone.now() + UNDO_WINDOW
    finally:
        _clear_app_cache()
        maintenance.clear_maintenance()

    restore.progress = ""
    restore.finished_at = timezone.now()
    restore.save()
    if restore.status == RestoreStatus.FAILED:
        _quiet_drop(staging)
    shutil.rmtree(restore_dir(restore.id), ignore_errors=True)
    maintenance.publish_status(
        restore.id, status=restore.status, progress="", step="", error=restore.error, switched=switched
    )


def undo_available(restore: BackupRestore) -> bool:
    return (
        restore.status == RestoreStatus.SUCCEEDED
        and restore.undo_until is not None
        and restore.undo_until > timezone.now()
    )


def run_undo(restore_id) -> None:
    restore = BackupRestore.objects.get(pk=restore_id)
    if restore.status != RestoreStatus.UNDOING:
        return
    previous = previous_name()
    switched = False
    try:
        if not database_exists(previous):
            raise RestoreFailed("The data from before the restore is no longer kept, so it can't be undone.")
        maintenance.publish_status(restore.id, status=RestoreStatus.UNDOING, progress="Pausing the platform")
        maintenance.set_maintenance(f"undo:{restore.id}")
        with database_alias(previous) as alias:
            carry_backup_records("default", alias)
            BackupRestore.objects.using(alias).filter(pk=restore.pk).update(
                status=RestoreStatus.UNDONE, undone_at=timezone.now(), progress=""
            )
        maintenance.publish_status(restore.id, status=RestoreStatus.UNDOING, progress="Switching back")
        swap_live(new_live=previous, keep_old_as=undone_name())
        switched = True
        _quiet_drop(undone_name())
    except RestoreFailed as error:
        BackupRestore.objects.filter(pk=restore.pk).update(status=RestoreStatus.SUCCEEDED, error=str(error))
        maintenance.publish_status(
            restore.id, status=RestoreStatus.SUCCEEDED, progress="", error=str(error), switched=False
        )
        return
    except Exception:  # noqa: BLE001
        logger.exception("Undo of restore %s failed", restore_id)
        if not switched:
            BackupRestore.objects.filter(pk=restore.pk).update(
                status=RestoreStatus.SUCCEEDED, error="Undo failed. Nothing was changed."
            )
    finally:
        _clear_app_cache()
        maintenance.clear_maintenance()
    maintenance.publish_status(
        restore.id,
        status=RestoreStatus.UNDONE if switched else RestoreStatus.SUCCEEDED,
        progress="",
        switched=switched,
    )


# ---------------------------------------------------------------------------
# Housekeeping
# ---------------------------------------------------------------------------


def cancel_restore(restore: BackupRestore) -> None:
    """Throw away a checked-but-not-used restore and its staging database."""
    if restore.status in (RestoreStatus.READY, RestoreStatus.INVALID, RestoreStatus.INSPECTING):
        _quiet_drop(staging_name())
        shutil.rmtree(restore_dir(restore.id), ignore_errors=True)
        restore.status = RestoreStatus.CANCELLED
        restore.save(update_fields=["status"])


def cleanup(now=None) -> dict:
    now = now or timezone.now()
    done = {"expired_restores": 0, "dropped_previous": False, "expired_exports": 0, "removed_uploads": 0}

    for restore in BackupRestore.objects.filter(status=RestoreStatus.READY, inspected_at__lt=now - STAGING_LIFETIME):
        cancel_restore(restore)
        BackupRestore.objects.filter(pk=restore.pk).update(status=RestoreStatus.EXPIRED)
        done["expired_restores"] += 1

    stuck = BackupRestore.objects.filter(
        status__in=[RestoreStatus.INSPECTING, RestoreStatus.QUEUED], created_at__lt=now - timedelta(hours=12)
    )
    for restore in stuck:
        restore.status = RestoreStatus.FAILED if restore.status == RestoreStatus.QUEUED else RestoreStatus.INVALID
        restore.error = "This stopped unexpectedly, probably because the server restarted."
        restore.save(update_fields=["status", "error"])

    # Never while a restore or undo is switching databases: its undo window isn't saved yet.
    busy = BackupRestore.objects.filter(status__in=[RestoreStatus.RUNNING, RestoreStatus.UNDOING]).exists()
    any_undo = any(undo_available(r) for r in BackupRestore.objects.filter(status=RestoreStatus.SUCCEEDED))
    if not busy and not any_undo and database_exists(previous_name()):
        _quiet_drop(previous_name())
        done["dropped_previous"] = True

    from plane.backup.exports import export_path

    for export in BackupExport.objects.filter(status="ready", expires_at__lt=now):
        export_path(export.id).unlink(missing_ok=True)
        export.status = "expired"
        export.save(update_fields=["status"])
        done["expired_exports"] += 1

    open_uploads = set(
        BackupRestore.objects.filter(status=RestoreStatus.INSPECTING).values_list("upload_id", flat=True)
    )
    for upload in BackupUpload.objects.filter(updated_at__lt=now - timedelta(hours=24)):
        if upload.id in open_uploads:
            continue
        path = upload_path(upload.id)
        if path.exists():
            path.unlink(missing_ok=True)
            done["removed_uploads"] += 1

    # Unpacked restores that are no longer needed.
    restores_root = shared_dir() / "restores"
    if restores_root.is_dir():
        keep = {
            str(r)
            for r in BackupRestore.objects.filter(
                status__in=[RestoreStatus.INSPECTING, RestoreStatus.READY, RestoreStatus.QUEUED, RestoreStatus.RUNNING]
            ).values_list("id", flat=True)
        }
        for child in restores_root.iterdir():
            if child.name not in keep:
                shutil.rmtree(child, ignore_errors=True)
    return done
