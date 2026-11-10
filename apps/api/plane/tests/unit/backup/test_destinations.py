# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import io

import pytest

from plane.backup.destinations import (
    DestinationError,
    LocalDriver,
    decrypt_secrets,
    describe_secrets,
    encrypt_secrets,
    format_bytes,
    validate_destination,
)

S3_CONFIG = {"bucket": "company-backups", "region": "eu-central-1", "access_key_id": "AKIA123"}
PG_CONFIG = {"host": "standby.internal", "port": 5432, "database": "sgtpm_standby", "user": "backup"}


@pytest.mark.unit
class TestValidateLocal:
    def test_accepts_nested_folder(self):
        config, secrets, errors = validate_destination("local", {"folder": "/nightly/main/"}, {})
        assert errors == {}
        assert config == {"folder": "nightly/main"}
        assert secrets == {}

    @pytest.mark.parametrize("folder", ["", "../etc", "a/../../b", "a//b", "with space", "./x"])
    def test_rejects_unsafe_folders(self, folder):
        _, _, errors = validate_destination("local", {"folder": folder}, {})
        assert "folder" in errors


@pytest.mark.unit
class TestValidateS3:
    def test_valid(self):
        config, secrets, errors = validate_destination(
            "s3",
            {**S3_CONFIG, "prefix": "/sgtpm/prod/", "endpoint_url": "https://s3.example.com/"},
            {"secret_access_key": "shh"},
        )
        assert errors == {}
        assert config["prefix"] == "sgtpm/prod"
        assert config["endpoint_url"] == "https://s3.example.com"
        assert config["server_side_encryption"] is False
        assert secrets == {"secret_access_key": "shh"}

    def test_secret_required_on_create(self):
        _, _, errors = validate_destination("s3", S3_CONFIG, {})
        assert "secret_access_key" in errors

    def test_blank_secret_keeps_the_stored_one(self):
        _, secrets, errors = validate_destination(
            "s3", S3_CONFIG, {"secret_access_key": ""}, existing_secrets={"secret_access_key": "old"}
        )
        assert errors == {}
        assert secrets == {"secret_access_key": "old"}

    def test_new_secret_replaces_the_stored_one(self):
        _, secrets, _ = validate_destination(
            "s3", S3_CONFIG, {"secret_access_key": "new"}, existing_secrets={"secret_access_key": "old"}
        )
        assert secrets == {"secret_access_key": "new"}

    def test_rejects_bad_fields(self):
        _, _, errors = validate_destination(
            "s3",
            {"bucket": "Bad_Bucket", "region": "EU WEST", "endpoint_url": "ftp://x", "prefix": "a/../b"},
            {"secret_access_key": "x"},
        )
        assert set(errors) == {"bucket", "region", "endpoint_url", "prefix", "access_key_id"}


@pytest.mark.unit
class TestValidatePostgres:
    def test_valid(self):
        config, secrets, errors = validate_destination("postgres", PG_CONFIG, {"password": "pw"})
        assert errors == {}
        assert config["sslmode"] == "prefer"
        assert secrets == {"password": "pw"}

    def test_bad_port_and_sslmode(self):
        _, _, errors = validate_destination("postgres", {**PG_CONFIG, "port": "99999", "sslmode": "maybe"}, {})
        assert {"port", "sslmode"} <= set(errors)

    def test_refuses_the_live_database(self, settings):
        settings.DATABASES = {"default": {"HOST": "db", "PORT": "5432", "NAME": "sgtpm"}}
        _, _, errors = validate_destination(
            "postgres", {**PG_CONFIG, "host": "DB", "database": "sgtpm"}, {"password": "pw"}
        )
        assert "running on" in errors["database"]

    def test_refuses_live_database_through_localhost_alias(self, settings):
        settings.DATABASES = {"default": {"HOST": "localhost", "PORT": 5432, "NAME": "sgtpm"}}
        _, _, errors = validate_destination("postgres", {**PG_CONFIG, "host": "127.0.0.1", "database": "sgtpm"}, {})
        assert "database" in errors

    def test_other_database_on_same_server_is_fine(self, settings):
        settings.DATABASES = {"default": {"HOST": "db", "PORT": 5432, "NAME": "sgtpm"}}
        _, _, errors = validate_destination("postgres", {**PG_CONFIG, "host": "db"}, {"password": "pw"})
        assert errors == {}


@pytest.mark.unit
def test_unknown_kind():
    assert validate_destination("ftp", {}, {})[2] == {"kind": "Choose a destination type."}


@pytest.mark.unit
def test_secrets_round_trip_and_description():
    secret = "correct-horse-battery-staple"
    stored = encrypt_secrets({"password": secret})
    assert secret not in stored
    assert decrypt_secrets(stored) == {"password": secret}
    assert decrypt_secrets("") == {}
    assert encrypt_secrets({}) == ""
    assert describe_secrets("postgres", {"password": "pw"}) == {"password": True}
    assert describe_secrets("s3", {}) == {"secret_access_key": False}


@pytest.mark.unit
def test_format_bytes():
    assert format_bytes(512) == "512 B"
    assert format_bytes(1536) == "1.5 KB"
    assert format_bytes(5 * 1024**3) == "5.0 GB"


@pytest.mark.unit
class TestPostgresDriverLoad:
    def test_load_targets_the_standby_database_in_one_transaction(self, tmp_path):
        from unittest import mock

        from plane.backup.destinations import PostgresDriver

        driver = PostgresDriver(PG_CONFIG | {"sslmode": "require"}, {"password": "pw"})
        result = mock.Mock(returncode=0, stderr=b"")
        with (
            mock.patch("plane.backup.destinations.shutil.which", return_value="/usr/bin/pg_restore"),
            mock.patch("plane.backup.destinations.subprocess.run", return_value=result) as run,
        ):
            driver.load_dump(tmp_path / "database.dump", 60)
        command = run.call_args.args[0]
        # pg_restore ignores PGDATABASE; without --dbname it only prints SQL.
        assert "--dbname=sgtpm_standby" in command
        assert "--single-transaction" in command and "--exit-on-error" in command
        env = run.call_args.kwargs["env"]
        assert env["PGPASSWORD"] == "pw" and env["PGSSLMODE"] == "require"

    def test_failed_load_keeps_previous_copy_message(self, tmp_path):
        from unittest import mock

        from plane.backup.destinations import PostgresDriver

        driver = PostgresDriver(PG_CONFIG, {"password": "pw"})
        with (
            mock.patch("plane.backup.destinations.shutil.which", return_value="/usr/bin/pg_restore"),
            mock.patch("plane.backup.destinations.subprocess.run", return_value=mock.Mock(returncode=1, stderr=b"x")),
        ):
            with pytest.raises(DestinationError, match="previous contents were kept"):
                driver.load_dump(tmp_path / "database.dump", 60)


@pytest.mark.unit
class TestLocalDriver:
    @pytest.fixture
    def driver(self, settings, tmp_path):
        settings.BACKUP_LOCAL_ROOT = str(tmp_path)
        return LocalDriver({"folder": "nightly"}, {})

    def test_test_creates_the_folder(self, driver, tmp_path):
        assert "ready" in driver.test()
        assert (tmp_path / "nightly").is_dir()
        assert list((tmp_path / "nightly").iterdir()) == []

    def test_missing_root_is_explained(self, settings, tmp_path):
        settings.BACKUP_LOCAL_ROOT = str(tmp_path / "missing")
        with pytest.raises(DestinationError, match="no backup area"):
            LocalDriver({"folder": "x"}, {}).test()

    def test_write_read_and_delete(self, driver, tmp_path):
        source = tmp_path / "dump.bin"
        source.write_bytes(b"data")
        driver.write_file("snapshots/a/database.dump", source)
        driver.write_bytes("snapshots/a/manifest.json", b"{}")
        driver.write_stream("files/x/y.png", io.BytesIO(b"png"), 3)

        assert driver.has_file("snapshots/a/database.dump", 4)
        assert not driver.has_file("snapshots/a/database.dump", 5)
        assert driver.has_file("files/x/y.png", 3)
        assert not list((tmp_path / "nightly" / "snapshots" / "a").glob(".*.part"))

        driver.delete_folder("snapshots/a")
        assert not (tmp_path / "nightly" / "snapshots" / "a").exists()
        assert driver.has_file("files/x/y.png", 3)

    def test_refuses_paths_outside_the_folder(self, driver):
        with pytest.raises(DestinationError):
            driver.write_bytes("../escape.txt", b"x")
        with pytest.raises(DestinationError):
            driver.delete_folder("")
