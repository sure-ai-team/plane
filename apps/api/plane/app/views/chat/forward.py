# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Forward a message to other conversations (docs/chat/phase-2/DECISIONS.md P2-D6).

Each target gets a new message with the same body. Attachments are copied to new
storage objects owned by the target conversation, so deleting one copy never
affects another (hard delete, D2). The forward source (original sender and
conversation) is stored in ``meta.forwarded_from``; the conversation is only
shown to viewers who are members of it.
"""

# Python imports
import uuid

# Django imports
from django.db import transaction

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers.chat import ForwardSerializer
from plane.db.models import FileAsset, Message, MessageKind
from plane.throttles.chat import ChatSendThrottle
from plane.utils.chat_config import get_chat_config
from plane.utils.chat_events import ChatEvent

from . import attachment as attachment_views
from . import services
from .base import ChatBaseEndpoint
from .message import full_message_data, get_message

CHAT_ROLES = [ROLE.ADMIN, ROLE.MEMBER]
MAX_FORWARD_TARGETS = 5


def forward_source(message) -> dict:
    """Keep the original source when forwarding a message that was itself forwarded."""
    existing = (message.meta or {}).get("forwarded_from")
    if existing:
        return dict(existing)
    sender = message.sender
    return {
        "message_id": str(message.id),
        "conversation_id": str(message.conversation_id),
        "sender_id": str(message.sender_id) if message.sender_id else None,
        "sender_name": (sender.display_name or sender.first_name) if sender else None,
        "sent_at": message.created_at.isoformat(),
    }


def copy_assets(assets, conversation, user, storage) -> list:
    """Copy stored files into ``conversation``. Returns the new FileAssets; on a
    storage failure, removes what was copied and raises 503."""
    copies, new_keys = [], []
    try:
        for asset in assets:
            attributes = dict(asset.attributes or {})
            name = attributes.get("name") or "file"
            prefix = attachment_views.object_prefix(conversation.workspace_id, conversation.id)
            key = f"{prefix}/{uuid.uuid4().hex}-{name}"
            if storage.copy_object(asset.asset.name, key) is None:
                raise services.ChatError(503, "STORAGE_UNAVAILABLE", "File storage is unavailable. Try again shortly.")
            new_keys.append(key)
            thumb_key = attributes.get("thumb_key")
            if thumb_key:
                extension = thumb_key.rsplit(".", 1)[-1] if "." in thumb_key else "webp"
                new_thumb = f"{prefix}/{uuid.uuid4().hex}-thumb.{extension}"
                if storage.copy_object(thumb_key, new_thumb) is None:
                    attributes.pop("thumb_key", None)
                    attributes.pop("thumb_type", None)
                else:
                    new_keys.append(new_thumb)
                    attributes["thumb_key"] = new_thumb
            copies.append(
                FileAsset.objects.create(
                    attributes=attributes,
                    asset=key,
                    size=asset.size,
                    workspace_id=conversation.workspace_id,
                    entity_type=FileAsset.EntityTypeContext.CHAT_ATTACHMENT,
                    chat_conversation=conversation,
                    created_by=user,
                    is_uploaded=True,
                )
            )
    except Exception:
        discard_copies(copies, new_keys)
        raise
    return copies


def discard_copies(copies, keys):
    FileAsset.all_objects.filter(id__in=[copy.id for copy in copies]).delete()
    if keys:
        from plane.bgtasks.chat_cleanup_task import delete_chat_objects

        delete_chat_objects.delay(list(keys))


class ChatForwardEndpoint(ChatBaseEndpoint):
    throttle_classes = [ChatSendThrottle]

    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def post(self, request, slug, message_id):
        message, _ = get_message(request.user, slug, message_id)
        if message.kind == MessageKind.SYSTEM:
            raise services.ChatError(400, "CANNOT_FORWARD", "System messages can't be forwarded.")
        payload = self.validated(ForwardSerializer(data=request.data))
        target_ids = list(dict.fromkeys(str(target) for target in payload["conversation_ids"]))
        if len(target_ids) > MAX_FORWARD_TARGETS:
            raise services.ChatError(
                400,
                "FORWARD_LIMIT",
                f"You can forward to up to {MAX_FORWARD_TARGETS} conversations at once.",
                max=MAX_FORWARD_TARGETS,
            )
        # 404 for any target the caller isn't an active member of (never reveal it exists).
        memberships = [services.get_membership(request.user, target_id, slug) for target_id in target_ids]

        config = get_chat_config()
        assets = list(FileAsset.objects.filter(chat_message=message).order_by("created_at"))
        for asset in assets:
            kind = (asset.attributes or {}).get("kind", "file")
            limit = config.limit_bytes(kind)
            if (asset.size or 0) > limit:
                raise services.ChatError(413, "FILE_TOO_LARGE", "This file is too large.", limit_bytes=limit, kind=kind)

        source = forward_source(message)
        comment_html = payload.get("comment_html") or ""
        storage = attachment_views.S3Storage(request=None)
        results = []
        for membership in memberships:
            conversation_id = membership.conversation_id
            if comment_html.strip():
                note = services.send_message(membership, request.user, body_html=comment_html)
                self.publish_created(note.message, request.user, conversation_id, slug)

            copies = copy_assets(assets, membership.conversation, request.user, storage)
            try:
                with transaction.atomic():
                    result = services.send_message(
                        membership,
                        request.user,
                        body_html=message.body_html,
                        body_json=message.body_json,
                        attachment_ids=[copy.id for copy in copies],
                        max_files=max(len(copies), config.max_files_per_message),
                        meta={"forwarded_from": source},
                    )
            except Exception:
                discard_copies(copies, services.collect_object_keys(copies))
                raise
            self.publish_created(result.message, request.user, conversation_id, slug)
            results.append(
                {"conversation_id": str(conversation_id), "id": str(result.message.id), "seq": result.message.seq}
            )
        return Response({"messages": results}, status=status.HTTP_201_CREATED)

    @staticmethod
    def publish_created(message, user, conversation_id, slug):
        message = Message.objects.select_related("sender", "reply_to__sender").get(id=message.id)
        data = full_message_data(message, user)
        services.publish_message(ChatEvent.MESSAGE_CREATED, message, data, conversation_id, slug)
