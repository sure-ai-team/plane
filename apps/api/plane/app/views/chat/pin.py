# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Pinned messages (docs/chat/phase-2/DECISIONS.md P2-D2): any active member can
pin or unpin; each change posts a system line; up to 50 pins per conversation."""

# Django imports
from django.db import IntegrityError, transaction

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.db.models import (
    MAX_PINS_PER_CONVERSATION,
    Conversation,
    FileAsset,
    MessageKind,
    MessageMention,
    MessagePin,
    SystemEvent,
)
from plane.throttles.chat import ChatPinThrottle
from plane.utils.chat_events import ChatEvent

from . import services
from .base import ChatBaseEndpoint
from .message import get_message, page_data

CHAT_ROLES = [ROLE.ADMIN, ROLE.MEMBER]


class ChatPinListEndpoint(ChatBaseEndpoint):
    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def get(self, request, slug, conversation_id):
        """Pinned messages, most recently pinned first, as full message payloads."""
        services.get_membership(request.user, conversation_id, slug)
        pins = list(
            MessagePin.objects.filter(conversation_id=conversation_id)
            .select_related("message__sender", "message__reply_to__sender")
            .order_by("-created_at")[:MAX_PINS_PER_CONVERSATION]
        )
        rows = [pin.message for pin in pins]
        ids = [message.id for message in rows]
        assets, mentions = {}, {}
        for asset in (
            FileAsset.objects.filter(chat_message_id__in=ids).select_related("workspace").order_by("created_at")
        ):
            assets.setdefault(str(asset.chat_message_id), []).append(asset)
        for message_id, user_id in MessageMention.objects.filter(message_id__in=ids).values_list(
            "message_id", "user_id"
        ):
            mentions.setdefault(str(message_id), []).append(str(user_id))
        results = page_data(rows, assets, mentions, services.read_positions(conversation_id), request.user)
        for pin, data in zip(pins, results):
            data["pinned_at"] = pin.created_at
            data["pinned_by"] = str(pin.pinned_by_id) if pin.pinned_by_id else None
        return Response(results, status=status.HTTP_200_OK)


class ChatPinEndpoint(ChatBaseEndpoint):
    throttle_classes = [ChatPinThrottle]

    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def post(self, request, slug, message_id):
        message, _ = get_message(request.user, slug, message_id)
        if message.kind == MessageKind.SYSTEM:
            raise services.ChatError(400, "CANNOT_PIN", "System messages can't be pinned.")
        if MessagePin.objects.filter(message=message).exists():
            return Response({"message_id": str(message.id), "is_pinned": True}, status=status.HTTP_200_OK)
        with transaction.atomic():
            # Lock the conversation so two pins can't both slip under the limit.
            Conversation.objects.select_for_update().filter(id=message.conversation_id).first()
            if MessagePin.objects.filter(conversation_id=message.conversation_id).count() >= MAX_PINS_PER_CONVERSATION:
                raise services.ChatError(
                    400,
                    "PIN_LIMIT",
                    f"A conversation can have up to {MAX_PINS_PER_CONVERSATION} pinned messages.",
                    max=MAX_PINS_PER_CONVERSATION,
                )
            try:
                with transaction.atomic():
                    MessagePin.objects.create(
                        conversation_id=message.conversation_id,
                        message=message,
                        workspace_id=message.workspace_id,
                        pinned_by=request.user,
                        created_by=request.user,
                    )
            except IntegrityError:
                return Response({"message_id": str(message.id), "is_pinned": True}, status=status.HTTP_200_OK)
            services.create_system_message(
                message.conversation_id, request.user, SystemEvent.PINNED, message_id=str(message.id), seq=message.seq
            )
            services.publish(
                ChatEvent.PIN_ADDED,
                {
                    "conversation_id": str(message.conversation_id),
                    "message_id": str(message.id),
                    "pinned_by": str(request.user.id),
                },
                message.conversation_id,
                slug,
            )
        return Response({"message_id": str(message.id), "is_pinned": True}, status=status.HTTP_201_CREATED)

    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def delete(self, request, slug, message_id):
        message, _ = get_message(request.user, slug, message_id)
        with transaction.atomic():
            deleted, _ = MessagePin.objects.filter(message=message).delete()
            if deleted:
                services.create_system_message(
                    message.conversation_id,
                    request.user,
                    SystemEvent.UNPINNED,
                    message_id=str(message.id),
                    seq=message.seq,
                )
                services.publish(
                    ChatEvent.PIN_REMOVED,
                    {"conversation_id": str(message.conversation_id), "message_id": str(message.id)},
                    message.conversation_id,
                    slug,
                )
        return Response(status=status.HTTP_204_NO_CONTENT)
