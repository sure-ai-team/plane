# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers.chat import (
    ConversationCreateSerializer,
    conversation_data,
    member_data,
)
from plane.db.models import ConversationType
from plane.utils.chat_events import ChatEvent, publish_on_commit

from . import services
from .base import ChatBaseEndpoint

CHAT_ROLES = [ROLE.ADMIN, ROLE.MEMBER]


def serialize_membership(membership, user):
    conversation_id = str(membership.conversation_id)
    counts = services.member_counts([conversation_id])
    partner = None
    if membership.conversation.type == ConversationType.DIRECT:
        partner = services.direct_partners([conversation_id], user).get(conversation_id)
    return conversation_data(membership, member_count=counts.get(conversation_id, 0), direct_user=partner)


class ChatConversationListEndpoint(ChatBaseEndpoint):
    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        memberships = list(services.user_memberships(request.user, slug, request.query_params.get("type")))
        ids = [str(membership.conversation_id) for membership in memberships]
        counts = services.member_counts(ids)
        direct_ids = [
            str(membership.conversation_id)
            for membership in memberships
            if membership.conversation.type == ConversationType.DIRECT
        ]
        partners = services.direct_partners(direct_ids, request.user) if direct_ids else {}
        data = [
            conversation_data(
                membership,
                member_count=counts.get(str(membership.conversation_id), 0),
                direct_user=partners.get(str(membership.conversation_id)),
            )
            for membership in memberships
        ]
        return Response(data, status=status.HTTP_200_OK)

    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        payload = self.validated(ConversationCreateSerializer(data=request.data))
        workspace = services.get_workspace(slug)

        if payload["type"] == ConversationType.DIRECT:
            if not payload.get("user_id"):
                raise services.ChatError(400, "INVALID_MEMBER", "Choose someone to message.")
            conversation, created = services.get_or_create_direct(workspace, request.user, payload["user_id"])
        else:
            conversation = services.create_group(
                workspace,
                request.user,
                name=payload.get("name"),
                logo_props=payload.get("logo_props"),
                project_id=payload.get("project_id"),
                member_ids=payload.get("member_ids") or [],
            )
            created = True

        membership = services.get_membership(request.user, conversation.id, slug)
        if created:
            services.publish(
                ChatEvent.CONVERSATION_CREATED, {"conversation_id": str(conversation.id)}, conversation.id, slug
            )
        return Response(
            serialize_membership(membership, request.user),
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class ChatConversationDetailEndpoint(ChatBaseEndpoint):
    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def get(self, request, slug, conversation_id):
        membership = services.get_membership(request.user, conversation_id, slug)
        data = serialize_membership(membership, request.user)
        members = services.active_members(conversation_id).select_related("member").order_by("joined_at")[:50]
        data["members"] = [member_data(row) for row in members]
        return Response(data, status=status.HTTP_200_OK)

    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def patch(self, request, slug, conversation_id):
        membership = services.get_membership(request.user, conversation_id, slug)
        allowed = {key: request.data[key] for key in ("name", "logo_props", "project_id") if key in request.data}
        conversation = services.update_group(membership, request.user, data=allowed)
        membership.conversation = conversation
        project = conversation.project
        services.publish(
            ChatEvent.CONVERSATION_UPDATED,
            {
                "conversation_id": str(conversation.id),
                "name": conversation.name,
                "logo_props": conversation.logo_props,
                "project": (
                    {
                        "id": str(project.id),
                        "identifier": project.identifier,
                        "name": project.name,
                        "logo_props": project.logo_props,
                    }
                    if project
                    else None
                ),
            },
            conversation.id,
            slug,
        )
        return Response(serialize_membership(membership, request.user), status=status.HTTP_200_OK)

    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def delete(self, request, slug, conversation_id):
        membership = services.get_membership(request.user, conversation_id, slug)
        if membership.conversation.type == ConversationType.DIRECT:
            raise services.ChatError(400, "CANNOT_DELETE_DIRECT", "Direct chats can't be deleted. Mute it instead.")
        services.require_group_admin(membership)
        recipients = services.recipient_ids(conversation_id)
        services.delete_conversation(membership.conversation)
        publish_on_commit(ChatEvent.CONVERSATION_DELETED, {"conversation_id": str(conversation_id)}, recipients, slug)
        return Response(status=status.HTTP_204_NO_CONTENT)
