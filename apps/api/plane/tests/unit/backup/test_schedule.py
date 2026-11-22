# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import datetime, timedelta, timezone

import pytest

from plane.backup.schedule import (
    RetentionCandidate,
    assess_health,
    compute_next_run,
    format_age,
    select_expired,
    validate_schedule,
)

UTC = timezone.utc


def next_run(after, **overrides):
    params = dict(frequency="daily", hour=2, minute=0, weekday=0, day_of_month=1, tz_name="UTC")
    params.update(overrides)
    return compute_next_run(after=after, **params)


@pytest.mark.unit
class TestComputeNextRun:
    def test_daily_later_today(self):
        assert next_run(datetime(2026, 11, 10, 1, 0, tzinfo=UTC)) == datetime(2026, 11, 10, 2, 0, tzinfo=UTC)

    def test_daily_rolls_to_tomorrow_when_time_has_passed(self):
        assert next_run(datetime(2026, 11, 10, 2, 0, tzinfo=UTC)) == datetime(2026, 11, 11, 2, 0, tzinfo=UTC)

    def test_every_6_hours_uses_the_anchor_hour(self):
        after = datetime(2026, 11, 10, 9, 30, tzinfo=UTC)
        assert next_run(after, frequency="every_6_hours", hour=2) == datetime(2026, 11, 10, 14, 0, tzinfo=UTC)

    def test_every_12_hours_wraps_past_midnight(self):
        after = datetime(2026, 11, 10, 21, 0, tzinfo=UTC)
        assert next_run(after, frequency="every_12_hours", hour=8) == datetime(2026, 11, 11, 8, 0, tzinfo=UTC)

    def test_weekly_picks_the_chosen_weekday(self):
        # 2026-11-10 is a Tuesday; Friday is weekday 4.
        after = datetime(2026, 11, 10, 12, 0, tzinfo=UTC)
        result = next_run(after, frequency="weekly", weekday=4, hour=23, minute=30)
        assert result == datetime(2026, 11, 13, 23, 30, tzinfo=UTC)

    def test_weekly_same_day_after_time_goes_to_next_week(self):
        after = datetime(2026, 11, 13, 23, 31, tzinfo=UTC)
        result = next_run(after, frequency="weekly", weekday=4, hour=23, minute=30)
        assert result == datetime(2026, 11, 20, 23, 30, tzinfo=UTC)

    def test_monthly_moves_to_next_month(self):
        after = datetime(2026, 12, 15, 0, 0, tzinfo=UTC)
        result = next_run(after, frequency="monthly", day_of_month=10)
        assert result == datetime(2027, 1, 10, 2, 0, tzinfo=UTC)

    def test_time_is_wall_clock_in_the_admin_timezone(self):
        # 02:00 in Riyadh (UTC+3) is 23:00 UTC the day before.
        after = datetime(2026, 11, 10, 12, 0, tzinfo=UTC)
        assert next_run(after, tz_name="Asia/Riyadh") == datetime(2026, 11, 10, 23, 0, tzinfo=UTC)

    def test_daylight_saving_keeps_local_time(self):
        # New York leaves DST on 2026-11-01: 02:30 local is 06:30 UTC before and 07:30 UTC after.
        before = next_run(datetime(2026, 10, 30, 12, 0, tzinfo=UTC), tz_name="America/New_York", minute=30)
        after = next_run(datetime(2026, 11, 2, 12, 0, tzinfo=UTC), tz_name="America/New_York", minute=30)
        assert before.hour == 6 and after.hour == 7

    def test_unknown_timezone_falls_back_to_utc(self):
        assert next_run(datetime(2026, 11, 10, 1, 0, tzinfo=UTC), tz_name="Mars/Base") == datetime(
            2026, 11, 10, 2, 0, tzinfo=UTC
        )


@pytest.mark.unit
class TestValidateSchedule:
    def test_valid_payload(self):
        assert (
            validate_schedule(
                {
                    "is_enabled": True,
                    "frequency": "weekly",
                    "hour": 23,
                    "minute": 59,
                    "weekday": 6,
                    "day_of_month": 28,
                    "timezone": "Asia/Riyadh",
                    "include_files": False,
                    "keep_last": 30,
                }
            )
            == {}
        )

    def test_rejects_bad_values(self):
        errors = validate_schedule(
            {
                "frequency": "hourly",
                "hour": 24,
                "minute": "5",
                "weekday": 7,
                "day_of_month": 31,
                "timezone": "Nowhere/City",
                "keep_last": 0,
                "is_enabled": "yes",
            }
        )
        assert set(errors) == {
            "frequency",
            "hour",
            "minute",
            "weekday",
            "day_of_month",
            "timezone",
            "keep_last",
            "is_enabled",
        }

    def test_booleans_are_not_numbers(self):
        assert "hour" in validate_schedule({"hour": True})


def candidate(index, trigger="scheduled", status="succeeded", pinned=False, age_days=0):
    created = datetime(2026, 11, 10, tzinfo=UTC) - timedelta(days=age_days, minutes=index)
    return RetentionCandidate(index, trigger, status, pinned, created)


@pytest.mark.unit
class TestRetention:
    now = datetime(2026, 11, 10, tzinfo=UTC)

    def test_keeps_newest_automatic_backups(self):
        snapshots = [candidate(i) for i in range(5)]
        assert select_expired(snapshots, 3, self.now) == [3, 4]

    def test_never_removes_manual_or_pinned(self):
        snapshots = [candidate(0), candidate(1, trigger="manual"), candidate(2, pinned=True), candidate(3)]
        assert select_expired(snapshots, 1, self.now) == [3]

    def test_partial_backups_count_as_kept(self):
        snapshots = [candidate(0, status="partial"), candidate(1)]
        assert select_expired(snapshots, 1, self.now) == [1]

    def test_old_failed_automatic_backups_are_cleaned(self):
        snapshots = [candidate(0, status="failed", age_days=31), candidate(1, status="failed", age_days=2)]
        assert select_expired(snapshots, 5, self.now) == [0]

    def test_keep_last_is_at_least_one(self):
        assert select_expired([candidate(0), candidate(1)], 0, self.now) == [1]


@pytest.mark.unit
class TestHealth:
    now = datetime(2026, 11, 10, 12, tzinfo=UTC)

    def assess(self, **overrides):
        params = dict(
            now=self.now,
            tools_available=True,
            enabled_destinations=1,
            failing_destinations=[],
            schedule_enabled=True,
            frequency="daily",
            last_success_at=self.now - timedelta(hours=10),
            latest_status="succeeded",
        )
        params.update(overrides)
        return assess_health(**params)

    def test_all_good(self):
        assert self.assess() == ("good", [])

    def test_no_destination_is_critical(self):
        level, messages = self.assess(enabled_destinations=0)
        assert level == "critical"
        assert "nowhere to go" in messages[0].text

    def test_last_failure_is_critical_with_reason(self):
        level, messages = self.assess(latest_status="failed", latest_error="Disk full.")
        assert level == "critical"
        assert messages[0].text.endswith("Disk full.")

    def test_schedule_off_is_a_warning(self):
        level, _ = self.assess(schedule_enabled=False)
        assert level == "warning"

    def test_stale_backup_is_a_warning(self):
        level, messages = self.assess(last_success_at=self.now - timedelta(days=3))
        assert level == "warning"
        assert "3 days old" in messages[0].text

    def test_never_backed_up(self):
        level, messages = self.assess(last_success_at=None, latest_status=None)
        assert level == "warning"
        assert "No backup" in messages[0].text

    def test_format_age(self):
        assert format_age(timedelta(minutes=5)) == "less than an hour"
        assert format_age(timedelta(hours=1)) == "1 hour"
        assert format_age(timedelta(hours=30)) == "30 hours"
        assert format_age(timedelta(days=4)) == "4 days"
