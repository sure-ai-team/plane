# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Chat domain logic. Views stay thin and call into these functions.

Access rule (docs/chat/DECISIONS.md D3, D15): a user can use a conversation
only while they are an active ConversationMember **and** an active admin or
member of the conversation's workspace. Workspace membership is checked live
on every query, so removing or deactivating someone in the workspace revokes
chat access immediately without any extra bookkeeping.
"""

# Python imports
from dataclasses import dataclass

# Django imports
from django.db import IntegrityError, transaction
from django.db.models import Count, Exists, F, OuterRef
from django.utils import timezone

# Third party imports
from bs4 import BeautifulSoup

# Module imports
from plane.db.models import (
    Conversation,
    ConversationMember,
    ConversationRole,
    ConversationType,
    FileAsset,
    Message,
    MessageKind,
    MessageMention,
    MessagePin,
    MessageReaction,
    NotifyLevel,
    SystemEvent,
    Workspace,
    WorkspaceMember,
    build_direct_key,
)
from plane.utils.chat_events import publish_on_commit
from plane.utils.chat_work_items import sync_message_work_items, work_item_refs
from plane.utils.chat_media import KIND_AUDIO
from plane.utils.content_validator import validate_html_content
from plane.utils.html_processor import strip_tags

CHAT_WORKSPACE_ROLES = (20, 15)  # admin, member; guests are excluded (D3)
PREVIEW_TEXT_LENGTH = 140
MAX_BODY_HTML_BYTES = 200 * 1024
MAX_DESCRIPTION_LENGTH = 500


class ChatError(Exception):
    """A user-facing error with an HTTP status and a stable error code."""

    def __init__(self, status_code: int, code: str, message: str, **extra):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.extra = extra

    def as_dict(self):
        return {"error": self.message, "code": self.code, **self.extra}


def not_found():
    return ChatError(404, "NOT_FOUND", "The requested conversation could not be found.")


# --------------------------------------------------------------------------- #
# Membership
# --------------------------------------------------------------------------- #


def active_workspace_member_q(workspace_field="workspace_id", member_field="member_id"):
    """Exists() clause: the row's user is an active admin/member of the row's workspace."""
    return Exists(
        WorkspaceMember.objects.filter(
            workspace_id=OuterRef(workspace_field),
            member_id=OuterRef(member_field),
            is_active=True,
            role__in=CHAT_WORKSPACE_ROLES,
        )
    )


def active_members(conversation_id):
    """Conversation members who can currently use the conversation."""
    return ConversationMember.objects.filter(conversation_id=conversation_id, is_active=True).filter(
        active_workspace_member_q()
    )


def recipient_ids(conversation_id) -> list:
    return [str(user_id) for user_id in active_members(conversation_id).values_list("member_id", flat=True)]


def get_workspace(slug) -> Workspace:
    try:
        return Workspace.objects.get(slug=slug)
    except Workspace.DoesNotExist:
        raise ChatError(404, "NOT_FOUND", "Workspace not found.")


def get_membership(user, conversation_id, slug, *, for_update=False) -> ConversationMember:
    """Return the caller's active membership or raise 404 (never 403, to avoid
    revealing that a conversation exists)."""
    queryset = ConversationMember.objects.select_related("conversation", "conversation__workspace")
    if for_update:
        queryset = queryset.select_for_update(of=("self",))
    membership = (
        queryset.filter(
            conversation_id=conversation_id,
            member=user,
            is_active=True,
            conversation__workspace__slug=slug,
        )
        .filter(active_workspace_member_q())
        .first()
    )
    if membership is None:
        raise not_found()
    return membership


def require_group_admin(membership: ConversationMember):
    if membership.conversation.type != ConversationType.GROUP:
        raise ChatError(400, "NOT_GROUP", "This action is only available in groups.")
    if membership.role != ConversationRole.ADMIN:
        raise ChatError(403, "NOT_ADMIN", "Only group admins can do this.")


def validate_workspace_users(workspace_id, user_ids) -> list:
    """Return the ids that are active admins/members of the workspace, raising
    400 if any requested id is not."""
    wanted = {str(user_id) for user_id in user_ids}
    valid = {
        str(user_id)
        for user_id in WorkspaceMember.objects.filter(
            workspace_id=workspace_id,
            member_id__in=wanted,
            is_active=True,
            role__in=CHAT_WORKSPACE_ROLES,
            member__is_active=True,
        ).values_list("member_id", flat=True)
    }
    if wanted - valid:
        raise ChatError(400, "INVALID_MEMBER", "One or more people are not members of this workspace.")
    return sorted(valid)


# --------------------------------------------------------------------------- #
# Content helpers
# --------------------------------------------------------------------------- #


def sanitize_body(body_html):
    """Sanitise message HTML with the same rules as issue comments.
    Returns (clean_html, stripped_text)."""
    body_html = body_html or ""
    if len(body_html.encode("utf-8")) > MAX_BODY_HTML_BYTES:
        raise ChatError(400, "MESSAGE_TOO_LONG", "The message is too long.")
    is_valid, error, clean_html = validate_html_content(body_html)
    if not is_valid:
        raise ChatError(400, "INVALID_BODY", error or "The message could not be processed.")
    clean_html = clean_html or ""
    stripped = " ".join(strip_tags(clean_html).split()) if clean_html else ""
    return clean_html, stripped


def parse_mention_ids(body_html) -> set:
    if not body_html or "mention-component" not in body_html:
        return set()
    soup = BeautifulSoup(body_html, "html.parser")
    tags = soup.find_all("mention-component", attrs={"entity_name": "user_mention"})
    return {str(tag.get("entity_identifier")) for tag in tags if tag.get("entity_identifier")}


def build_preview(message: Message, attachment_kinds=None) -> dict:
    preview = {
        "sender_id": str(message.sender_id) if message.sender_id else None,
        "kind": message.kind,
        "text": (message.body_stripped or "")[:PREVIEW_TEXT_LENGTH],
        "attachment_kinds": list(attachment_kinds or []),
    }
    if message.kind == MessageKind.SYSTEM:
        preview["event"] = message.meta.get("event")
    return preview


# --------------------------------------------------------------------------- #
# Messages
# --------------------------------------------------------------------------- #


def _append_message(conversation_id, attachment_kinds=(), **fields) -> Message:
    """Insert a message with the next sequence number. Must run inside an
    atomic block: the conversation row is locked so numbers never collide."""
    conversation = (
        Conversation.objects.select_for_update(of=("self",)).select_related("workspace").get(id=conversation_id)
    )
    conversation.last_message_seq += 1
    message = Message.objects.create(
        conversation=conversation,
        workspace_id=conversation.workspace_id,
        seq=conversation.last_message_seq,
        **fields,
    )
    conversation.last_message_at = message.created_at
    conversation.last_message_preview = build_preview(message, attachment_kinds)
    conversation.save(update_fields=["last_message_seq", "last_message_at", "last_message_preview", "updated_at"])
    message.workspace_slug = conversation.workspace.slug
    return message


def create_system_message(conversation_id, actor, event: str, **meta) -> Message:
    """Record a system line ("X added Y") and broadcast it like any message."""
    from plane.app.serializers.chat import message_data
    from plane.utils.chat_events import ChatEvent

    message = _append_message(
        conversation_id,
        sender=None,
        kind=MessageKind.SYSTEM,
        meta={"event": event, "actor_id": str(actor.id) if actor else None, **meta},
        created_by=actor,
    )
    publish(ChatEvent.MESSAGE_CREATED, {"message": message_data(message)}, conversation_id, message.workspace_slug)
    return message


@dataclass
class SendResult:
    message: Message
    created: bool


def send_message(
    membership: ConversationMember,
    sender,
    *,
    body_html: str = "",
    body_json=None,
    reply_to_id=None,
    client_id=None,
    attachment_ids=None,
    max_files: int = 10,
    meta=None,
) -> SendResult:
    conversation = membership.conversation
    attachment_ids = [str(asset_id) for asset_id in (attachment_ids or [])]
    if len(set(attachment_ids)) != len(attachment_ids):
        raise ChatError(400, "INVALID_ATTACHMENT", "An attachment was listed twice.")
    if len(attachment_ids) > max_files:
        raise ChatError(400, "TOO_MANY_FILES", f"You can attach up to {max_files} files.", max=max_files)

    # Idempotent retry: the same client_id returns the original message.
    if client_id:
        existing = Message.objects.filter(conversation=conversation, sender=sender, client_id=client_id).first()
        if existing:
            return SendResult(existing, False)

    clean_html, stripped = sanitize_body(body_html)
    if not stripped and not attachment_ids and "mention-component" not in clean_html:
        raise ChatError(400, "EMPTY_MESSAGE", "Write a message or attach a file.")

    if conversation.type == ConversationType.DIRECT:
        other_active = active_members(conversation.id).exclude(member_id=sender.id).exists()
        if not other_active:
            raise ChatError(400, "RECIPIENT_UNAVAILABLE", "This person is no longer available in the workspace.")

    reply_to = None
    if reply_to_id:
        reply_to = Message.objects.filter(id=reply_to_id, conversation=conversation).first()
        if reply_to is None:
            raise ChatError(400, "INVALID_REPLY", "The message you replied to no longer exists.")

    try:
        with transaction.atomic():
            assets = []
            if attachment_ids:
                assets = list(
                    FileAsset.objects.select_for_update().filter(
                        id__in=attachment_ids,
                        entity_type=FileAsset.EntityTypeContext.CHAT_ATTACHMENT,
                        chat_conversation_id=conversation.id,
                        created_by=sender,
                        chat_message__isnull=True,
                        is_uploaded=True,
                    )
                )
                if len(assets) != len(attachment_ids):
                    raise ChatError(400, "INVALID_ATTACHMENT", "One or more attachments are not ready to send.")
                # Keep the order the client sent.
                order = {asset_id: index for index, asset_id in enumerate(attachment_ids)}
                assets.sort(key=lambda asset: order[str(asset.id)])

            kinds = [asset.attributes.get("kind") for asset in assets]
            # A recorded voice note (flagged at upload) sent on its own is a
            # "voice" message; an uploaded audio file is a normal attachment.
            is_voice_note = (
                len(assets) == 1 and not stripped and kinds[0] == KIND_AUDIO and assets[0].attributes.get("is_voice")
            )
            if is_voice_note:
                kind = MessageKind.VOICE
            elif assets:
                kind = MessageKind.ATTACHMENT
            else:
                kind = MessageKind.TEXT

            message = _append_message(
                conversation.id,
                attachment_kinds=kinds,
                sender=sender,
                kind=kind,
                body_html=clean_html,
                body_json=body_json if isinstance(body_json, dict) else {},
                body_stripped=stripped,
                reply_to=reply_to,
                client_id=client_id,
                meta=meta if isinstance(meta, dict) else {},
                created_by=sender,
            )

            if assets:
                FileAsset.objects.filter(id__in=[asset.id for asset in assets]).update(chat_message=message)

            mention_ids = parse_mention_ids(clean_html)
            if mention_ids:
                allowed = set(recipient_ids(conversation.id)) - {str(sender.id)}
                MessageMention.objects.bulk_create(
                    [
                        MessageMention(message=message, user_id=user_id, workspace_id=message.workspace_id)
                        for user_id in sorted(mention_ids & allowed)
                    ],
                    ignore_conflicts=True,
                )

            sync_message_work_items(message, conversation.workspace.slug)
            schedule_inbox_notifications(message.id)

            # The sender has read their own message.
            ConversationMember.objects.filter(id=membership.id, last_read_seq__lt=message.seq).update(
                last_read_seq=message.seq
            )
    except IntegrityError:
        # Lost a race on client_id with a concurrent retry of the same send.
        if client_id:
            existing = Message.objects.filter(conversation=conversation, sender=sender, client_id=client_id).first()
            if existing:
                return SendResult(existing, False)
        raise

    return SendResult(message, True)


def edit_message(message: Message, *, body_html: str, body_json=None) -> Message:
    if message.kind == MessageKind.SYSTEM:
        raise ChatError(400, "CANNOT_EDIT", "System messages can't be edited.")
    clean_html, stripped = sanitize_body(body_html)
    has_assets = message.assets.exists()
    if not stripped and not has_assets and "mention-component" not in clean_html:
        raise ChatError(400, "EMPTY_MESSAGE", "A message can't be empty.")
    with transaction.atomic():
        message.body_html = clean_html
        message.body_json = body_json if isinstance(body_json, dict) else {}
        message.body_stripped = stripped
        message.edited_at = timezone.now()
        if message.kind == MessageKind.VOICE and stripped:
            message.kind = MessageKind.ATTACHMENT
        message.save(update_fields=["body_html", "body_json", "body_stripped", "edited_at", "kind", "updated_at"])

        allowed = set(recipient_ids(message.conversation_id)) - {str(message.sender_id)}
        wanted = parse_mention_ids(clean_html) & allowed
        MessageMention.objects.filter(message=message).exclude(user_id__in=wanted).delete()
        MessageMention.objects.bulk_create(
            [MessageMention(message=message, user_id=user_id, workspace_id=message.workspace_id) for user_id in wanted],
            ignore_conflicts=True,
        )

        conversation = (
            Conversation.objects.select_for_update().select_related("workspace").get(id=message.conversation_id)
        )
        sync_message_work_items(message, conversation.workspace.slug)
        if conversation.last_message_seq == message.seq:
            kinds = list(message.assets.values_list("attributes__kind", flat=True))
            conversation.last_message_preview = build_preview(message, kinds)
            conversation.save(update_fields=["last_message_preview", "updated_at"])
    return message


def collect_object_keys(assets) -> list:
    keys = []
    for asset in assets:
        if asset.asset and asset.asset.name:
            keys.append(asset.asset.name)
        thumb_key = (asset.attributes or {}).get("thumb_key")
        if thumb_key:
            keys.append(thumb_key)
    return keys


def schedule_object_deletion(keys):
    if not keys:
        return
    from plane.bgtasks.chat_cleanup_task import delete_chat_objects

    transaction.on_commit(lambda: delete_chat_objects.delay(list(keys)))


def schedule_inbox_notifications(message_id):
    from plane.bgtasks.chat_inbox_task import chat_inbox_notifications

    transaction.on_commit(lambda: chat_inbox_notifications.delay(str(message_id)))


def delete_message(message: Message):
    """Permanently delete a message and its files (D2)."""
    with transaction.atomic():
        keys = collect_object_keys(FileAsset.objects.filter(chat_message=message))
        conversation = Conversation.objects.select_for_update().get(id=message.conversation_id)
        was_last = conversation.last_message_seq == message.seq
        message_id, seq = str(message.id), message.seq
        from plane.bgtasks.chat_inbox_task import delete_message_notifications

        delete_message_notifications([message.id])
        message.delete()
        if was_last:
            latest = Message.objects.filter(conversation=conversation).order_by("-seq").first()
            if latest:
                kinds = list(latest.assets.values_list("attributes__kind", flat=True))
                conversation.last_message_preview = build_preview(latest, kinds)
                conversation.last_message_at = latest.created_at
            else:
                conversation.last_message_preview = {}
                conversation.last_message_at = None
            conversation.save(update_fields=["last_message_preview", "last_message_at", "updated_at"])
        schedule_object_deletion(keys)
    return message_id, seq


def delete_conversation(conversation: Conversation):
    """Permanently delete a conversation, its messages and its files (D2)."""
    with transaction.atomic():
        keys = collect_object_keys(FileAsset.objects.filter(chat_conversation=conversation))
        from plane.bgtasks.chat_inbox_task import delete_conversation_notifications

        delete_conversation_notifications(conversation.id)
        conversation.delete()
        schedule_object_deletion(keys)


def mark_read(membership: ConversationMember, seq: int) -> int:
    conversation = membership.conversation
    target = max(0, min(int(seq), conversation.last_message_seq))
    updated = ConversationMember.objects.filter(id=membership.id, last_read_seq__lt=target).update(last_read_seq=target)
    if updated:
        membership.last_read_seq = target
        from plane.bgtasks.chat_inbox_task import mark_inbox_read

        mark_inbox_read(membership.member_id, conversation.id, target)
    return membership.last_read_seq


# --------------------------------------------------------------------------- #
# Conversations and members
# --------------------------------------------------------------------------- #


def get_or_create_direct(workspace: Workspace, user, other_user_id):
    if str(other_user_id) == str(user.id):
        raise ChatError(400, "INVALID_MEMBER", "You can't start a direct chat with yourself.")
    validate_workspace_users(workspace.id, [other_user_id])
    key = build_direct_key(user.id, other_user_id)

    with transaction.atomic():
        conversation = Conversation.objects.select_for_update().filter(workspace=workspace, direct_key=key).first()
        created = False
        if conversation is None:
            try:
                with transaction.atomic():
                    conversation = Conversation.objects.create(
                        workspace=workspace,
                        type=ConversationType.DIRECT,
                        direct_key=key,
                        created_by=user,
                    )
                    created = True
            except IntegrityError:
                conversation = Conversation.objects.get(workspace=workspace, direct_key=key)

        for member_id in (user.id, other_user_id):
            membership, made = ConversationMember.objects.get_or_create(
                conversation=conversation,
                member_id=member_id,
                defaults={"workspace": workspace, "role": ConversationRole.ADMIN, "created_by": user},
            )
            if not made and not membership.is_active:
                membership.is_active = True
                membership.left_at = None
                membership.save(update_fields=["is_active", "left_at", "updated_at"])
    return conversation, created


def create_group(workspace: Workspace, user, *, name, logo_props=None, project_id=None, member_ids=()):
    from plane.db.models import Project

    name = (name or "").strip()
    if not name:
        raise ChatError(400, "NAME_REQUIRED", "Give the group a name.")
    if len(name) > 255:
        raise ChatError(400, "NAME_TOO_LONG", "The group name is too long.")
    if project_id and not Project.objects.filter(id=project_id, workspace=workspace, archived_at__isnull=True).exists():
        raise ChatError(400, "PROJECT_NOT_IN_WORKSPACE", "That project is not in this workspace.")
    other_ids = [user_id for user_id in {str(member_id) for member_id in member_ids} if user_id != str(user.id)]
    if other_ids:
        validate_workspace_users(workspace.id, other_ids)

    with transaction.atomic():
        conversation = Conversation.objects.create(
            workspace=workspace,
            type=ConversationType.GROUP,
            name=name,
            logo_props=logo_props if isinstance(logo_props, dict) else {},
            project_id=project_id or None,
            created_by=user,
        )
        rows = [
            ConversationMember(
                conversation=conversation,
                member_id=user.id,
                workspace=workspace,
                role=ConversationRole.ADMIN,
                notify_level=NotifyLevel.MENTIONS,
                created_by=user,
            )
        ] + [
            ConversationMember(
                conversation=conversation,
                member_id=member_id,
                workspace=workspace,
                role=ConversationRole.MEMBER,
                notify_level=NotifyLevel.MENTIONS,
                created_by=user,
            )
            for member_id in other_ids
        ]
        ConversationMember.objects.bulk_create(rows)
        create_system_message(conversation.id, user, SystemEvent.CREATED, name=name)
        # The creator has seen the "created" line.
        ConversationMember.objects.filter(conversation=conversation, member_id=user.id).update(last_read_seq=1)
    conversation.refresh_from_db()
    return conversation


def add_members(membership: ConversationMember, actor, member_ids) -> list:
    conversation = membership.conversation
    require_group_admin(membership)
    ids = validate_workspace_users(conversation.workspace_id, member_ids)
    added = []
    with transaction.atomic():
        for member_id in ids:
            row, made = ConversationMember.objects.get_or_create(
                conversation=conversation,
                member_id=member_id,
                defaults={
                    "workspace_id": conversation.workspace_id,
                    "notify_level": NotifyLevel.MENTIONS,
                    "created_by": actor,
                },
            )
            if made:
                added.append(row)
            elif not row.is_active:
                row.is_active = True
                row.left_at = None
                row.role = ConversationRole.MEMBER
                row.last_read_seq = Conversation.objects.get(id=conversation.id).last_message_seq
                row.save(update_fields=["is_active", "left_at", "role", "last_read_seq", "updated_at"])
                added.append(row)
        for row in added:
            create_system_message(conversation.id, actor, SystemEvent.MEMBER_ADDED, user_id=str(row.member_id))
        # New members start with everything before they joined marked as read.
        current_seq = Conversation.objects.get(id=conversation.id).last_message_seq
        ConversationMember.objects.filter(id__in=[row.id for row in added]).update(last_read_seq=current_seq)
    for row in added:
        row.last_read_seq = current_seq
    return added


def remove_member(membership: ConversationMember, actor, target: ConversationMember) -> dict:
    """Leave (target is the actor) or remove (admin removing someone else)."""
    conversation = membership.conversation
    if conversation.type == ConversationType.DIRECT:
        raise ChatError(400, "CANNOT_LEAVE_DIRECT", "You can't leave a direct chat. Mute it instead.")
    leaving = target.id == membership.id
    if not leaving:
        require_group_admin(membership)

    with transaction.atomic():
        promoted = None
        if target.role == ConversationRole.ADMIN:
            other_admins = (
                active_members(conversation.id).filter(role=ConversationRole.ADMIN).exclude(id=target.id).exists()
            )
            if not other_admins:
                promoted = active_members(conversation.id).exclude(id=target.id).order_by("joined_at").first()
                if promoted:
                    promoted.role = ConversationRole.ADMIN
                    promoted.save(update_fields=["role", "updated_at"])

        target.is_active = False
        target.left_at = timezone.now()
        target.save(update_fields=["is_active", "left_at", "updated_at"])
        from plane.bgtasks.chat_inbox_task import delete_conversation_notifications

        delete_conversation_notifications(conversation.id, user_id=target.member_id, unread_only=True)
        event = SystemEvent.MEMBER_LEFT if leaving else SystemEvent.MEMBER_REMOVED
        create_system_message(conversation.id, actor, event, user_id=str(target.member_id))
    return {"promoted": promoted}


def change_role(membership: ConversationMember, target: ConversationMember, role: int):
    require_group_admin(membership)
    if role not in (ConversationRole.ADMIN, ConversationRole.MEMBER):
        raise ChatError(400, "INVALID_ROLE", "Role must be admin or member.")
    if target.role == ConversationRole.ADMIN and role == ConversationRole.MEMBER:
        other_admins = (
            active_members(target.conversation_id).filter(role=ConversationRole.ADMIN).exclude(id=target.id).exists()
        )
        if not other_admins:
            raise ChatError(400, "LAST_ADMIN", "A group needs at least one admin.")
    target.role = role
    target.save(update_fields=["role", "updated_at"])
    return target


def update_group(membership: ConversationMember, actor, *, data: dict) -> Conversation:
    from plane.db.models import Project

    require_group_admin(membership)
    with transaction.atomic():
        conversation = Conversation.objects.select_for_update().get(id=membership.conversation_id)
        events = []
        if "name" in data:
            name = (data.get("name") or "").strip()
            if not name:
                raise ChatError(400, "NAME_REQUIRED", "Give the group a name.")
            if len(name) > 255:
                raise ChatError(400, "NAME_TOO_LONG", "The group name is too long.")
            if name != conversation.name:
                conversation.name = name
                events.append((SystemEvent.RENAMED, {"name": name}))
        if "logo_props" in data:
            logo_props = data.get("logo_props")
            if not isinstance(logo_props, dict):
                raise ChatError(400, "INVALID_ICON", "Invalid group icon.")
            if logo_props != conversation.logo_props:
                conversation.logo_props = logo_props
                events.append((SystemEvent.ICON_CHANGED, {}))
        if "description" in data:
            description = (data.get("description") or "").strip()
            if len(description) > MAX_DESCRIPTION_LENGTH:
                raise ChatError(400, "DESCRIPTION_TOO_LONG", "The description is too long.")
            conversation.description = description
        if "project_id" in data:
            project_id = data.get("project_id") or None
            if (
                project_id
                and not Project.objects.filter(
                    id=project_id, workspace_id=conversation.workspace_id, archived_at__isnull=True
                ).exists()
            ):
                raise ChatError(400, "PROJECT_NOT_IN_WORKSPACE", "That project is not in this workspace.")
            if str(project_id or "") != str(conversation.project_id or ""):
                conversation.project_id = project_id
                if project_id:
                    events.append((SystemEvent.PROJECT_LINKED, {"project_id": str(project_id)}))
        conversation.save(update_fields=["name", "description", "logo_props", "project_id", "updated_at"])
        for event, meta in events:
            create_system_message(conversation.id, actor, event, **meta)
    conversation.refresh_from_db()
    return conversation


# --------------------------------------------------------------------------- #
# Read models
# --------------------------------------------------------------------------- #


def member_counts(conversation_ids) -> dict:
    rows = (
        ConversationMember.objects.filter(conversation_id__in=conversation_ids, is_active=True)
        .filter(active_workspace_member_q())
        .values("conversation_id")
        .annotate(total=Count("id"))
    )
    return {str(row["conversation_id"]): row["total"] for row in rows}


def direct_partners(conversation_ids, user) -> dict:
    rows = (
        ConversationMember.objects.filter(conversation_id__in=conversation_ids)
        .exclude(member_id=user.id)
        .select_related("member")
    )
    return {str(row.conversation_id): row.member for row in rows}


def user_memberships(user, slug, conversation_type=None, archived=None):
    """The caller's active memberships. ``archived``: None = all, False = not
    archived (the sidebar), True = archived only."""
    queryset = (
        ConversationMember.objects.filter(member=user, is_active=True, conversation__workspace__slug=slug)
        .filter(active_workspace_member_q())
        .select_related("conversation", "conversation__project", "conversation__workspace")
    )
    if conversation_type in (ConversationType.DIRECT, ConversationType.GROUP):
        queryset = queryset.filter(conversation__type=conversation_type)
    if archived is True:
        queryset = queryset.filter(archived_at__isnull=False)
    elif archived is False:
        queryset = queryset.filter(archived_at__isnull=True)
    return queryset.order_by("-conversation__last_message_at", "-conversation__created_at")[:500]


def unread_mention_counts(user, conversation_ids) -> dict:
    """Unread messages that mention ``user``, per conversation."""
    if not conversation_ids:
        return {}
    rows = (
        MessageMention.objects.filter(
            user=user,
            message__conversation_id__in=conversation_ids,
            message__conversation__members__member=user,
            message__conversation__members__is_active=True,
            message__seq__gt=F("message__conversation__members__last_read_seq"),
        )
        .values("message__conversation_id")
        .annotate(total=Count("id"))
    )
    return {str(row["message__conversation_id"]): row["total"] for row in rows}


def unread_counts(user, slug) -> dict:
    """``total`` drives the app badge and tab title: it leaves out archived
    conversations and ones set to "off" (05-notifications.md)."""
    total = 0
    archived_total = 0
    by_conversation = {}
    memberships = list(user_memberships(user, slug))
    for membership in memberships:
        unread = max(0, membership.conversation.last_message_seq - membership.last_read_seq)
        by_conversation[str(membership.conversation_id)] = unread
        if membership.archived_at:
            archived_total += unread
        elif membership.notify_level != NotifyLevel.OFF:
            total += unread
    mentions = unread_mention_counts(user, list(by_conversation))
    return {
        "total": total,
        "archived_total": archived_total,
        "by_conversation": by_conversation,
        "mentions_by_conversation": mentions,
        "mentions_total": sum(mentions.values()),
    }


def read_positions(conversation_id) -> list:
    """(member_id, last_read_seq) for active members, used for "Seen by" counts."""
    return [
        (str(member_id), seq)
        for member_id, seq in active_members(conversation_id).values_list("member_id", "last_read_seq")
    ]


def messages_page(conversation_id, *, before_seq=None, after_seq=None, around_seq=None, limit=50):
    """One page of messages plus attachments and mentions. With ``around_seq``
    the page is centred on that message and ``has_more`` is ``(has_before, has_after)``."""
    queryset = Message.objects.filter(conversation_id=conversation_id).select_related("sender", "reply_to__sender")
    if around_seq is not None:
        before_count = limit // 2
        older = list(queryset.filter(seq__lt=around_seq).order_by("-seq")[: before_count + 1])
        has_before = len(older) > before_count
        newer = list(queryset.filter(seq__gte=around_seq).order_by("seq")[: limit - before_count + 1])
        has_after = len(newer) > limit - before_count
        rows = list(reversed(older[:before_count])) + newer[: limit - before_count]
        has_more = (has_before, has_after)
    elif after_seq is not None:
        rows = list(queryset.filter(seq__gt=after_seq).order_by("seq")[: limit + 1])
        has_more = len(rows) > limit
        rows = rows[:limit]
    else:
        if before_seq is not None:
            queryset = queryset.filter(seq__lt=before_seq)
        rows = list(queryset.order_by("-seq")[: limit + 1])
        has_more = len(rows) > limit
        rows = list(reversed(rows[:limit]))
    message_ids = [message.id for message in rows]
    assets = {}
    for asset in (
        FileAsset.objects.filter(chat_message_id__in=message_ids).select_related("workspace").order_by("created_at")
    ):
        assets.setdefault(str(asset.chat_message_id), []).append(asset)
    mentions = {}
    for message_id, user_id in MessageMention.objects.filter(message_id__in=message_ids).values_list(
        "message_id", "user_id"
    ):
        mentions.setdefault(str(message_id), []).append(str(user_id))
    return rows, has_more, assets, mentions


def reaction_summaries(message_ids, viewer_id) -> dict:
    """``{message_id: [{"emoji", "count", "reacted", "user_ids"}]}`` in order of the
    first reaction with each emoji; ``user_ids`` lists up to 10 people."""
    summaries = {}
    viewer = str(viewer_id) if viewer_id else None
    rows = (
        MessageReaction.objects.filter(message_id__in=message_ids)
        .order_by("created_at")
        .values_list("message_id", "emoji", "user_id")
    )
    for message_id, emoji, user_id in rows:
        per_message = summaries.setdefault(str(message_id), {})
        entry = per_message.setdefault(emoji, {"emoji": emoji, "count": 0, "reacted": False, "user_ids": []})
        entry["count"] += 1
        if str(user_id) == viewer:
            entry["reacted"] = True
        if len(entry["user_ids"]) < 10:
            entry["user_ids"].append(str(user_id))
    return {message_id: list(entries.values()) for message_id, entries in summaries.items()}


def forward_sources(messages, viewer) -> tuple:
    """Source conversations of forwarded messages that ``viewer`` belongs to,
    and their names (P2-D6)."""
    source_ids = {
        (message.meta or {}).get("forwarded_from", {}).get("conversation_id")
        for message in messages
        if (message.meta or {}).get("forwarded_from")
    } - {None}
    if not source_ids or viewer is None:
        return set(), {}
    rows = (
        active_members_for_user(viewer)
        .filter(conversation_id__in=source_ids)
        .values_list("conversation_id", "conversation__name", "conversation__type")
    )
    visible, names = set(), {}
    for conversation_id, name, conversation_type in rows:
        visible.add(str(conversation_id))
        names[str(conversation_id)] = name if conversation_type == ConversationType.GROUP else ""
    return visible, names


def active_members_for_user(user):
    return ConversationMember.objects.filter(member=user, is_active=True).filter(active_workspace_member_q())


def message_extras(messages, viewer) -> dict:
    """Per-message keyword arguments for ``message_data``: reactions, pin state,
    work-item refs and the viewer's view of the forward source."""
    from plane.app.serializers.chat import forwarded_data

    message_ids = [message.id for message in messages]
    if not message_ids:
        return {}
    reactions = reaction_summaries(message_ids, getattr(viewer, "id", None))
    pinned = {
        str(message_id)
        for message_id in MessagePin.objects.filter(message_id__in=message_ids).values_list("message_id", flat=True)
    }
    refs = work_item_refs(message_ids)
    visible, names = forward_sources(messages, viewer)
    extras = {}
    for message in messages:
        key = str(message.id)
        extras[key] = {
            "reactions": reactions.get(key, []),
            "is_pinned": key in pinned,
            "work_items": refs.get(key, []),
            "forwarded_from": forwarded_data(message, viewer_source_ids=visible, source_names=names),
        }
    return extras


def publish_message(event: str, message: Message, data: dict, conversation_id, slug):
    """Publish a message event. A forwarded message names its source conversation
    only for recipients who are members of it, so those get their own payload."""
    # "reacted" in a reaction summary is per viewer, so socket payloads leave
    # reactions out; clients keep theirs and apply reaction.updated events.
    data = {key: value for key, value in data.items() if key != "reactions"}
    source_id = ((message.meta or {}).get("forwarded_from") or {}).get("conversation_id")
    recipients = set(recipient_ids(conversation_id))
    if not source_id:
        publish_on_commit(event, {"message": data}, recipients, slug)
        return
    from plane.app.serializers.chat import forwarded_data

    insiders = recipients & set(recipient_ids(source_id))
    outsiders = recipients - insiders
    if outsiders:
        plain = {**data, "forwarded_from": forwarded_data(message)}
        publish_on_commit(event, {"message": plain}, outsiders, slug)
    if insiders:
        source = Conversation.objects.filter(id=source_id).values_list("name", "type").first()
        name = source[0] if source and source[1] == ConversationType.GROUP else ""
        full = {
            **data,
            "forwarded_from": forwarded_data(message, viewer_source_ids={source_id}, source_names={source_id: name}),
        }
        publish_on_commit(event, {"message": full}, insiders, slug)


def publish(event: str, data: dict, conversation_id, slug, extra_recipients=()):
    recipients = set(recipient_ids(conversation_id)) | {str(user_id) for user_id in extra_recipients}
    publish_on_commit(event, data, recipients, slug)
