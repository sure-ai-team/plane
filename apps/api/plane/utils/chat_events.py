# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Publish chat events to Redis for the live server (docs/chat/03-realtime-protocol.md).

Every recipient has its own channel ``chat:user:<user_id>``; the live server
pattern-subscribes to ``chat:user:*`` and forwards each payload to that user's
open sockets. Django decides who receives what, so the live server never
authorises content.

Delivery is best-effort: a failed publish is logged and swallowed, because
clients re-fetch anything they missed when they reconnect.
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

CHAT_USER_CHANNEL_PREFIX = "chat:user:"
CHAT_ONLINE_KEY_PREFIX = "chat:online:"


class ChatEvent:
    MESSAGE_CREATED = "message.created"
    MESSAGE_UPDATED = "message.updated"
    MESSAGE_DELETED = "message.deleted"
    CONVERSATION_CREATED = "conversation.created"
    CONVERSATION_UPDATED = "conversation.updated"
    CONVERSATION_DELETED = "conversation.deleted"
    MEMBER_ADDED = "member.added"
    MEMBER_UPDATED = "member.updated"
    MEMBER_REMOVED = "member.removed"
    READ_UPDATED = "read.updated"


_client = None


def _redis():
    global _client
    if _client is None:
        _client = redis_instance()
    return _client


def user_channel(user_id) -> str:
    return f"{CHAT_USER_CHANNEL_PREFIX}{user_id}"


def publish_chat_event(event_type: str, data: dict, recipient_ids: Iterable, workspace_slug: str) -> None:
    """Publish one event to each recipient's channel in a single pipeline."""
    recipients = {str(user_id) for user_id in recipient_ids if user_id}
    if not recipients:
        return
    payload = json.dumps(
        {"t": event_type, "d": data, "ws": workspace_slug, "ts": int(time.time() * 1000)},
        cls=DjangoJSONEncoder,
    )
    try:
        pipe = _redis().pipeline(transaction=False)
        for user_id in recipients:
            pipe.publish(user_channel(user_id), payload)
        pipe.execute()
    except Exception as e:
        log_exception(e, warning=True)


def publish_on_commit(event_type: str, data: dict, recipient_ids: Iterable, workspace_slug: str) -> None:
    """Publish only after the surrounding transaction commits, so a rolled-back
    write is never broadcast. Outside a transaction this publishes immediately."""
    recipients = [str(user_id) for user_id in recipient_ids if user_id]
    transaction.on_commit(lambda: publish_chat_event(event_type, data, recipients, workspace_slug))


def online_user_ids(user_ids: Iterable) -> list:
    """Return the subset of ``user_ids`` that currently have a live chat socket."""
    ids = [str(user_id) for user_id in user_ids]
    if not ids:
        return []
    try:
        values = _redis().mget([f"{CHAT_ONLINE_KEY_PREFIX}{user_id}" for user_id in ids])
    except Exception as e:
        log_exception(e, warning=True)
        return []
    return [user_id for user_id, value in zip(ids, values) if value is not None]
