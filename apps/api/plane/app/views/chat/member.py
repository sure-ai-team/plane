# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers.chat import member_data
from plane.db.models import ConversationMember, ConversationRole
from plane.utils.chat_events import ChatEvent, publish_on_commit

from . import services
from .base import ChatBaseEndpoint

CHAT_ROLES = [ROLE.ADMIN, ROLE.MEMBER]


def get_target(conversation_id, member_id) -> ConversationMember:
    """``member_id`` in the URL is the member's *user* id."""
    target = (
        ConversationMember.objects.select_related("member", "conversation")
        .filter(conversation_id=conversation_id, member_id=member_id, is_active=True)
        .first()
    )
    if target is None:
        raise services.ChatError(404, "NOT_FOUND", "That person is not in this conversation.")
    return target


class ChatMemberListEndpoint(ChatBaseEndpoint):
    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def get(self, request, slug, conversation_id):
        membership = services.get_membership(request.user, conversation_id, slug)
        include_inactive = (
            request.query_params.get("include_inactive") in ("1", "true") and membership.role == ConversationRole.ADMIN
        )
        if include_inactive:
            rows = ConversationMember.objects.filter(conversation_id=conversation_id)
        else:
            rows = services.active_members(conversation_id)
        rows = rows.select_related("member").order_by("joined_at")
        return Response([member_data(row) for row in rows], status=status.HTTP_200_OK)

    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def post(self, request, slug, conversation_id):
        membership = services.get_membership(request.user, conversation_id, slug)
        member_ids = request.data.get("member_ids")
        if not isinstance(member_ids, list) or not member_ids or len(member_ids) > 500:
            raise services.ChatError(400, "INVALID_MEMBER", "Choose who to add.")
        added = services.add_members(membership, request.user, member_ids)
        rows = ConversationMember.objects.filter(id__in=[row.id for row in added]).select_related("member")
        data = [member_data(row) for row in rows]
        for row in data:
            services.publish(
                ChatEvent.MEMBER_ADDED, {"conversation_id": str(conversation_id), "member": row}, conversation_id, slug
            )
        new_user_ids = [row["member"]["id"] for row in data]
        publish_on_commit(ChatEvent.CONVERSATION_CREATED, {"conversation_id": str(conversation_id)}, new_user_ids, slug)
        return Response(data, status=status.HTTP_201_CREATED)


class ChatMemberDetailEndpoint(ChatBaseEndpoint):
    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def patch(self, request, slug, conversation_id, member_id):
        membership = services.get_membership(request.user, conversation_id, slug)
        target = get_target(conversation_id, member_id)
        is_self = target.id == membership.id

        if "is_muted" in request.data:
            if not is_self:
                raise services.ChatError(403, "NOT_ALLOWED", "You can only mute a conversation for yourself.")
            target.is_muted = bool(request.data.get("is_muted"))
            target.save(update_fields=["is_muted", "updated_at"])
            publish_on_commit(
                ChatEvent.MEMBER_UPDATED,
                {"conversation_id": str(conversation_id), "member": member_data(target)},
                [request.user.id],
                slug,
            )

        if "role" in request.data:
            try:
                role = int(request.data.get("role"))
            except (TypeError, ValueError):
                raise services.ChatError(400, "INVALID_ROLE", "Role must be admin or member.")
            target = services.change_role(membership, target, role)
            services.publish(
                ChatEvent.MEMBER_UPDATED,
                {"conversation_id": str(conversation_id), "member": member_data(target)},
                conversation_id,
                slug,
            )

        return Response(member_data(target), status=status.HTTP_200_OK)

    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def delete(self, request, slug, conversation_id, member_id):
        membership = services.get_membership(request.user, conversation_id, slug)
        target = get_target(conversation_id, member_id)
        recipients = services.recipient_ids(conversation_id)
        result = services.remove_member(membership, request.user, target)
        publish_on_commit(
            ChatEvent.MEMBER_REMOVED,
            {"conversation_id": str(conversation_id), "user_id": str(target.member_id)},
            recipients,
            slug,
        )
        promoted = result.get("promoted")
        if promoted:
            promoted.refresh_from_db()
            services.publish(
                ChatEvent.MEMBER_UPDATED,
                {"conversation_id": str(conversation_id), "member": member_data(promoted)},
                conversation_id,
                slug,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)
