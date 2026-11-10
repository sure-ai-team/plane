# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Restore, upload and download endpoints (/api/instances/backups/...)."""

from datetime import timedelta
from unittest import mock

import pytest
from django.utils import timezone

from plane.backup import maintenance
from plane.backup.exports import export_path
from plane.backup.models import (
    BackupCopy,
    BackupDestination,
    BackupExport,
    BackupRestore,
    BackupSnapshot,
    BackupUpload,
    CopyStatus,
    ExportStatus,
    RestoreSource,
    RestoreStatus,
    SnapshotStatus,
    UploadStatus,
)
from plane.backup.restore import upload_path
from plane.license.models import Instance, InstanceAdmin

BASE = "/api/instances/backups"
PASSWORD = "test-password"


@pytest.fixture
def instance(db):
    return Instance.objects.create(
        instance_name="Acme PM", instance_id="test-instance", current_version="1.0", last_checked_at=timezone.now()
    )


@pytest.fixture
def admin_client(session_client, instance, create_user):
    InstanceAdmin.objects.create(user=create_user, instance=instance, role=20)
    return session_client


@pytest.fixture(autouse=True)
def shared(settings, tmp_path):
    settings.BACKUP_LOCAL_ROOT = str(tmp_path)
    settings.BACKUP_SHARED_DIR = str(tmp_path / ".staging")
    with mock.patch("plane.backup.restore.drop_database"):
        yield tmp_path


@pytest.fixture
def snapshot(db):
    destination = BackupDestination.objects.create(name="Folder", kind="local", config={"folder": "main"})
    snapshot = BackupSnapshot.objects.create(
        folder="s1", status=SnapshotStatus.SUCCEEDED, note="Before upgrade", include_files=False
    )
    BackupCopy.objects.create(
        snapshot=snapshot,
        destination=destination,
        destination_name="Folder",
        destination_kind="local",
        status=CopyStatus.SUCCEEDED,
    )
    return snapshot


def ready_restore(**fields):
    defaults = dict(source=RestoreSource.SNAPSHOT, status=RestoreStatus.READY, can_restore=True)
    defaults.update(fields)
    return BackupRestore.objects.create(**defaults)


@pytest.mark.contract
@pytest.mark.django_db
class TestPermissions:
    @pytest.mark.parametrize(
        "method,path",
        [
            ("get", "/restores/"),
            ("post", "/restores/"),
            ("post", "/uploads/"),
            ("get", "/exports/00000000-0000-0000-0000-000000000000/download/"),
        ],
    )
    def test_non_admins_are_refused(self, session_client, instance, method, path):
        assert getattr(session_client, method)(f"{BASE}{path}", {}, format="json").status_code == 403

    def test_status_is_readable_without_signing_in(self, api_client, instance):
        restore = ready_restore()
        maintenance.publish_status(restore.id, status="running", progress="Switching", secret="hidden")
        body = api_client.get(f"{BASE}/restores/{restore.id}/status/").json()
        assert body["status"] == "running" and body["progress"] == "Switching"
        assert "secret" not in body

    def test_unknown_status_is_404(self, api_client, instance):
        assert api_client.get(f"{BASE}/restores/00000000-0000-0000-0000-000000000000/status/").status_code == 404


@pytest.mark.contract
@pytest.mark.django_db
class TestStartRestore:
    def test_checks_a_saved_backup(self, admin_client, snapshot):
        response = admin_client.post(f"{BASE}/restores/", {"snapshot_id": str(snapshot.id)}, format="json")
        assert response.status_code == 201
        body = response.json()
        assert body["status"] == "inspecting" and "Before upgrade" in body["label"]
        assert body["confirm_phrase"] == "Acme PM"

    def test_refuses_failed_or_unreachable_backups(self, admin_client, snapshot):
        BackupSnapshot.objects.filter(pk=snapshot.pk).update(status=SnapshotStatus.FAILED)
        assert (
            admin_client.post(f"{BASE}/restores/", {"snapshot_id": str(snapshot.id)}, format="json").status_code == 400
        )
        BackupSnapshot.objects.filter(pk=snapshot.pk).update(status=SnapshotStatus.SUCCEEDED)
        BackupCopy.objects.update(destination=None)
        response = admin_client.post(f"{BASE}/restores/", {"snapshot_id": str(snapshot.id)}, format="json")
        assert response.status_code == 400 and "available" in response.json()["error"]

    def test_one_restore_at_a_time(self, admin_client, snapshot):
        ready_restore(status=RestoreStatus.RUNNING)
        response = admin_client.post(f"{BASE}/restores/", {"snapshot_id": str(snapshot.id)}, format="json")
        assert response.status_code == 409

    def test_a_new_check_replaces_an_unused_one(self, admin_client, snapshot):
        old = ready_restore()
        admin_client.post(f"{BASE}/restores/", {"snapshot_id": str(snapshot.id)}, format="json")
        old.refresh_from_db()
        assert old.status == RestoreStatus.CANCELLED

    def test_backups_wait_while_restoring(self, admin_client, snapshot):
        ready_restore(status=RestoreStatus.RUNNING)
        with mock.patch("plane.backup.views.tools_available", return_value=True):
            response = admin_client.post(f"{BASE}/snapshots/", {}, format="json")
        assert response.status_code == 409 and "restore" in response.json()["error"]


@pytest.mark.contract
@pytest.mark.django_db
class TestConfirmCancelUndo:
    def test_wrong_password(self, admin_client):
        restore = ready_restore()
        response = admin_client.post(
            f"{BASE}/restores/{restore.id}/confirm/", {"password": "nope", "confirm_text": "Acme PM"}, format="json"
        )
        assert response.status_code == 403

    def test_wrong_phrase(self, admin_client):
        restore = ready_restore()
        response = admin_client.post(
            f"{BASE}/restores/{restore.id}/confirm/", {"password": PASSWORD, "confirm_text": "acme"}, format="json"
        )
        assert response.status_code == 400 and "Acme PM" in response.json()["error"]

    def test_confirm_queues_the_restore(self, admin_client):
        restore = ready_restore()
        response = admin_client.post(
            f"{BASE}/restores/{restore.id}/confirm/", {"password": PASSWORD, "confirm_text": " acme pm "}, format="json"
        )
        assert response.status_code == 200
        restore.refresh_from_db()
        assert restore.status == RestoreStatus.QUEUED and restore.confirmed_by is not None
        assert maintenance.read_status(restore.id)["status"] == "queued"

    def test_cannot_confirm_a_blocked_backup(self, admin_client):
        restore = ready_restore(status=RestoreStatus.INVALID, can_restore=False)
        response = admin_client.post(
            f"{BASE}/restores/{restore.id}/confirm/", {"password": PASSWORD, "confirm_text": "Acme PM"}, format="json"
        )
        assert response.status_code == 409

    def test_cancel(self, admin_client):
        restore = ready_restore()
        assert admin_client.post(f"{BASE}/restores/{restore.id}/cancel/").json()["status"] == "cancelled"
        running = ready_restore(status=RestoreStatus.RUNNING)
        assert admin_client.post(f"{BASE}/restores/{running.id}/cancel/").status_code == 409

    def test_undo_within_the_window(self, admin_client):
        restore = ready_restore(status=RestoreStatus.SUCCEEDED, undo_until=timezone.now() + timedelta(hours=2))
        assert admin_client.get(f"{BASE}/restores/{restore.id}/").json()["undo_available"] is True
        response = admin_client.post(f"{BASE}/restores/{restore.id}/undo/", {"password": PASSWORD}, format="json")
        assert response.status_code == 200
        restore.refresh_from_db()
        assert restore.status == RestoreStatus.UNDOING

    def test_undo_after_the_window(self, admin_client):
        restore = ready_restore(status=RestoreStatus.SUCCEEDED, undo_until=timezone.now() - timedelta(minutes=1))
        response = admin_client.post(f"{BASE}/restores/{restore.id}/undo/", {"password": PASSWORD}, format="json")
        assert response.status_code == 409

    def test_overview_shows_an_undoable_restore(self, admin_client):
        restore = ready_restore(status=RestoreStatus.SUCCEEDED, undo_until=timezone.now() + timedelta(hours=2))
        with mock.patch("plane.backup.views.tools_available", return_value=True):
            body = admin_client.get(f"{BASE}/overview/").json()
        assert body["restore"]["id"] == str(restore.id)


@pytest.mark.contract
@pytest.mark.django_db
class TestUploads:
    def create(self, client, size=10, filename="backup.tar.gz"):
        return client.post(f"{BASE}/uploads/", {"filename": filename, "size": size}, format="json")

    def put(self, client, upload_id, offset, data):
        return client.put(
            f"{BASE}/uploads/{upload_id}/chunk/?offset={offset}", data, content_type="application/octet-stream"
        )

    def test_validation(self, admin_client, settings):
        assert self.create(admin_client, filename="backup.zip").status_code == 400
        assert self.create(admin_client, size=0).status_code == 400
        settings.BACKUP_MAX_UPLOAD_BYTES = 5
        assert self.create(admin_client, size=10).status_code == 400

    def test_chunks_in_order_then_restore(self, admin_client):
        created = self.create(admin_client, size=10).json()
        assert created["chunk_size"] > 0 and created["status"] == "uploading"
        upload_id = created["id"]

        assert self.put(admin_client, upload_id, 0, b"hello").json()["received"] == 5
        out_of_order = self.put(admin_client, upload_id, 0, b"again")
        assert out_of_order.status_code == 409 and out_of_order.json()["received"] == 5
        assert self.put(admin_client, upload_id, 5, b"too long chunk").status_code == 400

        early = admin_client.post(f"{BASE}/uploads/{upload_id}/restore/")
        assert early.status_code == 400

        assert self.put(admin_client, upload_id, 5, b"world").json()["status"] == "complete"
        assert upload_path(upload_id).read_bytes() == b"helloworld"

        response = admin_client.post(f"{BASE}/uploads/{upload_id}/restore/")
        assert response.status_code == 201
        assert response.json()["source"] == "upload" and "backup.tar.gz" in response.json()["label"]

    def test_resume_reports_progress(self, admin_client):
        upload_id = self.create(admin_client, size=10).json()["id"]
        self.put(admin_client, upload_id, 0, b"hel")
        assert admin_client.get(f"{BASE}/uploads/{upload_id}/").json()["received"] == 3

    def test_lost_partial_file(self, admin_client):
        upload_id = self.create(admin_client, size=10).json()["id"]
        upload_path(upload_id).unlink()
        assert self.put(admin_client, upload_id, 0, b"hel").status_code == 409
        assert BackupUpload.objects.get(pk=upload_id).status == UploadStatus.FAILED


@pytest.mark.contract
@pytest.mark.django_db
class TestExports:
    def test_prepare_reuse_and_download(self, admin_client, snapshot):
        created = admin_client.post(f"{BASE}/snapshots/{snapshot.id}/exports/", {}, format="json")
        assert created.status_code == 201
        export_id = created.json()["id"]
        again = admin_client.post(f"{BASE}/snapshots/{snapshot.id}/exports/", {}, format="json")
        assert again.json()["id"] == export_id

        assert admin_client.get(f"{BASE}/exports/{export_id}/download/").status_code == 404

        path = export_path(export_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"bundle-bytes")
        BackupExport.objects.filter(pk=export_id).update(status=ExportStatus.READY)
        response = admin_client.get(f"{BASE}/exports/{export_id}/download/", HTTP_ACCEPT_ENCODING="gzip")
        assert response.status_code == 200
        assert not response.has_header("Content-Encoding") and response["Content-Length"] == "12"
        assert b"".join(response.streaming_content) == b"bundle-bytes"
        assert "sgtpm-backup-s1.tar.gz" in response["Content-Disposition"]

    def test_files_only_when_the_backup_has_them(self, admin_client, snapshot):
        response = admin_client.post(f"{BASE}/snapshots/{snapshot.id}/exports/", {"include_files": True}, format="json")
        assert response.status_code == 400
