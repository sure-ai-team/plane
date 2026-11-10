# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Preparing a saved backup as one .tar.gz file to download."""

import logging
import shutil
from datetime import timedelta
from pathlib import Path

from django.utils import timezone

from plane.backup.bundle import BundleError, build_bundle, shared_dir
from plane.backup.destinations import DestinationError, driver_for, format_bytes
from plane.backup.models import BackupExport, ExportStatus

logger = logging.getLogger("plane.worker")

DOWNLOAD_WINDOW = timedelta(hours=24)
FREE_SPACE_MARGIN = 256 * 1024 * 1024


def export_path(export_id) -> Path:
    return shared_dir() / "exports" / f"{export_id}.tar.gz"


def download_name(export: BackupExport) -> str:
    return f"sgtpm-backup-{export.snapshot.folder}{'-with-files' if export.include_files else ''}.tar.gz"


def estimated_size(export: BackupExport) -> int:
    snapshot = export.snapshot
    return snapshot.database_size + (snapshot.files_size if export.include_files else 0)


def run_export(export_id) -> BackupExport:
    from plane.backup.restore import RestoreFailed, pick_copy

    export = BackupExport.objects.select_related("snapshot").get(pk=export_id)
    if export.status != ExportStatus.QUEUED:
        return export

    def progress(text: str) -> None:
        BackupExport.objects.filter(pk=export.pk).update(progress=text[:255])

    export.status = ExportStatus.RUNNING
    export.save(update_fields=["status"])
    target = export_path(export.id)
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        needed = estimated_size(export) + FREE_SPACE_MARGIN
        free = shutil.disk_usage(target.parent).free
        if free < needed:
            raise BundleError(
                f"Not enough free disk space on the server to prepare this file "
                f"(needs about {format_bytes(needed)}, has {format_bytes(free)})."
            )
        copy = pick_copy(export.snapshot)
        progress(f"Reading the backup from {copy.destination.name}")
        export.size = build_bundle(
            target, driver_for(copy.destination), export.snapshot.folder, export.include_files, progress
        )
        export.status = ExportStatus.READY
        export.expires_at = timezone.now() + DOWNLOAD_WINDOW
    except (BundleError, RestoreFailed) as error:
        export.status, export.error = ExportStatus.FAILED, str(error)
    except DestinationError as error:
        export.status, export.error = ExportStatus.FAILED, f"Couldn't read the backup: {error}"
    except Exception:  # noqa: BLE001
        logger.exception("Preparing download %s failed", export.id)
        export.status, export.error = ExportStatus.FAILED, "Unexpected error. Details are in the server logs."
    if export.status == ExportStatus.FAILED:
        target.unlink(missing_ok=True)
    export.progress = ""
    export.finished_at = timezone.now()
    export.save()
    return export
