# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views.user_work import (
    TeamWorkEndpoint,
    TeamWorkExportEndpoint,
    TeamWorkItemsEndpoint,
    UserWorkActivityEndpoint,
    UserWorkCyclesEndpoint,
    UserWorkExportEndpoint,
    UserWorkItemsEndpoint,
    UserWorkSummaryEndpoint,
)

PREFIX = "workspaces/<str:slug>/users-work"

urlpatterns = [
    path(f"{PREFIX}/", TeamWorkEndpoint.as_view(), name="users-work"),
    path(f"{PREFIX}/items/", TeamWorkItemsEndpoint.as_view(), name="users-work-items"),
    path(f"{PREFIX}/export/", TeamWorkExportEndpoint.as_view(), name="users-work-export"),
    path(f"{PREFIX}/<uuid:user_id>/summary/", UserWorkSummaryEndpoint.as_view(), name="user-work-summary"),
    path(f"{PREFIX}/<uuid:user_id>/items/", UserWorkItemsEndpoint.as_view(), name="user-work-items"),
    path(f"{PREFIX}/<uuid:user_id>/cycles/", UserWorkCyclesEndpoint.as_view(), name="user-work-cycles"),
    path(f"{PREFIX}/<uuid:user_id>/activity/", UserWorkActivityEndpoint.as_view(), name="user-work-activity"),
    path(f"{PREFIX}/<uuid:user_id>/export/", UserWorkExportEndpoint.as_view(), name="user-work-export"),
]
