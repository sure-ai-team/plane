# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import json
import shutil
import subprocess

import pytest

from plane.backup import releases, settings_kit
from plane.backup.destinations import encrypt_secrets
from plane.backup.models import BackupDestination

FAST = 1000  # PBKDF2 rounds for tests that don't involve the openssl command


@pytest.mark.unit
class TestKitEncryption:
    def test_round_trip(self):
        blob = settings_kit.encrypt(b"secret settings", "correct horse battery", iterations=FAST)
        assert blob.startswith(b"Salted__") and b"secret settings" not in blob
        assert settings_kit.decrypt(blob, "correct horse battery", iterations=FAST) == b"secret settings"

    def test_wrong_passphrase(self):
        blob = settings_kit.encrypt(b"secret settings" * 10, "correct horse battery", iterations=FAST)
        with pytest.raises(settings_kit.WrongPassphrase):
            settings_kit.decrypt(blob, "wrong passphrase!!", iterations=FAST)

    def test_each_kit_uses_a_new_salt(self):
        one = settings_kit.encrypt(b"x", "correct horse battery", iterations=FAST)
        two = settings_kit.encrypt(b"x", "correct horse battery", iterations=FAST)
        assert one != two

    @pytest.mark.skipif(shutil.which("openssl") is None, reason="openssl command not installed")
    def test_the_standard_openssl_command_opens_it(self, tmp_path):
        """The promise to the IT team: one standard command, no platform tool."""
        kit = tmp_path / "kit.tar.gz.enc"
        kit.write_bytes(settings_kit.encrypt(b"hello from the kit", "a long passphrase 123"))
        command = settings_kit.open_command(str(kit)).split() + ["-pass", "pass:a long passphrase 123"]
        command[command.index("-out") + 1] = str(tmp_path / "out")
        subprocess.run(command, check=True, capture_output=True)
        assert (tmp_path / "out").read_bytes() == b"hello from the kit"

    @pytest.mark.skipif(shutil.which("openssl") is None, reason="openssl command not installed")
    def test_reads_what_openssl_writes(self, tmp_path):
        source = tmp_path / "plain"
        source.write_bytes(b"made by openssl")
        subprocess.run(
            ["openssl", "enc", "-aes-256-cbc", "-pbkdf2", "-iter", str(FAST), "-md", "sha256", "-salt"]
            + ["-in", str(source), "-out", str(tmp_path / "enc"), "-pass", "pass:a long passphrase 123"],
            check=True,
            capture_output=True,
        )
        blob = (tmp_path / "enc").read_bytes()
        assert settings_kit.decrypt(blob, "a long passphrase 123", iterations=FAST) == b"made by openssl"


@pytest.mark.unit
class TestKitContents:
    def test_keeps_platform_settings_and_drops_container_noise(self):
        env = {
            "SECRET_KEY": "abc",
            "DATABASE_URL": "postgresql://x",
            "PATH": "/usr/bin",
            "HOSTNAME": "abc123",
            "PYTHONUNBUFFERED": "1",
            "LC_ALL": "C",
        }
        assert settings_kit.platform_environment(env) == {"DATABASE_URL": "postgresql://x", "SECRET_KEY": "abc"}

    def test_dotenv_escaping(self):
        text = settings_kit.render_dotenv({"A": 'say "hi"', "B": "line1\nline2", "C": "back\\slash"})
        assert 'A="say \\"hi\\""' in text
        assert 'B="line1\\nline2"' in text
        assert 'C="back\\\\slash"' in text


@pytest.fixture
def release_area(settings, tmp_path):
    settings.BACKUP_LOCAL_ROOT = str(tmp_path)
    return tmp_path / ".releases"


def make_release(root, version, created="2026-11-10T10:00:00Z", compose=True):
    folder = root / version
    folder.mkdir(parents=True)
    (folder / "images.tar.gz").write_bytes(b"image-bytes")
    if compose:
        (folder / "compose-files.tar.gz").write_bytes(b"compose")
    (folder / "manifest.json").write_text(
        json.dumps({"version": version, "created_at": created, "images_sha256": "ab", "images": [{"name": "api"}]})
    )
    return folder


@pytest.mark.unit
class TestReleases:
    @pytest.mark.parametrize("name", ["../etc", "a/b", "", ".hidden", "x" * 70, "1.4..2"])
    def test_refuses_odd_version_names(self, release_area, name):
        assert releases.release_dir(name) is None

    def test_lists_complete_copies_newest_first(self, release_area):
        make_release(release_area, "1.4.1", created="2026-10-01T00:00:00Z")
        make_release(release_area, "1.4.2", created="2026-11-01T00:00:00Z", compose=False)
        (release_area / "broken").mkdir()  # no manifest: ignored
        listed = releases.list_releases()
        assert [r["version"] for r in listed] == ["1.4.2", "1.4.1"]
        assert listed[0]["images_size"] == len(b"image-bytes") and listed[0]["has_compose_files"] is False

    def test_delete(self, release_area):
        make_release(release_area, "1.4.2")
        assert releases.delete_release("1.4.2") is True
        assert releases.list_releases() == []
        assert releases.delete_release("../x") is False

    @pytest.mark.django_db
    def test_copies_to_storage_destinations(self, release_area, tmp_path):
        make_release(release_area, "1.4.2")
        BackupDestination.objects.create(name="Folder", kind="local", config={"folder": "offsite"})
        BackupDestination.objects.create(
            name="Standby",
            kind="postgres",
            config={"host": "x", "port": 5432, "database": "y", "user": "z"},
            secrets=encrypt_secrets({"password": "p"}),
        )
        copies = releases.copy_to_destinations("1.4.2")
        assert copies == {"Folder": {"status": "saved", "at": copies["Folder"]["at"], "error": ""}}
        saved = tmp_path / "offsite" / "releases" / "1.4.2"
        assert (saved / "images.tar.gz").read_bytes() == b"image-bytes"
        assert (saved / "manifest.json").is_file() and (saved / "compose-files.tar.gz").is_file()
        assert releases.list_releases()[0]["copies"]["Folder"]["status"] == "saved"
