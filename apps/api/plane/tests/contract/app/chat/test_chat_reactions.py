# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Reactions (docs/chat/phase-2/02-api-contracts.md § Reactions)."""

import pytest

from plane.app.views.chat.reaction import is_single_emoji
from plane.db.models import MessageReaction

from .conftest import reaction_url, reactions_url, send


@pytest.mark.unit
@pytest.mark.parametrize(
    "value",
    ["👍", "❤️", "👍🏽", "👨‍💻", "👨‍👩‍👧‍👦", "🇸🇦", "#️⃣", "1️⃣", "❤️‍🔥", "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "✅", "🎉"],
)
def test_single_emoji_accepted(value):
    assert is_single_emoji(value)


@pytest.mark.unit
@pytest.mark.parametrize(
    "value",
    ["", "a", "ok", "👍👍", "👍 ", "1", "#", "🇸", "🇸🇦🇸", "<script>", "👍a", "‍👍", "x" * 40],
)
def test_non_emoji_rejected(value):
    assert not is_single_emoji(value)


@pytest.mark.contract
@pytest.mark.django_db
class TestReactions:
    def test_add_is_idempotent_and_summarised(self, owner_client, alice_client, workspace, group):
        message_id = send(owner_client, workspace.slug, group["id"], "ship it").data["id"]
        first = alice_client.post(reactions_url(workspace.slug, message_id), {"emoji": "🎉"}, format="json")
        assert first.status_code == 201
        assert first.data == [{"emoji": "🎉", "count": 1, "reacted": True, "user_ids": [first.data[0]["user_ids"][0]]}]
        again = alice_client.post(reactions_url(workspace.slug, message_id), {"emoji": "🎉"}, format="json")
        assert again.status_code == 200
        owner_client.post(reactions_url(workspace.slug, message_id), {"emoji": "🎉"}, format="json")

        page = owner_client.get(f"/api/workspaces/{workspace.slug}/chat/conversations/{group['id']}/messages/")
        message = next(m for m in page.data["results"] if m["id"] == message_id)
        assert message["reactions"][0]["count"] == 2
        assert message["reactions"][0]["reacted"] is True

    def test_remove(self, owner_client, alice_client, workspace, group):
        message_id = send(owner_client, workspace.slug, group["id"]).data["id"]
        alice_client.post(reactions_url(workspace.slug, message_id), {"emoji": "👍"}, format="json")
        response = alice_client.delete(reaction_url(workspace.slug, message_id, "👍"))
        assert response.status_code == 204
        assert not MessageReaction.objects.filter(message_id=message_id).exists()

    def test_invalid_emoji(self, owner_client, workspace, group):
        message_id = send(owner_client, workspace.slug, group["id"]).data["id"]
        response = owner_client.post(reactions_url(workspace.slug, message_id), {"emoji": "lol"}, format="json")
        assert response.status_code == 400
        assert response.data["code"] == "INVALID_EMOJI"

    def test_limit_of_distinct_emoji(self, owner_client, workspace, group):
        message_id = send(owner_client, workspace.slug, group["id"]).data["id"]
        emoji = [chr(code) for code in range(0x1F600, 0x1F600 + 21)]
        for value in emoji[:20]:
            assert (
                owner_client.post(
                    reactions_url(workspace.slug, message_id), {"emoji": value}, format="json"
                ).status_code
                == 201
            )
        response = owner_client.post(reactions_url(workspace.slug, message_id), {"emoji": emoji[20]}, format="json")
        assert response.status_code == 400
        assert response.data["code"] == "REACTION_LIMIT"

    def test_system_message_refused(self, owner_client, workspace, group):
        page = owner_client.get(f"/api/workspaces/{workspace.slug}/chat/conversations/{group['id']}/messages/")
        system_id = page.data["results"][0]["id"]
        response = owner_client.post(reactions_url(workspace.slug, system_id), {"emoji": "👍"}, format="json")
        assert response.status_code == 400
        assert response.data["code"] == "CANNOT_REACT"

    def test_outsider_gets_404(self, owner_client, workspace, direct, bob_client):
        message_id = send(owner_client, workspace.slug, direct["id"]).data["id"]
        response = bob_client.post(reactions_url(workspace.slug, message_id), {"emoji": "👍"}, format="json")
        assert response.status_code == 404

    def test_event_published_to_members(
        self, owner_client, alice_client, workspace, group, published, django_capture_on_commit_callbacks
    ):
        message_id = send(owner_client, workspace.slug, group["id"]).data["id"]
        published.clear()
        with django_capture_on_commit_callbacks(execute=True):
            alice_client.post(reactions_url(workspace.slug, message_id), {"emoji": "👀"}, format="json")
        events = [event for event in published if event[0] == "reaction.updated"]
        assert len(events) == 1
        _, data, recipients, _ = events[0]
        assert data["emoji"] == "👀" and data["count"] == 1 and data["added"] is True
        assert len(recipients) == 3

    def test_who_reacted(self, owner_client, alice_client, alice, workspace, group):
        message_id = send(owner_client, workspace.slug, group["id"]).data["id"]
        alice_client.post(reactions_url(workspace.slug, message_id), {"emoji": "👍"}, format="json")
        response = owner_client.get(reactions_url(workspace.slug, message_id) + "?emoji=👍")
        assert response.status_code == 200
        assert [row["user_id"] for row in response.data] == [str(alice.id)]
