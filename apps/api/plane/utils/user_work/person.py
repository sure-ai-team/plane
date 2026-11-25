# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The User Work page: one member's work across projects."""

from collections import defaultdict
from datetime import timedelta
from typing import Any, Dict, List, Optional

from django.db.models import Count, F, Q
from django.db.models.functions import TruncWeek
from django.utils import timezone

from plane.db.models import Cycle, CycleIssue, IssueActivity, IssueAssignee, Project, ProjectMember

from .metrics import (
    COUNT_KEYS,
    OPEN_GROUPS,
    STATE_GROUPS,
    TREND_WEEKS,
    Clock,
    due_soon_q,
    on_time_counts,
    overdue_q,
    state_group_q,
    stuck_q,
    week_start,
    workload_counts,
)
from .scope import WorkScope, assigned_to

ATTENTION_LIMIT = 10

ITEM_FIELDS = (
    "id",
    "name",
    "sequence_id",
    "priority",
    "start_date",
    "target_date",
    "completed_at",
    "updated_at",
    "project_id",
    "project__identifier",
    "project__name",
    "state_id",
    "state__name",
    "state__color",
    "state__group",
)


def serialize_items(queryset, scope: WorkScope, clock: Clock) -> List[Dict[str, Any]]:
    """Rows for a page of work items. The caller must pass readable items only."""
    items = list(queryset.values(*ITEM_FIELDS))
    assignees = defaultdict(list)
    for issue_id, user_id in IssueAssignee.objects.filter(issue_id__in=[item["id"] for item in items]).values_list(
        "issue_id", "assignee_id"
    ):
        assignees[issue_id].append(user_id)

    rows = []
    for item in items:
        group = item["state__group"]
        target_date = item["target_date"]
        rows.append(
            {
                "id": item["id"],
                "name": item["name"],
                "sequence_id": item["sequence_id"],
                "priority": item["priority"],
                "start_date": item["start_date"],
                "target_date": target_date,
                "completed_at": item["completed_at"],
                "updated_at": item["updated_at"],
                "project_id": item["project_id"],
                "project_identifier": item["project__identifier"],
                "project_name": item["project__name"],
                "state_id": item["state_id"],
                "state_name": item["state__name"],
                "state_color": item["state__color"],
                "state_group": group,
                "assignee_ids": assignees[item["id"]],
                "is_overdue": bool(group in OPEN_GROUPS and target_date and target_date < clock.today),
                "is_stuck": group == "started" and item["updated_at"] < clock.stuck_before,
                "can_open": item["project_id"] in scope.joined,
            }
        )
    return rows


def order_items(queryset, group: Optional[str] = None):
    """Closed work newest first; open work by due date, then most recently changed."""
    if group == "completed":
        return queryset.order_by("-completed_at", "-id")
    if group == "cancelled":
        return queryset.order_by("-updated_at", "-id")
    return queryset.order_by(F("target_date").asc(nulls_last=True), "-updated_at", "-id")


def hidden_projects(queryset, scope: WorkScope) -> List[Dict[str, Any]]:
    """How many of the items sit in projects whose titles the requester may not see."""
    if not scope.hidden:
        return []
    return list(
        queryset.filter(project_id__in=scope.hidden)
        .order_by()
        .values("project_id")
        .annotate(project_name=F("project__name"), count=Count("id"))
        .order_by("-count", "project_name")
    )


def _project_rows(scope: WorkScope, clock: Clock, items, user_id) -> List[Dict[str, Any]]:
    """Projects the person belongs to, or has recent or open work in."""
    memberships = dict(
        ProjectMember.objects.filter(
            member_id=user_id, is_active=True, project_id__in=scope.countable
        ).values_list("project_id", "role")
    )
    counts = {
        row["project_id"]: row
        for row in items.order_by().values("project_id").annotate(**workload_counts(clock))
        if any(row[key] for key in COUNT_KEYS)
    }
    projects = Project.objects.filter(id__in=set(memberships) | set(counts)).order_by("name")
    return [
        {
            "id": project.id,
            "name": project.name,
            "identifier": project.identifier,
            "logo_props": project.logo_props,
            "role": memberships.get(project.id),
            "can_read": project.id in scope.readable,
            "can_open": project.id in scope.joined,
            **{key: counts.get(project.id, {}).get(key, 0) for key in COUNT_KEYS},
        }
        for project in projects
    ]


def _trend(items, clock: Clock) -> List[Dict[str, Any]]:
    """Items completed per week, oldest first, including empty weeks and the current one."""
    weeks = TREND_WEEKS[clock.period]
    first = week_start(clock.today) - timedelta(weeks=weeks - 1)
    tz = timezone.get_current_timezone()
    rows = (
        items.filter(state__group="completed", completed_at__gte=clock.now - timedelta(weeks=weeks + 1))
        .annotate(week=TruncWeek("completed_at", tzinfo=tz))
        .order_by()
        .values("week")
        .annotate(total=Count("id"))
    )
    totals = {timezone.localdate(row["week"], tz): row["total"] for row in rows}
    return [
        {"week": day.isoformat(), "completed": totals.get(day, 0)}
        for day in (first + timedelta(weeks=n) for n in range(weeks))
    ]


def build_summary(scope: WorkScope, clock: Clock, user_id) -> Dict[str, Any]:
    items = assigned_to(scope.items(), user_id)

    stats = items.aggregate(**workload_counts(clock))
    on_time = on_time_counts(items, clock)
    groups = items.aggregate(**{group: Count("id", filter=state_group_q(group, clock)) for group in STATE_GROUPS})

    needs_attention = overdue_q(clock) | due_soon_q(clock) | stuck_q(clock)
    attention = assigned_to(scope.readable_items(), user_id).filter(needs_attention)

    return {
        "period": clock.period,
        "stats": {**stats, "on_time": on_time["on_time"], "on_time_total": on_time["total"]},
        "state_groups": groups,
        "projects": _project_rows(scope, clock, items, user_id),
        "trend": _trend(items, clock),
        "attention": {
            "items": serialize_items(order_items(attention)[:ATTENTION_LIMIT], scope, clock),
            "total": items.filter(needs_attention).count(),
            "hidden": items.filter(needs_attention, project_id__in=scope.hidden).count() if scope.hidden else 0,
        },
    }


def _points(value: Optional[str], estimate_type: Optional[str]) -> float:
    """Only numeric estimates of type "points" add up, as in reports."""
    if estimate_type != "points" or value in (None, ""):
        return 0.0
    try:
        return float(value)
    except ValueError:
        return 0.0


def _empty_share() -> Dict[str, Any]:
    return {
        "total": 0,
        "done": 0,
        "in_progress": 0,
        "not_started": 0,
        "cancelled": 0,
        "overdue": 0,
        "points": 0.0,
        "points_done": 0.0,
    }


def build_cycles(scope: WorkScope, clock: Clock, user_id) -> Dict[str, Any]:
    """The person's share of the cycles running now or starting later."""
    rows = list(
        CycleIssue.objects.filter(
            issue_id__in=assigned_to(scope.items(), user_id).values("id"),
            cycle__deleted_at__isnull=True,
            cycle__archived_at__isnull=True,
            cycle__start_date__isnull=False,
            cycle__end_date__gte=clock.now,
        ).values_list(
            "cycle_id",
            "project_id",
            "issue__state__group",
            "issue__target_date",
            "issue__estimate_point__value",
            "issue__estimate_point__estimate__type",
        )
    )
    hidden = {cycle_id for cycle_id, project_id, *_ in rows if project_id not in scope.readable}
    shares: Dict[Any, Dict[str, Any]] = defaultdict(_empty_share)
    for cycle_id, project_id, group, target_date, value, estimate_type in rows:
        if project_id not in scope.readable:
            continue
        share = shares[cycle_id]
        if group == "cancelled":
            # Cancelled work is neither done nor left to do.
            share["cancelled"] += 1
            continue
        points = _points(value, estimate_type)
        share["total"] += 1
        share["points"] += points
        if group == "completed":
            share["done"] += 1
            share["points_done"] += points
            continue
        share["in_progress" if group == "started" else "not_started"] += 1
        if target_date and target_date < clock.today:
            share["overdue"] += 1

    active, upcoming = [], []
    cycles = Cycle.objects.filter(id__in=list(shares)).select_related("project").order_by("end_date", "name")
    for cycle in cycles:
        is_active = cycle.start_date <= clock.now
        (active if is_active else upcoming).append(
            {
                "id": cycle.id,
                "name": cycle.name,
                "start_date": cycle.start_date,
                "end_date": cycle.end_date,
                "days_left": (timezone.localdate(cycle.end_date) - clock.today).days if is_active else None,
                "days_to_start": None if is_active else (timezone.localdate(cycle.start_date) - clock.today).days,
                "project_id": cycle.project_id,
                "project_name": cycle.project.name,
                "project_identifier": cycle.project.identifier,
                "project_logo_props": cycle.project.logo_props,
                "can_open": cycle.project_id in scope.joined,
                **shares[cycle.id],
            }
        )
    return {"active": active, "upcoming": upcoming, "hidden": len(hidden)}


# Outside joined projects an activity only shows what a list of work items would show:
# never comment text, descriptions, links, attachments or related work items.
PUBLIC_FIELDS = frozenset(
    {"name", "state", "priority", "start_date", "target_date", "assignees", "labels", "cycles", "modules"}
)
HIDDEN_ACTIVITY = ("vote", "reaction", "draft")


def activity_queryset(scope: WorkScope, user_id, start=None, end=None):
    queryset = (
        IssueActivity.objects.filter(
            # Creating a work item has no field, which an exclusion alone would drop.
            Q(field__isnull=True) | ~Q(field__in=HIDDEN_ACTIVITY),
            Q(issue__isnull=True) | Q(issue__deleted_at__isnull=True, issue__is_draft=False),
            workspace__slug=scope.slug,
            project_id__in=scope.readable,
            actor_id=user_id,
        )
        .select_related("actor", "actor__avatar_asset", "workspace", "project", "issue")
        .defer("issue__description_html", "issue__description_json", "issue__description_binary")
        .order_by("-created_at", "-id")
    )
    if start:
        queryset = queryset.filter(created_at__date__gte=start)
    if end:
        queryset = queryset.filter(created_at__date__lte=end)
    return queryset


def shows_values(activity: IssueActivity, scope: WorkScope) -> bool:
    return activity.project_id in scope.joined or activity.field in PUBLIC_FIELDS


def serialize_activity(activity: IssueActivity, scope: WorkScope) -> Dict[str, Any]:
    visible = shows_values(activity, scope)
    issue, project, actor = activity.issue, activity.project, activity.actor
    return {
        "id": activity.id,
        "verb": activity.verb,
        "field": activity.field,
        "old_value": activity.old_value if visible else None,
        "new_value": activity.new_value if visible else None,
        "old_identifier": activity.old_identifier if visible else None,
        "new_identifier": activity.new_identifier if visible else None,
        "comment": "",
        "epoch": activity.epoch,
        "created_at": activity.created_at,
        "can_open": activity.project_id in scope.joined,
        "issue": activity.issue_id,
        "issue_detail": (
            {"id": issue.id, "name": issue.name, "sequence_id": issue.sequence_id, "priority": issue.priority}
            if issue
            else None
        ),
        "project": activity.project_id,
        "project_detail": {
            "id": project.id,
            "name": project.name,
            "identifier": project.identifier,
            "logo_props": project.logo_props,
        },
        "workspace": activity.workspace_id,
        "workspace_detail": {"id": activity.workspace_id, "slug": scope.slug, "name": activity.workspace.name},
        "actor": activity.actor_id,
        "actor_detail": {
            "id": actor.id,
            "first_name": actor.first_name,
            "last_name": actor.last_name,
            "display_name": actor.display_name,
            "avatar_url": actor.avatar_url,
            "is_bot": actor.is_bot,
        },
    }
