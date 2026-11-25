# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Tell the live server that a project sticky changed.

Every recipient has its own channel ``sticky:user:<user_id>``; the live server
forwards each payload to that user's open sockets. Payloads only say *which*
sticky changed: clients fetch it, so the API alone decides who sees what.

Delivery is best-effort: a failed publish is logged and swallowed, because
clients fetch the list again when they reconnect.
"""

# Python imports
import json
import time
from typing import Iterable

# Django imports
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction

# Module imports
from plane.settings.redis import redis_instance
from plane.utils.exception_logger import log_exception

STICKY_USER_CHANNEL_PREFIX = "sticky:user:"
STICKY_CHANGED = "sticky.changed"

_client = None


def _redis():
    global _client
    if _client is None:
        _client = redis_instance()
    return _client


def publish_sticky_changed(data: dict, recipient_ids: Iterable, workspace_slug: str) -> None:
    """Publish to each recipient's channel in a single pipeline."""
    recipients = {str(user_id) for user_id in recipient_ids if user_id}
    if not recipients:
        return
    payload = json.dumps(
        {"t": STICKY_CHANGED, "d": data, "ws": workspace_slug, "ts": int(time.time() * 1000)},
        cls=DjangoJSONEncoder,
    )
    try:
        pipe = _redis().pipeline(transaction=False)
        for user_id in recipients:
            pipe.publish(f"{STICKY_USER_CHANNEL_PREFIX}{user_id}", payload)
        pipe.execute()
    except Exception as e:
        log_exception(e, warning=True)


def publish_on_commit(sticky, recipient_ids: Iterable, workspace_slug: str) -> None:
    """Publish only after the surrounding transaction commits, so a rolled-back
    write is never broadcast. Outside a transaction this publishes immediately."""
    recipients = [str(user_id) for user_id in recipient_ids if user_id]
    data = {
        "project_id": str(sticky.project_id),
        "sticky_id": str(sticky.id),
        # lets the client that made the change recognise its own event
        "updated_at": sticky.updated_at,
    }
    transaction.on_commit(lambda: publish_sticky_changed(data, recipients, workspace_slug))
