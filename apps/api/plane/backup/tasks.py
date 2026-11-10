# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import logging
import uuid

from celery import shared_task
from celery.exceptions import MaxRetriesExceededError
from django.db import transaction
from django.utils import timezone

from plane.backup.models import BackupSchedule, BackupSnapshot, SnapshotStatus, SnapshotTrigger
from plane.backup.runner import dump_timeout, make_folder_name, mark_stale_runs, run_backup
from plane.backup.schedule import compute_next_run

logger = logging.getLogger("plane.worker")

LOCK_KEY = "backup:running"
RETRY_SECONDS = 300
MAX_WAIT_RETRIES = 12  # one hour


def _redis():
    from plane.settings.redis import redis_instance

    return redis_instance()


def acquire_lock(snapshot_id) -> bool:
    return bool(_redis().set(LOCK_KEY, str(snapshot_id), nx=True, ex=dump_timeout() + 3600))


def release_lock(snapshot_id) -> None:
    client = _redis()
    if client.get(LOCK_KEY) == str(snapshot_id).encode():
        client.delete(LOCK_KEY)


def create_snapshot(*, trigger: str, include_files: bool, note: str = "", user=None) -> BackupSnapshot:
    snapshot_id = uuid.uuid4()
    return BackupSnapshot.objects.create(
        id=snapshot_id,
        trigger=trigger,
        include_files=include_files,
        note=note,
        folder=make_folder_name(snapshot_id, timezone.now()),
        created_by=user,
    )


def queue_snapshot(snapshot: BackupSnapshot) -> None:
    transaction.on_commit(lambda: run_backup_task.delay(str(snapshot.id)))


@shared_task(bind=True, max_retries=MAX_WAIT_RETRIES, ignore_result=True)
def run_backup_task(self, snapshot_id):
    if not acquire_lock(snapshot_id):
        try:
            raise self.retry(countdown=RETRY_SECONDS)
        except MaxRetriesExceededError:
            BackupSnapshot.objects.filter(pk=snapshot_id, status=SnapshotStatus.QUEUED).update(
                status=SnapshotStatus.FAILED,
                error="Another backup was still running, so this one was skipped.",
                finished_at=timezone.now(),
            )
            return
    try:
        snapshot = run_backup(snapshot_id)
    finally:
        release_lock(snapshot_id)
    if snapshot.status == SnapshotStatus.FAILED:
        notify_failure(snapshot)


@shared_task(ignore_result=True)
def backup_scheduler_tick():
    """Runs every minute from celery beat. Starts the automatic backup when it is due."""
    mark_stale_runs()
    now = timezone.now()
    with transaction.atomic():
        schedule = BackupSchedule.objects.select_for_update().order_by("updated_at").first()
        if schedule is None or not schedule.is_enabled:
            return
        if schedule.next_run_at is None:
            schedule.next_run_at = next_run_for(schedule, now)
            schedule.save(update_fields=["next_run_at"])
            return
        if schedule.next_run_at > now:
            return
        # Missed runs (server was off) collapse into one backup now, then the normal rhythm resumes.
        schedule.last_run_at = now
        schedule.next_run_at = next_run_for(schedule, now)
        schedule.save(update_fields=["last_run_at", "next_run_at"])
        from plane.backup.models import BackupRestore, RestoreStatus

        busy = BackupSnapshot.objects.filter(status__in=[SnapshotStatus.QUEUED, SnapshotStatus.RUNNING]).exists()
        busy = (
            busy
            or BackupRestore.objects.filter(
                status__in=[RestoreStatus.QUEUED, RestoreStatus.RUNNING, RestoreStatus.UNDOING]
            ).exists()
        )
        if busy:
            logger.info("Skipping the automatic backup: another backup or a restore is in progress.")
            return
        snapshot = create_snapshot(trigger=SnapshotTrigger.SCHEDULED, include_files=schedule.include_files)
        queue_snapshot(snapshot)


def next_run_for(schedule: BackupSchedule, after):
    return compute_next_run(
        frequency=schedule.frequency,
        hour=schedule.hour,
        minute=schedule.minute,
        weekday=schedule.weekday,
        day_of_month=schedule.day_of_month,
        tz_name=schedule.timezone,
        after=after,
    )


def notify_failure(snapshot: BackupSnapshot) -> None:
    """Email the instance admins. Silent when email isn't set up."""
    try:
        from django.core.mail import EmailMultiAlternatives, get_connection

        from plane.license.models import InstanceAdmin
        from plane.license.utils.instance_value import get_email_configuration

        (host, user, password, port, use_tls, use_ssl, sender) = get_email_configuration()
        if not host:
            return
        recipients = list(InstanceAdmin.objects.values_list("user__email", flat=True))
        if not recipients:
            return
        connection = get_connection(
            host=host,
            port=int(port),
            username=user,
            password=password,
            use_tls=use_tls == "1",
            use_ssl=use_ssl == "1",
        )
        when = timezone.localtime(snapshot.created_at).strftime("%Y-%m-%d %H:%M %Z")
        body = (
            f"A backup started at {when} did not complete.\n\n"
            f"Reason: {snapshot.error or 'unknown'}\n\n"
            "Open the admin panel, go to Backup & restore, and check the Overview tab."
        )
        EmailMultiAlternatives(
            subject="Backup failed", body=body, from_email=sender, to=recipients, connection=connection
        ).send()
    except Exception:  # noqa: BLE001 - a failed alert must not hide the failed backup
        logger.exception("Could not send the backup failure email")


# ---------------------------------------------------------------------------
# Restore, undo, download and housekeeping
# ---------------------------------------------------------------------------


def _run_locked(task, job_id, work, on_give_up):
    """Run `work` holding the same lock as backups, so only one heavy job runs at a time."""
    if not acquire_lock(job_id):
        try:
            raise task.retry(countdown=60)
        except MaxRetriesExceededError:
            on_give_up()
            return
    try:
        work(job_id)
    finally:
        release_lock(job_id)


@shared_task(bind=True, max_retries=60, ignore_result=True)
def inspect_restore_task(self, restore_id):
    from plane.backup.models import BackupRestore, RestoreStatus
    from plane.backup.restore import inspect_restore

    def give_up():
        BackupRestore.objects.filter(pk=restore_id, status=RestoreStatus.INSPECTING).update(
            status=RestoreStatus.INVALID, error="Another backup job kept running, so the check was skipped."
        )

    _run_locked(self, restore_id, inspect_restore, give_up)


@shared_task(bind=True, max_retries=60, ignore_result=True)
def run_restore_task(self, restore_id):
    from plane.backup.models import BackupRestore, RestoreStatus
    from plane.backup.restore import run_restore

    def give_up():
        BackupRestore.objects.filter(pk=restore_id, status=RestoreStatus.QUEUED).update(
            status=RestoreStatus.FAILED, error="Another backup job kept running, so the restore didn't start."
        )

    _run_locked(self, restore_id, run_restore, give_up)


@shared_task(bind=True, max_retries=60, ignore_result=True)
def undo_restore_task(self, restore_id):
    from plane.backup.models import BackupRestore, RestoreStatus
    from plane.backup.restore import run_undo

    def give_up():
        BackupRestore.objects.filter(pk=restore_id, status=RestoreStatus.UNDOING).update(
            status=RestoreStatus.SUCCEEDED, error="Another backup job kept running, so the undo didn't start."
        )

    _run_locked(self, restore_id, run_undo, give_up)


@shared_task(ignore_result=True)
def run_export_task(export_id):
    from plane.backup.exports import run_export

    run_export(export_id)


@shared_task(ignore_result=True)
def backup_housekeeping():
    """Hourly: expire downloads and checked restores, drop the pre-restore database after the undo window."""
    from plane.backup.restore import cleanup

    try:
        cleanup()
    except Exception:  # noqa: BLE001
        logger.exception("Backup housekeeping failed")


@shared_task(ignore_result=True)
def copy_release_task(version):
    """Upload a release copy (Docker images and compose files) to the backup destinations."""
    from plane.backup.releases import copy_to_destinations

    copy_to_destinations(version)
