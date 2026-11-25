# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The Users list: one row of workload per workspace member."""

from collections import defaultdict
from typing import Any, Dict, List, Optional

from django.db.models import Count, Exists, OuterRef, Q, Subquery

from plane.db.models import (
    CycleIssue,
    IssueActivity,
    IssueAssignee,
    ProjectMember,
    User,
    WorkspaceMember,
    WorkspaceMemberInvite,
)

from .metrics import COUNT_KEYS, Clock, open_q, overdue_q, workload_counts
from .scope import WorkScope

STATUS_ACTIVE = "active"
STATUS_SUSPENDED = "suspended"
STATUS_INVITED = "invited"
STATUSES = (STATUS_ACTIVE, STATUS_SUSPENDED, STATUS_INVITED)

SORT_FIELDS = ("name", "role", "projects", "open", "in_progress", "overdue", "done", "last_activity_at")


def member_status(membership: WorkspaceMember) -> str:
    """Suspended covers both people removed from the workspace and deactivated accounts."""
    return STATUS_ACTIVE if membership.is_active and membership.member.is_active else STATUS_SUSPENDED


def person(user: User) -> Dict[str, Any]:
    return {
        "id": user.id,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "display_name": user.display_name,
        "email": user.email,
        "avatar_url": user.avatar_url,
    }


def full_name(user: User) -> str:
    return f"{user.first_name or ''} {user.last_name or ''}".strip() or user.display_name or user.email


def last_activity(slug: str, user_ids) -> Dict[Any, Any]:
    """Latest work item change or comment of each user. One index probe per user."""
    latest = (
        IssueActivity.objects.filter(actor_id=OuterRef("pk"), workspace__slug=slug)
        .order_by("-created_at")
        .values("created_at")[:1]
    )
    return dict(User.objects.filter(id__in=user_ids).annotate(last=Subquery(latest)).values_list("id", "last"))


def _memberships(slug: str, statuses, search: str, roles, project_ids: Optional[List]):
    queryset = WorkspaceMember.objects.filter(workspace__slug=slug, member__is_bot=False).select_related(
        "member", "member__avatar_asset"
    )
    active = Q(is_active=True, member__is_active=True)
    if STATUS_ACTIVE in statuses and STATUS_SUSPENDED not in statuses:
        queryset = queryset.filter(active)
    elif STATUS_SUSPENDED in statuses and STATUS_ACTIVE not in statuses:
        queryset = queryset.exclude(active)
    for word in search.split():
        queryset = queryset.filter(
            Q(member__display_name__icontains=word)
            | Q(member__first_name__icontains=word)
            | Q(member__last_name__icontains=word)
            | Q(member__email__icontains=word)
        )
    if roles:
        queryset = queryset.filter(role__in=roles)
    if project_ids is not None:
        # Leaving the workspace also ends project memberships, so people who left are
        # matched by the memberships they had.
        queryset = queryset.filter(
            Exists(
                ProjectMember.objects.filter(
                    member_id=OuterRef("member_id"), project_id__in=project_ids, is_active=OuterRef("is_active")
                )
            )
        )
    return queryset


def _invitations(slug: str, search: str, roles) -> List[Dict[str, Any]]:
    queryset = WorkspaceMemberInvite.objects.filter(workspace__slug=slug, accepted=False, responded_at__isnull=True)
    for word in search.split():
        queryset = queryset.filter(email__icontains=word)
    if roles:
        queryset = queryset.filter(role__in=roles)
    return [
        {
            "id": invite.id,
            "first_name": "",
            "last_name": "",
            "display_name": invite.email,
            "email": invite.email,
            "avatar_url": None,
            "name": invite.email,
            "role": invite.role,
            "status": STATUS_INVITED,
            "joined_at": invite.created_at,
            "last_activity_at": None,
            "projects": 0,
            "cycles": [],
            "hidden_cycles": 0,
            **{key: 0 for key in COUNT_KEYS},
        }
        for invite in queryset
    ]


def _workloads(scope: WorkScope, clock: Clock, user_ids) -> Dict[Any, Dict[str, int]]:
    rows = (
        IssueAssignee.objects.filter(assignee_id__in=user_ids, issue_id__in=scope.items().values("id"))
        .order_by()
        .values("assignee_id")
        .annotate(**workload_counts(clock, prefix="issue__"))
    )
    return {row["assignee_id"]: {key: row[key] for key in COUNT_KEYS} for row in rows}


def _active_cycles(scope: WorkScope, clock: Clock, user_ids):
    """Cycles running now that hold work of each user: (named per user, number hidden per user)."""
    rows = (
        CycleIssue.objects.filter(
            issue_id__in=scope.items().values("id"),
            cycle__deleted_at__isnull=True,
            cycle__archived_at__isnull=True,
            cycle__start_date__lte=clock.now,
            cycle__end_date__gte=clock.now,
            issue__issue_assignee__deleted_at__isnull=True,
            issue__issue_assignee__assignee_id__in=user_ids,
        )
        .order_by("cycle__end_date", "cycle_id")
        .values_list("issue__issue_assignee__assignee_id", "cycle_id", "cycle__name", "project_id")
        .distinct()
    )
    named, hidden = defaultdict(list), defaultdict(int)
    for user_id, cycle_id, name, project_id in rows:
        if project_id in scope.readable:
            named[user_id].append({"id": cycle_id, "name": name, "project_id": project_id})
        else:
            hidden[user_id] += 1
    return named, hidden


def sort_rows(rows: List[Dict[str, Any]], field: str, descending: bool) -> List[Dict[str, Any]]:
    """Sort by a column; people without a value come last and ties are ordered by name."""
    rows = sorted(rows, key=lambda row: row["name"].casefold())
    if field == "name":
        return rows[::-1] if descending else rows
    filled = [row for row in rows if row[field] is not None]
    empty = [row for row in rows if row[field] is None]
    return sorted(filled, key=lambda row: row[field], reverse=descending) + empty


def build_team_rows(
    scope: WorkScope,
    clock: Clock,
    statuses=(STATUS_ACTIVE,),
    search: str = "",
    roles=None,
    project_ids: Optional[List] = None,
) -> List[Dict[str, Any]]:
    """One row per member. Runs a fixed number of queries, whatever the number of members."""
    rows: List[Dict[str, Any]] = []

    if STATUS_ACTIVE in statuses or STATUS_SUSPENDED in statuses:
        memberships = list(_memberships(scope.slug, statuses, search, roles, project_ids))
        user_ids = [membership.member_id for membership in memberships]
        workloads = _workloads(scope, clock, user_ids)
        named_cycles, hidden_cycles = _active_cycles(scope, clock, user_ids)
        activity = last_activity(scope.slug, user_ids)
        projects = dict(
            ProjectMember.objects.filter(member_id__in=user_ids, is_active=True, project_id__in=scope.countable)
            .order_by()
            .values("member_id")
            .annotate(total=Count("project_id", distinct=True))
            .values_list("member_id", "total")
        )
        no_work = {key: 0 for key in COUNT_KEYS}
        for membership in memberships:
            user_id = membership.member_id
            rows.append(
                {
                    **person(membership.member),
                    "name": full_name(membership.member),
                    "role": membership.role,
                    "status": member_status(membership),
                    "joined_at": membership.created_at,
                    "last_activity_at": activity.get(user_id),
                    "projects": projects.get(user_id, 0),
                    "cycles": named_cycles.get(user_id, []),
                    "hidden_cycles": hidden_cycles.get(user_id, 0),
                    **workloads.get(user_id, no_work),
                }
            )

    # Invited people are not in any project yet.
    if STATUS_INVITED in statuses and project_ids is None:
        rows.extend(_invitations(scope.slug, search, roles))

    return rows


def current_member_ids(slug: str):
    """Everyone who can still work in the workspace, bots included."""
    return WorkspaceMember.objects.filter(
        workspace__slug=slug, is_active=True, member__is_active=True
    ).values("member_id")


def unassigned_items(queryset):
    """Open work items that nobody is assigned to."""
    return queryset.filter(open_q()).exclude(Exists(IssueAssignee.objects.filter(issue_id=OuterRef("pk"))))


def orphaned_items(queryset, slug: str):
    """Open work items assigned only to people who left or were suspended."""
    assignees = IssueAssignee.objects.filter(issue_id=OuterRef("pk"))
    return (
        queryset.filter(open_q())
        .filter(Exists(assignees))
        .exclude(Exists(assignees.filter(assignee_id__in=current_member_ids(slug))))
    )


def build_team_totals(scope: WorkScope, clock: Clock) -> Dict[str, int]:
    """Totals of the whole team. Each work item counts once, whatever its assignees."""
    items = scope.items()
    assigned = Exists(
        IssueAssignee.objects.filter(issue_id=OuterRef("pk"), assignee_id__in=current_member_ids(scope.slug))
    )
    return {
        "members": WorkspaceMember.objects.filter(
            workspace__slug=scope.slug, is_active=True, member__is_active=True, member__is_bot=False
        ).count(),
        "overdue": items.filter(overdue_q(clock)).filter(assigned).count(),
        "unassigned": unassigned_items(items).count(),
        "orphaned": orphaned_items(items, scope.slug).count(),
    }
