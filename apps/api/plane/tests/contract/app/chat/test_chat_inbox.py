# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Chat entries in the Inbox (docs/chat/phase-2/05-notifications.md)."""

from datetime import timedelta

import pytest
from django.utils import timezone

from plane.bgtasks.chat_inbox_task import chat_inbox_notifications
from plane.db.models import ChatPreference, ConversationMember, Notification

from .conftest import base, me_url, member_url, message_url, read_url, send


def mention_html(user, text="look"):
    mention = f'<mention-component entity_name="user_mention" entity_identifier="{user.id}"></mention-component>'
    return f"<p>{mention} {text}</p>"


def post(client, slug, conversation_id, body_html):
    return client.post(
        f"{base(slug)}/conversations/{conversation_id}/messages/", {"body_html": body_html}, format="json"
    )


def rows_for(user):
    return Notification.objects.filter(receiver=user, entity_name="chat_message")


@pytest.mark.contract
@pytest.mark.django_db
class TestInbox:
    def test_task_scheduled_on_send(
        self, owner_client, workspace, direct, inbox_task, django_capture_on_commit_callbacks
    ):
        with django_capture_on_commit_callbacks(execute=True):
            message = send(owner_client, workspace.slug, direct["id"]).data
        inbox_task.assert_called_once_with(message["id"])

    def test_mention_in_group(self, owner_client, alice, bob, workspace, group):
        message = post(owner_client, workspace.slug, group["id"], mention_html(alice)).data
        assert chat_inbox_notifications(message["id"]) == 1
        row = rows_for(alice).get()
        assert row.data["type"] == "mention" and row.data["conversation_id"] == group["id"]
        assert row.entity_identifier.hex == message["id"].replace("-", "")
        assert not rows_for(bob).exists()  # groups default to mentions only

    def test_one_row_per_direct_conversation(self, owner_client, alice, workspace, direct):
        first = send(owner_client, workspace.slug, direct["id"], "one").data
        chat_inbox_notifications(first["id"])
        second = send(owner_client, workspace.slug, direct["id"], "two").data
        chat_inbox_notifications(second["id"])
        rows = list(rows_for(alice))
        assert len(rows) == 1
        assert rows[0].data["message_id"] == second["id"] and rows[0].message_stripped == "two"

    def test_levels_snooze_and_preference(self, owner_client, alice_client, alice, workspace, direct, group):
        alice_client.patch(me_url(workspace.slug, direct["id"]), {"notify_level": "off"}, format="json")
        chat_inbox_notifications(send(owner_client, workspace.slug, direct["id"]).data["id"])
        assert not rows_for(alice).exists()

        until = (timezone.now() + timedelta(hours=2)).isoformat()
        alice_client.patch(me_url(workspace.slug, group["id"]), {"snoozed_until": until}, format="json")
        chat_inbox_notifications(post(owner_client, workspace.slug, group["id"], mention_html(alice)).data["id"])
        assert not rows_for(alice).exists()

        alice_client.patch(me_url(workspace.slug, group["id"]), {"snoozed_until": None}, format="json")
        ChatPreference.objects.create(user=alice, workspace=workspace, inbox_mentions=False)
        chat_inbox_notifications(post(owner_client, workspace.slug, group["id"], mention_html(alice)).data["id"])
        assert not rows_for(alice).exists()

    def test_reading_in_chat_marks_rows_read(self, owner_client, alice_client, alice, workspace, direct):
        message = send(owner_client, workspace.slug, direct["id"]).data
        chat_inbox_notifications(message["id"])
        alice_client.post(read_url(workspace.slug, direct["id"]), {"seq": message["seq"]}, format="json")
        assert rows_for(alice).get().read_at is not None

    def test_delete_message_removes_rows(self, owner_client, alice, workspace, direct):
        message = send(owner_client, workspace.slug, direct["id"]).data
        chat_inbox_notifications(message["id"])
        owner_client.delete(message_url(workspace.slug, message["id"]))
        assert not Notification.all_objects.filter(receiver=alice, entity_name="chat_message").exists()

    def test_leaving_removes_unread_rows(self, owner_client, alice_client, alice, workspace, group):
        chat_inbox_notifications(post(owner_client, workspace.slug, group["id"], mention_html(alice)).data["id"])
        alice_client.delete(member_url(workspace.slug, group["id"], alice.id))
        assert not Notification.all_objects.filter(receiver=alice, entity_name="chat_message").exists()
        assert not ConversationMember.objects.get(conversation_id=group["id"], member=alice).is_active

    def test_rows_show_in_the_inbox_tabs(self, owner_client, alice_client, alice, workspace, group, direct):
        chat_inbox_notifications(
            post(owner_client, workspace.slug, group["id"], mention_html(alice, "<b>x</b>")).data["id"]
        )
        chat_inbox_notifications(send(owner_client, workspace.slug, direct["id"], "hi").data["id"])
        url = f"/api/workspaces/{workspace.slug}/users/notifications/"
        mentions = alice_client.get(url + "?mentioned=true").data
        others = alice_client.get(url).data
        assert [row["data"]["type"] for row in mentions] == ["mention"]
        assert [row["data"]["type"] for row in others] == ["direct"]
        assert "<b>" not in mentions[0]["message_html"]
        counts = alice_client.get(f"/api/workspaces/{workspace.slug}/users/notifications/unread/").data
        assert counts["mention_unread_notifications_count"] == 1
        assert counts["total_unread_notifications_count"] == 1
