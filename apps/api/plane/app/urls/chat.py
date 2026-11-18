# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views.chat import (
    ChatAttachmentEndpoint,
    ChatAttachmentRequestEndpoint,
    ChatAttachmentThumbnailEndpoint,
    ChatConfigEndpoint,
    ChatConversationDetailEndpoint,
    ChatConversationListEndpoint,
    ChatForwardEndpoint,
    ChatLiveAccessEndpoint,
    ChatLiveMemberIdsEndpoint,
    ChatMemberDetailEndpoint,
    ChatMemberListEndpoint,
    ChatMembershipSettingsEndpoint,
    ChatMessageDetailEndpoint,
    ChatMessageListEndpoint,
    ChatPinEndpoint,
    ChatPinListEndpoint,
    ChatPreferenceEndpoint,
    ChatPresenceEndpoint,
    ChatReactionDetailEndpoint,
    ChatReactionListEndpoint,
    ChatReadEndpoint,
    ChatSearchEndpoint,
    ChatUnreadCountEndpoint,
    ChatWorkItemReferencesEndpoint,
)

PREFIX = "workspaces/<str:slug>/chat"

urlpatterns = [
    path(f"{PREFIX}/conversations/", ChatConversationListEndpoint.as_view(), name="chat-conversations"),
    path(
        f"{PREFIX}/conversations/<uuid:conversation_id>/",
        ChatConversationDetailEndpoint.as_view(),
        name="chat-conversation-detail",
    ),
    path(
        f"{PREFIX}/conversations/<uuid:conversation_id>/members/",
        ChatMemberListEndpoint.as_view(),
        name="chat-members",
    ),
    path(
        f"{PREFIX}/conversations/<uuid:conversation_id>/members/<uuid:member_id>/",
        ChatMemberDetailEndpoint.as_view(),
        name="chat-member-detail",
    ),
    path(
        f"{PREFIX}/conversations/<uuid:conversation_id>/messages/",
        ChatMessageListEndpoint.as_view(),
        name="chat-messages",
    ),
    path(
        f"{PREFIX}/conversations/<uuid:conversation_id>/read/",
        ChatReadEndpoint.as_view(),
        name="chat-read",
    ),
    path(
        f"{PREFIX}/conversations/<uuid:conversation_id>/attachments/",
        ChatAttachmentRequestEndpoint.as_view(),
        name="chat-attachment-request",
    ),
    path(
        f"{PREFIX}/conversations/<uuid:conversation_id>/attachments/<uuid:asset_id>/thumbnail/",
        ChatAttachmentThumbnailEndpoint.as_view(),
        name="chat-attachment-thumbnail",
    ),
    path(f"{PREFIX}/messages/<uuid:message_id>/", ChatMessageDetailEndpoint.as_view(), name="chat-message-detail"),
    path(f"{PREFIX}/attachments/<uuid:asset_id>/", ChatAttachmentEndpoint.as_view(), name="chat-attachment"),
    path(f"{PREFIX}/unread-count/", ChatUnreadCountEndpoint.as_view(), name="chat-unread-count"),
    path(f"{PREFIX}/presence/", ChatPresenceEndpoint.as_view(), name="chat-presence"),
    path(f"{PREFIX}/config/", ChatConfigEndpoint.as_view(), name="chat-config"),
    # Phase 2 (docs/chat/phase-2/02-api-contracts.md)
    path(
        f"{PREFIX}/conversations/<uuid:conversation_id>/me/",
        ChatMembershipSettingsEndpoint.as_view(),
        name="chat-membership-settings",
    ),
    path(f"{PREFIX}/conversations/<uuid:conversation_id>/pins/", ChatPinListEndpoint.as_view(), name="chat-pins"),
    path(f"{PREFIX}/messages/<uuid:message_id>/pin/", ChatPinEndpoint.as_view(), name="chat-message-pin"),
    path(
        f"{PREFIX}/messages/<uuid:message_id>/reactions/",
        ChatReactionListEndpoint.as_view(),
        name="chat-message-reactions",
    ),
    path(
        f"{PREFIX}/messages/<uuid:message_id>/reactions/<str:emoji>/",
        ChatReactionDetailEndpoint.as_view(),
        name="chat-message-reaction-detail",
    ),
    path(f"{PREFIX}/messages/<uuid:message_id>/forward/", ChatForwardEndpoint.as_view(), name="chat-message-forward"),
    path(f"{PREFIX}/preferences/", ChatPreferenceEndpoint.as_view(), name="chat-preferences"),
    path(f"{PREFIX}/search/", ChatSearchEndpoint.as_view(), name="chat-search"),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/chat-references/",
        ChatWorkItemReferencesEndpoint.as_view(),
        name="chat-work-item-references",
    ),
    # Internal: called by the live server with X-Live-Secret.
    path(
        f"{PREFIX}/live/conversations/<uuid:conversation_id>/member-ids/",
        ChatLiveMemberIdsEndpoint.as_view(),
        name="chat-live-member-ids",
    ),
    path(
        f"{PREFIX}/live/users/<uuid:user_id>/access/",
        ChatLiveAccessEndpoint.as_view(),
        name="chat-live-access",
    ),
]
