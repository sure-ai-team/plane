# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views import ProjectStickyPinViewSet, ProjectStickyShareViewSet, ProjectStickyViewSet

urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/stickies/",
        ProjectStickyViewSet.as_view({"get": "list", "post": "create"}),
        name="project-stickies",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/stickies/<uuid:pk>/",
        ProjectStickyViewSet.as_view({"get": "retrieve", "patch": "partial_update", "delete": "destroy"}),
        name="project-stickies",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/stickies/<uuid:pk>/shares/",
        ProjectStickyShareViewSet.as_view({"put": "update"}),
        name="project-sticky-shares",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/stickies/<uuid:pk>/pin/",
        ProjectStickyPinViewSet.as_view({"post": "create", "delete": "destroy"}),
        name="project-sticky-pin",
    ),
]
