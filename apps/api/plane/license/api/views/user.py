# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""User accounts for instance admins (admin console > Users): creation, bulk import and management."""

import logging
from collections import Counter

from django.conf import settings
from django.http import HttpResponse
from rest_framework import status
from rest_framework.response import Response

from plane.app.views.base import BaseAPIView
from plane.db.models import Workspace
from plane.license.api.permissions import InstanceAdminPermission
from plane.utils import instance_user_admin as user_admin
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
    """GET lists every account; POST creates one with the same rules as a one-row bulk upload."""

    permission_classes = [InstanceAdminPermission]

    def get(self, request):
        status_filter = request.query_params.get("status", "")
        if status_filter and status_filter not in user_admin.STATUS_FILTERS:
            return error("Status must be active or deactivated.", "invalid_status")
        users = user_admin.user_queryset(
            search=request.query_params.get("search", ""),
            status=status_filter,
            workspace=request.query_params.get("workspace", ""),
        )
        return self.paginate(
            request=request,
            queryset=users,
            on_results=lambda results: [user_admin.serialize_user(user) for user in results],
            default_per_page=25,
            max_per_page=100,
        )

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


# ---------------------------------------------------------------------------
# Account management (admin console > Users > All users)


def _admin_error(exc):
    return error(str(exc), "invalid_request")


class InstanceUserDetailEndpoint(BaseAPIView):
    permission_classes = [InstanceAdminPermission]

    def get(self, request, pk):
        return Response(user_admin.user_detail(user_admin.get_user(pk)))

    def patch(self, request, pk):
        user = user_admin.get_user(pk)
        data = {key: request.data[key] for key in user_admin.EDITABLE_FIELDS if key in request.data}
        try:
            changed = user_admin.update_user(user, data)
        except user_admin.UserAdminError as exc:
            return _admin_error(exc)
        if changed:
            logger.info("User %s updated (%s) by instance admin %s", user.id, ", ".join(changed), request.user.email)
        return Response(user_admin.user_detail(user_admin.get_user(pk)))

    def delete(self, request, pk):
        user = user_admin.get_user(pk)
        try:
            user_admin.delete_user(user, request.user, request.data.get("confirm_email"))
        except user_admin.UserAdminError as exc:
            return _admin_error(exc)
        return Response(status=status.HTTP_204_NO_CONTENT)


class InstanceUserPasswordEndpoint(BaseAPIView):
    permission_classes = [InstanceAdminPermission]

    def post(self, request, pk):
        user = user_admin.get_user(pk)
        if user.pk == request.user.pk:
            return error("Change your own password from your profile settings.", "own_account")
        try:
            password = user_admin.set_password(
                user,
                password=request.data.get("password", ""),
                sign_out=str(request.data.get("sign_out", "true")).lower() not in ("0", "false", "no"),
            )
        except user_admin.UserAdminError as exc:
            return _admin_error(exc)
        logger.info("Password of user %s reset by instance admin %s", user.id, request.user.email)
        response = Response({"email": user.email, "password": password})
        # The body carries the new password; keep it out of every cache.
        response["Cache-Control"] = "no-store"
        return response


class InstanceUserActivationEndpoint(BaseAPIView):
    """POST {"is_active": false} deactivates the account; {"is_active": true} reactivates it."""

    permission_classes = [InstanceAdminPermission]

    def post(self, request, pk):
        user = user_admin.get_user(pk)
        is_active = request.data.get("is_active")
        if not isinstance(is_active, bool):
            return error("Send is_active as true or false.", "invalid_request")
        try:
            if is_active:
                user_admin.reactivate_user(user)
            else:
                user_admin.deactivate_user(user, request.user)
        except user_admin.UserAdminError as exc:
            return _admin_error(exc)
        logger.info(
            "User %s %s by instance admin %s",
            user.id,
            "reactivated" if is_active else "deactivated",
            request.user.email,
        )
        return Response(user_admin.user_detail(user_admin.get_user(pk)))


class InstanceUserWorkspaceEndpoint(BaseAPIView):
    """POST adds the user to a workspace; PATCH changes the role there; DELETE removes them from it."""

    permission_classes = [InstanceAdminPermission]

    def post(self, request, pk):
        user = user_admin.get_user(pk)
        try:
            user_admin.add_to_workspace(
                user,
                str(request.data.get("workspace") or "").strip(),
                user_admin.parse_role_name(request.data.get("role")),
            )
        except user_admin.UserAdminError as exc:
            return _admin_error(exc)
        return Response(user_admin.user_detail(user_admin.get_user(pk)), status=status.HTTP_201_CREATED)

    def patch(self, request, pk, slug):
        user = user_admin.get_user(pk)
        try:
            user_admin.change_workspace_role(user, slug, user_admin.parse_role_name(request.data.get("role")))
        except user_admin.UserAdminError as exc:
            return _admin_error(exc)
        return Response(user_admin.user_detail(user_admin.get_user(pk)))

    def delete(self, request, pk, slug):
        user = user_admin.get_user(pk)
        try:
            user_admin.remove_from_workspace(user, slug)
        except user_admin.UserAdminError as exc:
            return _admin_error(exc)
        return Response(user_admin.user_detail(user_admin.get_user(pk)))


class InstanceUserProjectEndpoint(BaseAPIView):
    """PUT adds the user to a project or changes their role there; DELETE removes them from it."""

    permission_classes = [InstanceAdminPermission]

    def put(self, request, pk, project_id):
        user = user_admin.get_user(pk)
        try:
            user_admin.set_project_role(user, project_id, user_admin.parse_role_name(request.data.get("role")))
        except user_admin.UserAdminError as exc:
            return _admin_error(exc)
        return Response(user_admin.user_detail(user_admin.get_user(pk)))

    def delete(self, request, pk, project_id):
        user = user_admin.get_user(pk)
        try:
            user_admin.remove_from_project(user, project_id)
        except user_admin.UserAdminError as exc:
            return _admin_error(exc)
        return Response(user_admin.user_detail(user_admin.get_user(pk)))
