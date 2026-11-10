# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The one-file backup format used for downloads and uploads.

A .tar.gz with:

    manifest.json        the backup summary (always)
    database.dump        PostgreSQL custom-format dump (always)
    files.json.gz        list of uploaded files (when files are included)
    files/<key>          the uploaded files themselves (when files are included)

Uploaded bundles come from outside, so unpacking trusts nothing: only these names
are accepted, links and devices are refused, and sizes are capped by the upload.
"""

import gzip
import io
import json
import logging
import shutil
import tarfile
import zlib
from pathlib import Path
from typing import Callable, Optional

from plane.backup.destinations import DestinationError, StorageDriver

logger = logging.getLogger("plane.worker")

MANIFEST = "manifest.json"
DATABASE = "database.dump"
FILES_INDEX = "files.json.gz"
FILES_DIR = "files/"
PROGRESS_EVERY = 50


class BundleError(Exception):
    """The file is not a usable backup. The message is for the admin."""


def shared_dir() -> Path:
    from django.conf import settings

    return Path(settings.BACKUP_SHARED_DIR)


def _add_bytes(tar: tarfile.TarFile, name: str, data: bytes) -> None:
    info = tarfile.TarInfo(name)
    info.size = len(data)
    info.mode = 0o644
    tar.addfile(info, io.BytesIO(data))


def build_bundle(
    target: Path,
    driver: StorageDriver,
    folder: str,
    include_files: bool,
    progress: Callable[[str], None] = lambda _text: None,
) -> int:
    """Pack a saved backup into `target` (a .tar.gz). Returns its size in bytes."""
    base = f"snapshots/{folder}"
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + ".part")
    local = target.with_name(target.name + ".dump")
    try:
        manifest = driver.read_bytes(f"{base}/{MANIFEST}")
        # The dump is already compressed; level 1 keeps packing fast.
        with tarfile.open(partial, "w:gz", compresslevel=1) as tar:
            _add_bytes(tar, MANIFEST, manifest)
            progress("Adding the database")
            dump_info = tarfile.TarInfo(DATABASE)
            stream = driver.open_read(f"{base}/{DATABASE}")
            try:
                with open(local, "wb") as handle:
                    shutil.copyfileobj(stream, handle, 1024 * 1024)
            finally:
                stream.close()
            dump_info.size = local.stat().st_size
            with open(local, "rb") as handle:
                tar.addfile(dump_info, handle)
            local.unlink(missing_ok=True)

            if include_files:
                index_bytes = driver.read_bytes(f"{base}/{FILES_INDEX}")
                _add_bytes(tar, FILES_INDEX, index_bytes)
                files = json.loads(gzip.decompress(index_bytes))
                for number, item in enumerate(files, start=1):
                    if number == 1 or number % PROGRESS_EVERY == 0:
                        progress(f"Adding files ({number} of {len(files)})")
                    info = tarfile.TarInfo(FILES_DIR + item["key"])
                    info.size = int(item["size"])
                    body = driver.open_read(f"files/{item['key']}")
                    try:
                        tar.addfile(info, body)
                    finally:
                        body.close()
        partial.replace(target)
        return target.stat().st_size
    except BaseException:
        partial.unlink(missing_ok=True)
        raise
    finally:
        local.unlink(missing_ok=True)


def _safe_member_name(name: str) -> Optional[str]:
    """The normalised member name, or None when it must be refused."""
    name = name.removeprefix("./")
    if not name or name.startswith("/") or "\\" in name:
        return None
    parts = name.split("/")
    if any(part in ("", ".", "..") for part in parts):
        return None
    if name in (MANIFEST, DATABASE, FILES_INDEX):
        return name
    if name.startswith(FILES_DIR) and len(parts) >= 2:
        return name
    return None


def read_manifest(data: bytes) -> dict:
    try:
        manifest = json.loads(data)
    except ValueError as error:
        raise BundleError("The backup summary (manifest.json) is damaged.") from error
    if not isinstance(manifest, dict) or manifest.get("format") != "sgtpm-backup":
        raise BundleError("This file is not a backup made by this platform.")
    if int(manifest.get("version", 0)) > 1:
        raise BundleError("This backup was made by a newer version of the platform. Upgrade the platform first.")
    return manifest


def extract_bundle(
    bundle: Path,
    target: Path,
    max_bytes: int,
    progress: Callable[[str], None] = lambda _text: None,
) -> dict:
    """Unpack an uploaded bundle into `target` and return its manifest."""
    target.mkdir(parents=True, exist_ok=True)
    written = 0
    found = set()
    try:
        tar = tarfile.open(bundle, "r:*")
    except (tarfile.TarError, OSError) as error:
        raise BundleError("This file isn't a backup archive (.tar.gz), or it is damaged.") from error
    with tar:
        try:
            for number, member in enumerate(tar, start=1):
                if number % (PROGRESS_EVERY * 4) == 0:
                    progress(f"Unpacking the backup ({number} items)")
                if member.isdir():
                    continue
                name = _safe_member_name(member.name)
                if name is None or not member.isfile():
                    raise BundleError("The backup file contains unexpected content and was refused.")
                written += member.size
                if written > max_bytes:
                    raise BundleError("The backup file unpacks to more data than expected and was refused.")
                destination = target / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                source = tar.extractfile(member)
                if source is None:
                    raise BundleError("The backup file is damaged.")
                with source, open(destination, "wb") as handle:
                    shutil.copyfileobj(source, handle, 1024 * 1024)
                found.add(name if not name.startswith(FILES_DIR) else FILES_DIR)
        except (tarfile.TarError, EOFError, OSError, zlib.error) as error:
            raise BundleError("The backup file is damaged or incomplete. Try downloading it again.") from error

    if MANIFEST not in found or DATABASE not in found:
        raise BundleError("The file is missing the database or the backup summary.")
    return read_manifest((target / MANIFEST).read_bytes())


def bundle_file_reader(root: Path):
    """Reads uploaded files out of an unpacked bundle (same interface as a storage driver)."""

    class _Reader:
        def open_read(self, key: str):
            path = (root / key).resolve()
            if not str(path).startswith(str(root.resolve())) or not path.is_file():
                raise DestinationError("A file listed in the backup is missing from it.")
            return open(path, "rb")

    return _Reader()
