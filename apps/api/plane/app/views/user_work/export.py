# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""CSV and XLSX exports of the Users list and of one member's work or activity."""

from django.utils import timezone
from django.utils.html import strip_tags
from rest_framework.exceptions import ValidationError

from plane.utils.reporting import EXPORT_FORMATS, render_export
from plane.utils.user_work import (
    activity_queryset,
    assigned_to,
    full_name,
    get_work_scope,
    order_items,
    serialize_items,
    shows_values,
)

from .common import TeamWorkBaseView, UserWorkBaseView, parse_choice, parse_date_range, parse_projects
from .person import filter_items
from .team import sorted_team_rows

ITEM_LIMIT = 5000
ACTIVITY_LIMIT = 10000
ROLE_NAMES = {20: "Admin", 15: "Member", 5: "Guest"}

TEAM_COLUMNS = (
    "name",
    "email",
    "role",
    "status",
    "projects",
    "open",
    "in_progress",
    "overdue",
    "due_soon",
    "stuck",
    "no_due_date",
    "done",
    "cycles",
    "last_activity_at",
)
ITEM_COLUMNS = (
    "key",
    "name",
    "project",
    "state",
    "priority",
    "start_date",
    "target_date",
    "completed_at",
    "updated_at",
    "is_overdue",
)
ACTIVITY_COLUMNS = ("created_at", "project", "key", "item", "action", "field", "old_value", "new_value")


def read_labels(data):
    """Translated headers and values sent by the web app, keyed by column or value."""
    labels = data.get("labels") or {}
    if not isinstance(labels, dict) or len(labels) > 100:
        raise ValidationError({"labels": "Invalid labels."})
    return {str(key): str(value)[:60] for key, value in labels.items() if value}


def local(value):
    """Spreadsheets have no timezones: write the requester's local time."""
    return timezone.localtime(value).strftime("%Y-%m-%d %H:%M") if value else ""


def render(request, title, columns, rows, labels):
    """Headers must stay distinct, so that translations can never merge two columns."""
    headers, used = {}, set()
    for column in columns:
        header = labels.get(column, column.replace("_", " ").capitalize())
        while header in used:
            header = f"{header} "
        used.add(header)
        headers[column] = header
    export_format = parse_choice(request.data, "format", EXPORT_FORMATS, "csv")
    sheet = [{headers[column]: row.get(column, "") for column in columns} for row in rows]
    return render_export(export_format, title, [(title, list(headers.values()), sheet)])


class TeamWorkExportEndpoint(TeamWorkBaseView):
    """POST users-work/export/ with the filters of the list."""

    def post(self, request, slug):
        data = request.data
        labels = read_labels(data)
        scope = get_work_scope(request.user, slug, parse_projects(data))
        rows = [
            {
                **row,
                "role": labels.get(f"role_{row['role']}", ROLE_NAMES.get(row["role"], "")),
                "status": labels.get(f"status_{row['status']}", row["status"]),
                "cycles": [cycle["name"] for cycle in row["cycles"]],
                "last_activity_at": local(row["last_activity_at"]),
            }
            for row in sorted_team_rows(scope, self.clock(data), data)
        ]
        return render(request, "users", TEAM_COLUMNS, rows, labels)


class UserWorkExportEndpoint(UserWorkBaseView):
    """POST users-work/<user_id>/export/ with type "items" or "activity"."""

    def post(self, request, slug, user_id):
        data = request.data
        labels = read_labels(data)
        kind = parse_choice(data, "type", ("items", "activity"), "items")
        scope = get_work_scope(request.user, slug, parse_projects(data))
        title = f"{full_name(self.membership.member)} {kind}"
        if kind == "items":
            return render(request, title, ITEM_COLUMNS, self.item_rows(scope, user_id, data, labels), labels)
        return render(request, title, ACTIVITY_COLUMNS, self.activity_rows(scope, user_id, data, labels), labels)

    def item_rows(self, scope, user_id, data, labels):
        clock = self.clock(data)
        items = filter_items(assigned_to(scope.readable_items(), user_id), clock, data)
        ordered = order_items(items, data.get("state_group"))[:ITEM_LIMIT]
        return [
            {
                "key": f"{item['project_identifier']}-{item['sequence_id']}",
                "name": item["name"],
                "project": item["project_name"],
                "state": item["state_name"],
                "priority": labels.get(f"priority_{item['priority']}", item["priority"]),
                "start_date": item["start_date"],
                "target_date": item["target_date"],
                "completed_at": local(item["completed_at"]),
                "updated_at": local(item["updated_at"]),
                "is_overdue": labels.get("yes", "Yes") if item["is_overdue"] else "",
            }
            for item in serialize_items(ordered, scope, clock)
        ]

    def activity_rows(self, scope, user_id, data, labels):
        start, end = parse_date_range(data)
        rows = []
        for activity in activity_queryset(scope, user_id, start, end)[:ACTIVITY_LIMIT]:
            visible = shows_values(activity, scope)
            issue, project = activity.issue, activity.project
            rows.append(
                {
                    "created_at": local(activity.created_at),
                    "project": project.name,
                    "key": f"{project.identifier}-{issue.sequence_id}" if issue else "",
                    "item": issue.name if issue else "",
                    "action": activity.verb,
                    "field": activity.field or "",
                    "old_value": strip_tags(activity.old_value or "") if visible else "",
                    "new_value": strip_tags(activity.new_value or "") if visible else "",
                }
            )
        return rows
