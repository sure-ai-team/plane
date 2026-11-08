# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Per-conversation settings and chat preferences (phase 2)."""

from datetime import timedelta

import pytest
from django.utils import timezone

from plane.db.models import ChatPreference, ConversationMember

from .conftest import base, conversations_url, me_url, member_url, preferences_url, send


@pytest.mark.contract
@pytest.mark.django_db
class TestMembershipSettings:
    def test_defaults(self, owner_client, workspace, group, direct):
        rows = {row["id"]: row for row in owner_client.get(conversations_url(workspace.slug)).data}
        assert rows[group["id"]]["notify_level"] == "mentions"
        assert rows[direct["id"]]["notify_level"] == "all"
        assert rows[group["id"]]["is_starred"] is False and rows[group["id"]]["archived_at"] is None

    def test_update_and_event_only_to_self(
        self, owner_client, create_user, workspace, group, published, django_capture_on_commit_callbacks
    ):
        until = (timezone.now() + timedelta(hours=1)).isoformat()
        published.clear()
        with django_capture_on_commit_callbacks(execute=True):
            response = owner_client.patch(
                me_url(workspace.slug, group["id"]),
                {"notify_level": "off", "snoozed_until": until, "is_starred": True},
                format="json",
            )
        assert response.status_code == 200
        assert response.data["notify_level"] == "off" and response.data["is_muted"] is True
        assert response.data["is_starred"] is True and response.data["snoozed_until"] is not None
        events = [event for event in published if event[0] == "membership.updated"]
        assert len(events) == 1 and events[0][2] == [str(create_user.id)]

    def test_invalid_level(self, owner_client, workspace, group):
        response = owner_client.patch(me_url(workspace.slug, group["id"]), {"notify_level": "loud"}, format="json")
        assert response.status_code == 400

    def test_archive_moves_conversation_to_archived_list(self, owner_client, workspace, group, direct):
        owner_client.patch(me_url(workspace.slug, group["id"]), {"archived": True}, format="json")
        main = [row["id"] for row in owner_client.get(conversations_url(workspace.slug)).data]
        archived = [row["id"] for row in owner_client.get(conversations_url(workspace.slug) + "?archived=true").data]
        assert group["id"] not in main and direct["id"] in main
        assert archived == [group["id"]]
        owner_client.patch(me_url(workspace.slug, group["id"]), {"archived": False}, format="json")
        assert group["id"] in [row["id"] for row in owner_client.get(conversations_url(workspace.slug)).data]

    def test_archive_is_sticky_and_unread_totals(self, owner_client, alice_client, workspace, group, direct):
        alice_client.patch(me_url(workspace.slug, group["id"]), {"archived": True}, format="json")
        send(owner_client, workspace.slug, group["id"], "still archived")
        send(owner_client, workspace.slug, direct["id"], "hi")
        counts = alice_client.get(f"{base(workspace.slug)}/unread-count/").data
        assert counts["archived_total"] >= 1
        assert counts["total"] == counts["by_conversation"][direct["id"]]
        archived = alice_client.get(conversations_url(workspace.slug) + "?archived=true").data
        assert [row["id"] for row in archived] == [group["id"]]

    def test_off_excluded_from_total(self, owner_client, alice_client, workspace, direct):
        alice_client.patch(me_url(workspace.slug, direct["id"]), {"notify_level": "off"}, format="json")
        send(owner_client, workspace.slug, direct["id"], "quiet")
        counts = alice_client.get(f"{base(workspace.slug)}/unread-count/").data
        assert counts["by_conversation"][direct["id"]] == 1
        assert counts["total"] == 0

    def test_unread_mentions(self, owner_client, alice_client, alice, workspace, group):
        component = f'<mention-component entity_name="user_mention" entity_identifier="{alice.id}"></mention-component>'
        mention = f"<p>{component} look</p>"
        owner_client.post(
            f"{base(workspace.slug)}/conversations/{group['id']}/messages/", {"body_html": mention}, format="json"
        )
        counts = alice_client.get(f"{base(workspace.slug)}/unread-count/").data
        assert counts["mentions_by_conversation"] == {group["id"]: 1}
        row = next(r for r in alice_client.get(conversations_url(workspace.slug)).data if r["id"] == group["id"])
        assert row["unread_mention_count"] == 1

    def test_legacy_mute_maps_to_level(self, alice_client, alice, workspace, group):
        response = alice_client.patch(
            member_url(workspace.slug, group["id"], alice.id), {"is_muted": True}, format="json"
        )
        assert response.status_code == 200
        row = ConversationMember.objects.get(conversation_id=group["id"], member=alice)
        assert row.notify_level == "off"
        alice_client.patch(member_url(workspace.slug, group["id"], alice.id), {"is_muted": False}, format="json")
        row.refresh_from_db()
        assert row.notify_level == "mentions"

    def test_non_member(self, bob_client, workspace, direct):
        assert (
            bob_client.patch(me_url(workspace.slug, direct["id"]), {"is_starred": True}, format="json").status_code
            == 404
        )


@pytest.mark.contract
@pytest.mark.django_db
class TestPreferences:
    def test_lazy_defaults_and_update(
        self, alice_client, alice, workspace, published, django_capture_on_commit_callbacks
    ):
        response = alice_client.get(preferences_url(workspace.slug))
        assert response.status_code == 200
        assert response.data == {
            "desktop_notifications": True,
            "sound": True,
            "sound_tone": "chime",
            "sound_volume": 60,
            "show_preview": True,
            "inbox_mentions": True,
            "message_layout": "bubbles",
            "bubbles_direct_only": True,
            "minimize_style": "docked",
        }
        published.clear()
        with django_capture_on_commit_callbacks(execute=True):
            update = alice_client.patch(
                preferences_url(workspace.slug), {"message_layout": "compact", "sound": False}, format="json"
            )
        assert update.data["message_layout"] == "compact" and update.data["sound"] is False
        assert ChatPreference.objects.filter(user=alice).count() == 1
        assert [event[0] for event in published] == ["preferences.updated"]

    def test_validation(self, alice_client, workspace):
        response = alice_client.patch(preferences_url(workspace.slug), {"minimize_style": "floating"}, format="json")
        assert response.status_code == 400
        for bad in ({"sound_tone": "siren"}, {"sound_volume": 101}, {"sound_volume": -1}):
            assert alice_client.patch(preferences_url(workspace.slug), bad, format="json").status_code == 400

    def test_sound_choice_saved(self, alice_client, workspace):
        response = alice_client.patch(
            preferences_url(workspace.slug), {"sound_tone": "ringtone", "sound_volume": 100}, format="json"
        )
        assert response.status_code == 200
        assert (response.data["sound_tone"], response.data["sound_volume"]) == ("ringtone", 100)

    def test_guest_refused(self, guest_client, workspace):
        assert guest_client.get(preferences_url(workspace.slug)).status_code == 403
