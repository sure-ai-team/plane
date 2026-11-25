# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The people a project sticky is visible to, for notifications and live updates."""

# Django imports
from django.db.models import Q

# Module imports
from plane.app.permissions import ROLE
from plane.db.models import ProjectMember, StickyAccess, StickyShare, WorkspaceMember


def ids_who_can_see(sticky, shared_ids):
    """The people the sticky is shared with as it is now, without its owner and those
    who see it because they are admins."""
    if sticky.access == StickyAccess.PRIVATE:
        return set()
    if sticky.access == StickyAccess.MEMBERS:
        return set(shared_ids)
    members = ProjectMember.objects.filter(project_id=sticky.project_id, is_active=True)
    if not sticky.project.guest_view_all_features:
        members = members.exclude(role=ROLE.GUEST.value)
    return set(shared_ids) | set(members.values_list("member_id", flat=True))


def audience(sticky, shared_ids=None):
    """Everyone who can open the sticky as it is now. Must agree with ProjectStickyAccess."""
    if shared_ids is None:
        shared_ids = StickyShare.objects.filter(sticky=sticky).values_list("member_id", flat=True)
    active = ProjectMember.objects.filter(project_id=sticky.project_id, is_active=True)
    allowed = Q(member_id=sticky.owner_id) | Q(member_id__in=ids_who_can_see(sticky, shared_ids))
    if sticky.access != StickyAccess.PRIVATE:
        workspace_admins = WorkspaceMember.objects.filter(
            workspace_id=sticky.workspace_id, role=ROLE.ADMIN.value, is_active=True
        ).values("member_id")
        allowed |= Q(role=ROLE.ADMIN.value) | Q(member_id__in=workspace_admins)
    return set(active.filter(allowed).values_list("member_id", flat=True))
