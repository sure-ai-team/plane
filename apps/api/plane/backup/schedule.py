# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Schedule maths, retention and health rules. No I/O here, so it is easy to test."""

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone as dt_timezone
from typing import Iterable, Optional, Sequence
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

FREQUENCIES = ("every_6_hours", "every_12_hours", "daily", "weekly", "monthly")

# Roughly how long one cycle lasts, used to decide when the last backup is "too old".
FREQUENCY_INTERVAL = {
    "every_6_hours": timedelta(hours=6),
    "every_12_hours": timedelta(hours=12),
    "daily": timedelta(days=1),
    "weekly": timedelta(days=7),
    "monthly": timedelta(days=31),
}

KEEP_LAST_MIN = 1
KEEP_LAST_MAX = 365


def get_zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def is_valid_timezone(name: str) -> bool:
    if not name or not isinstance(name, str):
        return False
    try:
        ZoneInfo(name)
        return True
    except (ZoneInfoNotFoundError, ValueError):
        return False


def _run_hours(frequency: str, hour: int) -> list[int]:
    if frequency == "every_6_hours":
        return sorted({(hour + 6 * step) % 24 for step in range(4)})
    if frequency == "every_12_hours":
        return sorted({(hour + 12 * step) % 24 for step in range(2)})
    return [hour]


def _day_matches(frequency: str, day: date, weekday: int, day_of_month: int) -> bool:
    if frequency == "weekly":
        return day.weekday() == weekday
    if frequency == "monthly":
        return day.day == day_of_month
    return True


def compute_next_run(
    *,
    frequency: str,
    hour: int,
    minute: int,
    weekday: int,
    day_of_month: int,
    tz_name: str,
    after: datetime,
) -> datetime:
    """The first scheduled time strictly after `after`, returned in UTC.

    Times are wall-clock times in the admin's timezone, so "02:00 daily" stays 02:00
    across daylight-saving changes.
    """
    zone = get_zone(tz_name)
    local_now = after.astimezone(zone)
    hours = _run_hours(frequency, hour)
    # 62 days always contains a matching day for every frequency (monthly days are capped at 28).
    for offset in range(62):
        day = local_now.date() + timedelta(days=offset)
        if not _day_matches(frequency, day, weekday, day_of_month):
            continue
        for run_hour in hours:
            candidate = datetime(day.year, day.month, day.day, run_hour, minute, tzinfo=zone)
            if candidate > local_now:
                return candidate.astimezone(dt_timezone.utc)
    raise ValueError("Could not find the next backup time.")  # pragma: no cover


def validate_schedule(data: dict) -> dict:
    """Field errors for a schedule update. An empty dict means it is valid."""
    errors: dict[str, str] = {}

    def as_int(key: str, low: int, high: int, message: str):
        if key not in data:
            return
        value = data[key]
        if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
            errors[key] = message

    if "frequency" in data and data["frequency"] not in FREQUENCIES:
        errors["frequency"] = "Choose how often to back up."
    as_int("hour", 0, 23, "Choose an hour between 0 and 23.")
    as_int("minute", 0, 59, "Choose a minute between 0 and 59.")
    as_int("weekday", 0, 6, "Choose a day of the week.")
    as_int("day_of_month", 1, 28, "Choose a day between 1 and 28.")
    as_int(
        "keep_last",
        KEEP_LAST_MIN,
        KEEP_LAST_MAX,
        f"Keep between {KEEP_LAST_MIN} and {KEEP_LAST_MAX} backups.",
    )
    if "timezone" in data and not is_valid_timezone(data["timezone"]):
        errors["timezone"] = "Choose a valid time zone."
    for key in ("is_enabled", "include_files"):
        if key in data and not isinstance(data[key], bool):
            errors[key] = "Use true or false."
    return errors


@dataclass
class RetentionCandidate:
    id: object
    trigger: str
    status: str
    is_pinned: bool
    created_at: datetime


def select_expired(snapshots: Iterable[RetentionCandidate], keep_last: int, now: datetime) -> list:
    """Ids of backups that the retention rule removes.

    - Keeps the newest `keep_last` automatic backups that hold data (complete or partial).
    - Never touches manual or pinned backups.
    - Removes failed automatic backups after 30 days so the history stays readable.
    """
    keep_last = max(KEEP_LAST_MIN, keep_last)
    automatic = [s for s in snapshots if s.trigger == "scheduled" and not s.is_pinned]
    with_data = sorted(
        (s for s in automatic if s.status in ("succeeded", "partial")),
        key=lambda s: s.created_at,
        reverse=True,
    )
    expired = [s.id for s in with_data[keep_last:]]
    failed_cutoff = now - timedelta(days=30)
    expired += [s.id for s in automatic if s.status == "failed" and s.created_at < failed_cutoff]
    return expired


@dataclass
class HealthMessage:
    level: str  # "critical" | "warning" | "info"
    text: str


def format_age(delta: timedelta) -> str:
    hours = int(delta.total_seconds() // 3600)
    if hours < 1:
        return "less than an hour"
    if hours < 48:
        return f"{hours} hour{'s' if hours != 1 else ''}"
    days = hours // 24
    return f"{days} days"


def assess_health(
    *,
    now: datetime,
    tools_available: bool,
    enabled_destinations: int,
    failing_destinations: Sequence[str],
    schedule_enabled: bool,
    frequency: str,
    last_success_at: Optional[datetime],
    latest_status: Optional[str],
    latest_error: str = "",
) -> tuple[str, list[HealthMessage]]:
    """Overall status ("good", "warning" or "critical") plus plain-language reasons."""
    messages: list[HealthMessage] = []
    if not tools_available:
        messages.append(
            HealthMessage(
                "critical",
                "The server is missing the database backup tool (pg_dump). Ask your IT team to update the server.",
            )
        )
    if enabled_destinations == 0:
        messages.append(
            HealthMessage("critical", "Backups have nowhere to go. Add a destination in the Destinations tab.")
        )
    if latest_status == "failed":
        reason = f" {latest_error}" if latest_error else ""
        messages.append(HealthMessage("critical", f"The last backup failed.{reason}"))
    elif latest_status == "partial":
        messages.append(HealthMessage("warning", "The last backup was saved to some destinations but not all of them."))
    for name in failing_destinations:
        messages.append(HealthMessage("warning", f'The destination "{name}" failed its last connection test.'))
    if not schedule_enabled:
        messages.append(HealthMessage("warning", "Automatic backups are off. Turn them on in the Schedule tab."))
    if last_success_at is None:
        messages.append(HealthMessage("warning", "No backup has been completed yet."))
    elif schedule_enabled:
        allowed = FREQUENCY_INTERVAL.get(frequency, timedelta(days=1)) * 2
        age = now - last_success_at
        if age > allowed:
            messages.append(HealthMessage("warning", f"The last good backup is {format_age(age)} old."))

    if any(m.level == "critical" for m in messages):
        return "critical", messages
    if messages:
        return "warning", messages
    return "good", messages
