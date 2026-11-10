# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Server recovery: the settings kit and release copies (/api/instances/backups/...)."""

import logging

from django.http import HttpResponse
from rest_framework import status
from rest_framework.response import Response

from plane.backup import releases, settings_kit
from plane.backup.bundle import compressed_file_response
from plane.license.api.views.base import BaseAPIView

logger = logging.getLogger("plane.api")


def _error(message: str, code=status.HTTP_400_BAD_REQUEST, **extra) -> Response:
    return Response({"error": message, **extra}, status=code)


class BackupSettingsKitEndpoint(BaseAPIView):
    def get(self, request):
        """How the kit is protected, for the instructions on the page."""
        return Response(
            {
                "min_passphrase_length": settings_kit.MIN_PASSPHRASE_LENGTH,
                "iterations": settings_kit.PBKDF2_ITERATIONS,
                "filename": settings_kit.kit_filename(),
                "open_command": settings_kit.open_command(settings_kit.kit_filename()),
            }
        )

    def post(self, request):
        password = request.data.get("password")
        if not isinstance(password, str) or not request.user.check_password(password):
            return _error("Your password is wrong.", status.HTTP_403_FORBIDDEN, fields={"password": "Wrong password."})
        passphrase = request.data.get("passphrase")
        minimum = settings_kit.MIN_PASSPHRASE_LENGTH
        if not isinstance(passphrase, str) or len(passphrase) < minimum:
            return _error(
                f"Use a passphrase of at least {minimum} characters.",
                fields={"passphrase": f"At least {minimum} characters."},
            )
        if passphrase == password:
            return _error(
                "Use a different passphrase from your account password.",
                fields={"passphrase": "Must differ from your password."},
            )
        filename = settings_kit.kit_filename()
        blob = settings_kit.encrypt(settings_kit.build_kit(request.user), passphrase)
        # The kit holds every password of the server: leave a trace of who took one.
        logger.warning("Server settings kit downloaded by %s", request.user.email)
        response = HttpResponse(blob, content_type="application/octet-stream")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        response["Cache-Control"] = "no-store"
        return response


class BackupReleaseListEndpoint(BaseAPIView):
    def get(self, request):
        current = releases.current_version()
        items = releases.list_releases()
        for item in items:
            item["is_current"] = item["version"] == current
        return Response(
            {
                "current_version": current,
                "has_current": any(item["is_current"] for item in items),
                "releases": items,
            }
        )


class BackupReleaseDetailEndpoint(BaseAPIView):
    def delete(self, request, version):
        if releases.release_dir(version) is None:
            return _error("Unknown release.", status.HTTP_404_NOT_FOUND)
        if not releases.delete_release(version):
            return _error("Unknown release.", status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)


class BackupReleaseDownloadEndpoint(BaseAPIView):
    def get(self, request, version):
        folder = releases.release_dir(version)
        name = releases.FILES.get(request.GET.get("file", "images"))
        if folder is None or name is None or not (folder / name).is_file():
            return _error("This release copy isn't on the server.", status.HTTP_404_NOT_FOUND)
        return compressed_file_response(request, folder / name, f"sgtpm-{version}-{name}")


class BackupReleaseCopyEndpoint(BaseAPIView):
    def post(self, request, version):
        from plane.backup.models import BackupDestination
        from plane.backup.tasks import copy_release_task

        folder = releases.release_dir(version)
        if folder is None or releases.describe(folder) is None:
            return _error("This release copy isn't on the server.", status.HTTP_404_NOT_FOUND)
        if not BackupDestination.objects.filter(is_enabled=True).exclude(kind="postgres").exists():
            return _error("Add a server folder or cloud storage destination first.")
        releases.mark_copy_queued(version)
        copy_release_task.delay(version)
        return Response(releases.describe(folder), status=status.HTTP_202_ACCEPTED)
