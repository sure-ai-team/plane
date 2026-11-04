# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Chat entries in the Inbox (docs/chat/phase-2/05-notifications.md).

* A mention creates one Inbox row per mention.
* A direct message keeps at most one unread row per conversation for the
  recipient; newer messages refresh that row instead of adding more.
* Rows follow the member's notification level, snooze and the
  ``inbox_mentions`` preference.
* Reading in chat marks the rows read; deleting a message deletes its rows
  (hard delete, D2); leaving a conversation deletes your unread rows for it.
"""

# Python imports
import html
import logging

# Django imports
from django.utils import timezone

# Third party imports
from celery import shared_task

# Module imports
from plane.db.models import (
    ChatPreference,
    ConversationType,
    Message,
    MessageKind,
    MessageMention,
    Notification,
    NotifyLevel,
)

logger = logging.getLogger("plane.worker")

ENTITY_NAME = "chat_message"
# The Inbox puts rows whose sender contains "mentioned" under its Mentions tab.
SENDER = "chat"
SENDER_MENTION = "chat_mentioned"
SNIPPET_LENGTH = 200


def _snippet(message) -> str:
    text = (message.body_stripped or "").strip()
    if text:
        return text[:SNIPPET_LENGTH]
    kinds = list(message.assets.values_list("attributes__kind", flat=True))
    if message.kind == MessageKind.VOICE:
        return "Voice note"
    if kinds:
        return {"image": "Photo", "video": "Video", "audio": "Audio"}.get(kinds[0], "File")
    return ""


def _row_fields(message, receiver_id, kind):
    conversation = message.conversation
    sender = message.sender
    sender_name = (sender.display_name or sender.first_name or sender.email) if sender else ""
    text = _snippet(message)
    return {
        "workspace_id": message.workspace_id,
        "project_id": conversation.project_id,
        "entity_identifier": message.id,
        "entity_name": ENTITY_NAME,
        "title": f"{sender_name} mentioned you" if kind == "mention" else f"{sender_name} sent you a message",
        "message": {"text": text},
        "message_html": f"<p>{html.escape(text)}</p>" if text else "<p></p>",
        "message_stripped": text,
        "sender": SENDER_MENTION if kind == "mention" else SENDER,
        "triggered_by_id": message.sender_id,
        "receiver_id": receiver_id,
        "data": {
            "type": kind,
            "conversation_id": str(conversation.id),
            "conversation_type": conversation.type,
            "conversation_name": conversation.name,
            "message_id": str(message.id),
            "seq": message.seq,
            "sender_id": str(message.sender_id) if message.sender_id else None,
        },
    }


def inbox_recipients(message):
    """``{user_id: kind}`` for who should get an Inbox row for this message."""
    from plane.app.views.chat.services import active_members

    conversation = message.conversation
    now = timezone.now()
    mentioned = {
        str(user_id) for user_id in MessageMention.objects.filter(message=message).values_list("user_id", flat=True)
    }
    members = active_members(conversation.id).exclude(member_id=message.sender_id)
    opted_out = {
        str(user_id)
        for user_id in ChatPreference.objects.filter(
            workspace_id=message.workspace_id, inbox_mentions=False
        ).values_list("user_id", flat=True)
    }
    recipients = {}
    for membership in members:
        user_id = str(membership.member_id)
        if user_id in opted_out or membership.notify_level == NotifyLevel.OFF or membership.is_snoozed(now):
            continue
        if user_id in mentioned:
            recipients[user_id] = "mention"
        elif conversation.type == ConversationType.DIRECT and membership.notify_level == NotifyLevel.ALL:
            recipients[user_id] = "direct"
    return recipients


@shared_task
def chat_inbox_notifications(message_id):
    """Create or refresh Inbox rows for a newly sent chat message."""
    message = Message.objects.select_related("conversation", "sender").filter(id=message_id).first()
    if message is None or message.kind == MessageKind.SYSTEM or message.sender_id is None:
        return 0
    created = 0
    for receiver_id, kind in inbox_recipients(message).items():
        fields = _row_fields(message, receiver_id, kind)
        if kind == "direct":
            existing = Notification.objects.filter(
                receiver_id=receiver_id,
                entity_name=ENTITY_NAME,
                read_at__isnull=True,
                data__conversation_id=str(message.conversation_id),
                data__type="direct",
            ).first()
            if existing:
                for field, value in fields.items():
                    setattr(existing, field, value)
                existing.created_at = timezone.now()
                existing.save()
                continue
        Notification.objects.create(**fields)
        created += 1
    return created


def mark_inbox_read(user_id, conversation_id, seq) -> int:
    """Reading up to ``seq`` in chat marks the matching Inbox rows read."""
    rows = Notification.objects.filter(
        receiver_id=user_id,
        entity_name=ENTITY_NAME,
        read_at__isnull=True,
        data__conversation_id=str(conversation_id),
        data__seq__lte=seq,
    )
    return rows.update(read_at=timezone.now())


def delete_message_notifications(message_ids) -> int:
    ids = [message_id for message_id in message_ids if message_id]
    if not ids:
        return 0
    deleted, _ = Notification.all_objects.filter(entity_name=ENTITY_NAME, entity_identifier__in=ids).delete()
    return deleted


def delete_conversation_notifications(conversation_id, user_id=None, unread_only=False) -> int:
    rows = Notification.all_objects.filter(entity_name=ENTITY_NAME, data__conversation_id=str(conversation_id))
    if user_id is not None:
        rows = rows.filter(receiver_id=user_id)
    if unread_only:
        rows = rows.filter(read_at__isnull=True)
    deleted, _ = rows.delete()
    return deleted


__all__ = [
    "chat_inbox_notifications",
    "delete_conversation_notifications",
    "delete_message_notifications",
    "inbox_recipients",
    "mark_inbox_read",
]
