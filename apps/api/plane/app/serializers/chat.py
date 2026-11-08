# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Chat response shapes (docs/chat/02-api-contracts.md § Shared shapes).

These are plain functions over already-fetched rows so list endpoints never
issue per-row queries. The same dicts are published to the live server, so
REST and socket payloads are identical.
"""

# Third party imports
from rest_framework import serializers

# Module imports
from plane.db.models import ConversationType, MessageKind, MessageLayout, MinimizeStyle, NotifyLevel, SoundTone
from plane.utils.chat_media import KIND_AUDIO, KIND_IMAGE, KIND_VIDEO

from .user import UserLiteSerializer


def user_lite(user):
    if user is None:
        return None
    data = dict(UserLiteSerializer(user).data)
    data["id"] = str(user.id)  # all chat ids are strings, in REST and socket payloads alike
    data["is_active"] = bool(getattr(user, "is_active", True))
    return data


def attachment_data(asset) -> dict:
    attributes = asset.attributes or {}
    kind = attributes.get("kind", "file")
    url = asset.asset_url
    return {
        "id": str(asset.id),
        "kind": kind,
        "name": attributes.get("name"),
        "type": attributes.get("type"),
        "size": attributes.get("size") or asset.size,
        "url": url,
        "thumb_url": f"{url}?thumb=1" if attributes.get("thumb_key") and kind in (KIND_IMAGE, KIND_VIDEO) else None,
        "width": attributes.get("width"),
        "height": attributes.get("height"),
        "duration": attributes.get("duration") if kind in (KIND_AUDIO, KIND_VIDEO) else None,
        "waveform": attributes.get("waveform") if kind == KIND_AUDIO else None,
        "is_voice": bool(attributes.get("is_voice")),
        "is_uploaded": asset.is_uploaded,
        "created_at": asset.created_at,
    }


def seen_by_count(message, read_positions) -> int:
    if message.kind == MessageKind.SYSTEM:
        return 0
    sender_id = str(message.sender_id) if message.sender_id else None
    return sum(1 for member_id, seq in read_positions if member_id != sender_id and seq >= message.seq)


def forwarded_data(message, *, viewer_source_ids=None, source_names=None):
    """Public shape of ``meta.forwarded_from`` (P2-D6).

    The source conversation is only revealed to viewers who are members of it:
    pass the conversation ids the viewer belongs to (and their names) to fill it in.
    """
    source = (message.meta or {}).get("forwarded_from")
    if not source:
        return None
    conversation_id = source.get("conversation_id")
    visible = bool(conversation_id and viewer_source_ids and conversation_id in viewer_source_ids)
    return {
        "sender_id": source.get("sender_id"),
        "sender_name": source.get("sender_name"),
        "sent_at": source.get("sent_at"),
        "conversation_id": conversation_id if visible else None,
        "conversation_name": (source_names or {}).get(conversation_id) if visible else None,
    }


def public_meta(message) -> dict:
    """``meta`` without server-only keys (the forward source lives in ``forwarded_from``)."""
    return {key: value for key, value in (message.meta or {}).items() if key != "forwarded_from"}


def message_data(
    message,
    *,
    assets=(),
    mentions=(),
    read_positions=(),
    reactions=(),
    is_pinned=False,
    work_items=(),
    forwarded_from=None,
) -> dict:
    reply = None
    if message.reply_to_id and message.reply_to is not None:
        target = message.reply_to
        reply = {
            "id": str(target.id),
            "seq": target.seq,
            "sender": user_lite(target.sender),
            "kind": target.kind,
            "body_stripped": (target.body_stripped or "")[:200],
        }
    return {
        "id": str(message.id),
        "conversation_id": str(message.conversation_id),
        "seq": message.seq,
        "kind": message.kind,
        "sender": user_lite(message.sender),
        "body_html": message.body_html,
        "body_json": message.body_json,
        "body_stripped": message.body_stripped,
        "reply_to": reply,
        "attachments": [attachment_data(asset) for asset in assets],
        "mentions": list(mentions),
        "meta": public_meta(message),
        "client_id": str(message.client_id) if message.client_id else None,
        "edited_at": message.edited_at,
        "created_at": message.created_at,
        "seen_by_count": seen_by_count(message, read_positions),
        "reactions": list(reactions),
        "is_pinned": bool(is_pinned),
        "work_items": list(work_items),
        "forwarded_from": forwarded_from if forwarded_from is not None else forwarded_data(message),
    }


def project_lite(project):
    if project is None:
        return None
    return {
        "id": str(project.id),
        "identifier": project.identifier,
        "name": project.name,
        "logo_props": project.logo_props,
    }


def conversation_data(membership, *, member_count=0, direct_user=None, unread_mention_count=0) -> dict:
    conversation = membership.conversation
    return {
        "id": str(conversation.id),
        "type": conversation.type,
        "name": conversation.name,
        "description": conversation.description,
        "logo_props": conversation.logo_props,
        "project": project_lite(conversation.project) if conversation.project_id else None,
        "direct_user": user_lite(direct_user) if conversation.type == ConversationType.DIRECT else None,
        "member_count": member_count,
        "my_role": membership.role,
        **member_settings_data(membership),
        "last_message_seq": conversation.last_message_seq,
        "last_read_seq": membership.last_read_seq,
        "unread_count": max(0, conversation.last_message_seq - membership.last_read_seq),
        "unread_mention_count": unread_mention_count,
        "last_message_at": conversation.last_message_at,
        "last_message_preview": conversation.last_message_preview or {},
        "created_at": conversation.created_at,
        "created_by": str(conversation.created_by_id) if conversation.created_by_id else None,
    }


def member_settings_data(membership) -> dict:
    """The caller's personal settings for one conversation (phase 2 02-api-contracts.md)."""
    return {
        "notify_level": membership.notify_level,
        "snoozed_until": membership.snoozed_until,
        "is_starred": membership.is_starred,
        "archived_at": membership.archived_at,
        "is_muted": membership.is_muted,  # phase 1 field, read-only (= notify level "off")
    }


def preference_data(preference) -> dict:
    return {
        "desktop_notifications": preference.desktop_notifications,
        "sound": preference.sound,
        "sound_tone": preference.sound_tone,
        "sound_volume": preference.sound_volume,
        "show_preview": preference.show_preview,
        "inbox_mentions": preference.inbox_mentions,
        "message_layout": preference.message_layout,
        "bubbles_direct_only": preference.bubbles_direct_only,
        "minimize_style": preference.minimize_style,
    }


def member_data(row) -> dict:
    return {
        "id": str(row.id),
        "member": user_lite(row.member),
        "role": row.role,
        "is_muted": row.is_muted,
        "is_active": row.is_active,
        "last_read_seq": row.last_read_seq,
        "joined_at": row.joined_at,
    }


# --------------------------------------------------------------------------- #
# Input validation
# --------------------------------------------------------------------------- #


class ConversationCreateSerializer(serializers.Serializer):
    type = serializers.ChoiceField(choices=ConversationType.choices)
    user_id = serializers.UUIDField(required=False)
    name = serializers.CharField(required=False, allow_blank=True, max_length=255)
    logo_props = serializers.DictField(required=False)
    project_id = serializers.UUIDField(required=False, allow_null=True)
    member_ids = serializers.ListField(child=serializers.UUIDField(), required=False, max_length=500)


class MessageCreateSerializer(serializers.Serializer):
    body_html = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False)
    body_json = serializers.DictField(required=False)
    reply_to_id = serializers.UUIDField(required=False, allow_null=True)
    client_id = serializers.UUIDField(required=False, allow_null=True)
    attachment_ids = serializers.ListField(child=serializers.UUIDField(), required=False, max_length=50)


class MessageUpdateSerializer(serializers.Serializer):
    body_html = serializers.CharField(allow_blank=True, trim_whitespace=False)
    body_json = serializers.DictField(required=False)


class AttachmentRequestSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255)
    type = serializers.CharField(max_length=255)
    size = serializers.IntegerField(min_value=1)
    width = serializers.IntegerField(required=False, allow_null=True, min_value=1, max_value=100000)
    height = serializers.IntegerField(required=False, allow_null=True, min_value=1, max_value=100000)
    duration = serializers.FloatField(required=False, allow_null=True)
    waveform = serializers.ListField(child=serializers.FloatField(), required=False, allow_null=True, max_length=64)
    is_voice = serializers.BooleanField(required=False, default=False)


class ThumbnailRequestSerializer(serializers.Serializer):
    type = serializers.CharField(max_length=64)
    size = serializers.IntegerField(min_value=1)


class MemberSettingsSerializer(serializers.Serializer):
    notify_level = serializers.ChoiceField(choices=NotifyLevel.choices, required=False)
    snoozed_until = serializers.DateTimeField(required=False, allow_null=True)
    is_starred = serializers.BooleanField(required=False)
    archived = serializers.BooleanField(required=False)


class PreferenceSerializer(serializers.Serializer):
    desktop_notifications = serializers.BooleanField(required=False)
    sound = serializers.BooleanField(required=False)
    sound_tone = serializers.ChoiceField(choices=SoundTone.choices, required=False)
    sound_volume = serializers.IntegerField(min_value=0, max_value=100, required=False)
    show_preview = serializers.BooleanField(required=False)
    inbox_mentions = serializers.BooleanField(required=False)
    message_layout = serializers.ChoiceField(choices=MessageLayout.choices, required=False)
    bubbles_direct_only = serializers.BooleanField(required=False)
    minimize_style = serializers.ChoiceField(choices=MinimizeStyle.choices, required=False)


class ForwardSerializer(serializers.Serializer):
    conversation_ids = serializers.ListField(child=serializers.UUIDField(), min_length=1, max_length=50)
    comment_html = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False)


class ReactionSerializer(serializers.Serializer):
    emoji = serializers.CharField(max_length=64, trim_whitespace=True)
