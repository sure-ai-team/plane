# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The server settings kit: everything needed to rebuild this server, besides the data.

A database backup is not enough on its own to rebuild a lost server. The new server also
needs the same SECRET_KEY (saved passwords inside the database are encrypted with it),
the connection settings, and the passwords of the backup destinations, which are what
let you reach the backups in the first place.

The kit is a .tar.gz encrypted with a passphrase the admin chooses. The format is the
one `openssl enc -aes-256-cbc -pbkdf2 -md sha256` writes, so an IT team opens it with
a single standard command and no platform-specific tool:

    openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -in KIT -out kit.tar.gz

The passphrase is never stored. A lost passphrase means a new kit must be downloaded.
"""

import io
import json
import os
import tarfile
import time

from cryptography.hazmat.primitives import hashes, padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from django.utils import timezone

PBKDF2_ITERATIONS = 600_000
MIN_PASSPHRASE_LENGTH = 12
OPENSSL_MAGIC = b"Salted__"
OPEN_COMMAND = (
    "openssl enc -d -aes-256-cbc -pbkdf2 -iter {iterations} -md sha256 -in {name} -out sgtpm-settings-kit.tar.gz"
)

# Variables that describe the container, not the platform.
_SYSTEM_VARIABLES = {
    "PATH",
    "HOME",
    "HOSTNAME",
    "PWD",
    "OLDPWD",
    "SHLVL",
    "TERM",
    "SHELL",
    "USER",
    "LANG",
    "GPG_KEY",
    "_",
    "container",
    "PYTHONDONTWRITEBYTECODE",
    "PYTHONUNBUFFERED",
    "PIP_DISABLE_PIP_VERSION_CHECK",
    "DJANGO_SETTINGS_MODULE",
    "MACHINE_SIGNATURE",
}
_SYSTEM_PREFIXES = ("PYTHON", "LC_", "PIP_", "KUBERNETES_", "SERVER_SOFTWARE", "CELERY_", "RUN_MAIN")


# ---------------------------------------------------------------------------
# Encryption (OpenSSL-compatible)
# ---------------------------------------------------------------------------


def _derive(passphrase: str, salt: bytes, iterations: int) -> tuple[bytes, bytes]:
    material = PBKDF2HMAC(algorithm=hashes.SHA256(), length=48, salt=salt, iterations=iterations).derive(
        passphrase.encode("utf-8")
    )
    return material[:32], material[32:]


def encrypt(data: bytes, passphrase: str, iterations: int | None = None) -> bytes:
    iterations = iterations or PBKDF2_ITERATIONS
    salt = os.urandom(8)
    key, iv = _derive(passphrase, salt, iterations)
    padder = padding.PKCS7(128).padder()
    padded = padder.update(data) + padder.finalize()
    encryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
    return OPENSSL_MAGIC + salt + encryptor.update(padded) + encryptor.finalize()


class WrongPassphrase(Exception):
    pass


def decrypt(blob: bytes, passphrase: str, iterations: int | None = None) -> bytes:
    iterations = iterations or PBKDF2_ITERATIONS
    if not blob.startswith(OPENSSL_MAGIC) or len(blob) < 32:
        raise WrongPassphrase("This isn't a settings kit.")
    salt, body = blob[8:16], blob[16:]
    key, iv = _derive(passphrase, salt, iterations)
    decryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
    try:
        padded = decryptor.update(body) + decryptor.finalize()
        unpadder = padding.PKCS7(128).unpadder()
        return unpadder.update(padded) + unpadder.finalize()
    except ValueError as error:
        raise WrongPassphrase("Wrong passphrase.") from error


# ---------------------------------------------------------------------------
# Contents
# ---------------------------------------------------------------------------


def platform_environment(environ=None) -> dict:
    """The platform's own settings from the API container's environment."""
    environ = os.environ if environ is None else environ
    return {
        key: value
        for key, value in sorted(environ.items())
        if key not in _SYSTEM_VARIABLES and not key.startswith(_SYSTEM_PREFIXES)
    }


def _dotenv_value(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
    return f'"{escaped}"'


def render_dotenv(variables: dict) -> str:
    lines = [
        "# Settings of the API, worker and beat containers when this kit was made.",
        "# Copy to apps/api/.env on the new server (keep SECRET_KEY exactly as it is).",
        "",
    ]
    lines += [f"{key}={_dotenv_value(value)}" for key, value in variables.items()]
    return "\n".join(lines) + "\n"


def _destinations() -> list:
    from plane.backup.destinations import decrypt_secrets
    from plane.backup.models import BackupDestination

    return [
        {
            "name": d.name,
            "kind": d.kind,
            "enabled": d.is_enabled,
            "config": d.config,
            # In plain text inside the encrypted kit: this is what reaches the backups after a loss.
            "secrets": decrypt_secrets(d.secrets),
        }
        for d in BackupDestination.objects.all()
    ]


def _instance_summary(user) -> dict:
    from django.conf import settings
    from django.db import connection

    from plane.license.models import Instance

    instance = Instance.objects.first()
    with connection.cursor() as cursor:
        cursor.execute("SHOW server_version")
        pg_version = str(cursor.fetchone()[0]).split(" ")[0]
    return {
        "format": "sgtpm-settings-kit",
        "version": 1,
        "made_at": timezone.now().isoformat(),
        "made_by": getattr(user, "email", None),
        "instance_name": instance.instance_name if instance else None,
        "instance_id": instance.instance_id if instance else None,
        "platform_version": instance.current_version if instance else None,
        "domain": instance.domain if instance else None,
        "postgres_version": pg_version,
        "database_name": settings.DATABASES["default"].get("NAME"),
    }


README = """SERVER SETTINGS KIT
===================

Made {made_at} for "{instance_name}" (platform version {platform_version}).

What is inside
  api.env               Settings of the API, worker and beat containers, including SECRET_KEY,
                        database, Redis, RabbitMQ, file storage and email settings.
  destinations.json     Every backup destination with its password or secret key.
  instance.json         Instance name and id, versions, and when this kit was made.

Keep this kit as safe as the passphrase: it contains every password the server uses.

Rebuilding a server from scratch
  1. Install the same platform version ({platform_version}) on the new server. If you saved
     a release copy, load its images with deployments/backup/import-release-images.sh.
  2. Copy api.env to apps/api/.env. Keep SECRET_KEY exactly as it is: saved passwords inside
     the database (email, backup destinations) are encrypted with it. Adjust host names or
     addresses that differ on the new server.
  3. Start the platform and create a temporary admin account (python manage.py
     create_instance_admin, or the setup screen).
  4. In the admin panel, open Backup & restore > Destinations and add the destination that
     holds your backups, using the details in destinations.json.
  5. Open the Backups tab, choose the latest backup and Restore. Or use Restore from a file
     with a backup you downloaded earlier.
"""


def build_kit(user) -> bytes:
    """The kit as an unencrypted .tar.gz (encrypt before it leaves the server)."""
    summary = _instance_summary(user)
    members = {
        "README.txt": README.format(**{k: v or "unknown" for k, v in summary.items()}).encode(),
        "api.env": render_dotenv(_kit_environment()).encode(),
        "destinations.json": json.dumps(_destinations(), indent=2).encode(),
        "instance.json": json.dumps(summary, indent=2).encode(),
    }
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for name, data in members.items():
            info = tarfile.TarInfo(f"sgtpm-settings-kit/{name}")
            info.size = len(data)
            info.mode = 0o600
            info.mtime = int(time.time())
            tar.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


def kit_filename(now=None) -> str:
    now = now or timezone.now()
    return f"sgtpm-settings-kit-{now:%Y%m%d-%H%M}.tar.gz.enc"


def open_command(filename: str) -> str:
    return OPEN_COMMAND.format(iterations=PBKDF2_ITERATIONS, name=filename)


def _kit_environment() -> dict:
    """The environment, with SECRET_KEY taken from Django itself: it is the one value that
    must be exact, whichever way the server was given it."""
    from django.conf import settings

    variables = platform_environment()
    variables["SECRET_KEY"] = settings.SECRET_KEY
    return dict(sorted(variables.items()))
