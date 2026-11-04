# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Pinned messages (docs/chat/phase-2/02-api-contracts.md § Pins)."""

from unittest.mock import patch

import pytest

from plane.db.models import MessagePin

from .conftest import messages_url, pin_url, pins_url, send


@pytest.mark.contract
@pytest.mark.django_db
class TestPins:
    def test_any_member_pins_and_unpins_with_system_lines(self, owner_client, alice_client, workspace, group):
        message_id = send(owner_client, workspace.slug, group["id"], "release on Thursday").data["id"]
        response = alice_client.post(pin_url(workspace.slug, message_id))
        assert response.status_code == 201

        pins = owner_client.get(pins_url(workspace.slug, group["id"]))
        assert pins.status_code == 200
        assert [pin["id"] for pin in pins.data] == [message_id]
        assert pins.data[0]["is_pinned"] is True

        page = owner_client.get(messages_url(workspace.slug, group["id"])).data["results"]
        assert page[-1]["kind"] == "system" and page[-1]["meta"]["event"] == "pinned"
        assert next(m for m in page if m["id"] == message_id)["is_pinned"] is True

        assert alice_client.post(pin_url(workspace.slug, message_id)).status_code == 200  # idempotent
        assert owner_client.delete(pin_url(workspace.slug, message_id)).status_code == 204
        assert not MessagePin.objects.filter(message_id=message_id).exists()
        last = owner_client.get(messages_url(workspace.slug, group["id"])).data["results"][-1]
        assert last["meta"]["event"] == "unpinned"

    def test_limit(self, owner_client, workspace, group):
        ids = [send(owner_client, workspace.slug, group["id"], f"m{i}").data["id"] for i in range(3)]
        with patch("plane.app.views.chat.pin.MAX_PINS_PER_CONVERSATION", 2):
            assert owner_client.post(pin_url(workspace.slug, ids[0])).status_code == 201
            assert owner_client.post(pin_url(workspace.slug, ids[1])).status_code == 201
            response = owner_client.post(pin_url(workspace.slug, ids[2]))
        assert response.status_code == 400
        assert response.data["code"] == "PIN_LIMIT"

    def test_outsider_and_system_message(self, owner_client, bob_client, workspace, direct, group):
        message_id = send(owner_client, workspace.slug, direct["id"]).data["id"]
        assert bob_client.post(pin_url(workspace.slug, message_id)).status_code == 404
        assert bob_client.get(pins_url(workspace.slug, direct["id"])).status_code == 404
        system_id = owner_client.get(messages_url(workspace.slug, group["id"])).data["results"][0]["id"]
        response = owner_client.post(pin_url(workspace.slug, system_id))
        assert response.status_code == 400 and response.data["code"] == "CANNOT_PIN"

    def test_events(self, owner_client, workspace, group, published, django_capture_on_commit_callbacks):
        message_id = send(owner_client, workspace.slug, group["id"]).data["id"]
        published.clear()
        with django_capture_on_commit_callbacks(execute=True):
            owner_client.post(pin_url(workspace.slug, message_id))
        kinds = [event[0] for event in published]
        assert "pin.added" in kinds and "message.created" in kinds
