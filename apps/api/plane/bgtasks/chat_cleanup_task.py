# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Storage cleanup for chat attachments (docs/chat/04-attachments-and-media.md § Deletion)."""

# Python imports
import logging
from datetime import timedelta

# Django imports
from django.utils import timezone

# Third party imports
from celery import shared_task

# Module imports
from plane.db.models import FileAsset
from plane.settings.storage import S3Storage

logger = logging.getLogger("plane.worker")

BATCH_SIZE = 1000
ORPHAN_AGE = timedelta(hours=24)


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def delete_chat_objects(self, keys):
    """Delete stored objects for permanently deleted chat attachments."""
    keys = [key for key in (keys or []) if key]
    if not keys:
        return 0
    storage = S3Storage(request=None)
    failed = []
    for start in range(0, len(keys), BATCH_SIZE):
        batch = keys[start : start + BATCH_SIZE]
        if not storage.delete_files(batch):
            failed.extend(batch)
    if failed:
        logger.warning("chat: failed to delete %d stored objects, retrying", len(failed))
        raise self.retry(args=[failed])
    return len(keys)


@shared_task
def purge_orphan_chat_uploads():
    """Hard-delete chat uploads that were never attached to a message within 24 hours
    (cancelled, abandoned tabs, failed sends). Includes rows another task may have
    soft-deleted, so nothing is left behind in storage."""
    cutoff = timezone.now() - ORPHAN_AGE
    orphans = FileAsset.all_objects.filter(
        entity_type=FileAsset.EntityTypeContext.CHAT_ATTACHMENT,
        chat_message__isnull=True,
        created_at__lt=cutoff,
    )
    keys = []
    ids = []
    for asset in orphans.only("id", "asset", "attributes").iterator(chunk_size=500):
        ids.append(asset.id)
        if asset.asset and asset.asset.name:
            keys.append(asset.asset.name)
        thumb_key = (asset.attributes or {}).get("thumb_key")
        if thumb_key:
            keys.append(thumb_key)
    if not ids:
        return 0
    # all_objects is a plain manager, so this is a real (hard) delete.
    FileAsset.all_objects.filter(id__in=ids).delete()
    if keys:
        delete_chat_objects.delay(keys)
    logger.info("chat: purged %d orphan uploads", len(ids))
    return len(ids)
