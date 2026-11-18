# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Personal chat settings (docs/chat/phase-2/02-api-contracts.md).

* ``PATCH conversations/<id>/me/``: notification level, snooze, star, archive
  for one conversation. Only the caller's own row; synced to their other tabs.
* ``GET/PATCH preferences/``: workspace-wide chat preferences (notifications,
  message layout, minimize style).
"""

# Django imports
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers.chat import (
    MemberSettingsSerializer,
    PreferenceSerializer,
    member_settings_data,
    preference_data,
)
from plane.db.models import ChatPreference
from plane.utils.chat_events import ChatEvent, publish_on_commit

from . import services
from .base import ChatBaseEndpoint

CHAT_ROLES = [ROLE.ADMIN, ROLE.MEMBER]


def get_preference(user, slug) -> ChatPreference:
    workspace = services.get_workspace(slug)
    preference, _ = ChatPreference.objects.get_or_create(user=user, workspace=workspace, defaults={"created_by": user})
    return preference


class ChatMembershipSettingsEndpoint(ChatBaseEndpoint):
    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def patch(self, request, slug, conversation_id):
        membership = services.get_membership(request.user, conversation_id, slug)
        payload = self.validated(MemberSettingsSerializer(data=request.data))
        fields = []
        if "notify_level" in payload:
            membership.notify_level = payload["notify_level"]
            fields.append("notify_level")
        if "snoozed_until" in payload:
            membership.snoozed_until = payload["snoozed_until"]
            fields.append("snoozed_until")
        if "is_starred" in payload:
            membership.is_starred = payload["is_starred"]
            fields.append("is_starred")
        if "archived" in payload:
            if payload["archived"] and membership.archived_at is None:
                membership.archived_at = timezone.now()
            elif not payload["archived"]:
                membership.archived_at = None
            fields.append("archived_at")
        if fields:
            membership.save(update_fields=[*fields, "updated_at"])
        data = {"conversation_id": str(conversation_id), **member_settings_data(membership)}
        if fields:
            publish_on_commit(ChatEvent.MEMBERSHIP_UPDATED, data, [request.user.id], slug)
        return Response(data, status=status.HTTP_200_OK)


class ChatPreferenceEndpoint(ChatBaseEndpoint):
    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        return Response(preference_data(get_preference(request.user, slug)), status=status.HTTP_200_OK)

    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def patch(self, request, slug):
        preference = get_preference(request.user, slug)
        payload = self.validated(PreferenceSerializer(data=request.data))
        for field, value in payload.items():
            setattr(preference, field, value)
        if payload:
            preference.save(update_fields=[*payload.keys(), "updated_at"])
            publish_on_commit(ChatEvent.PREFERENCES_UPDATED, preference_data(preference), [request.user.id], slug)
        return Response(preference_data(preference), status=status.HTTP_200_OK)
