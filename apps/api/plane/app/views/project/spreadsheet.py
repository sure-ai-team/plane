# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Spreadsheets (.xlsx / .csv) uploaded to a project's Overview page.

These are the *only* routes that create or serve ``PROJECT_SPREADSHEET`` assets;
the generic asset endpoints refuse them (see ``FileAsset.PRIVATE_ENTITY_TYPES``).
The browser parses the files itself, so the server only stores and serves bytes.
"""

# Python imports
import hashlib
import os
import uuid
from urllib.parse import quote

# Django imports
from django.conf import settings
from django.http import HttpResponse, HttpResponseRedirect, StreamingHttpResponse
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import ProjectSpreadsheetSerializer
from plane.db.models import FileAsset, Project
from plane.settings.storage import S3Storage
from plane.utils.path_validator import sanitize_filename

from ..base import BaseAPIView

XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
CSV_TYPE = "text/csv"

# extension -> (stored content type, content types a browser may report for it)
SPREADSHEET_TYPES = {
    ".xlsx": (XLSX_TYPE, frozenset({XLSX_TYPE})),
    # Browsers report .csv files as text/csv, application/vnd.ms-excel (Windows with Excel
    # installed) or text/plain; all of them are accepted only for a .csv name.
    ".csv": (CSV_TYPE, frozenset({CSV_TYPE, "application/vnd.ms-excel", "text/plain"})),
}

MAX_NAME_LENGTH = 255
READ_ROLES = [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST]
WRITE_ROLES = [ROLE.ADMIN, ROLE.MEMBER]
CONTENT_CHUNK_BYTES = 64 * 1024


class SpreadsheetError(Exception):
    def __init__(self, message, status_code=status.HTTP_400_BAD_REQUEST):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def file_extension(name):
    return os.path.splitext(name)[1].lower()


def clean_name(name):
    name = sanitize_filename(name)
    if not name:
        raise SpreadsheetError("A file name is required.")
    if len(name) > MAX_NAME_LENGTH:
        stem, extension = os.path.splitext(name)
        name = stem[: MAX_NAME_LENGTH - len(extension)] + extension
    return name


def validate_upload(data):
    """Validate ``{"name", "type", "size"}``; return (name, stored content type, size)."""
    name = clean_name(data.get("name"))
    extension = file_extension(name)
    if extension not in SPREADSHEET_TYPES:
        raise SpreadsheetError("Only .xlsx and .csv files can be uploaded.")

    stored_type, accepted_types = SPREADSHEET_TYPES[extension]
    content_type = str(data.get("type") or "").split(";")[0].strip().lower()
    if content_type not in accepted_types:
        raise SpreadsheetError("The file type doesn't match an .xlsx or .csv file.")

    try:
        size = int(data.get("size"))
    except (TypeError, ValueError):
        raise SpreadsheetError("A valid file size is required.")
    if size <= 0:
        raise SpreadsheetError("The file is empty.")
    if size > settings.SPREADSHEET_SIZE_LIMIT:
        raise SpreadsheetError(
            f"The file is too large. Spreadsheets can be up to {settings.SPREADSHEET_SIZE_LIMIT // (1024 * 1024)} MB."
        )
    return name, stored_type, size


def renamed(current_name, new_name):
    """Sanitize ``new_name`` and keep the file's current extension."""
    new_name = clean_name(new_name)
    extension = file_extension(current_name)
    if file_extension(new_name) != extension:
        new_name = clean_name(f"{new_name}{extension}")
    elif len(new_name) == len(extension):
        raise SpreadsheetError("A file name is required.")
    return new_name


def spreadsheets(slug, project_id):
    return FileAsset.objects.filter(
        workspace__slug=slug,
        project_id=project_id,
        entity_type=FileAsset.EntityTypeContext.PROJECT_SPREADSHEET,
        is_deleted=False,
    ).select_related("workspace")


def object_key(workspace_id, project_id, name):
    return f"{workspace_id}/projects/{project_id}/spreadsheets/{uuid.uuid4().hex}-{name}"


def upload_response(request, asset, key, content_type, size):
    upload_data = S3Storage(request=request).generate_presigned_post(
        object_name=key, file_type=content_type, file_size=size
    )
    if upload_data is None:
        raise SpreadsheetError("File storage is unavailable. Try again shortly.", status.HTTP_503_SERVICE_UNAVAILABLE)
    return Response(
        {"upload_data": upload_data, "asset_id": str(asset.id), "asset_url": asset.asset_url},
        status=status.HTTP_200_OK,
    )


def content_etag(asset):
    digest = hashlib.sha256(f"{asset.id}:{asset.asset.name}:{asset.updated_at.isoformat()}".encode()).hexdigest()
    return f'"{digest[:32]}"'


def etag_matches(header, etag):
    if not header:
        return False
    candidates = [tag.strip() for tag in header.split(",")]
    return "*" in candidates or any(tag.removeprefix("W/") == etag for tag in candidates)


class SpreadsheetBaseEndpoint(BaseAPIView):
    def handle_exception(self, exc):
        if isinstance(exc, SpreadsheetError):
            return Response({"error": exc.message}, status=exc.status_code)
        return super().handle_exception(exc)


class ProjectSpreadsheetEndpoint(SpreadsheetBaseEndpoint):
    """GET: list uploaded spreadsheets. POST: presigned upload for a new one."""

    @allow_permission(READ_ROLES)
    def get(self, request, slug, project_id):
        queryset = spreadsheets(slug, project_id).filter(is_uploaded=True).order_by("-updated_at")
        return Response(ProjectSpreadsheetSerializer(queryset, many=True).data, status=status.HTTP_200_OK)

    @allow_permission(WRITE_ROLES)
    def post(self, request, slug, project_id):
        name, content_type, size = validate_upload(request.data)
        project = Project.objects.get(pk=project_id, workspace__slug=slug)
        key = object_key(project.workspace_id, project.id, name)
        asset = FileAsset(
            attributes={"name": name, "type": content_type, "size": size},
            asset=key,
            size=size,
            workspace_id=project.workspace_id,
            project_id=project.id,
            entity_type=FileAsset.EntityTypeContext.PROJECT_SPREADSHEET,
            updated_by_id=request.user.id,
        )
        asset.save(created_by_id=request.user.id)
        return upload_response(request, asset, key, content_type, size)


class ProjectSpreadsheetDetailEndpoint(SpreadsheetBaseEndpoint):
    """PATCH: finish an upload or replace, and/or rename. DELETE: soft delete."""

    @allow_permission(WRITE_ROLES)
    def patch(self, request, slug, project_id, asset_id):
        asset = spreadsheets(slug, project_id).get(pk=asset_id)
        attributes = dict(asset.attributes or {})
        update_fields = set()

        if request.data.get("is_uploaded") is True:
            pending_key = attributes.get("pending_asset")
            if pending_key:
                # Finish a replace: swap the new file in under the same id.
                self.check_uploaded(pending_key)
                asset.asset = pending_key
                attributes["name"] = attributes.pop("pending_name", attributes.get("name"))
                attributes["type"] = attributes.pop("pending_type", attributes.get("type"))
                attributes["size"] = attributes.pop("pending_size", attributes.get("size"))
                attributes.pop("pending_asset", None)
                asset.size = attributes["size"]
                asset.is_uploaded = True
                asset.storage_metadata = {}
                update_fields |= {"asset", "attributes", "size", "is_uploaded", "storage_metadata"}
            elif not asset.is_uploaded:
                self.check_uploaded(asset.asset.name)
                asset.is_uploaded = True
                update_fields.add("is_uploaded")

        if "name" in request.data:
            name = renamed(attributes.get("name") or asset.asset.name, request.data.get("name"))
            if name != attributes.get("name"):
                attributes["name"] = name
                update_fields.add("attributes")

        if update_fields:
            asset.attributes = attributes
            asset.updated_by_id = request.user.id
            asset.save(update_fields=[*update_fields, "updated_by", "updated_at"], disable_auto_set_user=True)

        return Response(ProjectSpreadsheetSerializer(asset).data, status=status.HTTP_200_OK)

    @allow_permission(WRITE_ROLES)
    def delete(self, request, slug, project_id, asset_id):
        asset = spreadsheets(slug, project_id).get(pk=asset_id)
        asset.is_deleted = True
        asset.deleted_at = timezone.now()
        asset.updated_by_id = request.user.id
        asset.save(update_fields=["is_deleted", "deleted_at", "updated_by", "updated_at"], disable_auto_set_user=True)
        return Response(status=status.HTTP_204_NO_CONTENT)

    def check_uploaded(self, key):
        """The object must exist in storage and stay within the size limit."""
        # Server-side reads use the internal storage endpoint (request=None).
        head = S3Storage(request=None).get_object_metadata(key)
        if not head or not head.get("ContentLength"):
            raise SpreadsheetError("The file hasn't finished uploading.")
        if int(head["ContentLength"]) > settings.SPREADSHEET_SIZE_LIMIT:
            raise SpreadsheetError("The file is too large.")


class ProjectSpreadsheetReplaceEndpoint(SpreadsheetBaseEndpoint):
    """POST: presigned upload for a new version; PATCH ``{"is_uploaded": true}`` then swaps it in."""

    @allow_permission(WRITE_ROLES)
    def post(self, request, slug, project_id, asset_id):
        asset = spreadsheets(slug, project_id).get(pk=asset_id, is_uploaded=True)
        name, content_type, size = validate_upload(request.data)
        key = object_key(asset.workspace_id, asset.project_id, name)
        asset.attributes = {
            **(asset.attributes or {}),
            "pending_asset": key,
            "pending_name": name,
            "pending_type": content_type,
            "pending_size": size,
        }
        # Not a visible change yet, so updated_at (and the content ETag) stay as they are.
        FileAsset.objects.filter(pk=asset.pk).update(attributes=asset.attributes)
        return upload_response(request, asset, key, content_type, size)


class ProjectSpreadsheetContentEndpoint(SpreadsheetBaseEndpoint):
    """GET: stream the file through the API, so the browser never talks to storage directly."""

    @allow_permission(READ_ROLES)
    def get(self, request, slug, project_id, asset_id):
        asset = spreadsheets(slug, project_id).get(pk=asset_id, is_uploaded=True)
        etag = content_etag(asset)
        if etag_matches(request.headers.get("If-None-Match"), etag):
            response = HttpResponse(status=status.HTTP_304_NOT_MODIFIED)
            response["ETag"] = etag
            response["Cache-Control"] = "private, no-cache"
            return response

        stored = S3Storage(request=None).get_object(asset.asset.name)
        if not stored:
            return Response({"error": "The file could not be found."}, status=status.HTTP_404_NOT_FOUND)
        body = stored["Body"]

        def chunks():
            try:
                yield from body.iter_chunks(CONTENT_CHUNK_BYTES)
            finally:
                body.close()

        attributes = asset.attributes or {}
        response = StreamingHttpResponse(chunks(), content_type=attributes.get("type") or "application/octet-stream")
        if stored.get("ContentLength") is not None:
            response["Content-Length"] = str(stored["ContentLength"])
        response["ETag"] = etag
        response["Cache-Control"] = "private, no-cache"
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Disposition"] = (
            f"attachment; filename*=UTF-8''{quote(attributes.get('name') or 'spreadsheet')}"
        )
        return response


class ProjectSpreadsheetDownloadEndpoint(SpreadsheetBaseEndpoint):
    """GET: redirect to a short-lived storage link that downloads the file under its name."""

    @allow_permission(READ_ROLES)
    def get(self, request, slug, project_id, asset_id):
        asset = spreadsheets(slug, project_id).get(pk=asset_id, is_uploaded=True)
        url = S3Storage(request=request).generate_presigned_url(
            object_name=asset.asset.name,
            disposition="attachment",
            filename=(asset.attributes or {}).get("name"),
        )
        if not url:
            return Response(
                {"error": "File storage is unavailable. Try again shortly."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        return HttpResponseRedirect(url)
