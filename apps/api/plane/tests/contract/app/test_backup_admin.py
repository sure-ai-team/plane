# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Backup & restore admin API (/api/instances/backups/)."""

from unittest import mock

import pytest
from django.utils import timezone

from plane.backup.models import BackupDestination, BackupSchedule, BackupSnapshot, SnapshotStatus
from plane.backup.destinations import decrypt_secrets
from plane.license.models import Instance, InstanceAdmin

BASE = "/api/instances/backups"


@pytest.fixture
def instance(db):
    return Instance.objects.create(
        instance_name="Test", instance_id="test-instance", current_version="1.0", last_checked_at=timezone.now()
    )


@pytest.fixture
def admin_client(session_client, instance, create_user):
    InstanceAdmin.objects.create(user=create_user, instance=instance, role=20)
    return session_client


@pytest.fixture
def passing_tests():
    with mock.patch("plane.backup.views._run_test", return_value=(True, "Connected.")) as run:
        yield run


S3_PAYLOAD = {
    "name": "AWS bucket",
    "kind": "s3",
    "config": {"bucket": "company-backups", "region": "eu-central-1", "access_key_id": "AKIA123"},
    "secrets": {"secret_access_key": "top-secret"},
}


@pytest.mark.contract
@pytest.mark.django_db
class TestPermissions:
    @pytest.mark.parametrize(
        "method,path",
        [
            ("get", "/overview/"),
            ("get", "/schedule/"),
            ("patch", "/schedule/"),
            ("get", "/destinations/"),
            ("post", "/destinations/"),
            ("get", "/snapshots/"),
            ("post", "/snapshots/"),
        ],
    )
    def test_non_admins_are_refused(self, session_client, instance, method, path):
        response = getattr(session_client, method)(f"{BASE}{path}", {}, format="json")
        assert response.status_code == 403

    def test_anonymous_is_refused(self, api_client, instance):
        assert api_client.get(f"{BASE}/overview/").status_code in (401, 403)


@pytest.mark.contract
@pytest.mark.django_db
class TestSchedule:
    def test_defaults(self, admin_client):
        body = admin_client.get(f"{BASE}/schedule/").json()
        assert body["is_enabled"] is False
        assert body["frequency"] == "daily"
        assert body["next_run_at"] is None

    def test_turning_on_sets_the_next_run(self, admin_client):
        response = admin_client.patch(
            f"{BASE}/schedule/",
            {"is_enabled": True, "frequency": "weekly", "weekday": 4, "hour": 22, "timezone": "Asia/Riyadh"},
            format="json",
        )
        assert response.status_code == 200
        body = response.json()
        assert body["is_enabled"] is True and body["next_run_at"] is not None
        schedule = BackupSchedule.get_solo()
        assert schedule.next_run_at > timezone.now()
        assert schedule.next_run_at.astimezone(timezone.get_fixed_timezone(180)).weekday() == 4

    def test_turning_off_clears_the_next_run(self, admin_client):
        admin_client.patch(f"{BASE}/schedule/", {"is_enabled": True}, format="json")
        admin_client.patch(f"{BASE}/schedule/", {"is_enabled": False}, format="json")
        assert BackupSchedule.get_solo().next_run_at is None

    def test_invalid_values_are_explained(self, admin_client):
        response = admin_client.patch(f"{BASE}/schedule/", {"hour": 25, "keep_last": 0}, format="json")
        assert response.status_code == 400
        assert set(response.json()["fields"]) == {"hour", "keep_last"}


@pytest.mark.contract
@pytest.mark.django_db
class TestDestinations:
    def test_create_tests_and_hides_the_secret(self, admin_client, passing_tests):
        response = admin_client.post(f"{BASE}/destinations/", S3_PAYLOAD, format="json")
        assert response.status_code == 201
        body = response.json()
        assert "top-secret" not in response.content.decode()
        assert body["secrets_set"] == {"secret_access_key": True}
        assert body["last_check_ok"] is True and body["last_check_message"] == "Connected."
        stored = BackupDestination.objects.get(pk=body["id"])
        assert "top-secret" not in stored.secrets
        assert decrypt_secrets(stored.secrets) == {"secret_access_key": "top-secret"}

    def test_create_validation(self, admin_client, passing_tests):
        response = admin_client.post(
            f"{BASE}/destinations/", {"name": "", "kind": "local", "config": {"folder": "../x"}}, format="json"
        )
        assert response.status_code == 400
        assert set(response.json()["fields"]) == {"name", "folder"}
        passing_tests.assert_not_called()

    def test_edit_keeps_secret_when_blank_and_retests(self, admin_client, passing_tests):
        created = admin_client.post(f"{BASE}/destinations/", S3_PAYLOAD, format="json").json()
        response = admin_client.patch(
            f"{BASE}/destinations/{created['id']}/",
            {"name": "Renamed", "config": {**S3_PAYLOAD["config"], "prefix": "prod"}, "secrets": {}},
            format="json",
        )
        assert response.status_code == 200
        stored = BackupDestination.objects.get(pk=created["id"])
        assert stored.name == "Renamed" and stored.config["prefix"] == "prod"
        assert decrypt_secrets(stored.secrets) == {"secret_access_key": "top-secret"}
        assert passing_tests.call_count == 2

    def test_kind_cannot_change(self, admin_client, passing_tests):
        created = admin_client.post(f"{BASE}/destinations/", S3_PAYLOAD, format="json").json()
        response = admin_client.patch(f"{BASE}/destinations/{created['id']}/", {"kind": "local"}, format="json")
        assert response.status_code == 400

    def test_toggle_without_retest(self, admin_client, passing_tests):
        created = admin_client.post(f"{BASE}/destinations/", S3_PAYLOAD, format="json").json()
        admin_client.patch(f"{BASE}/destinations/{created['id']}/", {"is_enabled": False}, format="json")
        assert BackupDestination.objects.get(pk=created["id"]).is_enabled is False
        assert passing_tests.call_count == 1

    def test_test_unsaved_settings(self, admin_client):
        with mock.patch("plane.backup.views._run_test", return_value=(False, "Access was denied.")):
            response = admin_client.post(f"{BASE}/destinations/test/", S3_PAYLOAD, format="json")
        assert response.status_code == 200
        assert response.json() == {"ok": False, "message": "Access was denied."}
        assert BackupDestination.objects.count() == 0

    def test_test_saved_destination_records_result(self, admin_client, passing_tests):
        created = admin_client.post(f"{BASE}/destinations/", S3_PAYLOAD, format="json").json()
        with mock.patch("plane.backup.views._run_test", return_value=(False, "Access was denied.")):
            response = admin_client.post(f"{BASE}/destinations/{created['id']}/test/", {}, format="json")
        assert response.json()["ok"] is False
        assert BackupDestination.objects.get(pk=created["id"]).last_check_ok is False

    def test_delete(self, admin_client, passing_tests):
        created = admin_client.post(f"{BASE}/destinations/", S3_PAYLOAD, format="json").json()
        assert admin_client.delete(f"{BASE}/destinations/{created['id']}/").status_code == 204
        assert BackupDestination.objects.count() == 0


@pytest.mark.contract
@pytest.mark.django_db
class TestSnapshots:
    @pytest.fixture
    def ready(self, passing_tests):
        BackupDestination.objects.create(name="Folder", kind="local", config={"folder": "main"})
        with (
            mock.patch("plane.backup.views.tools_available", return_value=True),
            mock.patch("plane.backup.views.queue_snapshot") as queue,
        ):
            yield queue

    def test_start_a_backup(self, admin_client, ready):
        payload = {"note": " Before upgrade ", "include_files": False}
        response = admin_client.post(f"{BASE}/snapshots/", payload, format="json")
        assert response.status_code == 201
        body = response.json()
        assert body["status"] == "queued" and body["trigger"] == "manual"
        assert body["note"] == "Before upgrade" and body["include_files"] is False
        assert body["created_by"]["email"] == "test@sure.com.sa"
        ready.assert_called_once()

    def test_only_one_backup_at_a_time(self, admin_client, ready):
        admin_client.post(f"{BASE}/snapshots/", {}, format="json")
        response = admin_client.post(f"{BASE}/snapshots/", {}, format="json")
        assert response.status_code == 409
        assert ready.call_count == 1

    def test_needs_a_destination(self, admin_client, ready):
        BackupDestination.objects.update(is_enabled=False)
        response = admin_client.post(f"{BASE}/snapshots/", {}, format="json")
        assert response.status_code == 400
        assert "destination" in response.json()["error"]

    def test_needs_the_backup_tool(self, admin_client, ready):
        with mock.patch("plane.backup.views.tools_available", return_value=False):
            response = admin_client.post(f"{BASE}/snapshots/", {}, format="json")
        assert response.status_code == 400

    def test_list_filter_pin_and_delete(self, admin_client, ready):
        done = BackupSnapshot.objects.create(folder="a", status=SnapshotStatus.SUCCEEDED)
        BackupSnapshot.objects.create(folder="b", status=SnapshotStatus.FAILED)

        listing = admin_client.get(f"{BASE}/snapshots/?status=kept").json()
        assert listing["total"] == 1 and listing["results"][0]["id"] == str(done.id)

        payload = {"is_pinned": True, "note": "Keep"}
        response = admin_client.patch(f"{BASE}/snapshots/{done.id}/", payload, format="json")
        assert response.json()["is_pinned"] is True and response.json()["note"] == "Keep"

        assert admin_client.delete(f"{BASE}/snapshots/{done.id}/").status_code == 204
        assert not BackupSnapshot.objects.filter(pk=done.id).exists()

    def test_running_backup_cannot_be_deleted(self, admin_client, ready):
        running = BackupSnapshot.objects.create(folder="r", status=SnapshotStatus.RUNNING)
        assert admin_client.delete(f"{BASE}/snapshots/{running.id}/").status_code == 409

    def test_delete_reports_unreachable_copies_unless_forced(self, admin_client, ready):
        snapshot = BackupSnapshot.objects.create(folder="x", status=SnapshotStatus.SUCCEEDED)
        with mock.patch("plane.backup.views.delete_snapshot_data", return_value=["Bucket: Access was denied."]):
            first = admin_client.delete(f"{BASE}/snapshots/{snapshot.id}/")
            forced = admin_client.delete(f"{BASE}/snapshots/{snapshot.id}/?force=true")
        assert first.status_code == 409 and first.json()["problems"] == ["Bucket: Access was denied."]
        assert forced.status_code == 204


@pytest.mark.contract
@pytest.mark.django_db
class TestOverview:
    def test_fresh_instance_explains_what_to_do(self, admin_client):
        with mock.patch("plane.backup.views.tools_available", return_value=True):
            body = admin_client.get(f"{BASE}/overview/").json()
        assert body["health"] == "critical"
        texts = " ".join(m["text"] for m in body["messages"])
        assert "nowhere to go" in texts and "Automatic backups are off" in texts
        assert body["latest"] is None and body["running"] is None

    def test_healthy(self, admin_client):
        BackupDestination.objects.create(name="Folder", kind="local", config={"folder": "main"}, last_check_ok=True)
        schedule = BackupSchedule.get_solo()
        schedule.is_enabled = True
        schedule.save()
        BackupSnapshot.objects.create(
            folder="ok", status=SnapshotStatus.SUCCEEDED, finished_at=timezone.now(), database_size=2048
        )
        with mock.patch("plane.backup.views.tools_available", return_value=True):
            body = admin_client.get(f"{BASE}/overview/").json()
        assert body["health"] == "good"
        assert body["totals"] == {"count": 1, "database_size": 2048}
        assert body["last_success"]["id"] == body["latest"]["id"]
