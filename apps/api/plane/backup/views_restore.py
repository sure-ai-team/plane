# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Restore, upload and download endpoints (/api/instances/backups/...)."""

import re
import shutil

from django.conf import settings
from django.db import transaction
from django.http import FileResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from plane.backup import maintenance
from plane.backup.bundle import shared_dir
from plane.backup.destinations import format_bytes
from plane.backup.exports import download_name, estimated_size, export_path
from plane.backup.models import (
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
from plane.backup.restore import cancel_restore, undo_available, upload_path
from plane.backup.serializers import serialize_export, serialize_restore, serialize_upload
from plane.license.api.views.base import BaseAPIView

FREE_SPACE_MARGIN = 512 * 1024 * 1024
ALLOWED_UPLOAD_SUFFIXES = (".tar.gz", ".tgz")
_SAFE_FILENAME = re.compile(r"[^A-Za-z0-9._ -]+")
# Statuses during which no other restore may start.
BUSY_RESTORE_STATUSES = (RestoreStatus.INSPECTING, RestoreStatus.QUEUED, RestoreStatus.RUNNING, RestoreStatus.UNDOING)


def _error(message: str, code=status.HTTP_400_BAD_REQUEST, **extra) -> Response:
    return Response({"error": message, **extra}, status=code)


def chunk_size() -> int:
    """Upload chunks stay under the platform's request size limit."""
    limit = int(getattr(settings, "DATA_UPLOAD_MAX_MEMORY_SIZE", 5 * 1024 * 1024) or 5 * 1024 * 1024)
    return max(256 * 1024, min(8 * 1024 * 1024, limit - 64 * 1024))


def confirm_phrase() -> str:
    from plane.license.models import Instance

    instance = Instance.objects.only("instance_name").first()
    return (instance.instance_name or "").strip() if instance else ""


def restore_payload(restore: BackupRestore) -> dict:
    data = serialize_restore(restore)
    data["confirm_phrase"] = confirm_phrase() or "RESTORE"
    return data


def _check_password(request) -> Response | None:
    password = request.data.get("password")
    if not isinstance(password, str) or not request.user.check_password(password):
        return _error("Your password is wrong.", status.HTTP_403_FORBIDDEN, fields={"password": "Wrong password."})
    return None


def _start_inspection(source: str, label: str, user, snapshot=None, upload=None) -> BackupRestore | Response:
    from plane.backup.tasks import inspect_restore_task

    with transaction.atomic():
        if BackupRestore.objects.select_for_update().filter(status__in=BUSY_RESTORE_STATUSES).exists():
            return _error("Another restore is in progress. Wait for it to finish.", status.HTTP_409_CONFLICT)
        if BackupSnapshot.objects.filter(status__in=[SnapshotStatus.QUEUED, SnapshotStatus.RUNNING]).exists():
            return _error("A backup is in progress. Wait for it to finish, then restore.", status.HTTP_409_CONFLICT)
        # Only one checked restore at a time: they share the staging database.
        for old in BackupRestore.objects.filter(status__in=[RestoreStatus.READY, RestoreStatus.INVALID]):
            cancel_restore(old)
        restore = BackupRestore.objects.create(
            source=source, snapshot=snapshot, upload=upload, label=label[:255], created_by=user
        )
        transaction.on_commit(lambda: inspect_restore_task.delay(str(restore.id)))
    maintenance.publish_status(restore.id, status=RestoreStatus.INSPECTING, progress="Waiting to start")
    return restore


class BackupRestoreListEndpoint(BaseAPIView):
    def get(self, request):
        restores = BackupRestore.objects.select_related("created_by", "confirmed_by")[:20]
        return Response([restore_payload(r) for r in restores])

    def post(self, request):
        """Check a saved backup before restoring it."""
        snapshot = BackupSnapshot.objects.filter(pk=request.data.get("snapshot_id")).first()
        if snapshot is None:
            return _error("Choose a backup to restore.")
        if snapshot.status not in (SnapshotStatus.SUCCEEDED, SnapshotStatus.PARTIAL):
            return _error("Only completed backups can be restored.")
        usable = snapshot.copies.filter(status=CopyStatus.SUCCEEDED, destination__isnull=False).exclude(
            destination__kind="postgres"
        )
        if not usable.exists():
            return _error("None of the places this backup was saved to are available any more.")
        when = timezone.localtime(snapshot.created_at).strftime("%Y-%m-%d %H:%M")
        label = f"the backup from {when}" + (f" ({snapshot.note})" if snapshot.note else "")
        result = _start_inspection(RestoreSource.SNAPSHOT, label, request.user, snapshot=snapshot)
        if isinstance(result, Response):
            return result
        return Response(restore_payload(result), status=status.HTTP_201_CREATED)


class BackupRestoreDetailEndpoint(BaseAPIView):
    def get(self, request, pk):
        restore = BackupRestore.objects.select_related("created_by", "confirmed_by").get(pk=pk)
        return Response(restore_payload(restore))


class BackupRestoreConfirmEndpoint(BaseAPIView):
    def post(self, request, pk):
        from plane.backup.tasks import run_restore_task

        wrong = _check_password(request)
        if wrong:
            return wrong
        phrase = confirm_phrase() or "RESTORE"
        typed = request.data.get("confirm_text")
        if not isinstance(typed, str) or typed.strip().casefold() != phrase.casefold():
            return _error(f'Type "{phrase}" to confirm.', fields={"confirm_text": "Doesn't match."})
        with transaction.atomic():
            restore = BackupRestore.objects.select_for_update().get(pk=pk)
            if restore.status != RestoreStatus.READY or not restore.can_restore:
                return _error("This backup isn't ready to restore. Check it again.", status.HTTP_409_CONFLICT)
            restore.status = RestoreStatus.QUEUED
            restore.confirmed_by = request.user
            restore.save(update_fields=["status", "confirmed_by"])
            transaction.on_commit(lambda: run_restore_task.delay(str(restore.id)))
        maintenance.publish_status(
            restore.id, status=RestoreStatus.QUEUED, progress="Waiting to start", error="", switched=False
        )
        return Response(restore_payload(restore))


class BackupRestoreCancelEndpoint(BaseAPIView):
    def post(self, request, pk):
        restore = BackupRestore.objects.get(pk=pk)
        if restore.status not in (RestoreStatus.READY, RestoreStatus.INVALID):
            return _error("Only a restore that hasn't started can be cancelled.", status.HTTP_409_CONFLICT)
        cancel_restore(restore)
        return Response(restore_payload(restore))


class BackupRestoreUndoEndpoint(BaseAPIView):
    def post(self, request, pk):
        from plane.backup.tasks import undo_restore_task

        wrong = _check_password(request)
        if wrong:
            return wrong
        with transaction.atomic():
            restore = BackupRestore.objects.select_for_update().get(pk=pk)
            if not undo_available(restore):
                return _error("This restore can no longer be undone.", status.HTTP_409_CONFLICT)
            restore.status = RestoreStatus.UNDOING
            restore.save(update_fields=["status"])
            transaction.on_commit(lambda: undo_restore_task.delay(str(restore.id)))
        maintenance.publish_status(
            restore.id, status=RestoreStatus.UNDOING, progress="Waiting to start", error="", switched=False
        )
        return Response(restore_payload(restore))


class BackupRestoreStatusEndpoint(APIView):
    """Restore progress for the admin's progress screen.

    Open on purpose: a restore replaces the database, and with it every session. The id
    is a random UUID and the answer holds only status text.
    """

    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, pk):
        data = maintenance.read_status(pk)
        if not data:
            return Response({"error": "Unknown restore."}, status=status.HTTP_404_NOT_FOUND)
        allowed = ("status", "progress", "step", "error", "switched", "updated_at")
        return Response({key: data[key] for key in allowed if key in data})


# ---------------------------------------------------------------------------
# Uploading a backup file
# ---------------------------------------------------------------------------


class BackupUploadListEndpoint(BaseAPIView):
    def post(self, request):
        filename = request.data.get("filename")
        size = request.data.get("size")
        if not isinstance(filename, str) or not filename.lower().endswith(ALLOWED_UPLOAD_SUFFIXES):
            return _error("Choose a backup file downloaded from this page (it ends in .tar.gz).")
        if isinstance(size, bool) or not isinstance(size, int) or size <= 0:
            return _error("The file looks empty.")
        limit = int(getattr(settings, "BACKUP_MAX_UPLOAD_BYTES", 50 * 1024**3))
        if size > limit:
            return _error(f"The file is larger than the {format_bytes(limit)} the server accepts.")
        folder = shared_dir() / "uploads"
        folder.mkdir(parents=True, exist_ok=True)
        # Room for the file plus unpacking it.
        free = shutil.disk_usage(folder).free
        if free < size * 2 + FREE_SPACE_MARGIN:
            return _error(
                f"Not enough free disk space on the server for this file "
                f"(needs about {format_bytes(size * 2 + FREE_SPACE_MARGIN)}, has {format_bytes(free)})."
            )
        name = _SAFE_FILENAME.sub("_", filename)[-255:]
        upload = BackupUpload.objects.create(filename=name, size=size, created_by=request.user)
        upload_path(upload.id).write_bytes(b"")
        return Response({**serialize_upload(upload), "chunk_size": chunk_size()}, status=status.HTTP_201_CREATED)


class BackupUploadDetailEndpoint(BaseAPIView):
    def get(self, request, pk):
        upload = BackupUpload.objects.get(pk=pk)
        return Response({**serialize_upload(upload), "chunk_size": chunk_size()})


class BackupUploadChunkEndpoint(BaseAPIView):
    """Appends one chunk. `offset` must equal the bytes already received, so a resumed
    upload can't leave a gap or write twice."""

    def put(self, request, pk):
        try:
            offset = int(request.GET.get("offset", "-1"))
        except ValueError:
            offset = -1
        data = request.body
        with transaction.atomic():
            upload = BackupUpload.objects.select_for_update().get(pk=pk)
            if upload.status != UploadStatus.UPLOADING:
                return _error("This upload is already finished.", status.HTTP_409_CONFLICT)
            if offset != upload.received:
                return _error("Out of order chunk.", status.HTTP_409_CONFLICT, received=upload.received)
            if not data or upload.received + len(data) > upload.size:
                return _error("The chunk doesn't fit the file size given.")
            path = upload_path(upload.id)
            if not path.exists() or path.stat().st_size != upload.received:
                upload.status = UploadStatus.FAILED
                upload.save(update_fields=["status", "updated_at"])
                return _error("The partly uploaded file was lost. Start the upload again.", status.HTTP_409_CONFLICT)
            with open(path, "ab") as handle:
                handle.write(data)
            upload.received += len(data)
            if upload.received == upload.size:
                upload.status = UploadStatus.COMPLETE
            upload.save(update_fields=["received", "status", "updated_at"])
        return Response(serialize_upload(upload))


class BackupUploadRestoreEndpoint(BaseAPIView):
    def post(self, request, pk):
        upload = BackupUpload.objects.get(pk=pk)
        if upload.status != UploadStatus.COMPLETE:
            return _error("The file hasn't finished uploading.")
        if not upload_path(upload.id).is_file():
            return _error("The uploaded file is no longer on the server. Upload it again.")
        result = _start_inspection(
            RestoreSource.UPLOAD, f"the uploaded file {upload.filename}", request.user, upload=upload
        )
        if isinstance(result, Response):
            return result
        return Response(restore_payload(result), status=status.HTTP_201_CREATED)


# ---------------------------------------------------------------------------
# Downloading a backup as one file
# ---------------------------------------------------------------------------


class BackupExportListEndpoint(BaseAPIView):
    def post(self, request, pk):
        from plane.backup.tasks import run_export_task

        snapshot = BackupSnapshot.objects.get(pk=pk)
        if snapshot.status not in (SnapshotStatus.SUCCEEDED, SnapshotStatus.PARTIAL):
            return _error("Only completed backups can be downloaded.")
        include_files = request.data.get("include_files", False)
        if not isinstance(include_files, bool):
            return _error("Invalid choice for files.")
        if include_files and not snapshot.include_files:
            return _error("This backup has no uploaded files to include.")
        reusable = BackupExport.objects.filter(
            snapshot=snapshot,
            include_files=include_files,
            status__in=[ExportStatus.QUEUED, ExportStatus.RUNNING, ExportStatus.READY],
        ).first()
        if reusable and (reusable.status != ExportStatus.READY or export_path(reusable.id).is_file()):
            return Response(serialize_export(reusable))
        export = BackupExport.objects.create(snapshot=snapshot, include_files=include_files, created_by=request.user)
        transaction.on_commit(lambda: run_export_task.delay(str(export.id)))
        data = serialize_export(export)
        data["estimated_size"] = estimated_size(export)
        return Response(data, status=status.HTTP_201_CREATED)


class BackupExportDetailEndpoint(BaseAPIView):
    def get(self, request, pk):
        return Response(serialize_export(BackupExport.objects.get(pk=pk)))


class BackupExportDownloadEndpoint(BaseAPIView):
    def get(self, request, pk):
        export = BackupExport.objects.select_related("snapshot").get(pk=pk)
        path = export_path(export.id)
        if export.status != ExportStatus.READY or not path.is_file():
            return _error("This download isn't ready or has expired. Prepare it again.", status.HTTP_404_NOT_FOUND)
        return FileResponse(
            open(path, "rb"), as_attachment=True, filename=download_name(export), content_type="application/gzip"
        )
