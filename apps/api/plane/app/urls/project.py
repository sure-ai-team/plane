# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views import (
    ProjectViewSet,
    DeployBoardViewSet,
    ProjectInvitationsViewset,
    ProjectMemberViewSet,
    ProjectMemberUserEndpoint,
    ProjectJoinEndpoint,
    ProjectUserViewsEndpoint,
    ProjectIdentifierEndpoint,
    ProjectFavoritesViewSet,
    UserProjectInvitationsViewset,
    UserProjectRolesEndpoint,
    ProjectArchiveUnarchiveEndpoint,
    ProjectMemberPreferenceEndpoint,
    ProjectReadmeEndpoint,
    ProjectSpreadsheetEndpoint,
    ProjectSpreadsheetDetailEndpoint,
    ProjectSpreadsheetReplaceEndpoint,
    ProjectSpreadsheetContentEndpoint,
    ProjectSpreadsheetDownloadEndpoint,
)


urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/",
        ProjectViewSet.as_view({"get": "list", "post": "create"}),
        name="project",
    ),
    path(
        "workspaces/<str:slug>/projects/details/",
        ProjectViewSet.as_view({"get": "list_detail"}),
        name="project",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:pk>/",
        ProjectViewSet.as_view(
            {
                "get": "retrieve",
                "put": "update",
                "patch": "partial_update",
                "delete": "destroy",
            }
        ),
        name="project",
    ),
    path(
        "workspaces/<str:slug>/project-identifiers/",
        ProjectIdentifierEndpoint.as_view(),
        name="project-identifiers",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/invitations/",
        ProjectInvitationsViewset.as_view({"get": "list", "post": "create"}),
        name="project-member-invite",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/invitations/<uuid:pk>/",
        ProjectInvitationsViewset.as_view({"get": "retrieve", "delete": "destroy"}),
        name="project-member-invite",
    ),
    path(
        "users/me/workspaces/<str:slug>/projects/invitations/",
        UserProjectInvitationsViewset.as_view({"get": "list", "post": "create"}),
        name="user-project-invitations",
    ),
    path(
        "users/me/workspaces/<str:slug>/project-roles/",
        UserProjectRolesEndpoint.as_view(),
        name="user-project-roles",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/join/<uuid:pk>/",
        ProjectJoinEndpoint.as_view(),
        name="project-join",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/members/",
        ProjectMemberViewSet.as_view({"get": "list", "post": "create"}),
        name="project-member",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/members/<uuid:pk>/",
        ProjectMemberViewSet.as_view({"get": "retrieve", "patch": "partial_update", "delete": "destroy"}),
        name="project-member",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/members/leave/",
        ProjectMemberViewSet.as_view({"post": "leave"}),
        name="project-member",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/project-views/",
        ProjectUserViewsEndpoint.as_view(),
        name="project-view",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/project-members/me/",
        ProjectMemberUserEndpoint.as_view(),
        name="project-member-view",
    ),
    path(
        "workspaces/<str:slug>/user-favorite-projects/",
        ProjectFavoritesViewSet.as_view({"get": "list", "post": "create"}),
        name="project-favorite",
    ),
    path(
        "workspaces/<str:slug>/user-favorite-projects/<uuid:project_id>/",
        ProjectFavoritesViewSet.as_view({"delete": "destroy"}),
        name="project-favorite",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/project-deploy-boards/",
        DeployBoardViewSet.as_view({"get": "list", "post": "create"}),
        name="project-deploy-board",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/project-deploy-boards/<uuid:pk>/",
        DeployBoardViewSet.as_view({"get": "retrieve", "patch": "partial_update", "delete": "destroy"}),
        name="project-deploy-board",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/archive/",
        ProjectArchiveUnarchiveEndpoint.as_view(),
        name="project-archive-unarchive",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/preferences/member/<uuid:member_id>/",
        ProjectMemberPreferenceEndpoint.as_view(),
        name="project-member-preference",
    ),
    # Project Overview: README and spreadsheets
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/readme/",
        ProjectReadmeEndpoint.as_view(),
        name="project-readme",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/spreadsheets/",
        ProjectSpreadsheetEndpoint.as_view(),
        name="project-spreadsheets",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/spreadsheets/<uuid:asset_id>/",
        ProjectSpreadsheetDetailEndpoint.as_view(),
        name="project-spreadsheet",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/spreadsheets/<uuid:asset_id>/replace/",
        ProjectSpreadsheetReplaceEndpoint.as_view(),
        name="project-spreadsheet-replace",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/spreadsheets/<uuid:asset_id>/content/",
        ProjectSpreadsheetContentEndpoint.as_view(),
        name="project-spreadsheet-content",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/spreadsheets/<uuid:asset_id>/download/",
        ProjectSpreadsheetDownloadEndpoint.as_view(),
        name="project-spreadsheet-download",
    ),
]
