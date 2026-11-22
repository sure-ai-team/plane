# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Backup tables.

These are plain Django models on purpose: Plane's BaseModel soft-deletes rows and
schedules a cascade task, which is wrong for backup bookkeeping. A deleted backup
must be gone.
"""

import uuid

from django.conf import settings
from django.db import models


class DestinationKind(models.TextChoices):
    LOCAL = "local", "Folder on the server"
    S3 = "s3", "S3-compatible storage"
    POSTGRES = "postgres", "Standby PostgreSQL database"


class BackupFrequency(models.TextChoices):
    EVERY_6_HOURS = "every_6_hours", "Every 6 hours"
    EVERY_12_HOURS = "every_12_hours", "Every 12 hours"
    DAILY = "daily", "Every day"
    WEEKLY = "weekly", "Every week"
    MONTHLY = "monthly", "Every month"


class SnapshotTrigger(models.TextChoices):
    MANUAL = "manual", "Started by an admin"
    SCHEDULED = "scheduled", "Automatic"
    SAFETY = "safety", "Safety copy before a restore"


class SnapshotStatus(models.TextChoices):
    QUEUED = "queued", "Waiting to start"
    RUNNING = "running", "In progress"
    SUCCEEDED = "succeeded", "Complete"
    PARTIAL = "partial", "Saved to some destinations"
    FAILED = "failed", "Failed"


class CopyStatus(models.TextChoices):
    PENDING = "pending", "Waiting"
    RUNNING = "running", "Saving"
    SUCCEEDED = "succeeded", "Saved"
    FAILED = "failed", "Failed"


class BackupDestination(models.Model):
    id = models.UUIDField(default=uuid.uuid4, primary_key=True, editable=False)
    name = models.CharField(max_length=120)
    kind = models.CharField(max_length=20, choices=DestinationKind.choices)
    # Settings that are safe to show back to the admin.
    config = models.JSONField(default=dict, blank=True)
    # Passwords and secret keys, as encrypted JSON. Never returned by the API.
    secrets = models.TextField(blank=True, default="")
    is_enabled = models.BooleanField(default=True)
    last_checked_at = models.DateTimeField(null=True, blank=True)
    last_check_ok = models.BooleanField(null=True, blank=True)
    last_check_message = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        db_table = "backup_destinations"
        ordering = ("created_at",)

    def __str__(self):
        return f"{self.name} ({self.kind})"


class BackupSchedule(models.Model):
    """Single row: the automatic backup plan for the whole instance."""

    id = models.UUIDField(default=uuid.uuid4, primary_key=True, editable=False)
    is_enabled = models.BooleanField(default=False)
    frequency = models.CharField(max_length=20, choices=BackupFrequency.choices, default=BackupFrequency.DAILY)
    hour = models.PositiveSmallIntegerField(default=2)
    minute = models.PositiveSmallIntegerField(default=0)
    # 0 = Monday ... 6 = Sunday (Python's weekday()).
    weekday = models.PositiveSmallIntegerField(default=0)
    # Capped at 28 so every month has the day.
    day_of_month = models.PositiveSmallIntegerField(default=1)
    timezone = models.CharField(max_length=64, default="UTC")
    include_files = models.BooleanField(default=True)
    # How many automatic backups to keep. Manual and pinned backups are never removed automatically.
    keep_last = models.PositiveSmallIntegerField(default=14)
    next_run_at = models.DateTimeField(null=True, blank=True)
    last_run_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        db_table = "backup_schedules"

    @classmethod
    def get_solo(cls) -> "BackupSchedule":
        schedule = cls.objects.order_by("updated_at").first()
        if schedule is None:
            schedule = cls.objects.create()
        return schedule


class BackupSnapshot(models.Model):
    """One backup version."""

    id = models.UUIDField(default=uuid.uuid4, primary_key=True, editable=False)
    trigger = models.CharField(max_length=20, choices=SnapshotTrigger.choices, default=SnapshotTrigger.MANUAL)
    status = models.CharField(
        max_length=20, choices=SnapshotStatus.choices, default=SnapshotStatus.QUEUED, db_index=True
    )
    note = models.CharField(max_length=200, blank=True, default="")
    is_pinned = models.BooleanField(default=False)
    include_files = models.BooleanField(default=True)
    # Folder name used at every destination, e.g. 20261110-020000-1a2b3c4d.
    folder = models.CharField(max_length=100, unique=True)
    progress = models.CharField(max_length=255, blank=True, default="")
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    database_size = models.BigIntegerField(default=0)
    database_checksum = models.CharField(max_length=64, blank=True, default="")
    files_count = models.IntegerField(default=0)
    files_size = models.BigIntegerField(default=0)
    app_version = models.CharField(max_length=64, blank=True, default="")
    postgres_version = models.CharField(max_length=64, blank=True, default="")
    # Latest applied migration per Django app, used to check restore compatibility.
    migrations = models.JSONField(default=dict, blank=True)
    # Row counts of the main tables, shown to the admin as "what's inside".
    stats = models.JSONField(default=dict, blank=True)
    error = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        db_table = "backup_snapshots"
        ordering = ("-created_at",)

    def __str__(self):
        return self.folder


class BackupCopy(models.Model):
    """Where one backup was saved, and whether that worked."""

    id = models.UUIDField(default=uuid.uuid4, primary_key=True, editable=False)
    snapshot = models.ForeignKey(BackupSnapshot, on_delete=models.CASCADE, related_name="copies")
    destination = models.ForeignKey(
        BackupDestination, on_delete=models.SET_NULL, null=True, blank=True, related_name="copies"
    )
    # Kept so the history still reads correctly after a destination is removed.
    destination_name = models.CharField(max_length=120)
    destination_kind = models.CharField(max_length=20, choices=DestinationKind.choices)
    status = models.CharField(max_length=20, choices=CopyStatus.choices, default=CopyStatus.PENDING)
    location = models.TextField(blank=True, default="")
    size = models.BigIntegerField(default=0)
    error = models.TextField(blank=True, default="")
    finished_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "backup_copies"
        ordering = ("created_at",)


class UploadStatus(models.TextChoices):
    UPLOADING = "uploading", "Uploading"
    COMPLETE = "complete", "Uploaded"
    FAILED = "failed", "Failed"


class BackupUpload(models.Model):
    """A backup file sent from the admin's computer, received in chunks."""

    id = models.UUIDField(default=uuid.uuid4, primary_key=True, editable=False)
    filename = models.CharField(max_length=255)
    size = models.BigIntegerField()
    received = models.BigIntegerField(default=0)
    status = models.CharField(max_length=20, choices=UploadStatus.choices, default=UploadStatus.UPLOADING)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        db_table = "backup_uploads"
        ordering = ("-created_at",)


class ExportStatus(models.TextChoices):
    QUEUED = "queued", "Waiting to start"
    RUNNING = "running", "Preparing"
    READY = "ready", "Ready to download"
    FAILED = "failed", "Failed"
    EXPIRED = "expired", "Expired"


class BackupExport(models.Model):
    """A backup packed into one .tar.gz file for download."""

    id = models.UUIDField(default=uuid.uuid4, primary_key=True, editable=False)
    snapshot = models.ForeignKey(BackupSnapshot, on_delete=models.CASCADE, related_name="exports")
    include_files = models.BooleanField(default=False)
    status = models.CharField(max_length=20, choices=ExportStatus.choices, default=ExportStatus.QUEUED)
    progress = models.CharField(max_length=255, blank=True, default="")
    size = models.BigIntegerField(default=0)
    error = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        db_table = "backup_exports"
        ordering = ("-created_at",)


class RestoreSource(models.TextChoices):
    SNAPSHOT = "snapshot", "A saved backup"
    UPLOAD = "upload", "An uploaded file"


class RestoreStatus(models.TextChoices):
    INSPECTING = "inspecting", "Checking the backup"
    READY = "ready", "Ready to restore"
    INVALID = "invalid", "Can't be restored"
    QUEUED = "queued", "Waiting to start"
    RUNNING = "running", "Restoring"
    SUCCEEDED = "succeeded", "Restored"
    FAILED = "failed", "Failed"
    UNDOING = "undoing", "Undoing"
    UNDONE = "undone", "Undone"
    CANCELLED = "cancelled", "Cancelled"
    EXPIRED = "expired", "Expired"


# Restores still holding the staging database or the live switch.
OPEN_RESTORE_STATUSES = (
    RestoreStatus.INSPECTING,
    RestoreStatus.READY,
    RestoreStatus.QUEUED,
    RestoreStatus.RUNNING,
    RestoreStatus.UNDOING,
)


class BackupRestore(models.Model):
    """Inspecting a backup, then (once confirmed) putting it back."""

    id = models.UUIDField(default=uuid.uuid4, primary_key=True, editable=False)
    source = models.CharField(max_length=20, choices=RestoreSource.choices)
    snapshot = models.ForeignKey(
        BackupSnapshot, on_delete=models.SET_NULL, null=True, blank=True, related_name="restores"
    )
    upload = models.ForeignKey(BackupUpload, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    # Human-readable source, kept after the snapshot or upload is gone.
    label = models.CharField(max_length=255, blank=True, default="")
    status = models.CharField(max_length=20, choices=RestoreStatus.choices, default=RestoreStatus.INSPECTING)
    progress = models.CharField(max_length=255, blank=True, default="")
    error = models.TextField(blank=True, default="")
    manifest = models.JSONField(default=dict, blank=True)
    # [{"level": "ok"|"info"|"warning"|"blocker", "text": "..."}]
    checks = models.JSONField(default=list, blank=True)
    # {"backup": {...counts}, "current": {...counts}}
    comparison = models.JSONField(default=dict, blank=True)
    # Workspaces, admins and last activity found inside the backup.
    preview = models.JSONField(default=dict, blank=True)
    can_restore = models.BooleanField(default=False)
    safety_snapshot = models.ForeignKey(
        BackupSnapshot, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    files_restored = models.IntegerField(default=0)
    files_failed = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    inspected_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    undo_until = models.DateTimeField(null=True, blank=True)
    undone_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        db_table = "backup_restores"
        ordering = ("-created_at",)
