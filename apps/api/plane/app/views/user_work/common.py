# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Access rules and query parameters shared by the Users and User Work endpoints."""

from datetime import date
from typing import Any, Dict, List, Optional
from uuid import UUID

from django.http import Http404
from rest_framework.exceptions import PermissionDenied, ValidationError

from plane.app.views.base import BaseAPIView
from plane.db.models import WorkspaceMember
from plane.utils.user_work import ADMIN_ROLE, DEFAULT_PERIOD, MEMBER_ROLE, PERIODS, Clock, get_requester_role

DEFAULT_PER_PAGE = 50
MAX_PER_PAGE = 100
MAX_LIST_VALUES = 200


def parse_list(params, name: str) -> Optional[List[str]]:
    """A comma separated parameter, or None when it is missing or empty."""
    values = [value.strip() for value in str(params.get(name) or "").split(",") if value.strip()]
    if len(values) > MAX_LIST_VALUES:
        raise ValidationError({name: "Too many values."})
    return values or None


def parse_choice(params, name: str, choices, default=None):
    value = params.get(name)
    if value in (None, ""):
        return default
    if value not in choices:
        raise ValidationError({name: "Invalid value."})
    return value


def parse_projects(params) -> Optional[List[str]]:
    values = parse_list(params, "project")
    try:
        return [str(UUID(value)) for value in values] if values else None
    except ValueError:
        raise ValidationError({"project": "Invalid project."})


def parse_period(params) -> int:
    try:
        period = int(params.get("period") or DEFAULT_PERIOD)
    except (TypeError, ValueError):
        raise ValidationError({"period": "Invalid period."})
    if period not in PERIODS:
        raise ValidationError({"period": "Invalid period."})
    return period


def parse_date(params, name: str) -> Optional[date]:
    value = params.get(name)
    if not value:
        return None
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise ValidationError({name: "Invalid date."})


def parse_date_range(params):
    start, end = parse_date(params, "start"), parse_date(params, "end")
    if start and end and start > end:
        raise ValidationError({"end": "The end date is before the start date."})
    return start, end


def parse_page(params):
    """Return (offset, per_page, page)."""
    try:
        page, per_page = int(params.get("page") or 1), int(params.get("per_page") or DEFAULT_PER_PAGE)
    except (TypeError, ValueError):
        raise ValidationError({"page": "Invalid page."})
    if not 1 <= page <= 100_000 or not 1 <= per_page <= MAX_PER_PAGE:
        raise ValidationError({"page": "Invalid page."})
    return (page - 1) * per_page, per_page, page


def page_body(results, total: int, page: int, per_page: int, **extra) -> Dict[str, Any]:
    return {
        "results": results,
        "total": total,
        "page": page,
        "per_page": per_page,
        "has_more": page * per_page < total,
        **extra,
    }


class TeamWorkBaseView(BaseAPIView):
    """Pages about the whole team: workspace admins only."""

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if get_requester_role(request.user, kwargs["slug"]) != ADMIN_ROLE:
            raise PermissionDenied("You don't have the required permissions.")

    def clock(self, params=None) -> Clock:
        return Clock.start(parse_period(params if params is not None else self.request.query_params))


class UserWorkBaseView(BaseAPIView):
    """Pages about one member: workspace admins, and members looking at themselves."""

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        role = get_requester_role(request.user, kwargs["slug"])
        is_self = kwargs["user_id"] == request.user.id
        if role != ADMIN_ROLE and not (is_self and role is not None and role >= MEMBER_ROLE):
            raise PermissionDenied("You don't have the required permissions.")

        # People who left keep their membership row, so their remaining work stays visible.
        self.membership = (
            WorkspaceMember.objects.filter(
                workspace__slug=kwargs["slug"], member_id=kwargs["user_id"], member__is_bot=False
            )
            .select_related("member", "member__avatar_asset")
            .first()
        )
        if self.membership is None:
            raise Http404

    def clock(self, params=None) -> Clock:
        return Clock.start(parse_period(params if params is not None else self.request.query_params))
