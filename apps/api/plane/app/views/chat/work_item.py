# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The "Discussed in chat" list on a work item (docs/chat/phase-2/02-api-contracts.md).

Lists conversations that link to the work item, only those the caller is an
active member of (07-security.md P2-S5), and only if the caller can see the
work item's project.
"""

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers.chat import user_lite
from plane.db.models import Issue, MessageWorkItem, ProjectMember

from . import services
from .base import ChatBaseEndpoint
from .search import conversation_summary

CHAT_ROLES = [ROLE.ADMIN, ROLE.MEMBER]
SNIPPET_LENGTH = 160


class ChatWorkItemReferencesEndpoint(ChatBaseEndpoint):
    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def get(self, request, slug, project_id, issue_id):
        can_view_project = ProjectMember.objects.filter(
            project_id=project_id, member=request.user, is_active=True, workspace__slug=slug
        ).exists()
        issue_exists = Issue.objects.filter(id=issue_id, project_id=project_id, workspace__slug=slug).exists()
        if not (can_view_project and issue_exists):
            raise services.ChatError(404, "NOT_FOUND", "That work item could not be found.")

        memberships = {str(m.conversation_id): m for m in services.user_memberships(request.user, slug)}
        refs = (
            MessageWorkItem.objects.filter(issue_id=issue_id, conversation_id__in=list(memberships))
            .select_related("message__sender")
            .order_by("-created_at")
        )
        grouped = {}
        for ref in refs:
            key = str(ref.conversation_id)
            entry = grouped.get(key)
            if entry is None:
                message = ref.message
                grouped[key] = {
                    "conversation_id": key,
                    "count": 1,
                    "latest": {
                        "message_id": str(message.id),
                        "seq": message.seq,
                        "sender": user_lite(message.sender),
                        "created_at": message.created_at,
                        "snippet": (message.body_stripped or "")[:SNIPPET_LENGTH],
                    },
                }
            else:
                entry["count"] += 1

        direct_ids = [cid for cid in grouped if memberships[cid].conversation.is_direct]
        partners = services.direct_partners(direct_ids, request.user) if direct_ids else {}
        results = []
        for cid, entry in grouped.items():
            entry["conversation"] = conversation_summary(memberships[cid], partners.get(cid))
            results.append(entry)
        return Response(results, status=status.HTTP_200_OK)
