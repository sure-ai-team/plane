# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Definitions shared by every number on the Users and User Work pages.

All dates are compared with "today" in the requesting user's timezone, which
TimezoneMixin activates for the request.
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Dict

from django.db.models import Count, F, Q
from django.db.models.functions import TruncDate
from django.utils import timezone

OPEN_GROUPS = ("backlog", "unstarted", "started")
STATE_GROUPS = OPEN_GROUPS + ("completed", "cancelled")

PERIODS = (7, 30, 90)
DEFAULT_PERIOD = 30
# Weeks shown by the completion trend for each period.
TREND_WEEKS = {7: 4, 30: 8, 90: 13}

DUE_SOON_DAYS = 7
STUCK_DAYS = 7

FOCUS_CHOICES = ("overdue", "due_soon", "stuck", "no_due_date")


@dataclass(frozen=True)
class Clock:
    """One moment in time, so that all numbers of a response agree with each other."""

    now: datetime
    today: date
    period: int

    @classmethod
    def start(cls, period: int = DEFAULT_PERIOD) -> "Clock":
        now = timezone.now()
        return cls(now=now, today=timezone.localdate(now), period=period)

    @property
    def period_start(self) -> datetime:
        return self.now - timedelta(days=self.period)

    @property
    def stuck_before(self) -> datetime:
        return self.now - timedelta(days=STUCK_DAYS)


def open_q(prefix: str = "") -> Q:
    return Q(**{f"{prefix}state__group__in": OPEN_GROUPS})


def in_progress_q(prefix: str = "") -> Q:
    return Q(**{f"{prefix}state__group": "started"})


def done_q(clock: Clock, prefix: str = "") -> Q:
    return Q(**{f"{prefix}state__group": "completed", f"{prefix}completed_at__gte": clock.period_start})


def overdue_q(clock: Clock, prefix: str = "") -> Q:
    return open_q(prefix) & Q(**{f"{prefix}target_date__lt": clock.today})


def due_soon_q(clock: Clock, prefix: str = "") -> Q:
    return open_q(prefix) & Q(
        **{
            f"{prefix}target_date__gte": clock.today,
            f"{prefix}target_date__lte": clock.today + timedelta(days=DUE_SOON_DAYS),
        }
    )


def stuck_q(clock: Clock, prefix: str = "") -> Q:
    """In progress, and not changed for STUCK_DAYS."""
    return in_progress_q(prefix) & Q(**{f"{prefix}updated_at__lt": clock.stuck_before})


def no_due_date_q(prefix: str = "") -> Q:
    return open_q(prefix) & Q(**{f"{prefix}target_date__isnull": True})


def focus_q(focus: str, clock: Clock) -> Q:
    return {
        "overdue": overdue_q(clock),
        "due_soon": due_soon_q(clock),
        "stuck": stuck_q(clock),
        "no_due_date": no_due_date_q(),
    }[focus]


def state_group_q(group: str, clock: Clock) -> Q:
    """Work shown under a state group. Completed work is limited to the period."""
    if group == "completed":
        return done_q(clock)
    return Q(state__group=group)


def workload_counts(clock: Clock, prefix: str = "") -> Dict[str, Any]:
    """Aggregates over work items, or over rows that each hold one work item."""
    return {
        "open": Count("id", filter=open_q(prefix)),
        "in_progress": Count("id", filter=in_progress_q(prefix)),
        "overdue": Count("id", filter=overdue_q(clock, prefix)),
        "due_soon": Count("id", filter=due_soon_q(clock, prefix)),
        "stuck": Count("id", filter=stuck_q(clock, prefix)),
        "no_due_date": Count("id", filter=no_due_date_q(prefix)),
        "done": Count("id", filter=done_q(clock, prefix)),
    }


COUNT_KEYS = ("open", "in_progress", "overdue", "due_soon", "stuck", "no_due_date", "done")


def on_time_counts(queryset, clock: Clock) -> Dict[str, int]:
    """Of the items completed in the period that had a due date, how many were on time."""
    return (
        queryset.filter(done_q(clock), target_date__isnull=False)
        .annotate(completed_on=TruncDate("completed_at", tzinfo=timezone.get_current_timezone()))
        .aggregate(total=Count("id"), on_time=Count("id", filter=Q(completed_on__lte=F("target_date"))))
    )


def week_start(day: date) -> date:
    """Monday of the week, matching the database's week truncation."""
    return day - timedelta(days=day.weekday())
