# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import hmac

# Django imports
from django.conf import settings

# Third party imports
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.db.models import Conversation, WorkspaceMember
from plane.utils.chat_config import get_chat_config
from plane.utils.chat_events import online_user_ids

from . import services
from .base import ChatBaseEndpoint

CHAT_ROLES = [ROLE.ADMIN, ROLE.MEMBER]


class ChatUnreadCountEndpoint(ChatBaseEndpoint):
    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        return Response(services.unread_counts(request.user, slug), status=status.HTTP_200_OK)


class ChatPresenceEndpoint(ChatBaseEndpoint):
    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        member_ids = WorkspaceMember.objects.filter(
            workspace__slug=slug, is_active=True, role__in=services.CHAT_WORKSPACE_ROLES
        ).values_list("member_id", flat=True)
        return Response({"online_user_ids": online_user_ids(member_ids)}, status=status.HTTP_200_OK)


class ChatConfigEndpoint(ChatBaseEndpoint):
    """Limits the web client uses to reject oversized files before uploading."""

    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        return Response(get_chat_config().as_public_dict(), status=status.HTTP_200_OK)


class LiveSecretMixin:
    """Internal endpoints called only by the live server with X-Live-Secret.
    They return ids and booleans, never message content (07-security.md S10)."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = []

    def check_live_secret(self, request):
        expected = settings.LIVE_SERVER_SECRET_KEY or ""
        provided = request.headers.get("X-Live-Secret", "")
        if not expected or not hmac.compare_digest(expected.encode(), provided.encode()):
            raise services.ChatError(403, "FORBIDDEN", "Forbidden.")


class ChatLiveMemberIdsEndpoint(LiveSecretMixin, ChatBaseEndpoint):
    """GET chat/live/conversations/<id>/member-ids/ -> recipients for typing fan-out."""

    def get(self, request, slug, conversation_id):
        self.check_live_secret(request)
        if not Conversation.objects.filter(id=conversation_id, workspace__slug=slug).exists():
            raise services.not_found()
        return Response({"member_ids": services.recipient_ids(conversation_id)}, status=status.HTTP_200_OK)


class ChatLiveAccessEndpoint(LiveSecretMixin, ChatBaseEndpoint):
    """GET chat/live/users/<user_id>/access/ -> may this user open a chat socket
    for this workspace? Checked on connect and periodically by the live server."""

    def get(self, request, slug, user_id):
        self.check_live_secret(request)
        allowed = WorkspaceMember.objects.filter(
            workspace__slug=slug,
            member_id=user_id,
            member__is_active=True,
            is_active=True,
            role__in=services.CHAT_WORKSPACE_ROLES,
        ).exists()
        return Response({"allowed": allowed}, status=status.HTTP_200_OK)
