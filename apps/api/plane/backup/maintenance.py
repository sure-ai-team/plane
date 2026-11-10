# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Maintenance mode and restore status, both kept in Redis.

They live outside the database on purpose: during a restore the database is swapped,
and every session (stored in the database) disappears. The admin's progress screen
reads the status by restore id without signing in.
"""

import json
import logging
import time

from django.http import JsonResponse

logger = logging.getLogger("plane.worker")

MAINTENANCE_KEY = "backup:maintenance"
STATUS_KEY = "backup:restore-status:{id}"
STATUS_TTL = 3 * 24 * 3600
# Safety net: maintenance switches itself off if a worker dies mid-restore.
MAINTENANCE_TTL = 6 * 3600
# Paths that keep working during maintenance: the restore status and the instance info
# the admin app needs to render.
ALLOWED_PREFIXES = ("/api/instances/backups/restores/", "/api/instances/backups/maintenance/")
ALLOWED_EXACT = ("/api/instances/",)
CACHE_SECONDS = 2.0


def _redis():
    from plane.settings.redis import redis_instance

    return redis_instance()


def set_maintenance(reason: str) -> None:
    _redis().set(MAINTENANCE_KEY, reason, ex=MAINTENANCE_TTL)
    _cache["checked_at"] = 0.0


def clear_maintenance() -> None:
    _redis().delete(MAINTENANCE_KEY)
    _cache["checked_at"] = 0.0


def maintenance_reason() -> str:
    value = _redis().get(MAINTENANCE_KEY)
    return value.decode() if isinstance(value, bytes) else (value or "")


def publish_status(restore_id, **fields) -> None:
    """Merge fields into the public status of a restore."""
    try:
        client = _redis()
        key = STATUS_KEY.format(id=restore_id)
        current = client.get(key)
        data = json.loads(current) if current else {}
        data.update(fields)
        data["updated_at"] = time.time()
        client.set(key, json.dumps(data), ex=STATUS_TTL)
    except Exception:  # noqa: BLE001 - status is informational; never break the restore over it
        logger.exception("Could not publish the restore status")


def read_status(restore_id) -> dict:
    value = _redis().get(STATUS_KEY.format(id=restore_id))
    return json.loads(value) if value else {}


_cache = {"checked_at": 0.0, "reason": ""}


def _current_reason() -> str:
    now = time.monotonic()
    if now - _cache["checked_at"] > CACHE_SECONDS:
        try:
            _cache["reason"] = maintenance_reason()
        except Exception:  # noqa: BLE001 - Redis down must not take the app down
            _cache["reason"] = ""
        _cache["checked_at"] = now
    return _cache["reason"]


class MaintenanceModeMiddleware:
    """Answers 503 to API and sign-in calls while a restore swaps the database."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path
        guarded = path.startswith("/api/") or path.startswith("/auth/")
        if guarded and path not in ALLOWED_EXACT and not path.startswith(ALLOWED_PREFIXES):
            reason = _current_reason()
            if reason:
                return JsonResponse(
                    {
                        "error": "MAINTENANCE",
                        "detail": "The platform is being restored from a backup. Try again in a few minutes.",
                    },
                    status=503,
                    headers={"Retry-After": "60"},
                )
        return self.get_response(request)
