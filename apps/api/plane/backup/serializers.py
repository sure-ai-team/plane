# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Response shapes. Secrets are never included."""

from plane.backup.destinations import decrypt_secrets, describe_secrets
from plane.backup.models import BackupDestination, BackupSchedule, BackupSnapshot


def _iso(value):
    return value.isoformat() if value else None


def _person(user):
    if user is None:
        return None
    name = " ".join(filter(None, [user.first_name, user.last_name])) or user.display_name or user.email
    return {"id": str(user.id), "name": name, "email": user.email}


def serialize_destination(destination: BackupDestination) -> dict:
    return {
        "id": str(destination.id),
        "name": destination.name,
        "kind": destination.kind,
        "config": destination.config,
        "secrets_set": describe_secrets(destination.kind, decrypt_secrets(destination.secrets)),
        "is_enabled": destination.is_enabled,
        "last_checked_at": _iso(destination.last_checked_at),
        "last_check_ok": destination.last_check_ok,
        "last_check_message": destination.last_check_message,
        "created_at": _iso(destination.created_at),
    }


def serialize_schedule(schedule: BackupSchedule) -> dict:
    return {
        "is_enabled": schedule.is_enabled,
        "frequency": schedule.frequency,
        "hour": schedule.hour,
        "minute": schedule.minute,
        "weekday": schedule.weekday,
        "day_of_month": schedule.day_of_month,
        "timezone": schedule.timezone,
        "include_files": schedule.include_files,
        "keep_last": schedule.keep_last,
        "next_run_at": _iso(schedule.next_run_at) if schedule.is_enabled else None,
        "last_run_at": _iso(schedule.last_run_at),
        "updated_at": _iso(schedule.updated_at),
    }


def serialize_snapshot(snapshot: BackupSnapshot) -> dict:
    return {
        "id": str(snapshot.id),
        "trigger": snapshot.trigger,
        "status": snapshot.status,
        "note": snapshot.note,
        "is_pinned": snapshot.is_pinned,
        "include_files": snapshot.include_files,
        "folder": snapshot.folder,
        "progress": snapshot.progress,
        "created_at": _iso(snapshot.created_at),
        "started_at": _iso(snapshot.started_at),
        "finished_at": _iso(snapshot.finished_at),
        "created_by": _person(snapshot.created_by),
        "database_size": snapshot.database_size,
        "files_count": snapshot.files_count,
        "files_size": snapshot.files_size,
        "app_version": snapshot.app_version,
        "postgres_version": snapshot.postgres_version,
        "stats": snapshot.stats,
        "error": snapshot.error,
        "copies": [
            {
                "id": str(copy.id),
                "destination_id": str(copy.destination_id) if copy.destination_id else None,
                "destination_name": copy.destination_name,
                "destination_kind": copy.destination_kind,
                "status": copy.status,
                "location": copy.location,
                "size": copy.size,
                "error": copy.error,
                "finished_at": _iso(copy.finished_at),
            }
            for copy in snapshot.copies.all()
        ],
    }


def serialize_export(export) -> dict:
    return {
        "id": str(export.id),
        "snapshot_id": str(export.snapshot_id),
        "include_files": export.include_files,
        "status": export.status,
        "progress": export.progress,
        "size": export.size,
        "error": export.error,
        "created_at": _iso(export.created_at),
        "finished_at": _iso(export.finished_at),
        "expires_at": _iso(export.expires_at),
    }


def serialize_upload(upload) -> dict:
    return {
        "id": str(upload.id),
        "filename": upload.filename,
        "size": upload.size,
        "received": upload.received,
        "status": upload.status,
        "created_at": _iso(upload.created_at),
    }


def serialize_restore(restore) -> dict:
    from plane.backup.restore import undo_available

    manifest = restore.manifest or {}
    return {
        "id": str(restore.id),
        "source": restore.source,
        "snapshot_id": str(restore.snapshot_id) if restore.snapshot_id else None,
        "label": restore.label,
        "status": restore.status,
        "progress": restore.progress,
        "error": restore.error,
        "can_restore": restore.can_restore,
        "checks": restore.checks,
        "comparison": restore.comparison,
        "preview": restore.preview,
        "backup": {
            "created_at": manifest.get("created_at"),
            "trigger": manifest.get("trigger"),
            "note": manifest.get("note", ""),
            "app_version": manifest.get("app_version", ""),
            "postgres_version": manifest.get("postgres_version", ""),
            "database_size": (manifest.get("database") or {}).get("size", 0),
            "files": manifest.get("files") or {},
        },
        "safety_snapshot_id": str(restore.safety_snapshot_id) if restore.safety_snapshot_id else None,
        "files_restored": restore.files_restored,
        "files_failed": restore.files_failed,
        "created_at": _iso(restore.created_at),
        "inspected_at": _iso(restore.inspected_at),
        "started_at": _iso(restore.started_at),
        "finished_at": _iso(restore.finished_at),
        "undo_until": _iso(restore.undo_until),
        "undo_available": undo_available(restore),
        "undone_at": _iso(restore.undone_at),
        "created_by": _person(restore.created_by),
        "confirmed_by": _person(restore.confirmed_by),
    }
