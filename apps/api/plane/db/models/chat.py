# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace chat models.

Chat rows are hard-deleted (docs/chat/DECISIONS.md D2), so these models do not
inherit ``BaseModel``: that pulls in ``SoftDeleteModel`` and turns ``delete()``
into a soft delete. ``ChatBaseModel`` keeps the UUID primary key and the
time/user audit columns only.
"""

# Python imports
import uuid

# Django imports
from django.conf import settings
from django.db import models
from django.db.models import Q

# Module imports
from ..mixins import TimeAuditModel, UserAuditModel


class ChatBaseModel(TimeAuditModel, UserAuditModel):
    id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True)

    class Meta:
        abstract = True

    def __str__(self):
        return str(self.id)


class ConversationType(models.TextChoices):
    DIRECT = "direct", "Direct"
    GROUP = "group", "Group"


class ConversationRole(models.IntegerChoices):
    ADMIN = 20, "Admin"
    MEMBER = 15, "Member"


class MessageKind(models.TextChoices):
    TEXT = "text", "Text"
    SYSTEM = "system", "System"
    ATTACHMENT = "attachment", "Attachment"
    VOICE = "voice", "Voice"


class SystemEvent(models.TextChoices):
    CREATED = "created", "Created"
    MEMBER_ADDED = "member_added", "Member added"
    MEMBER_REMOVED = "member_removed", "Member removed"
    MEMBER_LEFT = "member_left", "Member left"
    RENAMED = "renamed", "Renamed"
    ICON_CHANGED = "icon_changed", "Icon changed"
    PROJECT_LINKED = "project_linked", "Project linked"


def build_direct_key(user_a_id, user_b_id) -> str:
    """Order-independent key that identifies the direct chat between two users."""
    first, second = sorted([str(user_a_id), str(user_b_id)])
    return f"{first}:{second}"


class Conversation(ChatBaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="chat_conversations")
    type = models.CharField(max_length=10, choices=ConversationType.choices)
    name = models.CharField(max_length=255, blank=True, default="")
    logo_props = models.JSONField(default=dict, blank=True)
    project = models.ForeignKey(
        "db.Project",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="chat_conversations",
    )
    direct_key = models.CharField(max_length=80, null=True, blank=True, db_index=True)
    last_message_seq = models.PositiveBigIntegerField(default=0)
    last_message_at = models.DateTimeField(null=True, blank=True, db_index=True)
    # {"sender_id", "kind", "event", "attachment_kinds": [...], "text"}; the client
    # renders it in the viewer's language ("Photo", "Voice note", ...).
    last_message_preview = models.JSONField(default=dict, blank=True)

    class Meta:
        verbose_name = "Chat Conversation"
        verbose_name_plural = "Chat Conversations"
        db_table = "chat_conversations"
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "direct_key"],
                condition=Q(direct_key__isnull=False),
                name="chat_unique_direct_per_workspace",
            ),
            models.CheckConstraint(
                condition=Q(type=ConversationType.DIRECT, direct_key__isnull=False)
                | Q(type=ConversationType.GROUP, direct_key__isnull=True),
                name="chat_direct_key_matches_type",
            ),
        ]
        indexes = [
            models.Index(fields=["workspace", "-last_message_at"], name="chat_conv_ws_last_msg"),
        ]

    @property
    def is_direct(self) -> bool:
        return self.type == ConversationType.DIRECT


class ConversationMember(ChatBaseModel):
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="members")
    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="chat_memberships")
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="chat_memberships")
    role = models.PositiveSmallIntegerField(choices=ConversationRole.choices, default=ConversationRole.MEMBER)
    last_read_seq = models.PositiveBigIntegerField(default=0)
    is_muted = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    joined_at = models.DateTimeField(auto_now_add=True)
    left_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Chat Conversation Member"
        verbose_name_plural = "Chat Conversation Members"
        db_table = "chat_conversation_members"
        constraints = [
            models.UniqueConstraint(fields=["conversation", "member"], name="chat_unique_member_per_conversation"),
        ]
        indexes = [
            models.Index(fields=["member", "is_active"], name="chat_member_active"),
            models.Index(fields=["workspace", "member", "is_active"], name="chat_member_ws_active"),
        ]


class Message(ChatBaseModel):
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="messages")
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="chat_messages")
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="chat_messages",
    )
    seq = models.PositiveBigIntegerField()
    kind = models.CharField(max_length=16, choices=MessageKind.choices, default=MessageKind.TEXT)
    body_html = models.TextField(blank=True, default="")
    body_json = models.JSONField(default=dict, blank=True)
    body_stripped = models.TextField(blank=True, default="")
    reply_to = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="replies",
    )
    client_id = models.UUIDField(null=True, blank=True)
    meta = models.JSONField(default=dict, blank=True)
    edited_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Chat Message"
        verbose_name_plural = "Chat Messages"
        db_table = "chat_messages"
        ordering = ["seq"]
        constraints = [
            models.UniqueConstraint(fields=["conversation", "seq"], name="chat_unique_seq_per_conversation"),
            models.UniqueConstraint(
                fields=["conversation", "sender", "client_id"],
                condition=Q(client_id__isnull=False),
                name="chat_unique_client_id",
            ),
        ]
        indexes = [
            models.Index(fields=["conversation", "-seq"], name="chat_msg_conv_seq_desc"),
        ]


class MessageMention(ChatBaseModel):
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="mentions")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="chat_mentions")
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="chat_mentions")

    class Meta:
        verbose_name = "Chat Message Mention"
        verbose_name_plural = "Chat Message Mentions"
        db_table = "chat_message_mentions"
        constraints = [
            models.UniqueConstraint(fields=["message", "user"], name="chat_unique_mention_per_message"),
        ]
        indexes = [
            models.Index(fields=["user", "-created_at"], name="chat_mention_user_created"),
        ]
