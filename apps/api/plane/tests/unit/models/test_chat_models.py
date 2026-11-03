# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import timedelta
from unittest.mock import patch

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from plane.bgtasks.chat_cleanup_task import delete_chat_objects, purge_orphan_chat_uploads
from plane.db.models import Conversation, ConversationMember, FileAsset, Message, build_direct_key


@pytest.mark.unit
@pytest.mark.django_db
class TestChatModels:
    def test_direct_key_is_order_independent(self):
        assert build_direct_key("b", "a") == build_direct_key("a", "b") == "a:b"

    def test_direct_conversation_unique_per_workspace(self, workspace):
        Conversation.objects.create(workspace=workspace, type="direct", direct_key="a:b")
        with pytest.raises(IntegrityError), transaction.atomic():
            Conversation.objects.create(workspace=workspace, type="direct", direct_key="a:b")

    def test_direct_key_must_match_type(self, workspace):
        with pytest.raises(IntegrityError), transaction.atomic():
            Conversation.objects.create(workspace=workspace, type="group", name="x", direct_key="a:b")
        with pytest.raises(IntegrityError), transaction.atomic():
            Conversation.objects.create(workspace=workspace, type="direct")

    def test_delete_is_permanent(self, workspace, create_user):
        conversation = Conversation.objects.create(workspace=workspace, type="group", name="x")
        ConversationMember.objects.create(conversation=conversation, member=create_user, workspace=workspace)
        message = Message.objects.create(conversation=conversation, workspace=workspace, seq=1, body_stripped="hi")
        assert not hasattr(message, "deleted_at")
        conversation.delete()
        assert not Conversation.objects.filter(id=conversation.id).exists()
        assert not Message.objects.filter(id=message.id).exists()
        assert not ConversationMember.objects.filter(conversation_id=conversation.id).exists()

    def test_seq_unique_per_conversation(self, workspace):
        conversation = Conversation.objects.create(workspace=workspace, type="group", name="x")
        Message.objects.create(conversation=conversation, workspace=workspace, seq=1)
        with pytest.raises(IntegrityError), transaction.atomic():
            Message.objects.create(conversation=conversation, workspace=workspace, seq=1)

    def test_workspace_soft_delete_leaves_chat_rows(self, workspace):
        """The soft-delete cascade skips models without deleted_at (open question Q3)."""
        from plane.bgtasks.deletion_task import soft_delete_related_objects

        conversation = Conversation.objects.create(workspace=workspace, type="group", name="x")
        soft_delete_related_objects("db", "workspace", workspace.id)
        assert Conversation.objects.filter(id=conversation.id).exists()


@pytest.mark.unit
@pytest.mark.django_db
class TestChatCleanup:
    def test_purge_orphans_only(self, workspace, create_user):
        conversation = Conversation.objects.create(workspace=workspace, type="group", name="x")
        message = Message.objects.create(conversation=conversation, workspace=workspace, seq=1)

        def make(key, **extra):
            return FileAsset.objects.create(
                attributes={"thumb_key": f"{key}-thumb"},
                asset=key,
                workspace=workspace,
                entity_type="CHAT_ATTACHMENT",
                chat_conversation=conversation,
                created_by=create_user,
                **extra,
            )

        old_orphan = make("old-orphan")
        fresh_orphan = make("fresh-orphan")
        sent = make("sent", chat_message=message)
        FileAsset.objects.filter(id__in=[old_orphan.id, sent.id]).update(created_at=timezone.now() - timedelta(days=2))

        with patch("plane.bgtasks.chat_cleanup_task.delete_chat_objects.delay") as delay:
            assert purge_orphan_chat_uploads() == 1
        assert not FileAsset.all_objects.filter(id=old_orphan.id).exists()
        assert FileAsset.objects.filter(id=fresh_orphan.id).exists()
        assert FileAsset.objects.filter(id=sent.id).exists()
        assert sorted(delay.call_args.args[0]) == ["old-orphan", "old-orphan-thumb"]

    def test_delete_objects_batches(self):
        with patch("plane.bgtasks.chat_cleanup_task.S3Storage") as storage_class:
            storage_class.return_value.delete_files.return_value = True
            keys = [f"k{index}" for index in range(2500)]
            assert delete_chat_objects.run(keys) == 2500
            assert storage_class.return_value.delete_files.call_count == 3

    def test_generic_unuploaded_cleanup_skips_chat(self, workspace, create_user):
        from plane.bgtasks.file_asset_task import delete_unuploaded_file_asset

        asset = FileAsset.objects.create(
            asset="x", workspace=workspace, entity_type="CHAT_ATTACHMENT", created_by=create_user
        )
        FileAsset.objects.filter(id=asset.id).update(created_at=timezone.now() - timedelta(days=30))
        delete_unuploaded_file_asset()
        assert FileAsset.objects.filter(id=asset.id).exists()
