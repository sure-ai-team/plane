# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

DESTINATION_KINDS = [
    ("local", "Folder on the server"),
    ("s3", "S3-compatible storage"),
    ("postgres", "Standby PostgreSQL database"),
]


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="BackupDestination",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=120)),
                ("kind", models.CharField(choices=DESTINATION_KINDS, max_length=20)),
                ("config", models.JSONField(blank=True, default=dict)),
                ("secrets", models.TextField(blank=True, default="")),
                ("is_enabled", models.BooleanField(default=True)),
                ("last_checked_at", models.DateTimeField(blank=True, null=True)),
                ("last_check_ok", models.BooleanField(blank=True, null=True)),
                ("last_check_message", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"db_table": "backup_destinations", "ordering": ("created_at",)},
        ),
        migrations.CreateModel(
            name="BackupSchedule",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("is_enabled", models.BooleanField(default=False)),
                (
                    "frequency",
                    models.CharField(
                        choices=[
                            ("every_6_hours", "Every 6 hours"),
                            ("every_12_hours", "Every 12 hours"),
                            ("daily", "Every day"),
                            ("weekly", "Every week"),
                            ("monthly", "Every month"),
                        ],
                        default="daily",
                        max_length=20,
                    ),
                ),
                ("hour", models.PositiveSmallIntegerField(default=2)),
                ("minute", models.PositiveSmallIntegerField(default=0)),
                ("weekday", models.PositiveSmallIntegerField(default=0)),
                ("day_of_month", models.PositiveSmallIntegerField(default=1)),
                ("timezone", models.CharField(default="UTC", max_length=64)),
                ("include_files", models.BooleanField(default=True)),
                ("keep_last", models.PositiveSmallIntegerField(default=14)),
                ("next_run_at", models.DateTimeField(blank=True, null=True)),
                ("last_run_at", models.DateTimeField(blank=True, null=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "updated_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"db_table": "backup_schedules"},
        ),
        migrations.CreateModel(
            name="BackupSnapshot",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                (
                    "trigger",
                    models.CharField(
                        choices=[("manual", "Started by an admin"), ("scheduled", "Automatic")],
                        default="manual",
                        max_length=20,
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("queued", "Waiting to start"),
                            ("running", "In progress"),
                            ("succeeded", "Complete"),
                            ("partial", "Saved to some destinations"),
                            ("failed", "Failed"),
                        ],
                        db_index=True,
                        default="queued",
                        max_length=20,
                    ),
                ),
                ("note", models.CharField(blank=True, default="", max_length=200)),
                ("is_pinned", models.BooleanField(default=False)),
                ("include_files", models.BooleanField(default=True)),
                ("folder", models.CharField(max_length=100, unique=True)),
                ("progress", models.CharField(blank=True, default="", max_length=255)),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("finished_at", models.DateTimeField(blank=True, null=True)),
                ("database_size", models.BigIntegerField(default=0)),
                ("database_checksum", models.CharField(blank=True, default="", max_length=64)),
                ("files_count", models.IntegerField(default=0)),
                ("files_size", models.BigIntegerField(default=0)),
                ("app_version", models.CharField(blank=True, default="", max_length=64)),
                ("postgres_version", models.CharField(blank=True, default="", max_length=64)),
                ("migrations", models.JSONField(blank=True, default=dict)),
                ("stats", models.JSONField(blank=True, default=dict)),
                ("error", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"db_table": "backup_snapshots", "ordering": ("-created_at",)},
        ),
        migrations.CreateModel(
            name="BackupCopy",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("destination_name", models.CharField(max_length=120)),
                ("destination_kind", models.CharField(choices=DESTINATION_KINDS, max_length=20)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Waiting"),
                            ("running", "Saving"),
                            ("succeeded", "Saved"),
                            ("failed", "Failed"),
                        ],
                        default="pending",
                        max_length=20,
                    ),
                ),
                ("location", models.TextField(blank=True, default="")),
                ("size", models.BigIntegerField(default=0)),
                ("error", models.TextField(blank=True, default="")),
                ("finished_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "destination",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="copies",
                        to="backup.backupdestination",
                    ),
                ),
                (
                    "snapshot",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="copies",
                        to="backup.backupsnapshot",
                    ),
                ),
            ],
            options={"db_table": "backup_copies", "ordering": ("created_at",)},
        ),
    ]
