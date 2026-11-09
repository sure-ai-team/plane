# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Chat attachment endpoints (docs/chat/04-attachments-and-media.md).

These are the *only* routes that create or serve ``CHAT_ATTACHMENT`` assets;
the generic asset endpoints refuse them (docs/chat/07-security.md S1).
"""

# Python imports
import uuid

# Django imports
from django.conf import settings
from django.db import transaction
from django.http import HttpResponseRedirect

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers.chat import AttachmentRequestSerializer, ThumbnailRequestSerializer, attachment_data
from plane.db.models import FileAsset
from plane.settings.storage import S3Storage
from plane.throttles.chat import ChatUploadThrottle
from plane.utils.chat_config import get_chat_config
from plane.utils.chat_media import (
    KIND_AUDIO,
    KIND_IMAGE,
    KIND_VIDEO,
    MAX_THUMBNAIL_BYTES,
    THUMBNAIL_TYPES,
    clean_positive_number,
    clean_waveform,
    is_blocked,
    is_valid_type,
    kind_for_type,
    normalize_type,
    sniffed_type_mismatch,
)
from plane.utils.path_validator import sanitize_filename

from . import services
from .base import ChatBaseEndpoint

CHAT_ROLES = [ROLE.ADMIN, ROLE.MEMBER]
UPLOAD_LINK_SECONDS = 15 * 60
DOWNLOAD_LINK_SECONDS = 5 * 60
INLINE_KINDS = (KIND_IMAGE, KIND_VIDEO, KIND_AUDIO)


def object_prefix(workspace_id, conversation_id) -> str:
    return f"{workspace_id}/chat/{conversation_id}"


def get_own_pending_asset(user, slug, asset_id, conversation_id=None) -> FileAsset:
    """An attachment the caller uploaded that has not been sent yet."""
    filters = {
        "id": asset_id,
        "workspace__slug": slug,
        "entity_type": FileAsset.EntityTypeContext.CHAT_ATTACHMENT,
        "created_by": user,
    }
    if conversation_id is not None:
        filters["chat_conversation_id"] = conversation_id
    asset = FileAsset.objects.select_related("workspace").filter(**filters).first()
    if asset is None:
        raise services.ChatError(404, "NOT_FOUND", "That attachment could not be found.")
    # Still a member of the conversation it was uploaded to?
    services.get_membership(user, asset.chat_conversation_id, slug)
    return asset


def discard_asset(asset: FileAsset):
    keys = services.collect_object_keys([asset])
    with transaction.atomic():
        asset.delete(soft=False)
        services.schedule_object_deletion(keys)


class ChatAttachmentRequestEndpoint(ChatBaseEndpoint):
    """POST conversations/<id>/attachments/ -> presigned upload for a new attachment."""

    throttle_classes = [ChatUploadThrottle]

    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def post(self, request, slug, conversation_id):
        membership = services.get_membership(request.user, conversation_id, slug)
        payload = self.validated(AttachmentRequestSerializer(data=request.data))
        config = get_chat_config()

        name = sanitize_filename(payload["name"]) or "file"
        content_type = normalize_type(payload["type"])
        if not is_valid_type(content_type) or is_blocked(name, content_type):
            raise services.ChatError(400, "TYPE_NOT_ALLOWED", "This file type isn't allowed.")

        kind = kind_for_type(content_type)
        is_voice = bool(payload.get("is_voice"))
        if is_voice and kind != KIND_AUDIO:
            raise services.ChatError(400, "TYPE_NOT_ALLOWED", "Voice notes must be audio.")

        limit = config.limit_bytes(kind)
        if payload["size"] > limit:
            raise services.ChatError(413, "FILE_TOO_LARGE", "This file is too large.", limit_bytes=limit, kind=kind)

        duration = None
        if kind in (KIND_AUDIO, KIND_VIDEO) and payload.get("duration") is not None:
            duration = clean_positive_number(payload.get("duration"), maximum=24 * 3600)
        if is_voice:
            if duration is None:
                raise services.ChatError(400, "INVALID_PAYLOAD", "Voice notes need a duration.")
            if duration > config.max_voice_seconds:
                raise services.ChatError(
                    400, "DURATION_TOO_LONG", "This voice note is too long.", max_seconds=config.max_voice_seconds
                )

        attributes = {
            "name": name,
            "type": content_type,
            "size": payload["size"],
            "kind": kind,
            "is_voice": is_voice,
        }
        if kind in (KIND_IMAGE, KIND_VIDEO):
            attributes["width"] = payload.get("width")
            attributes["height"] = payload.get("height")
        if duration is not None:
            attributes["duration"] = round(duration, 2)
        if kind == KIND_AUDIO:
            attributes["waveform"] = clean_waveform(payload.get("waveform"))

        conversation = membership.conversation
        key = f"{object_prefix(conversation.workspace_id, conversation.id)}/{uuid.uuid4().hex}-{name}"
        asset = FileAsset.objects.create(
            attributes=attributes,
            asset=key,
            size=payload["size"],
            workspace_id=conversation.workspace_id,
            entity_type=FileAsset.EntityTypeContext.CHAT_ATTACHMENT,
            chat_conversation=conversation,
            created_by=request.user,
        )
        upload_data = S3Storage(request=request).generate_presigned_post(
            object_name=key, file_type=content_type, file_size=payload["size"], expiration=UPLOAD_LINK_SECONDS
        )
        if upload_data is None:
            asset.delete(soft=False)
            raise services.ChatError(503, "STORAGE_UNAVAILABLE", "File storage is unavailable. Try again shortly.")
        return Response(
            {
                "asset_id": str(asset.id),
                "upload_data": upload_data,
                "asset_url": asset.asset_url,
                "attachment": attachment_data(asset),
            },
            status=status.HTTP_200_OK,
        )


class ChatAttachmentThumbnailEndpoint(ChatBaseEndpoint):
    """POST conversations/<id>/attachments/<asset_id>/thumbnail/ -> presigned upload
    for an image thumbnail or video poster made in the browser."""

    throttle_classes = [ChatUploadThrottle]

    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def post(self, request, slug, conversation_id, asset_id):
        asset = get_own_pending_asset(request.user, slug, asset_id, conversation_id)
        if asset.chat_message_id:
            raise services.ChatError(400, "ALREADY_SENT", "This attachment was already sent.")
        if (asset.attributes or {}).get("kind") not in (KIND_IMAGE, KIND_VIDEO):
            raise services.ChatError(400, "TYPE_NOT_ALLOWED", "Only images and videos have thumbnails.")
        payload = self.validated(ThumbnailRequestSerializer(data=request.data))
        content_type = normalize_type(payload["type"])
        if content_type not in THUMBNAIL_TYPES:
            raise services.ChatError(400, "TYPE_NOT_ALLOWED", "Thumbnails must be WebP, JPEG or PNG.")
        if payload["size"] > MAX_THUMBNAIL_BYTES:
            raise services.ChatError(
                413, "FILE_TOO_LARGE", "The thumbnail is too large.", limit_bytes=MAX_THUMBNAIL_BYTES
            )

        old_key = (asset.attributes or {}).get("thumb_key")
        extension = content_type.split("/")[1]
        key = f"{object_prefix(asset.workspace_id, asset.chat_conversation_id)}/{uuid.uuid4().hex}-thumb.{extension}"
        attributes = dict(asset.attributes or {})
        attributes["thumb_key"] = key
        attributes["thumb_type"] = content_type
        asset.attributes = attributes
        asset.save(update_fields=["attributes", "updated_at"])
        if old_key:
            services.schedule_object_deletion([old_key])

        upload_data = S3Storage(request=request).generate_presigned_post(
            object_name=key, file_type=content_type, file_size=payload["size"], expiration=UPLOAD_LINK_SECONDS
        )
        if upload_data is None:
            raise services.ChatError(503, "STORAGE_UNAVAILABLE", "File storage is unavailable. Try again shortly.")
        return Response({"upload_data": upload_data}, status=status.HTTP_200_OK)


class ChatAttachmentEndpoint(ChatBaseEndpoint):
    """GET (download), PATCH (confirm upload) and DELETE (cancel) one attachment."""

    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def get(self, request, slug, asset_id):
        asset = (
            FileAsset.objects.filter(
                id=asset_id,
                workspace__slug=slug,
                entity_type=FileAsset.EntityTypeContext.CHAT_ATTACHMENT,
                is_uploaded=True,
            )
            .only("id", "asset", "attributes", "chat_conversation_id", "chat_message_id", "created_by_id")
            .first()
        )
        if asset is None:
            raise services.ChatError(404, "NOT_FOUND", "That attachment could not be found.")
        services.get_membership(request.user, asset.chat_conversation_id, slug)
        # Unsent uploads are visible only to the uploader (for their own preview).
        if asset.chat_message_id is None and asset.created_by_id != request.user.id:
            raise services.ChatError(404, "NOT_FOUND", "That attachment could not be found.")

        attributes = asset.attributes or {}
        storage = S3Storage(request=request)
        if request.query_params.get("thumb") in ("1", "true"):
            thumb_key = attributes.get("thumb_key")
            if not thumb_key:
                raise services.ChatError(404, "NOT_FOUND", "This attachment has no thumbnail.")
            url = storage.generate_presigned_url(
                object_name=thumb_key, expiration=DOWNLOAD_LINK_SECONDS, disposition="inline"
            )
        else:
            content_type = normalize_type(attributes.get("type"))
            inline = (
                attributes.get("kind") in INLINE_KINDS
                and content_type not in settings.SCRIPT_CAPABLE_MIME_TYPES
                and request.query_params.get("download") not in ("1", "true")
            )
            url = storage.generate_presigned_url(
                object_name=asset.asset.name,
                expiration=DOWNLOAD_LINK_SECONDS,
                disposition="inline" if inline else "attachment",
                filename=attributes.get("name"),
            )
        if not url:
            raise services.ChatError(503, "STORAGE_UNAVAILABLE", "File storage is unavailable. Try again shortly.")
        return HttpResponseRedirect(url)

    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def patch(self, request, slug, asset_id):
        asset = get_own_pending_asset(request.user, slug, asset_id)
        if asset.is_uploaded:
            return Response(attachment_data(asset), status=status.HTTP_200_OK)

        attributes = dict(asset.attributes or {})
        kind = attributes.get("kind", "file")
        # Server-side reads go to the internal storage endpoint. A request-bound client points at the
        # public host (for links handed to the browser), which the API container often can't reach.
        storage = S3Storage(request=None)
        head = storage.get_object_metadata(asset.asset.name)
        if not head or not head.get("ContentLength"):
            raise services.ChatError(400, "UPLOAD_MISSING", "The file hasn't finished uploading.")

        real_size = int(head["ContentLength"])
        limit = get_chat_config().limit_bytes(kind)
        if real_size > limit:
            discard_asset(asset)
            raise services.ChatError(413, "FILE_TOO_LARGE", "This file is too large.", limit_bytes=limit, kind=kind)

        sample = storage.get_object_range(asset.asset.name, 0, 8191)
        problem = sniffed_type_mismatch(sample, kind, attributes.get("name"))
        if problem:
            discard_asset(asset)
            message = (
                "This file type isn't allowed." if problem == "TYPE_NOT_ALLOWED" else "The file doesn't match its type."
            )
            raise services.ChatError(400, problem, message)

        thumb_key = attributes.get("thumb_key")
        if thumb_key:
            thumb = storage.get_object_metadata(thumb_key)
            if not thumb or int(thumb.get("ContentLength") or 0) > MAX_THUMBNAIL_BYTES:
                attributes.pop("thumb_key", None)
                attributes.pop("thumb_type", None)
                if thumb:
                    services.schedule_object_deletion([thumb_key])

        attributes["size"] = real_size
        asset.attributes = attributes
        asset.size = real_size
        asset.is_uploaded = True
        asset.storage_metadata = head
        asset.save(update_fields=["attributes", "size", "is_uploaded", "storage_metadata", "updated_at"])
        return Response(attachment_data(asset), status=status.HTTP_200_OK)

    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def delete(self, request, slug, asset_id):
        asset = get_own_pending_asset(request.user, slug, asset_id)
        if asset.chat_message_id:
            raise services.ChatError(400, "ALREADY_SENT", "Delete the message to remove a sent attachment.")
        discard_asset(asset)
        return Response(status=status.HTTP_204_NO_CONTENT)
