# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The Users list and the work that nobody in the team is taking care of."""

from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from plane.utils.user_work import (
    SORT_FIELDS,
    STATUS_ACTIVE,
    STATUSES,
    build_team_rows,
    build_team_totals,
    get_work_scope,
    hidden_projects,
    order_items,
    orphaned_items,
    serialize_items,
    sort_rows,
    unassigned_items,
)

from .common import TeamWorkBaseView, page_body, parse_choice, parse_list, parse_page, parse_projects

ROLES = {"20": 20, "15": 15, "5": 5}
BUCKETS = ("unassigned", "orphaned")


def parse_team_filters(params):
    statuses = parse_list(params, "status") or [STATUS_ACTIVE]
    roles = parse_list(params, "role") or []
    if not set(statuses) <= set(STATUSES):
        raise ValidationError({"status": "Invalid status."})
    if not set(roles) <= set(ROLES):
        raise ValidationError({"role": "Invalid role."})
    return {
        "statuses": statuses,
        "roles": [ROLES[role] for role in roles],
        "search": str(params.get("search") or "").strip()[:100],
        "project_ids": parse_projects(params),
    }


def sorted_team_rows(scope, clock, params):
    rows = build_team_rows(scope, clock, **parse_team_filters(params))
    field = parse_choice(params, "sort", SORT_FIELDS, "name")
    direction = parse_choice(params, "direction", ("asc", "desc"), "asc")
    return sort_rows(rows, field, direction == "desc")


class TeamWorkEndpoint(TeamWorkBaseView):
    """GET users-work/ -> workload of every member, with totals of the whole team."""

    def get(self, request, slug):
        params = request.query_params
        clock = self.clock()
        offset, per_page, page = parse_page(params)
        scope = get_work_scope(request.user, slug, parse_projects(params))
        rows = sorted_team_rows(scope, clock, params)
        return Response(
            page_body(
                rows[offset : offset + per_page],
                len(rows),
                page,
                per_page,
                period=clock.period,
                totals=build_team_totals(scope, clock),
            ),
            status=status.HTTP_200_OK,
        )


class TeamWorkItemsEndpoint(TeamWorkBaseView):
    """GET users-work/items/?bucket= -> open work without an assignee, or left by people who are gone."""

    def get(self, request, slug):
        params = request.query_params
        clock = self.clock()
        offset, per_page, page = parse_page(params)
        bucket = parse_choice(params, "bucket", BUCKETS, "unassigned")
        scope = get_work_scope(request.user, slug, parse_projects(params))

        def select(queryset):
            return unassigned_items(queryset) if bucket == "unassigned" else orphaned_items(queryset, slug)

        readable = select(scope.readable_items())
        return Response(
            page_body(
                serialize_items(order_items(readable)[offset : offset + per_page], scope, clock),
                readable.count(),
                page,
                per_page,
                hidden_projects=hidden_projects(select(scope.items()), scope),
            ),
            status=status.HTTP_200_OK,
        )
