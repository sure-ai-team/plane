# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Backup destinations: settings validation, secret handling and one driver per kind.

Every error raised to the admin is a DestinationError with a plain-language message.
Raw library errors are logged, never shown.
"""

import json
import logging
import os
import re
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import BinaryIO, Iterator, Optional
from urllib.parse import urlparse

from django.conf import settings

from plane.license.utils.encryption import decrypt_data, encrypt_data

logger = logging.getLogger("plane.worker")

KINDS = ("local", "s3", "postgres")
SECRET_FIELDS = {"local": (), "s3": ("secret_access_key",), "postgres": ("password",)}
SSL_MODES = ("disable", "allow", "prefer", "require", "verify-ca", "verify-full")

_FOLDER_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
_BUCKET = re.compile(r"^[a-z0-9][a-z0-9.\-]{1,61}[a-z0-9]$")
_PREFIX_SEGMENT = re.compile(r"^[A-Za-z0-9._\-]{1,100}$")
_REGION = re.compile(r"^[a-z0-9\-]{0,40}$")


class DestinationError(Exception):
    """A problem the admin can understand and act on."""


# ---------------------------------------------------------------------------
# Settings validation
# ---------------------------------------------------------------------------


def _text(value) -> str:
    return value.strip() if isinstance(value, str) else ""


def _clean_relative_path(value: str, segment: re.Pattern) -> Optional[str]:
    """Normalise "a/b/" to "a/b". None when any part is unsafe (empty, "..", odd characters)."""
    parts = [p for p in value.strip().strip("/").split("/")]
    if not parts or parts == [""]:
        return ""
    if any(p in ("", ".", "..") or not segment.match(p) for p in parts):
        return None
    return "/".join(parts)


def local_root() -> Path:
    return Path(getattr(settings, "BACKUP_LOCAL_ROOT", "/backups"))


def _is_live_database(host: str, port: int, database: str) -> bool:
    """True when the settings point at the database the app itself runs on."""
    live = settings.DATABASES.get("default", {})
    live_host = (live.get("HOST") or "localhost").lower()
    live_port = int(live.get("PORT") or 5432)
    live_name = live.get("NAME") or ""
    if database != live_name or port != live_port:
        return False
    local_names = {"localhost", "127.0.0.1", "::1"}
    host = host.lower()
    return host == live_host or (host in local_names and live_host in local_names)


def validate_destination(
    kind: str, config: dict, secrets: dict, existing_secrets: Optional[dict] = None
) -> tuple[dict, dict, dict]:
    """Return (clean_config, clean_secrets, field_errors).

    A secret left blank keeps the stored one, so editing a destination does not
    force the admin to type the password again.
    """
    config = config if isinstance(config, dict) else {}
    secrets = secrets if isinstance(secrets, dict) else {}
    existing_secrets = existing_secrets or {}
    errors: dict[str, str] = {}
    clean: dict = {}
    clean_secrets: dict = {}

    if kind not in KINDS:
        return {}, {}, {"kind": "Choose a destination type."}

    for field in SECRET_FIELDS[kind]:
        value = secrets.get(field)
        if isinstance(value, str) and value != "":
            clean_secrets[field] = value
        elif existing_secrets.get(field):
            clean_secrets[field] = existing_secrets[field]

    if kind == "local":
        folder = _clean_relative_path(_text(config.get("folder")), _FOLDER_SEGMENT)
        if not folder:
            errors["folder"] = "Use a folder name made of letters, numbers, dots, dashes or underscores."
        else:
            clean["folder"] = folder

    elif kind == "s3":
        bucket = _text(config.get("bucket"))
        if not _BUCKET.match(bucket):
            errors["bucket"] = "Enter a valid bucket name (lowercase letters, numbers, dots and dashes)."
        clean["bucket"] = bucket

        region = _text(config.get("region"))
        if not _REGION.match(region):
            errors["region"] = "Enter a region such as us-east-1, or leave it empty."
        clean["region"] = region

        endpoint = _text(config.get("endpoint_url"))
        if endpoint:
            parsed = urlparse(endpoint)
            if parsed.scheme not in ("http", "https") or not parsed.netloc:
                errors["endpoint_url"] = "Enter a full address starting with https:// or http://."
        clean["endpoint_url"] = endpoint.rstrip("/")

        prefix = _clean_relative_path(_text(config.get("prefix")), _PREFIX_SEGMENT)
        if prefix is None:
            errors["prefix"] = "Use letters, numbers, dots, dashes, underscores and slashes only."
        clean["prefix"] = prefix or ""

        access_key = _text(config.get("access_key_id"))
        if not access_key:
            errors["access_key_id"] = "Enter the access key ID."
        clean["access_key_id"] = access_key
        if not clean_secrets.get("secret_access_key"):
            errors["secret_access_key"] = "Enter the secret access key."

        clean["force_path_style"] = bool(config.get("force_path_style", False))
        clean["server_side_encryption"] = bool(config.get("server_side_encryption", False))

    elif kind == "postgres":
        host = _text(config.get("host"))
        if not host or any(c.isspace() for c in host):
            errors["host"] = "Enter the database server address."
        clean["host"] = host

        port = config.get("port", 5432)
        try:
            port = int(port)
            if not 1 <= port <= 65535:
                raise ValueError
        except (TypeError, ValueError):
            errors["port"] = "Enter a port between 1 and 65535."
            port = 5432
        clean["port"] = port

        database = _text(config.get("database"))
        if not database:
            errors["database"] = "Enter the database name."
        clean["database"] = database

        user = _text(config.get("user"))
        if not user:
            errors["user"] = "Enter the database user."
        clean["user"] = user

        sslmode = _text(config.get("sslmode")) or "prefer"
        if sslmode not in SSL_MODES:
            errors["sslmode"] = "Choose a connection security option."
        clean["sslmode"] = sslmode

        if host and database and "port" not in errors and _is_live_database(host, port, database):
            errors["database"] = (
                "This is the database the platform is running on. A standby copy must go to a different database."
            )

    return clean, clean_secrets, errors


def encrypt_secrets(secrets: dict) -> str:
    return encrypt_data(json.dumps(secrets)) if secrets else ""


def decrypt_secrets(value: str) -> dict:
    if not value:
        return {}
    try:
        data = json.loads(decrypt_data(value) or "{}")
        return data if isinstance(data, dict) else {}
    except (ValueError, TypeError):
        logger.warning("Could not read the stored secrets of a backup destination.")
        return {}


def describe_secrets(kind: str, secrets: dict) -> dict:
    """Which secrets are set, without their values."""
    return {field: bool(secrets.get(field)) for field in SECRET_FIELDS.get(kind, ())}


# ---------------------------------------------------------------------------
# Drivers
# ---------------------------------------------------------------------------


class StorageDriver:
    """A place that keeps backup files (folder or bucket)."""

    stores_files = True

    def test(self) -> str:
        raise NotImplementedError

    def location(self, key: str = "") -> str:
        raise NotImplementedError

    def write_file(self, key: str, local_path: Path) -> None:
        raise NotImplementedError

    def write_bytes(self, key: str, data: bytes) -> None:
        raise NotImplementedError

    def write_stream(self, key: str, stream: BinaryIO, size: int) -> None:
        raise NotImplementedError

    def has_file(self, key: str, size: int) -> bool:
        raise NotImplementedError

    def delete_folder(self, key: str) -> None:
        raise NotImplementedError

    # Reading back (restore and download)

    def read_bytes(self, key: str) -> bytes:
        raise NotImplementedError

    def download_file(self, key: str, local_path: Path) -> None:
        raise NotImplementedError

    def open_read(self, key: str) -> BinaryIO:
        """A readable stream; the caller closes it."""
        raise NotImplementedError


class LocalDriver(StorageDriver):
    def __init__(self, config: dict, secrets: dict):
        self.root = local_root()
        self.base = (self.root / config["folder"]).resolve()
        if not str(self.base).startswith(str(self.root.resolve())):
            raise DestinationError("The folder must be inside the server's backup area.")

    def _path(self, key: str) -> Path:
        path = (self.base / key).resolve()
        if path != self.base and not str(path).startswith(str(self.base) + os.sep):
            raise DestinationError("Refused to write outside the backup folder.")
        return path

    def location(self, key: str = "") -> str:
        return str(self._path(key)) if key else str(self.base)

    def test(self) -> str:
        if not self.root.exists():
            raise DestinationError(
                f"The server has no backup area at {self.root}. Ask your IT team to mount a disk there."
            )
        try:
            self.base.mkdir(parents=True, exist_ok=True)
            probe = self.base / f".write-test-{uuid.uuid4().hex}"
            probe.write_bytes(b"ok")
            probe.unlink()
        except OSError as error:
            logger.warning("Local backup folder test failed: %s", error)
            raise DestinationError("The server can't write to this folder. Check its permissions.") from error
        free = shutil.disk_usage(self.base).free
        return f"Folder is ready. {format_bytes(free)} free."

    def _write(self, key: str, writer) -> None:
        target = self._path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        temp = target.with_name(f".{target.name}.part")
        try:
            with open(temp, "wb") as handle:
                writer(handle)
            os.replace(temp, target)
        except OSError as error:
            temp.unlink(missing_ok=True)
            if getattr(error, "errno", None) == 28:
                raise DestinationError("The backup folder ran out of disk space.") from error
            raise DestinationError("Couldn't write to the backup folder.") from error

    def write_file(self, key: str, local_path: Path) -> None:
        def writer(handle):
            with open(local_path, "rb") as source:
                shutil.copyfileobj(source, handle, 1024 * 1024)

        self._write(key, writer)

    def write_bytes(self, key: str, data: bytes) -> None:
        self._write(key, lambda handle: handle.write(data))

    def write_stream(self, key: str, stream: BinaryIO, size: int) -> None:
        self._write(key, lambda handle: shutil.copyfileobj(stream, handle, 1024 * 1024))

    def has_file(self, key: str, size: int) -> bool:
        path = self._path(key)
        return path.is_file() and path.stat().st_size == size

    def delete_folder(self, key: str) -> None:
        path = self._path(key)
        if path == self.base:
            raise DestinationError("Refused to delete the whole backup folder.")
        shutil.rmtree(path, ignore_errors=True)

    def _existing(self, key: str) -> Path:
        path = self._path(key)
        if not path.is_file():
            raise DestinationError("This backup is no longer in the folder. It may have been moved or deleted.")
        return path

    def read_bytes(self, key: str) -> bytes:
        return self._existing(key).read_bytes()

    def download_file(self, key: str, local_path: Path) -> None:
        shutil.copyfile(self._existing(key), local_path)

    def open_read(self, key: str) -> BinaryIO:
        return open(self._existing(key), "rb")


def _friendly_s3_error(error: Exception) -> DestinationError:
    from botocore.exceptions import ClientError, EndpointConnectionError, NoCredentialsError

    if isinstance(error, EndpointConnectionError):
        return DestinationError("Couldn't reach the storage server. Check the endpoint address and region.")
    if isinstance(error, NoCredentialsError):
        return DestinationError("The access key is missing.")
    if isinstance(error, ClientError):
        code = str(error.response.get("Error", {}).get("Code", ""))
        messages = {
            "NoSuchBucket": "The bucket doesn't exist. Check its name.",
            "404": "The bucket doesn't exist. Check its name.",
            "AccessDenied": "Access was denied. The key needs permission to list, read, write and delete objects.",
            "403": "Access was denied. The key needs permission to list, read, write and delete objects.",
            "InvalidAccessKeyId": "The access key ID isn't recognised.",
            "SignatureDoesNotMatch": "The secret access key is wrong.",
            "PermanentRedirect": "The bucket is in a different region. Check the region.",
            "AuthorizationHeaderMalformed": "The region doesn't match the bucket. Check the region.",
        }
        return DestinationError(messages.get(code, f"The storage service refused the request ({code})."))
    return DestinationError("Couldn't connect to the storage service.")


class S3Driver(StorageDriver):
    def __init__(self, config: dict, secrets: dict, attempts: int = 5):
        import boto3
        from botocore.config import Config

        self.bucket = config["bucket"]
        self.prefix = config.get("prefix", "")
        self.endpoint = config.get("endpoint_url") or None
        self.sse = bool(config.get("server_side_encryption"))
        self.client = boto3.client(
            "s3",
            aws_access_key_id=config.get("access_key_id"),
            aws_secret_access_key=secrets.get("secret_access_key"),
            region_name=config.get("region") or None,
            endpoint_url=self.endpoint,
            config=Config(
                signature_version="s3v4",
                connect_timeout=10,
                read_timeout=120,
                retries={"max_attempts": attempts, "mode": "standard"},
                s3={"addressing_style": "path" if config.get("force_path_style") else "auto"},
            ),
        )

    def _key(self, key: str) -> str:
        return f"{self.prefix}/{key}" if self.prefix else key

    def _extra(self) -> dict:
        return {"ServerSideEncryption": "AES256"} if self.sse else {}

    def location(self, key: str = "") -> str:
        base = f"s3://{self.bucket}/{self._key(key)}" if key else f"s3://{self.bucket}/{self.prefix}"
        return base.rstrip("/")

    def test(self) -> str:
        probe = self._key(f".write-test-{uuid.uuid4().hex}")
        try:
            self.client.head_bucket(Bucket=self.bucket)
            self.client.put_object(Bucket=self.bucket, Key=probe, Body=b"ok", **self._extra())
            self.client.delete_object(Bucket=self.bucket, Key=probe)
        except Exception as error:  # noqa: BLE001 - mapped to a friendly message
            logger.warning("S3 backup destination test failed: %s", error)
            raise _friendly_s3_error(error) from error
        return "Connected. The bucket accepts new files."

    def _call(self, fn, *args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except DestinationError:
            raise
        except Exception as error:  # noqa: BLE001
            logger.warning("S3 backup destination call failed: %s", error)
            raise _friendly_s3_error(error) from error

    def write_file(self, key: str, local_path: Path) -> None:
        self._call(
            self.client.upload_file, str(local_path), self.bucket, self._key(key), ExtraArgs=self._extra() or None
        )

    def write_bytes(self, key: str, data: bytes) -> None:
        self._call(self.client.put_object, Bucket=self.bucket, Key=self._key(key), Body=data, **self._extra())

    def write_stream(self, key: str, stream: BinaryIO, size: int) -> None:
        self._call(self.client.upload_fileobj, stream, self.bucket, self._key(key), ExtraArgs=self._extra() or None)

    def has_file(self, key: str, size: int) -> bool:
        from botocore.exceptions import ClientError

        try:
            head = self.client.head_object(Bucket=self.bucket, Key=self._key(key))
        except ClientError as error:
            if str(error.response.get("Error", {}).get("Code")) in ("404", "NoSuchKey", "NotFound"):
                return False
            raise _friendly_s3_error(error) from error
        return int(head.get("ContentLength", -1)) == size

    def delete_folder(self, key: str) -> None:
        prefix = self._key(key).rstrip("/") + "/"
        paginator = self.client.get_paginator("list_objects_v2")
        try:
            for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
                objects = [{"Key": item["Key"]} for item in page.get("Contents", [])]
                if objects:
                    self.client.delete_objects(Bucket=self.bucket, Delete={"Objects": objects, "Quiet": True})
        except Exception as error:  # noqa: BLE001
            raise _friendly_s3_error(error) from error

    def _missing_or_friendly(self, error: Exception) -> DestinationError:
        code = str(getattr(error, "response", {}).get("Error", {}).get("Code", ""))
        if code in ("404", "NoSuchKey", "NotFound"):
            return DestinationError("This backup is no longer in the bucket. It may have been moved or deleted.")
        return _friendly_s3_error(error)

    def read_bytes(self, key: str) -> bytes:
        try:
            body = self.client.get_object(Bucket=self.bucket, Key=self._key(key))["Body"]
            try:
                return body.read()
            finally:
                body.close()
        except Exception as error:  # noqa: BLE001
            raise self._missing_or_friendly(error) from error

    def download_file(self, key: str, local_path: Path) -> None:
        try:
            self.client.download_file(self.bucket, self._key(key), str(local_path))
        except Exception as error:  # noqa: BLE001
            raise self._missing_or_friendly(error) from error

    def open_read(self, key: str) -> BinaryIO:
        try:
            return self.client.get_object(Bucket=self.bucket, Key=self._key(key))["Body"]
        except Exception as error:  # noqa: BLE001
            raise self._missing_or_friendly(error) from error


class PostgresDriver:
    """Keeps a ready-to-use copy of the database on another PostgreSQL server.

    Each backup replaces the copy inside one transaction, so a failed load leaves
    the previous copy in place.
    """

    stores_files = False

    def __init__(self, config: dict, secrets: dict):
        self.config = config
        self.password = secrets.get("password", "")

    def location(self, key: str = "") -> str:
        c = self.config
        return f"postgresql://{c['user']}@{c['host']}:{c['port']}/{c['database']}"

    def _env(self) -> dict:
        env = os.environ.copy()
        env.update(
            {
                "PGHOST": self.config["host"],
                "PGPORT": str(self.config["port"]),
                "PGDATABASE": self.config["database"],
                "PGUSER": self.config["user"],
                "PGPASSWORD": self.password,
                "PGSSLMODE": self.config.get("sslmode", "prefer"),
                "PGCONNECT_TIMEOUT": "10",
            }
        )
        return env

    def test(self) -> str:
        import psycopg

        try:
            with psycopg.connect(
                host=self.config["host"],
                port=self.config["port"],
                dbname=self.config["database"],
                user=self.config["user"],
                password=self.password,
                sslmode=self.config.get("sslmode", "prefer"),
                connect_timeout=10,
            ) as connection:
                version = connection.execute("SHOW server_version").fetchone()[0]
        except psycopg.OperationalError as error:
            logger.warning("Standby database test failed: %s", error)
            text = str(error).lower()
            if "password authentication failed" in text:
                raise DestinationError("The user name or password is wrong.") from error
            if "does not exist" in text:
                raise DestinationError("The database doesn't exist on that server. Create it first.") from error
            raise DestinationError("Couldn't connect to the database server. Check the address and port.") from error
        return (
            f"Connected to PostgreSQL {version.split(' ')[0]}. "
            f'Everything in "{self.config["database"]}" will be replaced by each backup.'
        )

    def load_dump(self, dump_path: Path, timeout: int) -> None:
        binary = shutil.which("pg_restore")
        if not binary:
            raise DestinationError("The server is missing the database restore tool (pg_restore).")
        command = [
            binary,
            "--clean",
            "--if-exists",
            "--no-owner",
            "--no-privileges",
            "--single-transaction",
            "--exit-on-error",
            # pg_restore ignores PGDATABASE: without --dbname it would only print SQL.
            f"--dbname={self.config['database']}",
            str(dump_path),
        ]
        try:
            result = subprocess.run(
                command,
                env=self._env(),
                capture_output=True,
                timeout=timeout,
                preexec_fn=_lower_priority if os.name == "posix" else None,
                check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise DestinationError("Loading the standby database took too long and was stopped.") from error
        if result.returncode != 0:
            logger.warning("pg_restore into standby failed: %s", result.stderr.decode(errors="replace")[-2000:])
            raise DestinationError(
                "The standby database refused the copy. Its previous contents were kept. "
                "Check that the user owns the database."
            )


def _lower_priority() -> None:  # pragma: no cover - runs in the child process
    try:
        os.nice(10)
    except OSError:
        pass


def build_driver(kind: str, config: dict, secrets: dict, quick: bool = False):
    """`quick` is for connection tests: fail fast instead of retrying."""
    if kind == "local":
        return LocalDriver(config, secrets)
    if kind == "s3":
        return S3Driver(config, secrets, attempts=2 if quick else 5)
    if kind == "postgres":
        return PostgresDriver(config, secrets)
    raise DestinationError("Unknown destination type.")


def driver_for(destination):
    return build_driver(destination.kind, destination.config, decrypt_secrets(destination.secrets))


# ---------------------------------------------------------------------------
# Source of uploaded files (the platform's own bucket)
# ---------------------------------------------------------------------------


def source_bucket_client():
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        region_name=settings.AWS_REGION or None,
        endpoint_url=getattr(settings, "BACKUP_SOURCE_S3_ENDPOINT_URL", "") or settings.AWS_S3_ENDPOINT_URL or None,
        config=Config(signature_version="s3v4", retries={"max_attempts": 5, "mode": "standard"}),
    )


def iter_source_files(client) -> Iterator[tuple[str, int]]:
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=settings.AWS_STORAGE_BUCKET_NAME):
        for item in page.get("Contents", []):
            yield item["Key"], int(item["Size"])


def format_bytes(size: int) -> str:
    value = float(size)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024 or unit == "TB":
            return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"
        value /= 1024
    return f"{size} B"  # pragma: no cover
