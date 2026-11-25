# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Whose work, and how much of it, a user may see on the Users and User Work pages.

Three levels, from widest to narrowest:
  * countable: projects whose work items are included in the numbers;
  * readable: projects whose work item titles may be shown;
  * joined: projects the requester is a member of, so items can be opened there.

Workspace admins count work in every project, because a partial number would be read as
the whole picture. Titles are shown for public projects (which anyone may join) and for
private projects the admin has joined. Other private projects only contribute numbers.

Members may only ask about themselves, and only see projects they could open or join.

Reports and dashboards deliberately use the narrower plane.utils.reporting.scope.
"""

from dataclasses import dataclass, field
from typing import FrozenSet, Iterable, Optional
from uuid import UUID

from django.db.models import Exists, OuterRef, QuerySet

from plane.db.models import Issue, IssueAssignee, Project, ProjectMember, WorkspaceMember
from plane.db.models.project import ProjectNetwork

ADMIN_ROLE = 20
MEMBER_ROLE = 15


@dataclass(frozen=True)
class WorkScope:
    slug: str
    is_admin: bool
    countable: FrozenSet[UUID] = field(default_factory=frozenset)
    readable: FrozenSet[UUID] = field(default_factory=frozenset)
    joined: FrozenSet[UUID] = field(default_factory=frozenset)

    @property
    def hidden(self) -> FrozenSet[UUID]:
        """Projects that are counted but whose titles may not be shown."""
        return self.countable - self.readable

    def items(self) -> QuerySet:
        """Work items included in the numbers."""
        return Issue.issue_objects.filter(workspace__slug=self.slug, project_id__in=self.countable)

    def readable_items(self) -> QuerySet:
        """Work items whose titles may be shown."""
        return Issue.issue_objects.filter(workspace__slug=self.slug, project_id__in=self.readable)


def get_requester_role(user, slug: str) -> Optional[int]:
    return (
        WorkspaceMember.objects.filter(workspace__slug=slug, member=user, is_active=True)
        .values_list("role", flat=True)
        .first()
    )


def get_work_scope(user, slug: str, project_ids: Optional[Iterable] = None) -> WorkScope:
    """Build the scope of the requesting user, optionally narrowed to project_ids."""
    role = get_requester_role(user, slug)
    if role is None or role < MEMBER_ROLE:
        return WorkScope(slug=slug, is_admin=False)

    is_admin = role == ADMIN_ROLE
    projects = dict(
        Project.objects.filter(workspace__slug=slug, archived_at__isnull=True).values_list("id", "network")
    )
    if project_ids is not None:
        requested = {str(project_id) for project_id in project_ids}
        projects = {pid: network for pid, network in projects.items() if str(pid) in requested}

    joined = frozenset(
        ProjectMember.objects.filter(
            workspace__slug=slug, member=user, is_active=True, project_id__in=projects.keys()
        ).values_list("project_id", flat=True)
    )
    public = frozenset(pid for pid, network in projects.items() if network == ProjectNetwork.PUBLIC.value)
    readable = public | joined
    return WorkScope(
        slug=slug,
        is_admin=is_admin,
        countable=frozenset(projects) if is_admin else readable,
        readable=readable,
        joined=joined,
    )


def assigned_to(queryset: QuerySet, user_id) -> QuerySet:
    """Keep the work items currently assigned to user_id, without joining (and so never duplicating)."""
    return queryset.filter(Exists(IssueAssignee.objects.filter(issue_id=OuterRef("pk"), assignee_id=user_id)))
