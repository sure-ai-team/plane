# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ProjectStickyPermission
from plane.app.serializers import ProjectStickySerializer, StickySharingSerializer
from plane.db.models import Sticky, StickyAccess, StickyShare, Workspace

from ..base import BaseViewSet
from .notifications import ids_who_can_see, notify_shared, withdraw

# Fields whose concurrent edits would overwrite each other
CONTENT_FIELDS = {"name", "description", "description_html"}


class ProjectStickyBaseViewSet(BaseViewSet):
    model = Sticky
    serializer_class = ProjectStickySerializer
    permission_classes = [ProjectStickyPermission]

    def get_queryset(self):
        return self.sticky_access.stickies()

    def get_locked_sticky(self, pk):
        """The sticky, locked until the end of the transaction. 404 when it is not visible to the user."""
        return get_object_or_404(self.get_queryset().select_for_update(of=("self",)), pk=pk)

    def require_edit(self, sticky):
        if not self.sticky_access.can_edit(sticky):
            raise PermissionDenied("You don't have the required permissions.")

    def require_manage(self, sticky):
        if not self.sticky_access.can_manage(sticky):
            raise PermissionDenied("You don't have the required permissions.")

    def serialize(self, stickies, **kwargs):
        return ProjectStickySerializer(stickies, context={"sticky_access": self.sticky_access}, **kwargs).data


class ProjectStickyViewSet(ProjectStickyBaseViewSet):
    def list(self, request, slug, project_id):
        stickies = self.get_queryset()

        query = request.query_params.get("query")
        if query:
            stickies = stickies.filter(description_stripped__icontains=query)

        if request.query_params.get("pinned") == "true":
            stickies = stickies.filter(pinned_at__isnull=False).order_by("-pinned_at", "id")
        else:
            stickies = stickies.order_by("-sort_order", "id")

        return self.paginate(
            request=request,
            queryset=stickies,
            on_results=lambda results: self.serialize(results, many=True),
            default_per_page=20,
            max_per_page=100,
        )

    def retrieve(self, request, slug, project_id, pk):
        return Response(self.serialize(get_object_or_404(self.get_queryset(), pk=pk)), status=status.HTTP_200_OK)

    def create(self, request, slug, project_id):
        if not self.sticky_access.can_create:
            raise PermissionDenied("You don't have the required permissions.")
        serializer = ProjectStickySerializer(data=request.data, context={"sticky_access": self.sticky_access})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        workspace = Workspace.objects.get(slug=slug)
        serializer.save(workspace_id=workspace.id, project_id=project_id, owner_id=request.user.id)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, slug, project_id, pk):
        with transaction.atomic():
            sticky = self.get_locked_sticky(pk)
            self.require_edit(sticky)
            serializer = ProjectStickySerializer(
                sticky, data=request.data, partial=True, context={"sticky_access": self.sticky_access}
            )
            if not serializer.is_valid():
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

            changes = {}
            if CONTENT_FIELDS & serializer.validated_data.keys():
                base_version = request.data.get("content_version")
                if type(base_version) is not int:
                    return Response(
                        {"content_version": ["The version these changes are based on is required."]},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if base_version != sticky.content_version:
                    return Response(
                        {
                            "error": "This sticky was changed by someone else.",
                            "sticky": self.serialize(sticky),
                        },
                        status=status.HTTP_409_CONFLICT,
                    )
                changes["content_version"] = sticky.content_version + 1

            serializer.save(**changes)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def destroy(self, request, slug, project_id, pk):
        with transaction.atomic():
            sticky = self.get_locked_sticky(pk)
            self.require_manage(sticky)
            sticky.delete()
            withdraw(sticky)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectStickyShareViewSet(ProjectStickyBaseViewSet):
    def update(self, request, slug, project_id, pk):
        """Replace who the sticky is shared with."""
        with transaction.atomic():
            sticky = self.get_locked_sticky(pk)
            self.require_manage(sticky)
            serializer = StickySharingSerializer(data=request.data, context={"sticky": sticky})
            if not serializer.is_valid():
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
            data = serializer.validated_data
            permissions = {item["member_id"]: item["permission"] for item in data["members"]}
            current_shares = {share.member_id: share for share in StickyShare.objects.filter(sticky=sticky)}
            could_see_ids = ids_who_can_see(sticky, current_shares)

            sticky.access = data["access"]
            sticky.project_permission = data["project_permission"]
            if sticky.access != StickyAccess.PROJECT:
                # The overview only shows what the whole project may see
                sticky.pinned_at = None
                sticky.pinned_by = None
            sticky.save()
            self.replace_shares(sticky, current_shares, permissions)
            withdraw(sticky, except_for=ids_who_can_see(sticky, permissions))
            notify_shared(sticky, request.user, permissions, could_see_ids)

        # An admin who made someone else's sticky private can no longer see it
        sticky = self.get_queryset().filter(pk=pk).first()
        if sticky is None:
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response(self.serialize(sticky), status=status.HTTP_200_OK)

    def replace_shares(self, sticky, current, permissions):
        StickyShare.objects.filter(sticky=sticky).exclude(member_id__in=list(permissions)).delete()
        for member_id, permission in permissions.items():
            share = current.get(member_id)
            if share is None:
                StickyShare.objects.create(
                    workspace_id=sticky.workspace_id, sticky=sticky, member_id=member_id, permission=permission
                )
            elif share.permission != permission:
                share.permission = permission
                share.save()


class ProjectStickyPinViewSet(ProjectStickyBaseViewSet):
    def create(self, request, slug, project_id, pk):
        with transaction.atomic():
            sticky = self.get_locked_sticky(pk)
            self.require_manage(sticky)
            if sticky.access != StickyAccess.PROJECT:
                return Response(
                    {"error": "Share the sticky with the whole project before pinning it."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if sticky.pinned_at is None:
                sticky.pinned_at = timezone.now()
                sticky.pinned_by = request.user
                sticky.save()
        return Response(self.serialize(sticky), status=status.HTTP_200_OK)

    def destroy(self, request, slug, project_id, pk):
        with transaction.atomic():
            sticky = self.get_locked_sticky(pk)
            self.require_manage(sticky)
            if sticky.pinned_at is not None:
                sticky.pinned_at = None
                sticky.pinned_by = None
                sticky.save()
        return Response(self.serialize(sticky), status=status.HTTP_200_OK)
