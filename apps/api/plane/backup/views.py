# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Backup & restore endpoints for the instance admin panel (/api/instances/backups/)."""

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from plane.backup.destinations import (
    KINDS,
    DestinationError,
    build_driver,
    decrypt_secrets,
    encrypt_secrets,
    validate_destination,
)
from plane.backup.models import (
    BackupDestination,
    BackupSchedule,
    BackupSnapshot,
    CopyStatus,
    SnapshotStatus,
    SnapshotTrigger,
)
from plane.backup.runner import delete_snapshot_data, tools_available
from plane.backup.schedule import assess_health, validate_schedule
from plane.backup.serializers import serialize_destination, serialize_schedule, serialize_snapshot
from plane.backup.tasks import create_snapshot, next_run_for, queue_snapshot
from plane.license.api.views.base import BaseAPIView

ACTIVE_STATUSES = (SnapshotStatus.QUEUED, SnapshotStatus.RUNNING)
NAME_MAX = 120
NOTE_MAX = 200


def _bad_request(message: str, fields: dict | None = None) -> Response:
    body = {"error": message}
    if fields:
        body["fields"] = fields
    return Response(body, status=status.HTTP_400_BAD_REQUEST)


def _snapshots():
    return BackupSnapshot.objects.select_related("created_by").prefetch_related("copies")


class BackupOverviewEndpoint(BaseAPIView):
    def get(self, request):
        now = timezone.now()
        schedule = BackupSchedule.get_solo()
        destinations = list(BackupDestination.objects.filter(is_enabled=True))
        latest = _snapshots().exclude(status__in=ACTIVE_STATUSES).first()
        running = _snapshots().filter(status__in=ACTIVE_STATUSES).first()
        last_success = _snapshots().filter(status__in=[SnapshotStatus.SUCCEEDED, SnapshotStatus.PARTIAL]).first()
        kept = BackupSnapshot.objects.filter(status__in=[SnapshotStatus.SUCCEEDED, SnapshotStatus.PARTIAL])
        has_tools = tools_available()
        restore = _current_restore()

        health, messages = assess_health(
            now=now,
            tools_available=has_tools,
            enabled_destinations=len(destinations),
            failing_destinations=[d.name for d in destinations if d.last_check_ok is False],
            schedule_enabled=schedule.is_enabled,
            frequency=schedule.frequency,
            last_success_at=last_success.finished_at if last_success else None,
            latest_status=latest.status if latest else None,
            latest_error=latest.error if latest else "",
        )
        return Response(
            {
                "health": health,
                "messages": [{"level": m.level, "text": m.text} for m in messages],
                "tools_available": has_tools,
                "schedule": serialize_schedule(schedule),
                "latest": serialize_snapshot(latest) if latest else None,
                "last_success": serialize_snapshot(last_success) if last_success else None,
                "running": serialize_snapshot(running) if running else None,
                "destinations": {
                    "enabled": len(destinations),
                    "total": BackupDestination.objects.count(),
                },
                "totals": {
                    "count": kept.count(),
                    "database_size": kept.aggregate(total=Sum("database_size"))["total"] or 0,
                },
                # An open restore, or a finished one that can still be undone.
                "restore": restore_payload(restore) if restore else None,
            }
        )


def _restore_busy() -> bool:
    from plane.backup.models import BackupRestore, RestoreStatus

    return BackupRestore.objects.filter(
        status__in=[RestoreStatus.INSPECTING, RestoreStatus.QUEUED, RestoreStatus.RUNNING, RestoreStatus.UNDOING]
    ).exists()


def _current_restore():
    from plane.backup.models import OPEN_RESTORE_STATUSES, BackupRestore, RestoreStatus
    from plane.backup.restore import undo_available

    restores = BackupRestore.objects.select_related("created_by", "confirmed_by")
    open_restore = restores.filter(status__in=OPEN_RESTORE_STATUSES).first()
    if open_restore:
        return open_restore
    latest_done = restores.filter(status=RestoreStatus.SUCCEEDED).first()
    return latest_done if latest_done and undo_available(latest_done) else None


def restore_payload(restore):
    from plane.backup.views_restore import restore_payload as payload

    return payload(restore)


class BackupScheduleEndpoint(BaseAPIView):
    FIELDS = (
        "is_enabled",
        "frequency",
        "hour",
        "minute",
        "weekday",
        "day_of_month",
        "timezone",
        "include_files",
        "keep_last",
    )

    def get(self, request):
        return Response(serialize_schedule(BackupSchedule.get_solo()))

    def patch(self, request):
        data = {key: request.data[key] for key in self.FIELDS if key in request.data}
        errors = validate_schedule(data)
        if errors:
            return _bad_request("Check the highlighted settings.", errors)
        with transaction.atomic():
            schedule = BackupSchedule.objects.select_for_update().get(pk=BackupSchedule.get_solo().pk)
            for key, value in data.items():
                setattr(schedule, key, value)
            schedule.next_run_at = next_run_for(schedule, timezone.now()) if schedule.is_enabled else None
            schedule.updated_by = request.user
            schedule.save()
        return Response(serialize_schedule(schedule))


def _destination_input(request, existing: BackupDestination | None = None):
    kind = existing.kind if existing else request.data.get("kind")
    name = request.data.get("name", existing.name if existing else "")
    name = name.strip() if isinstance(name, str) else ""
    config = request.data.get("config", existing.config if existing else {})
    secrets = request.data.get("secrets", {})
    stored = decrypt_secrets(existing.secrets) if existing else {}
    clean_config, clean_secrets, errors = validate_destination(kind, config, secrets, stored)
    if not name or len(name) > NAME_MAX:
        errors["name"] = f"Give the destination a name (up to {NAME_MAX} characters)."
    return kind, name, clean_config, clean_secrets, errors


def _run_test(kind: str, config: dict, secrets: dict) -> tuple[bool, str]:
    try:
        return True, build_driver(kind, config, secrets, quick=True).test()
    except DestinationError as error:
        return False, str(error)


def _record_test(destination: BackupDestination, ok: bool, message: str) -> None:
    destination.last_checked_at = timezone.now()
    destination.last_check_ok = ok
    destination.last_check_message = message
    destination.save(update_fields=["last_checked_at", "last_check_ok", "last_check_message", "updated_at"])


class BackupDestinationListEndpoint(BaseAPIView):
    def get(self, request):
        return Response([serialize_destination(d) for d in BackupDestination.objects.all()])

    def post(self, request):
        kind, name, config, secrets, errors = _destination_input(request)
        if errors:
            return _bad_request("Check the highlighted settings.", errors)
        destination = BackupDestination.objects.create(
            name=name,
            kind=kind,
            config=config,
            secrets=encrypt_secrets(secrets),
            is_enabled=bool(request.data.get("is_enabled", True)),
            created_by=request.user,
        )
        # Test right away so the admin sees at once whether it works.
        ok, message = _run_test(kind, config, secrets)
        _record_test(destination, ok, message)
        return Response(serialize_destination(destination), status=status.HTTP_201_CREATED)


class BackupDestinationDetailEndpoint(BaseAPIView):
    def get(self, request, pk):
        return Response(serialize_destination(BackupDestination.objects.get(pk=pk)))

    def patch(self, request, pk):
        destination = BackupDestination.objects.get(pk=pk)
        if "kind" in request.data and request.data["kind"] != destination.kind:
            return _bad_request("The type of a destination can't be changed. Add a new destination instead.")
        settings_changed = any(key in request.data for key in ("config", "secrets"))
        kind, name, config, secrets, errors = _destination_input(request, destination)
        if errors:
            return _bad_request("Check the highlighted settings.", errors)
        destination.name = name
        destination.config = config
        destination.secrets = encrypt_secrets(secrets)
        if "is_enabled" in request.data:
            destination.is_enabled = bool(request.data["is_enabled"])
        destination.save()
        if settings_changed:
            ok, message = _run_test(kind, config, secrets)
            _record_test(destination, ok, message)
        return Response(serialize_destination(destination))

    def delete(self, request, pk):
        destination = BackupDestination.objects.get(pk=pk)
        busy = destination.copies.filter(status__in=[CopyStatus.PENDING, CopyStatus.RUNNING]).exists()
        if busy:
            return Response(
                {"error": "A backup is being saved here right now. Try again when it finishes."},
                status=status.HTTP_409_CONFLICT,
            )
        # Files already saved at the destination are left there on purpose.
        destination.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class BackupDestinationTestEndpoint(BaseAPIView):
    """Test saved settings (pk given) or settings typed into the form (no pk)."""

    def post(self, request, pk=None):
        existing = BackupDestination.objects.get(pk=pk) if pk else None
        if existing and not any(key in request.data for key in ("config", "secrets")):
            ok, message = _run_test(existing.kind, existing.config, decrypt_secrets(existing.secrets))
            _record_test(existing, ok, message)
            return Response({"ok": ok, "message": message})

        data_kind = existing.kind if existing else request.data.get("kind")
        if data_kind not in KINDS:
            return _bad_request("Choose a destination type.", {"kind": "Choose a destination type."})
        stored = decrypt_secrets(existing.secrets) if existing else {}
        config, secrets, errors = validate_destination(
            data_kind, request.data.get("config", {}), request.data.get("secrets", {}), stored
        )
        if errors:
            return _bad_request("Check the highlighted settings.", errors)
        ok, message = _run_test(data_kind, config, secrets)
        return Response({"ok": ok, "message": message})


class BackupSnapshotListEndpoint(BaseAPIView):
    def get(self, request):
        try:
            limit = min(max(int(request.GET.get("limit", 25)), 1), 100)
            offset = max(int(request.GET.get("offset", 0)), 0)
        except ValueError:
            return _bad_request("Invalid page.")
        queryset = _snapshots()
        status_filter = request.GET.get("status")
        if status_filter == "kept":
            queryset = queryset.filter(status__in=[SnapshotStatus.SUCCEEDED, SnapshotStatus.PARTIAL])
        elif status_filter == "failed":
            queryset = queryset.filter(status=SnapshotStatus.FAILED)
        total = queryset.count()
        results = [serialize_snapshot(s) for s in queryset[offset : offset + limit]]
        return Response({"results": results, "total": total, "limit": limit, "offset": offset})

    def post(self, request):
        if not tools_available():
            return _bad_request("The server is missing the database backup tool (pg_dump).")
        if not BackupDestination.objects.filter(is_enabled=True).exists():
            return _bad_request("Add a destination first, so the backup has somewhere to go.")
        note = request.data.get("note", "")
        note = note.strip() if isinstance(note, str) else ""
        if len(note) > NOTE_MAX:
            return _bad_request(f"Keep the note under {NOTE_MAX} characters.", {"note": "Too long."})
        include_files = request.data.get("include_files", True)
        if not isinstance(include_files, bool):
            return _bad_request("Invalid choice for files.", {"include_files": "Use true or false."})
        with transaction.atomic():
            # Serialise "start backup" clicks so two admins can't start two at once.
            BackupSchedule.objects.select_for_update().filter(pk=BackupSchedule.get_solo().pk).exists()
            if BackupSnapshot.objects.filter(status__in=ACTIVE_STATUSES).exists():
                return Response(
                    {"error": "A backup is already in progress. Wait for it to finish."},
                    status=status.HTTP_409_CONFLICT,
                )
            if _restore_busy():
                return Response(
                    {"error": "A restore is in progress. Wait for it to finish."},
                    status=status.HTTP_409_CONFLICT,
                )
            snapshot = create_snapshot(
                trigger=SnapshotTrigger.MANUAL, include_files=include_files, note=note, user=request.user
            )
            queue_snapshot(snapshot)
        return Response(serialize_snapshot(_snapshots().get(pk=snapshot.pk)), status=status.HTTP_201_CREATED)


class BackupSnapshotDetailEndpoint(BaseAPIView):
    def get(self, request, pk):
        return Response(serialize_snapshot(_snapshots().get(pk=pk)))

    def patch(self, request, pk):
        snapshot = BackupSnapshot.objects.get(pk=pk)
        fields = []
        if "note" in request.data:
            note = request.data["note"]
            if not isinstance(note, str) or len(note.strip()) > NOTE_MAX:
                return _bad_request(f"Keep the note under {NOTE_MAX} characters.", {"note": "Too long."})
            snapshot.note = note.strip()
            fields.append("note")
        if "is_pinned" in request.data:
            if not isinstance(request.data["is_pinned"], bool):
                return _bad_request("Invalid pin value.", {"is_pinned": "Use true or false."})
            snapshot.is_pinned = request.data["is_pinned"]
            fields.append("is_pinned")
        if fields:
            snapshot.save(update_fields=fields)
        return Response(serialize_snapshot(_snapshots().get(pk=pk)))

    def delete(self, request, pk):
        snapshot = BackupSnapshot.objects.get(pk=pk)
        if snapshot.status in ACTIVE_STATUSES:
            return Response(
                {"error": "This backup is still in progress. Wait for it to finish."},
                status=status.HTTP_409_CONFLICT,
            )
        problems = delete_snapshot_data(snapshot)
        if problems and request.GET.get("force") != "true":
            return Response(
                {
                    "error": "Some copies couldn't be removed. You can remove the backup from the list anyway.",
                    "problems": problems,
                },
                status=status.HTTP_409_CONFLICT,
            )
        snapshot.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
