# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Server recovery endpoints: settings kit, release copies, maintenance status."""

import io
import json
import tarfile
from unittest import mock

import pytest
from django.utils import timezone

from plane.backup import maintenance, settings_kit
from plane.backup.destinations import encrypt_secrets
from plane.backup.models import BackupDestination
from plane.license.models import Instance, InstanceAdmin

BASE = "/api/instances/backups"
PASSWORD = "test-password"


@pytest.fixture
def instance(db):
    return Instance.objects.create(
        instance_name="Acme PM", instance_id="test-instance", current_version="1.4.2", last_checked_at=timezone.now()
    )


@pytest.fixture
def admin_client(session_client, instance, create_user):
    InstanceAdmin.objects.create(user=create_user, instance=instance, role=20)
    return session_client


@pytest.fixture(autouse=True)
def area(settings, tmp_path):
    settings.BACKUP_LOCAL_ROOT = str(tmp_path)
    return tmp_path


@pytest.fixture(autouse=True)
def fast_kdf():
    # The real 600,000 rounds are covered by the openssl test; keep these quick.
    with mock.patch.object(settings_kit, "PBKDF2_ITERATIONS", 1000):
        yield


def kit_files(blob, passphrase):
    data = settings_kit.decrypt(blob, passphrase, iterations=1000)
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        return {m.name.split("/", 1)[1]: tar.extractfile(m).read() for m in tar.getmembers()}


@pytest.mark.contract
@pytest.mark.django_db
class TestSettingsKit:
    def test_non_admins_are_refused(self, session_client, instance):
        assert session_client.post(f"{BASE}/settings-kit/", {}, format="json").status_code == 403

    def test_info(self, admin_client):
        body = admin_client.get(f"{BASE}/settings-kit/").json()
        assert body["min_passphrase_length"] == 12
        assert body["open_command"].startswith("openssl enc -d -aes-256-cbc -pbkdf2")

    @pytest.mark.parametrize(
        "payload,code",
        [
            ({"password": "nope", "passphrase": "a long passphrase"}, 403),
            ({"password": PASSWORD, "passphrase": "short"}, 400),
            ({"password": PASSWORD, "passphrase": PASSWORD}, 400),
        ],
    )
    def test_refusals(self, admin_client, payload, code):
        assert admin_client.post(f"{BASE}/settings-kit/", payload, format="json").status_code == code

    def test_passphrase_must_differ_from_password(self, admin_client, create_user):
        create_user.set_password("a-long-account-password")
        create_user.save()
        payload = {"password": "a-long-account-password", "passphrase": "a-long-account-password"}
        response = admin_client.post(f"{BASE}/settings-kit/", payload, format="json")
        assert response.status_code == 400 and "different" in response.json()["error"]

    def test_downloads_an_encrypted_kit(self, admin_client, settings):
        BackupDestination.objects.create(
            name="Bucket",
            kind="s3",
            config={"bucket": "b", "access_key_id": "AKIA"},
            secrets=encrypt_secrets({"secret_access_key": "bucket-secret-value"}),
        )
        with mock.patch.dict("os.environ", {"PLATFORM_FLAG": "on", "PATH": "/bin"}):
            response = admin_client.post(
                f"{BASE}/settings-kit/", {"password": PASSWORD, "passphrase": "a long passphrase"}, format="json"
            )
        assert response.status_code == 200
        assert response["Content-Disposition"].startswith('attachment; filename="sgtpm-settings-kit-')
        assert settings.SECRET_KEY.encode() not in response.content and b"bucket-secret-value" not in response.content

        files = kit_files(response.content, "a long passphrase")
        assert set(files) == {"README.txt", "api.env", "destinations.json", "instance.json"}
        lines = files["api.env"].decode().splitlines()
        assert f'SECRET_KEY="{settings.SECRET_KEY}"' in lines
        assert 'PLATFORM_FLAG="on"' in lines and not any(line.startswith("PATH=") for line in lines)
        destinations = json.loads(files["destinations.json"])
        assert destinations[0]["secrets"] == {"secret_access_key": "bucket-secret-value"}
        summary = json.loads(files["instance.json"])
        assert summary["instance_name"] == "Acme PM" and summary["platform_version"] == "1.4.2"
        assert b"1.4.2" in files["README.txt"]


def make_release(root, version):
    folder = root / ".releases" / version
    folder.mkdir(parents=True)
    (folder / "images.tar.gz").write_bytes(b"image-bytes")
    (folder / "manifest.json").write_text(json.dumps({"version": version, "created_at": "2026-11-10T00:00:00Z"}))


@pytest.mark.contract
@pytest.mark.django_db
class TestReleases:
    def test_list_marks_the_running_version(self, admin_client, area):
        make_release(area, "1.4.1")
        body = admin_client.get(f"{BASE}/releases/").json()
        assert body["current_version"] == "1.4.2" and body["has_current"] is False
        make_release(area, "1.4.2")
        body = admin_client.get(f"{BASE}/releases/").json()
        assert body["has_current"] is True
        assert {r["version"]: r["is_current"] for r in body["releases"]} == {"1.4.1": False, "1.4.2": True}

    def test_download_and_unknown_files(self, admin_client, area):
        make_release(area, "1.4.2")
        response = admin_client.get(f"{BASE}/releases/1.4.2/download/", HTTP_ACCEPT_ENCODING="gzip, br")
        assert response.status_code == 200 and b"".join(response.streaming_content) == b"image-bytes"
        # Already compressed: served as is, with its size, even to a browser that accepts gzip.
        assert not response.has_header("Content-Encoding") and response["Content-Length"] == "11"
        assert admin_client.get(f"{BASE}/releases/1.4.2/download/?file=compose").status_code == 404
        assert admin_client.get(f"{BASE}/releases/1.4.2/download/?file=../../etc").status_code == 404
        assert admin_client.get(f"{BASE}/releases/9.9.9/download/").status_code == 404

    def test_copy_needs_a_storage_destination(self, admin_client, area):
        make_release(area, "1.4.2")
        assert admin_client.post(f"{BASE}/releases/1.4.2/copy/").status_code == 400
        BackupDestination.objects.create(name="Folder", kind="local", config={"folder": "main"})
        with mock.patch("plane.backup.tasks.copy_release_task.delay") as delay:
            response = admin_client.post(f"{BASE}/releases/1.4.2/copy/")
        assert response.status_code == 202 and response.json()["copies"]["Folder"]["status"] == "queued"
        delay.assert_called_once_with("1.4.2")

    def test_delete(self, admin_client, area):
        make_release(area, "1.4.2")
        assert admin_client.delete(f"{BASE}/releases/1.4.2/").status_code == 204
        assert admin_client.delete(f"{BASE}/releases/1.4.2/").status_code == 404


@pytest.mark.contract
@pytest.mark.django_db
class TestMaintenanceStatus:
    def test_open_and_reflects_maintenance(self, api_client):
        maintenance.clear_maintenance()
        assert api_client.get(f"{BASE}/maintenance/").json() == {"active": False}
        maintenance.set_maintenance("restore:test")
        try:
            response = api_client.get(f"{BASE}/maintenance/")
            assert response.status_code == 200 and response.json() == {"active": True}
        finally:
            maintenance.clear_maintenance()
