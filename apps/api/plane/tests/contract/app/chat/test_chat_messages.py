# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from uuid import uuid4

import pytest

from plane.db.models import ConversationMember, Message, MessageMention, WorkspaceMember
from plane.throttles.chat import ChatSendThrottle

from .conftest import client_for, message_url, messages_url, read_url, send


def mention(user):
    return (
        f'<mention-component entity_name="user_mention" entity_identifier="{user.id}" '
        f'id="{uuid4()}"></mention-component>'
    )


@pytest.mark.contract
@pytest.mark.django_db
class TestSendAndList:
    def test_send_assigns_consecutive_seq(self, owner_client, workspace, group):
        first = send(owner_client, workspace.slug, group["id"], "one")
        second = send(owner_client, workspace.slug, group["id"], "two")
        assert first.status_code == 201 and second.status_code == 201
        # seq 1 is the "created" system line.
        assert (first.data["seq"], second.data["seq"]) == (2, 3)
        assert first.data["kind"] == "text"
        assert first.data["body_stripped"] == "one"
        assert first.data["sender"]["id"] == str(owner_client.handler._force_user.id)

    def test_duplicate_client_id_returns_original(self, owner_client, workspace, group):
        client_id = str(uuid4())
        url = messages_url(workspace.slug, group["id"])
        first = owner_client.post(url, {"body_html": "<p>hi</p>", "client_id": client_id}, format="json")
        again = owner_client.post(url, {"body_html": "<p>hi</p>", "client_id": client_id}, format="json")
        assert first.status_code == 201
        assert again.status_code == 200
        assert again.data["id"] == first.data["id"]
        assert Message.objects.filter(conversation_id=group["id"], kind="text").count() == 1

    def test_empty_message_rejected(self, owner_client, workspace, group):
        response = owner_client.post(
            messages_url(workspace.slug, group["id"]), {"body_html": "<p>   </p>"}, format="json"
        )
        assert response.status_code == 400
        assert response.data["code"] == "EMPTY_MESSAGE"

    def test_html_is_sanitized(self, owner_client, workspace, group):
        response = owner_client.post(
            messages_url(workspace.slug, group["id"]),
            {"body_html": '<p>hi<script>alert(1)</script><img src=x onerror="alert(1)"></p>'},
            format="json",
        )
        assert response.status_code == 201
        assert "<script" not in response.data["body_html"]
        assert "onerror" not in response.data["body_html"]

    def test_paging_before_and_after(self, owner_client, workspace, group):
        for index in range(5):
            send(owner_client, workspace.slug, group["id"], f"m{index}")
        url = messages_url(workspace.slug, group["id"])

        latest = owner_client.get(url, {"limit": 2})
        assert [row["seq"] for row in latest.data["results"]] == [5, 6]
        assert latest.data["has_more"] is True

        older = owner_client.get(url, {"before_seq": 5, "limit": 10})
        assert [row["seq"] for row in older.data["results"]] == [1, 2, 3, 4]
        assert older.data["has_more"] is False

        newer = owner_client.get(url, {"after_seq": 3, "limit": 2})
        assert [row["seq"] for row in newer.data["results"]] == [4, 5]
        assert newer.data["has_more"] is True

        both = owner_client.get(url, {"before_seq": 5, "after_seq": 2})
        assert both.status_code == 400

    def test_limit_is_capped(self, owner_client, workspace, group):
        response = owner_client.get(messages_url(workspace.slug, group["id"]), {"limit": 5000})
        assert response.status_code == 200

    def test_reply_to_and_reply_cleared_after_delete(self, owner_client, alice_client, workspace, group):
        original = send(owner_client, workspace.slug, group["id"], "question")
        reply = send(alice_client, workspace.slug, group["id"], "answer", reply_to_id=original.data["id"])
        assert reply.data["reply_to"]["id"] == original.data["id"]

        owner_client.delete(message_url(workspace.slug, original.data["id"]))
        refreshed = Message.objects.get(id=reply.data["id"])
        assert refreshed.reply_to_id is None

    def test_reply_to_other_conversation_rejected(self, owner_client, workspace, group, direct):
        elsewhere = send(owner_client, workspace.slug, direct["id"], "dm")
        response = send(owner_client, workspace.slug, group["id"], "x", reply_to_id=elsewhere.data["id"])
        assert response.status_code == 400
        assert response.data["code"] == "INVALID_REPLY"

    def test_mentions_only_for_conversation_members(self, owner_client, workspace, group, alice, make_member):
        carol = make_member("carol", 15)
        body = f"<p>hey {mention(alice)} and {mention(carol)}</p>"
        response = owner_client.post(messages_url(workspace.slug, group["id"]), {"body_html": body}, format="json")
        assert response.status_code == 201
        assert response.data["mentions"] == [str(alice.id)]
        assert MessageMention.objects.filter(message_id=response.data["id"]).count() == 1

    def test_direct_to_removed_member_is_blocked(self, owner_client, workspace, direct, alice):
        WorkspaceMember.objects.filter(workspace=workspace, member=alice).update(is_active=False)
        response = send(owner_client, workspace.slug, direct["id"], "still there?")
        assert response.status_code == 400
        assert response.data["code"] == "RECIPIENT_UNAVAILABLE"

    def test_send_publishes_after_commit_to_members(
        self, owner_client, workspace, group, owner, alice, bob, published, django_capture_on_commit_callbacks
    ):
        with django_capture_on_commit_callbacks(execute=True):
            response = send(owner_client, workspace.slug, group["id"], "broadcast")
        created = [event for event in published if event[0] == "message.created"]
        assert len(created) == 1
        event_type, data, recipients, slug = created[0]
        assert data["message"]["id"] == response.data["id"]
        assert recipients == sorted([str(owner.id), str(alice.id), str(bob.id)])
        assert slug == workspace.slug

    def test_nothing_published_without_commit(self, owner_client, workspace, group, published):
        send(owner_client, workspace.slug, group["id"], "rolled back in test transaction")
        assert [event for event in published if event[0] == "message.created"] == []

    def test_send_throttle(self, owner_client, workspace, group, mocker):
        mocker.patch.object(ChatSendThrottle, "rate", "2/minute", create=True)
        codes = [send(owner_client, workspace.slug, group["id"], f"n{index}").status_code for index in range(3)]
        assert codes == [201, 201, 429]


@pytest.mark.contract
@pytest.mark.django_db
class TestEditAndDelete:
    def test_only_sender_can_edit(self, owner_client, alice_client, workspace, group):
        message = send(owner_client, workspace.slug, group["id"], "draft")
        denied = alice_client.patch(
            message_url(workspace.slug, message.data["id"]), {"body_html": "<p>x</p>"}, format="json"
        )
        assert denied.status_code == 403
        assert denied.data["code"] == "NOT_SENDER"

        ok = owner_client.patch(
            message_url(workspace.slug, message.data["id"]), {"body_html": "<p>final</p>"}, format="json"
        )
        assert ok.status_code == 200
        assert ok.data["body_stripped"] == "final"
        assert ok.data["edited_at"] is not None

    def test_member_cannot_delete_others_but_admin_can(self, owner_client, alice_client, bob_client, workspace, group):
        message = send(alice_client, workspace.slug, group["id"], "oops")
        assert bob_client.delete(message_url(workspace.slug, message.data["id"])).status_code == 403
        assert owner_client.delete(message_url(workspace.slug, message.data["id"])).status_code == 204
        assert not Message.objects.filter(id=message.data["id"]).exists()

    def test_delete_last_message_updates_preview(self, owner_client, workspace, group):
        send(owner_client, workspace.slug, group["id"], "first")
        last = send(owner_client, workspace.slug, group["id"], "second")
        owner_client.delete(message_url(workspace.slug, last.data["id"]))
        from plane.db.models import Conversation

        conversation = Conversation.objects.get(id=group["id"])
        assert conversation.last_message_preview["text"] == "first"

    def test_non_member_cannot_touch_message(self, owner_client, workspace, group, make_member):
        message = send(owner_client, workspace.slug, group["id"], "private")
        carol = client_for(make_member("carol", 15))
        assert carol.delete(message_url(workspace.slug, message.data["id"])).status_code == 404
        assert (
            carol.patch(
                message_url(workspace.slug, message.data["id"]), {"body_html": "<p>x</p>"}, format="json"
            ).status_code
            == 404
        )

    def test_system_messages_cannot_be_edited(self, owner_client, workspace, group):
        system = Message.objects.get(conversation_id=group["id"], kind="system")
        system.sender_id = owner_client.handler._force_user.id
        system.save(update_fields=["sender"])
        response = owner_client.patch(message_url(workspace.slug, system.id), {"body_html": "<p>x</p>"}, format="json")
        assert response.status_code == 400
        assert response.data["code"] == "CANNOT_EDIT"


@pytest.mark.contract
@pytest.mark.django_db
class TestRead:
    def test_read_is_monotonic_and_clamped(self, owner_client, alice_client, workspace, group, alice):
        send(owner_client, workspace.slug, group["id"], "a")
        send(owner_client, workspace.slug, group["id"], "b")
        url = read_url(workspace.slug, group["id"])

        response = alice_client.post(url, {"seq": 2}, format="json")
        assert response.data == {"last_read_seq": 2, "unread_count": 1}

        backwards = alice_client.post(url, {"seq": 1}, format="json")
        assert backwards.data["last_read_seq"] == 2

        future = alice_client.post(url, {"seq": 999}, format="json")
        assert future.data["last_read_seq"] == 3
        assert ConversationMember.objects.get(conversation_id=group["id"], member=alice).last_read_seq == 3

    def test_seen_by_count(self, owner_client, alice_client, workspace, group):
        message = send(owner_client, workspace.slug, group["id"], "seen?")
        alice_client.post(read_url(workspace.slug, group["id"]), {"seq": message.data["seq"]}, format="json")
        page = owner_client.get(messages_url(workspace.slug, group["id"]))
        row = next(item for item in page.data["results"] if item["id"] == message.data["id"])
        assert row["seen_by_count"] == 1

    def test_sender_has_read_own_message(self, owner_client, workspace, group, owner):
        message = send(owner_client, workspace.slug, group["id"], "mine")
        membership = ConversationMember.objects.get(conversation_id=group["id"], member=owner)
        assert membership.last_read_seq == message.data["seq"]
