# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Release copies: the platform's Docker images saved once per version.

Saving images needs control of Docker, which a web app must never have (it would mean
full control of the host). So the copy is made on the server by
deployments/backup/export-release-images.sh, which writes into the backups volume:

    /backups/.releases/<version>/images.tar.gz        `docker save` of every platform image
    /backups/.releases/<version>/compose-files.tar.gz the compose files used to run them
    /backups/.releases/<version>/manifest.json        version, images, checksum, when

The panel only reads that folder: it lists the copies, offers them for download, and can
copy them to the backup destinations so they survive the loss of the server.
"""

import json
import logging
import re
import shutil
from pathlib import Path
from typing import Optional

from django.conf import settings
from django.utils import timezone

from plane.backup.destinations import DestinationError, driver_for

logger = logging.getLogger("plane.worker")

VERSION_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
FILES = {"images": "images.tar.gz", "compose": "compose-files.tar.gz"}
COPIES_FILE = "copies.json"


def releases_root() -> Path:
    return Path(settings.BACKUP_LOCAL_ROOT) / ".releases"


def release_dir(version: str) -> Optional[Path]:
    """The folder of a release, or None when the name isn't a plain version."""
    if not isinstance(version, str) or not VERSION_PATTERN.match(version) or ".." in version:
        return None
    return releases_root() / version


def current_version() -> str:
    from plane.license.models import Instance

    instance = Instance.objects.only("current_version").first()
    return instance.current_version if instance else ""


def _read_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def describe(folder: Path) -> Optional[dict]:
    manifest = _read_json(folder / "manifest.json")
    images = folder / FILES["images"]
    if not manifest or not images.is_file():
        return None
    compose = folder / FILES["compose"]
    return {
        "version": folder.name,
        "created_at": manifest.get("created_at"),
        "images": manifest.get("images", []),
        "images_sha256": manifest.get("images_sha256", ""),
        "images_size": images.stat().st_size,
        "has_compose_files": compose.is_file(),
        "compose_size": compose.stat().st_size if compose.is_file() else 0,
        "made_on": manifest.get("host", ""),
        "copies": _read_json(folder / COPIES_FILE),
    }


def list_releases() -> list:
    root = releases_root()
    if not root.is_dir():
        return []
    releases = [describe(child) for child in root.iterdir() if child.is_dir() and release_dir(child.name)]
    return sorted((r for r in releases if r), key=lambda r: r.get("created_at") or "", reverse=True)


def delete_release(version: str) -> bool:
    folder = release_dir(version)
    if folder is None or not folder.is_dir():
        return False
    shutil.rmtree(folder)
    return True


def _write_copies(folder: Path, copies: dict) -> None:
    temp = folder / f".{COPIES_FILE}.part"
    temp.write_text(json.dumps(copies, indent=2))
    temp.replace(folder / COPIES_FILE)


def mark_copy_queued(version: str) -> None:
    from plane.backup.models import BackupDestination

    folder = release_dir(version)
    copies = _read_json(folder / COPIES_FILE)
    for destination in BackupDestination.objects.filter(is_enabled=True).exclude(kind="postgres"):
        copies[destination.name] = {"status": "queued", "at": timezone.now().isoformat(), "error": ""}
    _write_copies(folder, copies)


def copy_to_destinations(version: str) -> dict:
    """Upload a release copy to every active storage destination, under releases/<version>/."""
    from plane.backup.models import BackupDestination

    folder = release_dir(version)
    if folder is None or describe(folder) is None:
        return {}
    copies = _read_json(folder / COPIES_FILE)
    for destination in BackupDestination.objects.filter(is_enabled=True).exclude(kind="postgres"):
        copies[destination.name] = {"status": "copying", "at": timezone.now().isoformat(), "error": ""}
        _write_copies(folder, copies)
        try:
            driver = driver_for(destination)
            for name in (FILES["images"], FILES["compose"], "manifest.json"):
                if (folder / name).is_file():
                    driver.write_file(f"releases/{version}/{name}", folder / name)
            copies[destination.name] = {"status": "saved", "at": timezone.now().isoformat(), "error": ""}
        except DestinationError as error:
            copies[destination.name] = {"status": "failed", "at": timezone.now().isoformat(), "error": str(error)}
        except Exception:  # noqa: BLE001
            logger.exception("Copying release %s to %s failed", version, destination.name)
            copies[destination.name] = {
                "status": "failed",
                "at": timezone.now().isoformat(),
                "error": "Unexpected error. Details are in the server logs.",
            }
        _write_copies(folder, copies)
    return copies
