# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers.chat import MessageCreateSerializer, MessageUpdateSerializer, message_data
from plane.db.models import ConversationRole, ConversationType, FileAsset, Message, MessageMention
from plane.throttles.chat import ChatReadThrottle, ChatSendThrottle
from plane.utils.chat_config import get_chat_config
from plane.utils.chat_events import ChatEvent

from . import services
from .base import ChatBaseEndpoint

CHAT_ROLES = [ROLE.ADMIN, ROLE.MEMBER]
DEFAULT_PAGE = 50
MAX_PAGE = 100


def full_message_data(message, viewer=None, read_positions=None):
    assets = list(FileAsset.objects.filter(chat_message=message).select_related("workspace").order_by("created_at"))
    mentions = [
        str(user_id) for user_id in MessageMention.objects.filter(message=message).values_list("user_id", flat=True)
    ]
    if read_positions is None:
        read_positions = services.read_positions(message.conversation_id)
    extras = services.message_extras([message], viewer).get(str(message.id), {})
    return message_data(message, assets=assets, mentions=mentions, read_positions=read_positions, **extras)


def page_data(rows, assets, mentions, positions, viewer) -> list:
    extras = services.message_extras(rows, viewer)
    return [
        message_data(
            message,
            assets=assets.get(str(message.id), []),
            mentions=mentions.get(str(message.id), []),
            read_positions=positions,
            **extras.get(str(message.id), {}),
        )
        for message in rows
    ]


def get_message(user, slug, message_id):
    message = (
        Message.objects.select_related("sender", "reply_to__sender", "conversation")
        .filter(id=message_id, workspace__slug=slug)
        .first()
    )
    if message is None:
        raise services.ChatError(404, "NOT_FOUND", "That message no longer exists.")
    membership = services.get_membership(user, message.conversation_id, slug)
    return message, membership


class ChatMessageListEndpoint(ChatBaseEndpoint):
    def get_throttles(self):
        if self.request.method == "POST":
            return [ChatSendThrottle()]
        return []

    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def get(self, request, slug, conversation_id):
        services.get_membership(request.user, conversation_id, slug)
        before_seq = self.int_param(request.query_params.get("before_seq"), "before_seq", minimum=0)
        after_seq = self.int_param(request.query_params.get("after_seq"), "after_seq", minimum=0)
        around_seq = self.int_param(request.query_params.get("around_seq"), "around_seq", minimum=1)
        if sum(value is not None for value in (before_seq, after_seq, around_seq)) > 1:
            raise services.ChatError(400, "INVALID_PARAM", "Use only one of before_seq, after_seq or around_seq.")
        limit = self.int_param(
            request.query_params.get("limit"), "limit", minimum=1, maximum=MAX_PAGE, default=DEFAULT_PAGE
        )

        rows, has_more, assets, mentions = services.messages_page(
            conversation_id, before_seq=before_seq, after_seq=after_seq, around_seq=around_seq, limit=limit
        )
        positions = services.read_positions(conversation_id)
        data = {
            "results": page_data(rows, assets, mentions, positions, request.user),
            "oldest_seq": rows[0].seq if rows else None,
            "newest_seq": rows[-1].seq if rows else None,
        }
        if around_seq is not None:
            data["has_before"], data["has_after"] = has_more
            data["has_more"] = has_more[0]
        else:
            data["has_more"] = has_more
        return Response(data, status=status.HTTP_200_OK)

    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def post(self, request, slug, conversation_id):
        membership = services.get_membership(request.user, conversation_id, slug)
        payload = self.validated(MessageCreateSerializer(data=request.data))
        result = services.send_message(
            membership,
            request.user,
            body_html=payload.get("body_html", ""),
            body_json=payload.get("body_json"),
            reply_to_id=payload.get("reply_to_id"),
            client_id=payload.get("client_id"),
            attachment_ids=payload.get("attachment_ids") or [],
            max_files=get_chat_config().max_files_per_message,
        )
        message = Message.objects.select_related("sender", "reply_to__sender").get(id=result.message.id)
        data = full_message_data(message, request.user)
        if result.created:
            services.publish_message(ChatEvent.MESSAGE_CREATED, message, data, conversation_id, slug)
        return Response(data, status=status.HTTP_201_CREATED if result.created else status.HTTP_200_OK)


class ChatMessageDetailEndpoint(ChatBaseEndpoint):
    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def get(self, request, slug, message_id):
        """One message, for message links (``?m=<id>``): the client reads ``seq``
        and loads the page around it (phase 2 P2-D7)."""
        message, _ = get_message(request.user, slug, message_id)
        return Response(full_message_data(message, request.user), status=status.HTTP_200_OK)

    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def patch(self, request, slug, message_id):
        message, _ = get_message(request.user, slug, message_id)
        if message.sender_id != request.user.id:
            raise services.ChatError(403, "NOT_SENDER", "You can only edit your own messages.")
        payload = self.validated(MessageUpdateSerializer(data=request.data))
        services.edit_message(message, body_html=payload["body_html"], body_json=payload.get("body_json"))
        message = Message.objects.select_related("sender", "reply_to__sender").get(id=message.id)
        data = full_message_data(message, request.user)
        services.publish_message(ChatEvent.MESSAGE_UPDATED, message, data, message.conversation_id, slug)
        return Response(data, status=status.HTTP_200_OK)

    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def delete(self, request, slug, message_id):
        message, membership = get_message(request.user, slug, message_id)
        is_sender = message.sender_id == request.user.id
        is_group_admin = (
            membership.conversation.type == ConversationType.GROUP and membership.role == ConversationRole.ADMIN
        )
        if not (is_sender or is_group_admin):
            raise services.ChatError(403, "NOT_ALLOWED", "You can only delete your own messages.")
        conversation_id = message.conversation_id
        recipients = services.recipient_ids(conversation_id)
        deleted_id, seq = services.delete_message(message)
        services.publish_on_commit(
            ChatEvent.MESSAGE_DELETED,
            {"conversation_id": str(conversation_id), "id": deleted_id, "seq": seq},
            recipients,
            slug,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class ChatReadEndpoint(ChatBaseEndpoint):
    throttle_classes = [ChatReadThrottle]

    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def post(self, request, slug, conversation_id):
        membership = services.get_membership(request.user, conversation_id, slug)
        seq = self.int_param(request.data.get("seq"), "seq", minimum=0)
        if seq is None:
            raise services.ChatError(400, "INVALID_PARAM", "'seq' is required.")
        before = membership.last_read_seq
        last_read_seq = services.mark_read(membership, seq)
        if last_read_seq != before:
            services.publish(
                ChatEvent.READ_UPDATED,
                {"conversation_id": str(conversation_id), "user_id": str(request.user.id), "seq": last_read_seq},
                conversation_id,
                slug,
            )
        unread = max(0, membership.conversation.last_message_seq - last_read_seq)
        return Response({"last_read_seq": last_read_seq, "unread_count": unread}, status=status.HTTP_200_OK)
