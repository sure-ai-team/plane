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
from django.contrib.postgres.indexes import GinIndex
from django.contrib.postgres.search import SearchVector
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
    PINNED = "pinned", "Pinned"
    UNPINNED = "unpinned", "Unpinned"


class NotifyLevel(models.TextChoices):
    """Per-member notification level (docs/chat/phase-2/DECISIONS.md P2-D4)."""

    ALL = "all", "All messages"
    MENTIONS = "mentions", "Mentions only"
    OFF = "off", "Off"


class MessageLayout(models.TextChoices):
    COMPACT = "compact", "Compact"
    BUBBLES = "bubbles", "Bubbles"


class MinimizeStyle(models.TextChoices):
    DOCKED = "docked", "Docked tabs"
    HEADS = "heads", "Chat heads"


SEARCH_CONFIG = "simple"  # same treatment for Arabic and English text (P2-D3)
MAX_REACTIONS_PER_MESSAGE = 20
MAX_PINS_PER_CONVERSATION = 50
MAX_WORK_ITEM_REFS_PER_MESSAGE = 10


def build_direct_key(user_a_id, user_b_id) -> str:
    """Order-independent key that identifies the direct chat between two users."""
    first, second = sorted([str(user_a_id), str(user_b_id)])
    return f"{first}:{second}"


class Conversation(ChatBaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="chat_conversations")
    type = models.CharField(max_length=10, choices=ConversationType.choices)
    name = models.CharField(max_length=255, blank=True, default="")
    logo_props = models.JSONField(default=dict, blank=True)
    description = models.TextField(blank=True, default="")
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
    notify_level = models.CharField(max_length=10, choices=NotifyLevel.choices, default=NotifyLevel.ALL)
    snoozed_until = models.DateTimeField(null=True, blank=True)
    is_starred = models.BooleanField(default=False)
    archived_at = models.DateTimeField(null=True, blank=True)
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
            models.Index(fields=["member", "workspace", "is_active", "archived_at"], name="chat_member_sidebar"),
        ]

    @property
    def is_muted(self) -> bool:
        """Phase 1 field, kept readable for one release (= notify level "off")."""
        return self.notify_level == NotifyLevel.OFF

    def is_snoozed(self, now=None) -> bool:
        from django.utils import timezone

        return bool(self.snoozed_until and self.snoozed_until > (now or timezone.now()))


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
            GinIndex(SearchVector("body_stripped", config=SEARCH_CONFIG), name="chat_msg_search_idx"),
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


class MessageReaction(ChatBaseModel):
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="reactions")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="chat_reactions")
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="chat_reactions")
    emoji = models.CharField(max_length=32)

    class Meta:
        verbose_name = "Chat Message Reaction"
        verbose_name_plural = "Chat Message Reactions"
        db_table = "chat_message_reactions"
        constraints = [
            models.UniqueConstraint(fields=["message", "user", "emoji"], name="chat_unique_reaction"),
        ]
        indexes = [
            models.Index(fields=["message", "emoji"], name="chat_reaction_msg_emoji"),
        ]


class MessagePin(ChatBaseModel):
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="pins")
    message = models.OneToOneField(Message, on_delete=models.CASCADE, related_name="pin")
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="chat_pins")
    pinned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="chat_pins",
    )

    class Meta:
        verbose_name = "Chat Message Pin"
        verbose_name_plural = "Chat Message Pins"
        db_table = "chat_message_pins"
        indexes = [
            models.Index(fields=["conversation", "-created_at"], name="chat_pin_conv_created"),
        ]


class MessageWorkItem(ChatBaseModel):
    """A work item a message links to (P2-D13), for cards and "Discussed in chat"."""

    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="work_items")
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="work_item_refs")
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="chat_refs")
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="chat_work_item_refs")

    class Meta:
        verbose_name = "Chat Message Work Item"
        verbose_name_plural = "Chat Message Work Items"
        db_table = "chat_message_work_items"
        constraints = [
            models.UniqueConstraint(fields=["message", "issue"], name="chat_unique_work_item_ref"),
        ]
        indexes = [
            models.Index(fields=["issue", "-created_at"], name="chat_work_item_issue_created"),
        ]


class ChatPreference(ChatBaseModel):
    """Per-user, per-workspace chat settings (docs/chat/phase-2/01-data-model.md)."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="chat_preferences")
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="chat_preferences")
    desktop_notifications = models.BooleanField(default=True)
    sound = models.BooleanField(default=True)
    show_preview = models.BooleanField(default=True)
    inbox_mentions = models.BooleanField(default=True)
    message_layout = models.CharField(max_length=10, choices=MessageLayout.choices, default=MessageLayout.BUBBLES)
    bubbles_direct_only = models.BooleanField(default=True)
    minimize_style = models.CharField(max_length=10, choices=MinimizeStyle.choices, default=MinimizeStyle.DOCKED)

    class Meta:
        verbose_name = "Chat Preference"
        verbose_name_plural = "Chat Preferences"
        db_table = "chat_preferences"
        constraints = [
            models.UniqueConstraint(fields=["user", "workspace"], name="chat_unique_preference"),
        ]
