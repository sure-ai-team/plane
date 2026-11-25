# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The User Work page of one member."""

from rest_framework import status
from rest_framework.response import Response

from plane.utils.user_work import (
    FOCUS_CHOICES,
    STATE_GROUPS,
    activity_queryset,
    assigned_to,
    build_cycles,
    build_summary,
    focus_q,
    full_name,
    get_work_scope,
    hidden_projects,
    last_activity,
    member_status,
    order_items,
    person,
    serialize_activity,
    serialize_items,
    state_group_q,
)

from .common import UserWorkBaseView, page_body, parse_choice, parse_date_range, parse_page, parse_projects


class UserWorkSummaryEndpoint(UserWorkBaseView):
    """GET users-work/<user_id>/summary/ -> who the person is, key numbers and what needs attention."""

    def get(self, request, slug, user_id):
        clock = self.clock()
        scope = get_work_scope(request.user, slug, parse_projects(request.query_params))
        member = self.membership.member
        return Response(
            {
                "user": {
                    **person(member),
                    "name": full_name(member),
                    "role": self.membership.role,
                    "status": member_status(self.membership),
                    "joined_at": self.membership.created_at,
                    "timezone": member.user_timezone,
                    "cover_image_url": member.cover_image_url,
                    "last_activity_at": last_activity(slug, [member.id]).get(member.id),
                },
                **build_summary(scope, clock, user_id),
            },
            status=status.HTTP_200_OK,
        )


def filter_items(queryset, clock, params):
    """Apply the state group and focus filters of the Work tab."""
    group = parse_choice(params, "state_group", STATE_GROUPS)
    focus = parse_choice(params, "focus", FOCUS_CHOICES)
    if group:
        queryset = queryset.filter(state_group_q(group, clock))
    if focus:
        queryset = queryset.filter(focus_q(focus, clock))
    return queryset


class UserWorkItemsEndpoint(UserWorkBaseView):
    """GET users-work/<user_id>/items/ -> assigned work items, usually one state group at a time."""

    def get(self, request, slug, user_id):
        params = request.query_params
        clock = self.clock()
        offset, per_page, page = parse_page(params)
        scope = get_work_scope(request.user, slug, parse_projects(params))
        readable = filter_items(assigned_to(scope.readable_items(), user_id), clock, params)
        counted = filter_items(assigned_to(scope.items(), user_id), clock, params)
        ordered = order_items(readable, params.get("state_group"))
        return Response(
            page_body(
                serialize_items(ordered[offset : offset + per_page], scope, clock),
                readable.count(),
                page,
                per_page,
                hidden_projects=hidden_projects(counted, scope),
            ),
            status=status.HTTP_200_OK,
        )


class UserWorkCyclesEndpoint(UserWorkBaseView):
    """GET users-work/<user_id>/cycles/ -> the person's share of running and upcoming cycles."""

    def get(self, request, slug, user_id):
        scope = get_work_scope(request.user, slug, parse_projects(request.query_params))
        return Response(build_cycles(scope, self.clock(), user_id), status=status.HTTP_200_OK)


class UserWorkActivityEndpoint(UserWorkBaseView):
    """GET users-work/<user_id>/activity/ -> what the person did, comments included, newest first."""

    def get(self, request, slug, user_id):
        params = request.query_params
        offset, per_page, page = parse_page(params)
        start, end = parse_date_range(params)
        scope = get_work_scope(request.user, slug, parse_projects(params))
        queryset = activity_queryset(scope, user_id, start, end)
        # One row more than the page tells whether there is another page, without counting
        # a history that only grows.
        rows = list(queryset[offset : offset + per_page + 1])
        return Response(
            {
                "results": [serialize_activity(row, scope) for row in rows[:per_page]],
                "page": page,
                "per_page": per_page,
                "has_more": len(rows) > per_page,
            },
            status=status.HTTP_200_OK,
        )
