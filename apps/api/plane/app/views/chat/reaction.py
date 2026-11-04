# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Emoji reactions on chat messages (docs/chat/phase-2/DECISIONS.md P2-D1)."""

# Django imports
from django.db import IntegrityError, transaction

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers.chat import ReactionSerializer
from plane.db.models import MAX_REACTIONS_PER_MESSAGE, MessageKind, MessageReaction
from plane.throttles.chat import ChatReactThrottle
from plane.utils.chat_events import ChatEvent

from . import services
from .base import ChatBaseEndpoint
from .message import get_message

CHAT_ROLES = [ROLE.ADMIN, ROLE.MEMBER]
MAX_EMOJI_BYTES = 32

# Code point ranges that render as emoji (pictographs, symbols, dingbats, arrows...).
_EMOJI_RANGES = (
    (0x1F000, 0x1FAFF),
    (0x2600, 0x27BF),
    (0x2300, 0x23FF),
    (0x2B00, 0x2BFF),
    (0x2190, 0x21FF),
    (0x25A0, 0x25FF),
    (0x2900, 0x297F),
    (0x3030, 0x3030),
    (0x303D, 0x303D),
    (0x3297, 0x3297),
    (0x3299, 0x3299),
    (0x00A9, 0x00A9),
    (0x00AE, 0x00AE),
    (0x203C, 0x203C),
    (0x2049, 0x2049),
    (0x2122, 0x2122),
    (0x2139, 0x2139),
    (0x24C2, 0x24C2),
)
_ZWJ = 0x200D
_VARIATION = (0xFE0E, 0xFE0F)
_KEYCAP = 0x20E3
_SKIN_TONES = range(0x1F3FB, 0x1F400)
_REGIONAL = range(0x1F1E6, 0x1F200)
_TAGS = range(0xE0020, 0xE0080)
_KEYCAP_BASES = set("0123456789#*")


def _is_pictograph(code_point: int) -> bool:
    return any(start <= code_point <= end for start, end in _EMOJI_RANGES)


def is_single_emoji(value: str) -> bool:
    """True for exactly one emoji: a pictograph with optional variation selector,
    skin tone, keycap, tag sequence (subdivision flags), a regional-indicator
    pair (flags), or several of these joined with ZWJ (07-security.md P2-S8)."""
    if not value or len(value.encode("utf-8")) > MAX_EMOJI_BYTES:
        return False
    chars = list(value)
    has_pictograph = False
    previous_pictograph = False
    regional_run = 0
    for index, char in enumerate(chars):
        code_point = ord(char)
        if code_point == _ZWJ:
            if not previous_pictograph:
                return False
            previous_pictograph = False
            regional_run = 0
            continue
        if code_point in _VARIATION or code_point == _KEYCAP or code_point in _TAGS:
            continue
        if char in _KEYCAP_BASES:
            following = [ord(c) for c in chars[index + 1 : index + 3]]
            if _KEYCAP not in following or has_pictograph:
                return False
            has_pictograph = previous_pictograph = True
            continue
        if code_point in _SKIN_TONES and previous_pictograph:
            continue
        if code_point in _REGIONAL:
            regional_run += 1
            if regional_run > 2 or (has_pictograph and regional_run == 1):
                return False
            has_pictograph = previous_pictograph = True
            continue
        if not _is_pictograph(code_point):
            return False
        if previous_pictograph:
            return False  # two emoji side by side without a joiner
        has_pictograph = previous_pictograph = True
        regional_run = 0
    return has_pictograph and regional_run in (0, 2)


def emoji_count(message_id, emoji) -> int:
    return MessageReaction.objects.filter(message_id=message_id, emoji=emoji).count()


def publish_reaction(message, slug, *, emoji, user_id, added):
    services.publish(
        ChatEvent.REACTION_UPDATED,
        {
            "conversation_id": str(message.conversation_id),
            "message_id": str(message.id),
            "emoji": emoji,
            "count": emoji_count(message.id, emoji),
            "user_id": str(user_id),
            "added": added,
        },
        message.conversation_id,
        slug,
    )


def reactable_message(user, slug, message_id):
    message, membership = get_message(user, slug, message_id)
    if message.kind == MessageKind.SYSTEM:
        raise services.ChatError(400, "CANNOT_REACT", "You can't react to this message.")
    return message, membership


class ChatReactionListEndpoint(ChatBaseEndpoint):
    def get_throttles(self):
        return [ChatReactThrottle()] if self.request.method == "POST" else []

    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def get(self, request, slug, message_id):
        """Who reacted, optionally for one emoji."""
        message, _ = get_message(request.user, slug, message_id)
        rows = MessageReaction.objects.filter(message=message).order_by("created_at")
        emoji = request.query_params.get("emoji")
        if emoji:
            rows = rows.filter(emoji=emoji)
        data = [
            {"emoji": row["emoji"], "user_id": str(row["user_id"]), "created_at": row["created_at"]}
            for row in rows.values("emoji", "user_id", "created_at")
        ]
        return Response(data, status=status.HTTP_200_OK)

    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def post(self, request, slug, message_id):
        message, _ = reactable_message(request.user, slug, message_id)
        emoji = self.validated(ReactionSerializer(data=request.data))["emoji"]
        if not is_single_emoji(emoji):
            raise services.ChatError(400, "INVALID_EMOJI", "Choose a single emoji.")

        created = False
        if not MessageReaction.objects.filter(message=message, user=request.user, emoji=emoji).exists():
            existing = set(MessageReaction.objects.filter(message=message).values_list("emoji", flat=True))
            if emoji not in existing and len(existing) >= MAX_REACTIONS_PER_MESSAGE:
                raise services.ChatError(
                    400,
                    "REACTION_LIMIT",
                    f"A message can have up to {MAX_REACTIONS_PER_MESSAGE} different reactions.",
                    max=MAX_REACTIONS_PER_MESSAGE,
                )
            try:
                with transaction.atomic():
                    MessageReaction.objects.create(
                        message=message,
                        user=request.user,
                        workspace_id=message.workspace_id,
                        emoji=emoji,
                        created_by=request.user,
                    )
                created = True
            except IntegrityError:
                created = False  # a concurrent identical request won

        if created:
            publish_reaction(message, slug, emoji=emoji, user_id=request.user.id, added=True)
        summary = services.reaction_summaries([message.id], request.user.id).get(str(message.id), [])
        return Response(summary, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class ChatReactionDetailEndpoint(ChatBaseEndpoint):
    throttle_classes = [ChatReactThrottle]

    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def delete(self, request, slug, message_id, emoji):
        message, _ = get_message(request.user, slug, message_id)
        deleted, _ = MessageReaction.objects.filter(message=message, user=request.user, emoji=emoji).delete()
        if deleted:
            publish_reaction(message, slug, emoji=emoji, user_id=request.user.id, added=False)
        return Response(status=status.HTTP_204_NO_CONTENT)
