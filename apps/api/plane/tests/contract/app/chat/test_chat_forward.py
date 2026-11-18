# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Forwarding messages (docs/chat/phase-2/DECISIONS.md P2-D6)."""

import pytest

from plane.db.models import FileAsset, Message

from .conftest import conversations_url, forward_url, messages_url, send, upload


@pytest.mark.contract
@pytest.mark.django_db
class TestForward:
    def test_forward_copies_body_and_files(self, owner_client, workspace, group, direct, storage):
        asset_id, key, _ = upload(owner_client, storage, workspace.slug, group["id"])
        original = send(owner_client, workspace.slug, group["id"], "the screen", attachment_ids=[asset_id]).data
        response = owner_client.post(
            forward_url(workspace.slug, original["id"]),
            {"conversation_ids": [direct["id"]], "comment_html": "<p>fyi</p>"},
            format="json",
        )
        assert response.status_code == 201
        new_id = response.data["messages"][0]["id"]
        copy = Message.objects.get(id=new_id)
        assert copy.conversation_id.hex == direct["id"].replace("-", "")
        assert copy.meta["forwarded_from"]["message_id"] == original["id"]

        copied_assets = list(FileAsset.objects.filter(chat_message=copy))
        assert len(copied_assets) == 1 and copied_assets[0].asset.name != key
        assert storage.copied and storage.copied[0][0] == key

        page = owner_client.get(messages_url(workspace.slug, direct["id"])).data["results"]
        assert page[-2]["body_stripped"] == "fyi"
        assert page[-1]["forwarded_from"]["conversation_id"] == group["id"]  # owner is in the source group
        assert page[-1]["forwarded_from"]["conversation_name"] == "Release"
        assert "forwarded_from" not in page[-1]["meta"]

    def test_source_hidden_from_non_members(self, owner_client, workspace, group, make_member):
        carol = make_member("carol")
        from .conftest import client_for

        carol_client = client_for(carol)
        target = owner_client.post(
            conversations_url(workspace.slug), {"type": "direct", "user_id": str(carol.id)}, format="json"
        ).data
        original = send(owner_client, workspace.slug, group["id"], "internal").data
        owner_client.post(
            forward_url(workspace.slug, original["id"]), {"conversation_ids": [target["id"]]}, format="json"
        )
        seen = carol_client.get(messages_url(workspace.slug, target["id"])).data["results"][-1]
        assert seen["forwarded_from"]["conversation_id"] is None
        assert seen["forwarded_from"]["conversation_name"] is None
        assert seen["forwarded_from"]["sender_name"]

    def test_target_must_be_a_membership(self, owner_client, bob_client, workspace, direct, group):
        original = send(bob_client, workspace.slug, group["id"], "x").data
        response = bob_client.post(
            forward_url(workspace.slug, original["id"]), {"conversation_ids": [direct["id"]]}, format="json"
        )
        assert response.status_code == 404

    def test_limit(self, owner_client, workspace, group):
        original = send(owner_client, workspace.slug, group["id"]).data
        ids = [group["id"]] * 1 + [str(__import__("uuid").uuid4()) for _ in range(5)]
        response = owner_client.post(
            forward_url(workspace.slug, original["id"]), {"conversation_ids": ids}, format="json"
        )
        assert response.status_code == 400 and response.data["code"] == "FORWARD_LIMIT"

    def test_forwarding_a_forward_keeps_the_original_source(self, owner_client, workspace, group, direct):
        original = send(owner_client, workspace.slug, group["id"], "origin").data
        first = owner_client.post(
            forward_url(workspace.slug, original["id"]), {"conversation_ids": [direct["id"]]}, format="json"
        ).data["messages"][0]
        second = owner_client.post(
            forward_url(workspace.slug, first["id"]), {"conversation_ids": [group["id"]]}, format="json"
        ).data["messages"][0]
        assert Message.objects.get(id=second["id"]).meta["forwarded_from"]["message_id"] == original["id"]

    def test_events_split_by_source_membership(
        self, owner_client, workspace, group, make_member, published, django_capture_on_commit_callbacks
    ):
        carol = make_member("carol")
        target = owner_client.post(
            conversations_url(workspace.slug), {"type": "direct", "user_id": str(carol.id)}, format="json"
        ).data
        original = send(owner_client, workspace.slug, group["id"], "split").data
        published.clear()
        with django_capture_on_commit_callbacks(execute=True):
            owner_client.post(
                forward_url(workspace.slug, original["id"]), {"conversation_ids": [target["id"]]}, format="json"
            )
        created = [event for event in published if event[0] == "message.created"]
        by_recipient = {tuple(event[2]): event[1]["message"]["forwarded_from"] for event in created}
        assert by_recipient[(str(carol.id),)]["conversation_id"] is None
        owner_view = next(value for key, value in by_recipient.items() if str(carol.id) not in key)
        assert owner_view["conversation_id"] == group["id"]
        assert all("reactions" not in event[1]["message"] for event in created)
