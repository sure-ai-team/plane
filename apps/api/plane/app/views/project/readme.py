# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Project README: an ordinary project page shown on the project's Overview page."""

# Django imports
from django.db import transaction

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.db.models import Page, Project, ProjectPage
from plane.utils.project_readme import (
    BLANK_TEMPLATE,
    README_PAGE_NAME,
    README_TEMPLATES,
    readme_template_html,
)

from ..base import BaseAPIView


def active_readme_page_id(project):
    """The README page id, or None when it is unset, deleted, archived, private or detached from the project."""
    if not project.readme_page_id:
        return None
    exists = Page.objects.filter(
        pk=project.readme_page_id,
        archived_at__isnull=True,
        # A README made private before this was enforced is treated as missing.
        access=Page.PUBLIC_ACCESS,
        project_pages__project_id=project.id,
        project_pages__deleted_at__isnull=True,
    ).exists()
    return project.readme_page_id if exists else None


class ProjectReadmeEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        project = Project.objects.get(pk=project_id, workspace__slug=slug)
        page_id = active_readme_page_id(project)
        return Response({"page_id": str(page_id) if page_id else None}, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id):
        template = request.data.get("template") or BLANK_TEMPLATE
        if template not in README_TEMPLATES:
            return Response(
                {"error": f"Unknown template. Choose one of: {', '.join(sorted(README_TEMPLATES))}."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            # Lock the project row so concurrent requests create at most one README.
            project = Project.objects.select_for_update().get(pk=project_id, workspace__slug=slug)
            page_id = active_readme_page_id(project)
            if page_id:
                return Response({"page_id": str(page_id)}, status=status.HTTP_200_OK)

            # Created like any project page (see PageSerializer.create). The live server
            # turns description_html into the collaborative document the first time the
            # page is opened, because description_binary is empty.
            page = Page(
                name=README_PAGE_NAME,
                workspace_id=project.workspace_id,
                owned_by=request.user,
                access=Page.PUBLIC_ACCESS,
                description_html=readme_template_html(template),
                description_binary=None,
                description_json={},
            )
            page.save(created_by_id=request.user.id)
            ProjectPage(
                workspace_id=project.workspace_id,
                project_id=project.id,
                page_id=page.id,
            ).save(created_by_id=request.user.id)
            project.readme_page = page
            project.save(update_fields=["readme_page", "updated_at"])

        return Response({"page_id": str(page.id)}, status=status.HTTP_201_CREATED)
