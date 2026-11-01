# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Bulk user creation for instance admins (admin console > Users)."""

import logging
from collections import Counter

from django.conf import settings
from django.http import HttpResponse
from rest_framework import status
from rest_framework.response import Response

from plane.app.views.base import BaseAPIView
from plane.db.models import Workspace
from plane.license.api.permissions import InstanceAdminPermission
from plane.utils.bulk_user_import import (
    MEMBER,
    STATUS_CREATED,
    STATUS_ERROR,
    STATUS_EXISTING,
    BulkUserImporter,
    BulkUserImportError,
    RowError,
    build_template_xlsx,
    parse_role,
    read_upload,
)

logger = logging.getLogger("plane.api")

XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def error(message, code, http_status=status.HTTP_400_BAD_REQUEST):
    return Response({"error": message, "code": code}, status=http_status)


SINGLE_USER_FIELDS = ("email", "first_name", "last_name", "phone", "workspace", "role")


class InstanceUserCreateEndpoint(BaseAPIView):
    """Create one account from the admin console form; same rules as a one-row bulk upload."""

    permission_classes = [InstanceAdminPermission]

    def post(self, request):
        row = {key: str(request.data.get(key) or "").strip() for key in SINGLE_USER_FIELDS}
        [result] = BulkUserImporter(default_role=MEMBER).run([(1, row)])
        if result.status == STATUS_ERROR:
            return error(" ".join(result.messages), "invalid_user")

        if result.status == STATUS_CREATED:
            logger.info("User %s created by instance admin %s", result.email, request.user.email)
        response = Response(
            result.as_dict(),
            status=status.HTTP_201_CREATED if result.status == STATUS_CREATED else status.HTTP_200_OK,
        )
        # The body carries the temporary password; keep it out of every cache.
        response["Cache-Control"] = "no-store"
        return response


class InstanceBulkUserTemplateEndpoint(BaseAPIView):
    permission_classes = [InstanceAdminPermission]

    def get(self, request):
        response = HttpResponse(build_template_xlsx(), content_type=XLSX_CONTENT_TYPE)
        response["Content-Disposition"] = 'attachment; filename="users-template.xlsx"'
        return response


class InstanceBulkUserCreateEndpoint(BaseAPIView):
    permission_classes = [InstanceAdminPermission]

    def post(self, request):
        upload = request.FILES.get("file")
        if upload is None:
            return error("Choose the filled-in users file.", "missing_file")
        if upload.size > settings.FILE_SIZE_LIMIT:
            return error("The file is larger than the upload limit.", "file_too_large")

        dry_run = str(request.data.get("dry_run", "")).lower() in ("1", "true", "yes")
        try:
            default_role = parse_role(request.data.get("role") or "", MEMBER)
        except RowError as exc:
            return error(str(exc), "invalid_role")

        default_workspace = (request.data.get("workspace") or "").strip()
        if default_workspace and not Workspace.objects.filter(slug=default_workspace).exists():
            return error(f"Workspace '{default_workspace}' does not exist.", "invalid_workspace")

        try:
            rows = read_upload(upload.name, upload.read())
        except BulkUserImportError as exc:
            return error(str(exc), "invalid_file")

        results = BulkUserImporter(default_workspace=default_workspace, default_role=default_role).run(
            rows, dry_run=dry_run
        )
        counts = Counter(result.status for result in results)
        if not dry_run:
            logger.info(
                "Bulk user creation by %s: %s created, %s existing, %s failed",
                request.user.email,
                counts[STATUS_CREATED],
                counts[STATUS_EXISTING],
                counts[STATUS_ERROR],
            )

        response = Response(
            {
                "dry_run": dry_run,
                "summary": {
                    "created": counts[STATUS_CREATED],
                    "existing": counts[STATUS_EXISTING],
                    "failed": counts[STATUS_ERROR],
                },
                "results": [result.as_dict() for result in results],
            },
            status=status.HTTP_200_OK,
        )
        # The body carries temporary passwords; keep it out of every cache.
        response["Cache-Control"] = "no-store"
        return response
