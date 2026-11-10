# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import gzip
import hashlib
import io
import json
import tarfile
from datetime import timedelta
from unittest import mock

import pytest
from django.test import RequestFactory
from django.utils import timezone

from plane.backup import maintenance, restore as restore_module
from plane.backup.bundle import BundleError, build_bundle, extract_bundle, read_manifest
from plane.backup.destinations import LocalDriver
from plane.backup.exports import export_path, run_export
from plane.backup.models import (
    BackupCopy,
    BackupDestination,
    BackupExport,
    BackupRestore,
    BackupSnapshot,
    CopyStatus,
    ExportStatus,
    RestoreSource,
    RestoreStatus,
    SnapshotStatus,
)

DUMP = b"PGDMP fake dump bytes"


def manifest_for(folder, dump=DUMP, files=None):
    files = files or {}
    return {
        "format": "sgtpm-backup",
        "version": 1,
        "folder": folder,
        "created_at": "2026-11-10T02:00:00+00:00",
        "app_version": "1.0",
        "postgres_version": "15.7",
        "database": {"file": "database.dump", "size": len(dump), "sha256": hashlib.sha256(dump).hexdigest()},
        "files": {
            "included": bool(files),
            "count": len(files),
            "size": sum(len(v) for v in files.values()),
        },
    }


@pytest.fixture
def backup_area(settings, tmp_path):
    settings.BACKUP_LOCAL_ROOT = str(tmp_path / "area")
    settings.BACKUP_SHARED_DIR = str(tmp_path / "area" / ".staging")
    (tmp_path / "area").mkdir()
    return tmp_path / "area"


def save_backup(driver, folder, dump=DUMP, files=None, manifest=None):
    files = files or {}
    base = f"snapshots/{folder}"
    driver.write_bytes(f"{base}/database.dump", dump)
    if files:
        index = [{"key": k, "size": len(v)} for k, v in files.items()]
        driver.write_bytes(f"{base}/files.json.gz", gzip.compress(json.dumps(index).encode()))
        for key, data in files.items():
            driver.write_bytes(f"files/{key}", data)
    driver.write_bytes(f"{base}/manifest.json", json.dumps(manifest or manifest_for(folder, dump, files)).encode())


@pytest.mark.unit
class TestBundle:
    def test_round_trip_with_files(self, backup_area, tmp_path):
        driver = LocalDriver({"folder": "main"}, {})
        files = {"ws/a.png": b"aaa", "ws/b.pdf": b"bbbbb"}
        save_backup(driver, "f1", files=files)
        target = tmp_path / "out" / "bundle.tar.gz"

        size = build_bundle(target, driver, "f1", include_files=True)

        assert size == target.stat().st_size > 0
        unpacked = tmp_path / "unpacked"
        manifest = extract_bundle(target, unpacked, max_bytes=10_000)
        assert manifest["folder"] == "f1"
        assert (unpacked / "database.dump").read_bytes() == DUMP
        assert (unpacked / "files" / "ws" / "b.pdf").read_bytes() == b"bbbbb"
        assert not list(target.parent.glob("*.part")) and not list(target.parent.glob("*.dump"))

    def test_without_files_leaves_them_out(self, backup_area, tmp_path):
        driver = LocalDriver({"folder": "main"}, {})
        save_backup(driver, "f1", files={"a.png": b"a"})
        target = tmp_path / "bundle.tar.gz"
        build_bundle(target, driver, "f1", include_files=False)
        with tarfile.open(target) as tar:
            assert sorted(tar.getnames()) == ["database.dump", "manifest.json"]

    def _tar(self, tmp_path, members):
        path = tmp_path / "evil.tar.gz"
        with tarfile.open(path, "w:gz") as tar:
            for name, data, kind in members:
                info = tarfile.TarInfo(name)
                if kind == "symlink":
                    info.type = tarfile.SYMTYPE
                    info.linkname = "/etc/passwd"
                    tar.addfile(info)
                else:
                    info.size = len(data)
                    tar.addfile(info, io.BytesIO(data))
        return path

    @pytest.mark.parametrize(
        "name,kind",
        [("../escape.txt", "file"), ("/abs.txt", "file"), ("other.txt", "file"), ("files/link", "symlink")],
    )
    def test_refuses_unexpected_content(self, tmp_path, name, kind):
        manifest = json.dumps(manifest_for("x")).encode()
        path = self._tar(
            tmp_path, [("manifest.json", manifest, "file"), ("database.dump", DUMP, "file"), (name, b"x", kind)]
        )
        with pytest.raises(BundleError, match="unexpected content"):
            extract_bundle(path, tmp_path / "out", max_bytes=10_000)
        assert not (tmp_path / "escape.txt").exists()

    def test_refuses_missing_database(self, tmp_path):
        path = self._tar(tmp_path, [("manifest.json", json.dumps(manifest_for("x")).encode(), "file")])
        with pytest.raises(BundleError, match="missing the database"):
            extract_bundle(path, tmp_path / "out", max_bytes=10_000)

    def test_refuses_oversized_content(self, tmp_path):
        manifest = json.dumps(manifest_for("x")).encode()
        path = self._tar(tmp_path, [("manifest.json", manifest, "file"), ("database.dump", b"x" * 500, "file")])
        with pytest.raises(BundleError, match="more data than expected"):
            extract_bundle(path, tmp_path / "out", max_bytes=100)

    def test_refuses_non_archives(self, tmp_path):
        path = tmp_path / "notes.tar.gz"
        path.write_bytes(b"just text")
        with pytest.raises(BundleError, match="isn't a backup archive"):
            extract_bundle(path, tmp_path / "out", max_bytes=100)

    def test_manifest_checks(self):
        with pytest.raises(BundleError, match="not a backup made by this platform"):
            read_manifest(b'{"format": "other"}')
        with pytest.raises(BundleError, match="damaged"):
            read_manifest(b"{not json")
        with pytest.raises(BundleError, match="newer version"):
            read_manifest(json.dumps({"format": "sgtpm-backup", "version": 99}).encode())


@pytest.mark.unit
class TestMaintenanceMiddleware:
    def call(self, path, reason):
        middleware = maintenance.MaintenanceModeMiddleware(lambda request: "passed")
        with mock.patch.object(maintenance, "_current_reason", return_value=reason):
            return middleware(RequestFactory().get(path))

    def test_blocks_api_and_sign_in_during_a_restore(self):
        for path in ("/api/workspaces/", "/auth/sign-in/", "/api/instances/backups/overview/"):
            response = self.call(path, "restore:1")
            assert response.status_code == 503
            assert json.loads(response.content)["error"] == "MAINTENANCE"

    def test_status_and_instance_info_stay_open(self):
        assert self.call("/api/instances/backups/restores/abc/status/", "restore:1") == "passed"
        assert self.call("/api/instances/", "restore:1") == "passed"

    def test_passes_everything_normally(self):
        assert self.call("/api/workspaces/", "") == "passed"


@pytest.mark.unit
@pytest.mark.django_db
class TestCompatibility:
    @pytest.fixture(autouse=True)
    def real_migrations(self, settings):
        # pytest runs with --nomigrations, which hides every migration from the loader.
        settings.MIGRATION_MODULES = {}

    def test_current_migrations_are_compatible(self):
        from django.db.migrations.loader import MigrationLoader

        known = set(MigrationLoader(None, ignore_no_migrations=True).disk_migrations)
        unknown, pending = restore_module.migration_compatibility(known)
        assert unknown == [] and pending == 0

    def test_newer_backup_is_detected(self):
        unknown, _ = restore_module.migration_compatibility({("backup", "9999_from_the_future")})
        assert unknown == [("backup", "9999_from_the_future")]

    def test_older_backup_counts_pending_upgrades(self):
        _, pending = restore_module.migration_compatibility({("backup", "0001_initial")})
        assert pending >= 1


def local_snapshot(folder="f1", files=None, manifest=None, dump=DUMP):
    destination = BackupDestination.objects.create(name="Folder", kind="local", config={"folder": "main"})
    save_backup(LocalDriver({"folder": "main"}, {}), folder, dump=dump, files=files, manifest=manifest)
    snapshot = BackupSnapshot.objects.create(
        folder=folder, status=SnapshotStatus.SUCCEEDED, include_files=bool(files), database_size=len(dump)
    )
    BackupCopy.objects.create(
        snapshot=snapshot,
        destination=destination,
        destination_name="Folder",
        destination_kind="local",
        status=CopyStatus.SUCCEEDED,
    )
    return snapshot


@pytest.mark.unit
@pytest.mark.django_db
class TestInspectFailures:
    @pytest.fixture(autouse=True)
    def no_server_ops(self):
        with (
            mock.patch.object(restore_module, "privilege_problem", return_value=None),
            mock.patch.object(restore_module, "drop_database"),
            mock.patch.object(restore_module.maintenance, "publish_status"),
        ):
            yield

    def test_damaged_dump_is_refused_before_loading(self, backup_area):
        manifest = manifest_for("f1")
        manifest["database"]["sha256"] = "0" * 64
        snapshot = local_snapshot(manifest=manifest)
        restore = BackupRestore.objects.create(source=RestoreSource.SNAPSHOT, snapshot=snapshot)
        with mock.patch.object(restore_module, "create_empty_database") as create:
            result = restore_module.inspect_restore(restore.id)
        assert result.status == RestoreStatus.INVALID and not result.can_restore
        assert "damaged" in result.error
        create.assert_not_called()
        assert not restore_module.restore_dir(restore.id).exists()

    def test_missing_privileges_block(self, backup_area):
        snapshot = local_snapshot()
        restore = BackupRestore.objects.create(source=RestoreSource.SNAPSHOT, snapshot=snapshot)
        with mock.patch.object(restore_module, "privilege_problem", return_value="Not allowed."):
            result = restore_module.inspect_restore(restore.id)
        assert result.status == RestoreStatus.INVALID and result.checks[-1]["level"] == "blocker"

    def test_vanished_copy_is_explained(self, backup_area):
        snapshot = local_snapshot()
        BackupCopy.objects.update(destination=None)
        restore = BackupRestore.objects.create(source=RestoreSource.SNAPSHOT, snapshot=snapshot)
        result = restore_module.inspect_restore(restore.id)
        assert "available any more" in result.error

    def test_upload_that_is_gone(self, backup_area):
        restore = BackupRestore.objects.create(source=RestoreSource.UPLOAD)
        result = restore_module.inspect_restore(restore.id)
        assert "Upload it again" in result.error


@pytest.mark.unit
@pytest.mark.django_db
class TestExport:
    def test_prepares_a_downloadable_bundle(self, backup_area):
        snapshot = local_snapshot(files={"a.png": b"aaa"})
        export = BackupExport.objects.create(snapshot=snapshot, include_files=True)
        result = run_export(export.id)
        assert result.status == ExportStatus.READY and result.expires_at > timezone.now()
        with tarfile.open(export_path(export.id)) as tar:
            assert set(tar.getnames()) == {"manifest.json", "database.dump", "files.json.gz", "files/a.png"}

    def test_missing_copy_fails_cleanly(self, backup_area):
        snapshot = local_snapshot()
        BackupCopy.objects.update(status=CopyStatus.FAILED)
        export = BackupExport.objects.create(snapshot=snapshot)
        result = run_export(export.id)
        assert result.status == ExportStatus.FAILED and "available any more" in result.error
        assert not export_path(export.id).exists()


@pytest.mark.unit
@pytest.mark.django_db
class TestCleanup:
    def test_expires_downloads_and_stale_checks(self, backup_area):
        snapshot = local_snapshot()
        export = BackupExport.objects.create(
            snapshot=snapshot, status=ExportStatus.READY, expires_at=timezone.now() - timedelta(minutes=1)
        )
        export_path(export.id).parent.mkdir(parents=True, exist_ok=True)
        export_path(export.id).write_bytes(b"x")
        stale = BackupRestore.objects.create(
            source=RestoreSource.SNAPSHOT, status=RestoreStatus.READY, inspected_at=timezone.now() - timedelta(days=1)
        )
        with (
            mock.patch.object(restore_module, "database_exists", return_value=False),
            mock.patch.object(restore_module, "drop_database"),
        ):
            done = restore_module.cleanup()
        assert done["expired_exports"] == 1 and not export_path(export.id).exists()
        stale.refresh_from_db()
        assert stale.status == RestoreStatus.EXPIRED

    def test_keeps_previous_database_during_undo_window(self, backup_area):
        BackupRestore.objects.create(
            source=RestoreSource.SNAPSHOT,
            status=RestoreStatus.SUCCEEDED,
            undo_until=timezone.now() + timedelta(hours=3),
        )
        with (
            mock.patch.object(restore_module, "database_exists", return_value=True),
            mock.patch.object(restore_module, "drop_database") as drop,
        ):
            assert restore_module.cleanup()["dropped_previous"] is False
        drop.assert_not_called()

    def test_drops_previous_database_after_undo_window(self, backup_area):
        BackupRestore.objects.create(
            source=RestoreSource.SNAPSHOT,
            status=RestoreStatus.SUCCEEDED,
            undo_until=timezone.now() - timedelta(minutes=1),
        )
        with (
            mock.patch.object(restore_module, "database_exists", return_value=True),
            mock.patch.object(restore_module, "drop_database") as drop,
        ):
            assert restore_module.cleanup()["dropped_previous"] is True
        drop.assert_called_once_with(restore_module.previous_name())
