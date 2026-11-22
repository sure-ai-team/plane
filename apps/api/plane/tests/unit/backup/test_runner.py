# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import gzip
import io
import json
from datetime import timedelta
from unittest import mock

import pytest
from django.utils import timezone

from plane.backup import runner
from plane.backup.destinations import DestinationError
from plane.backup.models import (
    BackupDestination,
    BackupSchedule,
    BackupSnapshot,
    CopyStatus,
    SnapshotStatus,
    SnapshotTrigger,
)
from plane.backup.tasks import backup_scheduler_tick, create_snapshot

DUMP = b"PGDMP fake dump"


class FakeSourceBucket:
    """Stands in for the platform's own upload bucket."""

    def __init__(self, files):
        self.files = files

    def get_object(self, Bucket, Key):  # noqa: N803 - boto3 signature
        return {"Body": io.BytesIO(self.files[Key])}


@pytest.fixture
def backup_env(settings, tmp_path):
    settings.BACKUP_LOCAL_ROOT = str(tmp_path / "area")
    settings.BACKUP_WORK_DIR = str(tmp_path / "work")
    (tmp_path / "area").mkdir()

    def fake_dump(target):
        target.write_bytes(DUMP)

    with (
        mock.patch.object(runner, "dump_database", side_effect=fake_dump),
        mock.patch.object(runner, "database_size", return_value=1024),
        mock.patch.object(runner, "check_free_space"),
    ):
        yield tmp_path


def local_destination(name="Server folder", folder="main", **kwargs):
    return BackupDestination.objects.create(name=name, kind="local", config={"folder": folder}, **kwargs)


def with_source_files(files):
    return (
        mock.patch.object(runner, "source_bucket_client", return_value=FakeSourceBucket(files)),
        mock.patch.object(runner, "iter_source_files", return_value=[(k, len(v)) for k, v in files.items()]),
    )


@pytest.mark.unit
@pytest.mark.django_db
class TestRunBackup:
    def test_database_only_backup_to_a_folder(self, backup_env):
        local_destination()
        snapshot = create_snapshot(trigger=SnapshotTrigger.MANUAL, include_files=False, note="Before upgrade")

        result = runner.run_backup(snapshot.id)

        assert result.status == SnapshotStatus.SUCCEEDED
        assert result.database_size == len(DUMP)
        assert len(result.database_checksum) == 64
        assert result.finished_at is not None and result.progress == ""
        folder = backup_env / "area" / "main" / "snapshots" / snapshot.folder
        assert (folder / "database.dump").read_bytes() == DUMP
        manifest = json.loads((folder / "manifest.json").read_text())
        assert manifest["note"] == "Before upgrade"
        assert manifest["database"]["sha256"] == result.database_checksum
        assert manifest["files"]["included"] is False
        assert not (folder / "files.json.gz").exists()
        copy = result.copies.get()
        assert copy.status == CopyStatus.SUCCEEDED and copy.location.endswith(snapshot.folder)
        # The temporary dump is always removed.
        assert not (backup_env / "work" / snapshot.folder).exists()

    def test_files_are_copied_once_and_shared(self, backup_env):
        local_destination()
        files = {"ws/a.png": b"aaa", "ws/b.pdf": b"bbbbb"}
        patches = with_source_files(files)
        with patches[0], patches[1]:
            first = runner.run_backup(create_snapshot(trigger=SnapshotTrigger.MANUAL, include_files=True).id)
        assert first.status == SnapshotStatus.SUCCEEDED
        assert (first.files_count, first.files_size) == (2, 8)
        assert first.copies.get().size == len(DUMP) + 8
        root = backup_env / "area" / "main"
        assert (root / "files" / "ws" / "a.png").read_bytes() == b"aaa"
        index = json.loads(gzip.decompress((root / "snapshots" / first.folder / "files.json.gz").read_bytes()))
        assert {item["key"] for item in index} == set(files)

        files["ws/c.txt"] = b"c"
        patches = with_source_files(files)
        with patches[0], patches[1]:
            second = runner.run_backup(create_snapshot(trigger=SnapshotTrigger.MANUAL, include_files=True).id)
        # Only the new upload is copied the second time.
        assert second.copies.get().size == len(DUMP) + 1

    def test_one_failing_destination_gives_a_partial_backup(self, backup_env):
        local_destination(name="Good")
        bad = local_destination(name="Bad", folder="bad")
        original = runner.driver_for

        def driver_for(destination):
            if destination.pk == bad.pk:
                raise DestinationError("The bucket doesn't exist. Check its name.")
            return original(destination)

        with mock.patch.object(runner, "driver_for", side_effect=driver_for):
            result = runner.run_backup(create_snapshot(trigger=SnapshotTrigger.MANUAL, include_files=False).id)

        assert result.status == SnapshotStatus.PARTIAL
        copies = {c.destination_name: c for c in result.copies.all()}
        assert copies["Good"].status == CopyStatus.SUCCEEDED
        assert copies["Bad"].status == CopyStatus.FAILED
        assert copies["Bad"].error == "The bucket doesn't exist. Check its name."

    def test_no_destination_fails_with_a_clear_reason(self, backup_env):
        local_destination(is_enabled=False)
        result = runner.run_backup(create_snapshot(trigger=SnapshotTrigger.MANUAL, include_files=False).id)
        assert result.status == SnapshotStatus.FAILED
        assert "no destination" in result.error

    def test_dump_failure_is_reported_and_cleaned_up(self, backup_env):
        local_destination()
        snapshot = create_snapshot(trigger=SnapshotTrigger.MANUAL, include_files=False)
        with mock.patch.object(runner, "dump_database", side_effect=runner.BackupFailed("Saving the database failed.")):
            result = runner.run_backup(snapshot.id)
        assert result.status == SnapshotStatus.FAILED
        assert result.error == "Saving the database failed."
        assert result.copies.get().status == CopyStatus.FAILED
        assert not (backup_env / "work" / snapshot.folder).exists()

    def test_only_queued_snapshots_run(self, backup_env):
        local_destination()
        snapshot = create_snapshot(trigger=SnapshotTrigger.MANUAL, include_files=False)
        BackupSnapshot.objects.filter(pk=snapshot.pk).update(status=SnapshotStatus.SUCCEEDED)
        assert runner.run_backup(snapshot.id).copies.count() == 0

    def test_scheduled_backups_apply_retention(self, backup_env):
        local_destination()
        schedule = BackupSchedule.get_solo()
        schedule.keep_last = 2
        schedule.save()
        manual = runner.run_backup(create_snapshot(trigger=SnapshotTrigger.MANUAL, include_files=False).id)
        made = []
        for _ in range(3):
            made.append(runner.run_backup(create_snapshot(trigger=SnapshotTrigger.SCHEDULED, include_files=False).id))

        remaining = set(BackupSnapshot.objects.values_list("id", flat=True))
        assert remaining == {manual.id, made[1].id, made[2].id}
        assert not (backup_env / "area" / "main" / "snapshots" / made[0].folder).exists()


@pytest.mark.unit
@pytest.mark.django_db
class TestStaleRuns:
    def test_marks_abandoned_runs_failed(self, settings):
        settings.BACKUP_DB_TIMEOUT_SECONDS = 3600
        now = timezone.now()
        stale = create_snapshot(trigger=SnapshotTrigger.SCHEDULED, include_files=False)
        BackupSnapshot.objects.filter(pk=stale.pk).update(
            status=SnapshotStatus.RUNNING, started_at=now - timedelta(hours=3)
        )
        fresh = create_snapshot(trigger=SnapshotTrigger.SCHEDULED, include_files=False)
        BackupSnapshot.objects.filter(pk=fresh.pk).update(status=SnapshotStatus.RUNNING, started_at=now)

        assert runner.mark_stale_runs(now) == 1
        stale.refresh_from_db()
        fresh.refresh_from_db()
        assert stale.status == SnapshotStatus.FAILED and "restarted" in stale.error
        assert fresh.status == SnapshotStatus.RUNNING


@pytest.mark.unit
@pytest.mark.django_db
class TestSchedulerTick:
    def setup_schedule(self, **fields):
        schedule = BackupSchedule.get_solo()
        for key, value in fields.items():
            setattr(schedule, key, value)
        schedule.save()
        return schedule

    def test_does_nothing_when_disabled(self):
        self.setup_schedule(is_enabled=False, next_run_at=timezone.now() - timedelta(minutes=1))
        with mock.patch("plane.backup.tasks.queue_snapshot") as queue:
            backup_scheduler_tick()
        queue.assert_not_called()
        assert BackupSnapshot.objects.count() == 0

    def test_starts_a_due_backup_once_and_moves_the_next_run(self):
        past = timezone.now() - timedelta(days=3)
        self.setup_schedule(is_enabled=True, next_run_at=past, include_files=False)
        with mock.patch("plane.backup.tasks.queue_snapshot") as queue:
            backup_scheduler_tick()
            backup_scheduler_tick()
        assert queue.call_count == 1
        snapshot = BackupSnapshot.objects.get()
        assert snapshot.trigger == SnapshotTrigger.SCHEDULED and snapshot.include_files is False
        schedule = BackupSchedule.get_solo()
        assert schedule.next_run_at > timezone.now() and schedule.last_run_at is not None

    def test_skips_while_another_backup_runs(self):
        create_snapshot(trigger=SnapshotTrigger.MANUAL, include_files=False)
        self.setup_schedule(is_enabled=True, next_run_at=timezone.now() - timedelta(minutes=1))
        with mock.patch("plane.backup.tasks.queue_snapshot") as queue:
            backup_scheduler_tick()
        queue.assert_not_called()
        assert BackupSchedule.get_solo().next_run_at > timezone.now()

    def test_fills_in_a_missing_next_run(self):
        self.setup_schedule(is_enabled=True, next_run_at=None)
        with mock.patch("plane.backup.tasks.queue_snapshot") as queue:
            backup_scheduler_tick()
        queue.assert_not_called()
        assert BackupSchedule.get_solo().next_run_at is not None
