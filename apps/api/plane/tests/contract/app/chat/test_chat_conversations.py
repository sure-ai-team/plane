# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest

from plane.db.models import Conversation, ConversationMember, FileAsset, Message, Project, WorkspaceMember

from .conftest import (
    client_for,
    conversation_url,
    conversations_url,
    make_user,
    messages_url,
    send,
    upload,
)


@pytest.mark.contract
@pytest.mark.django_db
class TestDirectConversations:
    def test_create_direct_then_reopen_returns_same(self, owner_client, workspace, alice):
        url = conversations_url(workspace.slug)
        first = owner_client.post(url, {"type": "direct", "user_id": str(alice.id)}, format="json")
        assert first.status_code == 201
        assert first.data["type"] == "direct"
        assert first.data["direct_user"]["id"] == str(alice.id)

        again = owner_client.post(url, {"type": "direct", "user_id": str(alice.id)}, format="json")
        assert again.status_code == 200
        assert again.data["id"] == first.data["id"]

    def test_reverse_direction_is_same_conversation(self, owner_client, alice_client, workspace, owner, alice):
        created = owner_client.post(
            conversations_url(workspace.slug), {"type": "direct", "user_id": str(alice.id)}, format="json"
        )
        reverse = alice_client.post(
            conversations_url(workspace.slug), {"type": "direct", "user_id": str(owner.id)}, format="json"
        )
        assert reverse.status_code == 200
        assert reverse.data["id"] == created.data["id"]
        assert Conversation.objects.filter(workspace=workspace, type="direct").count() == 1

    def test_cannot_message_self(self, owner_client, workspace, owner):
        response = owner_client.post(
            conversations_url(workspace.slug), {"type": "direct", "user_id": str(owner.id)}, format="json"
        )
        assert response.status_code == 400
        assert response.data["code"] == "INVALID_MEMBER"

    def test_cannot_message_guest_or_outsider(self, owner_client, workspace, guest):
        outsider = make_user("outsider")
        for user in (guest, outsider):
            response = owner_client.post(
                conversations_url(workspace.slug), {"type": "direct", "user_id": str(user.id)}, format="json"
            )
            assert response.status_code == 400
            assert response.data["code"] == "INVALID_MEMBER"

    def test_direct_cannot_be_deleted(self, owner_client, workspace, direct):
        response = owner_client.delete(conversation_url(workspace.slug, direct["id"]))
        assert response.status_code == 400
        assert response.data["code"] == "CANNOT_DELETE_DIRECT"


@pytest.mark.contract
@pytest.mark.django_db
class TestGroups:
    def test_create_group_roles_and_system_message(self, owner_client, workspace, owner, alice, bob, group):
        assert group["type"] == "group"
        assert group["name"] == "Release"
        assert group["member_count"] == 3
        assert group["my_role"] == 20
        roles = dict(ConversationMember.objects.filter(conversation_id=group["id"]).values_list("member_id", "role"))
        assert roles[owner.id] == 20
        assert roles[alice.id] == 15
        assert roles[bob.id] == 15
        system = Message.objects.get(conversation_id=group["id"])
        assert system.kind == "system"
        assert system.meta["event"] == "created"
        # The creator has read the "created" line; the others have one unread.
        assert group["unread_count"] == 0

    def test_group_requires_name(self, owner_client, workspace, alice):
        response = owner_client.post(
            conversations_url(workspace.slug),
            {"type": "group", "name": "  ", "member_ids": [str(alice.id)]},
            format="json",
        )
        assert response.status_code == 400
        assert response.data["code"] == "NAME_REQUIRED"

    def test_group_rejects_project_from_other_workspace(self, owner_client, workspace, alice, owner):
        from plane.db.models import Workspace

        other = Workspace.objects.create(name="Other", slug="other-ws", owner=owner)
        project = Project.objects.create(name="Elsewhere", identifier="ELS", workspace=other, created_by=owner)
        response = owner_client.post(
            conversations_url(workspace.slug),
            {"type": "group", "name": "X", "member_ids": [str(alice.id)], "project_id": str(project.id)},
            format="json",
        )
        assert response.status_code == 400
        assert response.data["code"] == "PROJECT_NOT_IN_WORKSPACE"

    def test_list_shows_unread_and_hides_others(self, alice_client, owner_client, workspace, group, make_member):
        send(owner_client, workspace.slug, group["id"], "one")
        send(owner_client, workspace.slug, group["id"], "two")
        response = alice_client.get(conversations_url(workspace.slug))
        assert response.status_code == 200
        row = next(item for item in response.data if item["id"] == group["id"])
        assert row["unread_count"] == 3  # "created" + two messages
        assert row["last_message_preview"]["text"] == "two"

        outsider = make_member("carol", 15)
        listing = client_for(outsider).get(conversations_url(workspace.slug))
        assert listing.status_code == 200
        assert listing.data == []

    def test_non_member_gets_404_not_403(self, workspace, group, make_member):
        carol = client_for(make_member("carol", 15))
        assert carol.get(conversation_url(workspace.slug, group["id"])).status_code == 404
        assert carol.get(messages_url(workspace.slug, group["id"])).status_code == 404

    def test_guest_is_refused(self, guest_client, workspace):
        assert guest_client.get(conversations_url(workspace.slug)).status_code == 403

    def test_rename_by_admin_only(
        self, owner_client, alice_client, workspace, group, published, django_capture_on_commit_callbacks
    ):
        denied = alice_client.patch(conversation_url(workspace.slug, group["id"]), {"name": "Nope"}, format="json")
        assert denied.status_code == 403
        assert denied.data["code"] == "NOT_ADMIN"

        with django_capture_on_commit_callbacks(execute=True):
            ok = owner_client.patch(
                conversation_url(workspace.slug, group["id"]), {"name": "Release 3.2"}, format="json"
            )
        assert ok.status_code == 200
        assert ok.data["name"] == "Release 3.2"
        events = [event[0] for event in published]
        assert "conversation.updated" in events
        system = [event for event in published if event[0] == "message.created"]
        assert system and system[-1][1]["message"]["meta"]["event"] == "renamed"

    def test_delete_group_is_permanent(
        self, owner_client, workspace, group, storage, deletion_task, published, django_capture_on_commit_callbacks
    ):
        asset_id, key, confirm = upload(owner_client, storage, workspace.slug, group["id"])
        assert confirm.status_code == 200
        send(owner_client, workspace.slug, group["id"], "with file", attachment_ids=[asset_id])

        with django_capture_on_commit_callbacks(execute=True):
            response = owner_client.delete(conversation_url(workspace.slug, group["id"]))
        assert response.status_code == 204
        assert not Conversation.objects.filter(id=group["id"]).exists()
        assert not Message.objects.filter(conversation_id=group["id"]).exists()
        assert not FileAsset.all_objects.filter(id=asset_id).exists()
        deletion_task.assert_called_once()
        assert key in deletion_task.call_args.args[0]
        deleted = [event for event in published if event[0] == "conversation.deleted"]
        assert deleted and len(deleted[0][2]) == 3

    def test_removed_workspace_member_loses_access(self, alice_client, workspace, alice, group):
        assert alice_client.get(conversation_url(workspace.slug, group["id"])).status_code == 200
        WorkspaceMember.objects.filter(workspace=workspace, member=alice).update(is_active=False)
        assert alice_client.get(conversations_url(workspace.slug)).status_code == 403
        # Their membership row is untouched, but it no longer counts.
        detail = client_for(alice).get(conversation_url(workspace.slug, group["id"]))
        assert detail.status_code == 403

    def test_member_count_excludes_removed_workspace_members(self, owner_client, workspace, alice, group):
        WorkspaceMember.objects.filter(workspace=workspace, member=alice).update(is_active=False)
        response = owner_client.get(conversation_url(workspace.slug, group["id"]))
        assert response.data["member_count"] == 2
        assert str(alice.id) not in [row["member"]["id"] for row in response.data["members"]]

    def test_created_event_goes_to_all_members(
        self, owner_client, workspace, alice, bob, owner, published, django_capture_on_commit_callbacks
    ):
        with django_capture_on_commit_callbacks(execute=True):
            response = owner_client.post(
                conversations_url(workspace.slug),
                {"type": "group", "name": "Ops", "member_ids": [str(alice.id), str(bob.id)]},
                format="json",
            )
        created = [event for event in published if event[0] == "conversation.created"]
        assert len(created) == 1
        assert created[0][1] == {"conversation_id": response.data["id"]}
        assert created[0][2] == sorted([str(owner.id), str(alice.id), str(bob.id)])
        assert created[0][3] == workspace.slug
