# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Who may do what with a project sticky.

Every rule lives in ``ProjectStickyAccess`` so lists, single objects and the
``my_permission`` value sent to clients cannot disagree.

Active project membership is always required: a person removed from the project
loses access at once, whatever was shared with them.
"""

# Python imports
from dataclasses import dataclass
from typing import Optional

# Django imports
from django.db.models import Exists, OuterRef, Prefetch, Q, Subquery

# Third party imports
from rest_framework.permissions import BasePermission

# Module imports
from plane.app.permissions.base import ROLE
from plane.db.models import ProjectMember, Sticky, StickyAccess, StickyPermission, StickyShare, WorkspaceMember

VIEW = "view"
EDIT = "edit"
MANAGE = "manage"  # edit, plus share, pin and delete


@dataclass(frozen=True)
class ProjectStickyAccess:
    """One user's standing in one project."""

    user_id: object
    project_id: object
    is_admin: bool
    is_guest: bool
    sees_project_wide: bool

    @classmethod
    def resolve(cls, user, slug, project_id) -> Optional["ProjectStickyAccess"]:
        """None when the user is not an active member of the project."""
        member = (
            ProjectMember.objects.filter(
                member=user,
                workspace__slug=slug,
                project_id=project_id,
                project__archived_at__isnull=True,
                is_active=True,
            )
            .select_related("project")
            .first()
        )
        if member is None:
            return None

        # Same rule as allow_permission: a workspace admin who is part of the
        # project acts as a project admin whatever their project role is.
        is_admin = (
            member.role == ROLE.ADMIN.value
            or WorkspaceMember.objects.filter(
                member=user, workspace__slug=slug, role=ROLE.ADMIN.value, is_active=True
            ).exists()
        )
        is_guest = member.role == ROLE.GUEST.value and not is_admin
        return cls(
            user_id=user.id,
            project_id=project_id,
            is_admin=is_admin,
            is_guest=is_guest,
            # Guests see project-wide content only where the project allows it (as for pages)
            sees_project_wide=not is_guest or member.project.guest_view_all_features,
        )

    @property
    def can_create(self) -> bool:
        return not self.is_guest

    def stickies(self):
        """Stickies of the project this user may at least view."""
        my_share = StickyShare.objects.filter(sticky_id=OuterRef("pk"), member_id=self.user_id)
        active_members = ProjectMember.objects.filter(
            project_id=self.project_id, member_id=OuterRef("member_id"), is_active=True
        )

        # Private stickies are excluded explicitly, so a leftover share or the
        # admin role never opens one.
        visible = Q(owner_id=self.user_id)
        visible |= Q(access__in=[StickyAccess.MEMBERS, StickyAccess.PROJECT], my_share__isnull=False)
        if self.sees_project_wide:
            visible |= Q(access=StickyAccess.PROJECT)
        if self.is_admin:
            visible |= Q(access=StickyAccess.MEMBERS)

        return (
            Sticky.objects.filter(project_id=self.project_id)
            .annotate(my_share=Subquery(my_share.values("permission")[:1]))
            .filter(visible)
            .prefetch_related(
                Prefetch("shares", queryset=StickyShare.objects.filter(Exists(active_members)), to_attr="active_shares")
            )
        )

    def permission_for(self, sticky) -> str:
        """The user's permission on a sticky returned by ``stickies()``."""
        if self.is_guest:
            return VIEW
        if self.is_admin or sticky.owner_id == self.user_id:
            return MANAGE
        # my_share is missing on a sticky that was only just created, whose owner is handled above
        if getattr(sticky, "my_share", None) == StickyPermission.EDIT:
            return EDIT
        if sticky.access == StickyAccess.PROJECT and sticky.project_permission == StickyPermission.EDIT:
            return EDIT
        return VIEW

    def can_edit(self, sticky) -> bool:
        return self.permission_for(sticky) in (EDIT, MANAGE)

    def can_manage(self, sticky) -> bool:
        return self.permission_for(sticky) == MANAGE


class ProjectStickyPermission(BasePermission):
    """Requires project membership and leaves the caller's standing on ``view.sticky_access``."""

    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False
        view.sticky_access = ProjectStickyAccess.resolve(
            request.user, view.kwargs.get("slug"), view.kwargs.get("project_id")
        )
        return view.sticky_access is not None
