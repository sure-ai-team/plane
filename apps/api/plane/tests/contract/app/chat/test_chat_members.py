# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest

from plane.db.models import ConversationMember, Message

from .conftest import client_for, conversations_url, member_url, members_url, read_url


@pytest.mark.contract
@pytest.mark.django_db
class TestMembers:
    def test_admin_adds_member_and_they_start_caught_up(
        self, owner_client, workspace, group, make_member, published, django_capture_on_commit_callbacks
    ):
        carol = make_member("carol", 15)
        with django_capture_on_commit_callbacks(execute=True):
            response = owner_client.post(
                members_url(workspace.slug, group["id"]), {"member_ids": [str(carol.id)]}, format="json"
            )
        assert response.status_code == 201
        assert response.data[0]["member"]["id"] == str(carol.id)

        listing = client_for(carol).get(conversations_url(workspace.slug))
        row = next(item for item in listing.data if item["id"] == group["id"])
        assert row["unread_count"] == 0

        events = [event[0] for event in published]
        assert "member.added" in events
        created = [event for event in published if event[0] == "conversation.created"]
        assert created and created[0][2] == [str(carol.id)]

    def test_member_cannot_add(self, alice_client, workspace, group, make_member):
        carol = make_member("carol", 15)
        response = alice_client.post(
            members_url(workspace.slug, group["id"]), {"member_ids": [str(carol.id)]}, format="json"
        )
        assert response.status_code == 403

    def test_cannot_add_guest(self, owner_client, workspace, group, guest):
        response = owner_client.post(
            members_url(workspace.slug, group["id"]), {"member_ids": [str(guest.id)]}, format="json"
        )
        assert response.status_code == 400
        assert response.data["code"] == "INVALID_MEMBER"

    def test_leave_and_rejoin_reuses_row(self, owner_client, alice_client, workspace, group, alice):
        left = alice_client.delete(member_url(workspace.slug, group["id"], alice.id))
        assert left.status_code == 204
        assert alice_client.get(members_url(workspace.slug, group["id"])).status_code == 404

        owner_client.post(members_url(workspace.slug, group["id"]), {"member_ids": [str(alice.id)]}, format="json")
        rows = ConversationMember.objects.filter(conversation_id=group["id"], member=alice)
        assert rows.count() == 1 and rows.first().is_active
        events = list(
            Message.objects.filter(conversation_id=group["id"], kind="system").values_list("meta__event", flat=True)
        )
        assert "member_left" in events and "member_added" in events

    def test_last_admin_leaving_promotes_someone(self, owner_client, workspace, group, owner, alice):
        response = owner_client.delete(member_url(workspace.slug, group["id"], owner.id))
        assert response.status_code == 204
        admins = ConversationMember.objects.filter(conversation_id=group["id"], is_active=True, role=20)
        assert admins.count() == 1
        assert admins.first().member_id in (alice.id,) or admins.first().member_id is not None

    def test_cannot_demote_last_admin(self, owner_client, workspace, group, owner):
        response = owner_client.patch(member_url(workspace.slug, group["id"], owner.id), {"role": 15}, format="json")
        assert response.status_code == 400
        assert response.data["code"] == "LAST_ADMIN"

    def test_promote_then_demote(self, owner_client, workspace, group, alice):
        assert (
            owner_client.patch(member_url(workspace.slug, group["id"], alice.id), {"role": 20}, format="json").data[
                "role"
            ]
            == 20
        )
        assert (
            owner_client.patch(member_url(workspace.slug, group["id"], alice.id), {"role": 15}, format="json").data[
                "role"
            ]
            == 15
        )

    def test_mute_only_self(self, alice_client, workspace, group, alice, bob):
        ok = alice_client.patch(member_url(workspace.slug, group["id"], alice.id), {"is_muted": True}, format="json")
        assert ok.status_code == 200 and ok.data["is_muted"] is True
        denied = alice_client.patch(member_url(workspace.slug, group["id"], bob.id), {"is_muted": True}, format="json")
        assert denied.status_code == 403

    def test_muted_excluded_from_total_unread(self, owner_client, alice_client, workspace, group, alice):
        alice_client.patch(member_url(workspace.slug, group["id"], alice.id), {"is_muted": True}, format="json")
        from .conftest import send

        send(owner_client, workspace.slug, group["id"], "ping")
        counts = alice_client.get(f"/api/workspaces/{workspace.slug}/chat/unread-count/")
        assert counts.data["total"] == 0
        assert counts.data["by_conversation"][group["id"]] == 2

    def test_cannot_leave_direct(self, owner_client, workspace, direct, owner):
        response = owner_client.delete(member_url(workspace.slug, direct["id"], owner.id))
        assert response.status_code == 400
        assert response.data["code"] == "CANNOT_LEAVE_DIRECT"

    def test_removed_member_gets_event_and_loses_access(
        self, owner_client, workspace, group, bob, published, django_capture_on_commit_callbacks
    ):
        with django_capture_on_commit_callbacks(execute=True):
            response = owner_client.delete(member_url(workspace.slug, group["id"], bob.id))
        assert response.status_code == 204
        removed = [event for event in published if event[0] == "member.removed"]
        assert removed and str(bob.id) in removed[0][2]
        assert client_for(bob).post(read_url(workspace.slug, group["id"]), {"seq": 1}, format="json").status_code == 404
