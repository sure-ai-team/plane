# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Jumping to a message: around_seq paging and the single-message GET (P2-D7)."""

import pytest

from .conftest import message_url, messages_url, send


@pytest.mark.contract
@pytest.mark.django_db
class TestAround:
    def test_window_centred_on_seq(self, owner_client, workspace, group):
        for i in range(20):
            send(owner_client, workspace.slug, group["id"], f"m{i}")
        # seq 1 is the "created" system line, so "m9" is seq 11.
        response = owner_client.get(messages_url(workspace.slug, group["id"]) + "?around_seq=11&limit=6")
        assert response.status_code == 200
        seqs = [message["seq"] for message in response.data["results"]]
        assert seqs == [8, 9, 10, 11, 12, 13]
        assert response.data["has_before"] is True and response.data["has_after"] is True

    def test_edges(self, owner_client, workspace, group):
        for i in range(3):
            send(owner_client, workspace.slug, group["id"], f"m{i}")
        response = owner_client.get(messages_url(workspace.slug, group["id"]) + "?around_seq=1&limit=10")
        assert [m["seq"] for m in response.data["results"]] == [1, 2, 3, 4]
        assert response.data["has_before"] is False and response.data["has_after"] is False

    def test_params_are_exclusive(self, owner_client, workspace, group):
        response = owner_client.get(messages_url(workspace.slug, group["id"]) + "?around_seq=2&before_seq=5")
        assert response.status_code == 400

    def test_message_detail_for_links(self, owner_client, bob_client, workspace, group, direct):
        message = send(owner_client, workspace.slug, group["id"], "link me").data
        response = owner_client.get(message_url(workspace.slug, message["id"]))
        assert response.status_code == 200 and response.data["seq"] == message["seq"]
        private = send(owner_client, workspace.slug, direct["id"], "private").data
        assert bob_client.get(message_url(workspace.slug, private["id"])).status_code == 404
