# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from dataclasses import replace

import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from .conftest import base, conversations_url, send


@pytest.mark.contract
@pytest.mark.django_db
class TestMisc:
    def test_unread_count(self, owner_client, alice_client, workspace, group, direct):
        send(owner_client, workspace.slug, group["id"], "a")
        send(owner_client, workspace.slug, direct["id"], "b")
        response = alice_client.get(f"{base(workspace.slug)}/unread-count/")
        assert response.status_code == 200
        assert response.data["by_conversation"][group["id"]] == 2
        assert response.data["by_conversation"][direct["id"]] == 1
        assert response.data["total"] == 3

    def test_presence(self, owner_client, workspace, alice, mocker):
        mocker.patch("plane.app.views.chat.misc.online_user_ids", side_effect=lambda ids: [str(alice.id)])
        response = owner_client.get(f"{base(workspace.slug)}/presence/")
        assert response.status_code == 200
        assert response.data == {"online_user_ids": [str(alice.id)]}

    def test_config(self, owner_client, workspace):
        response = owner_client.get(f"{base(workspace.slug)}/config/")
        assert response.status_code == 200
        assert response.data["max_image_mb"] == 10
        assert response.data["enabled"] is True

    def test_disabled_returns_404_everywhere(self, owner_client, workspace, chat_enabled, mocker):
        mocker.patch("plane.app.views.chat.base.get_chat_config", return_value=replace(chat_enabled, enabled=False))
        for url in (conversations_url(workspace.slug), f"{base(workspace.slug)}/unread-count/"):
            response = owner_client.get(url)
            assert response.status_code == 404
            assert response.data["code"] == "CHAT_DISABLED"

    def test_unauthenticated_refused(self, api_client, workspace):
        assert api_client.get(conversations_url(workspace.slug)).status_code in (401, 403)


@pytest.mark.contract
@pytest.mark.django_db
class TestLiveEndpoints:
    def test_member_ids_requires_secret(self, workspace, group, owner, alice, bob):
        url = f"{base(workspace.slug)}/live/conversations/{group['id']}/member-ids/"
        client = APIClient()
        with override_settings(LIVE_SERVER_SECRET_KEY="s3cret"):
            assert client.get(url).status_code == 403
            assert client.get(url, HTTP_X_LIVE_SECRET="wrong").status_code == 403
            response = client.get(url, HTTP_X_LIVE_SECRET="s3cret")
        assert response.status_code == 200
        assert sorted(response.data["member_ids"]) == sorted([str(owner.id), str(alice.id), str(bob.id)])

    def test_member_ids_refused_when_secret_unset(self, workspace, group):
        url = f"{base(workspace.slug)}/live/conversations/{group['id']}/member-ids/"
        with override_settings(LIVE_SERVER_SECRET_KEY=""):
            assert APIClient().get(url, HTTP_X_LIVE_SECRET="").status_code == 403

    def test_member_ids_scoped_to_workspace(self, workspace, group, owner):
        from plane.db.models import Workspace

        other = Workspace.objects.create(name="Other", slug="other-live", owner=owner)
        url = f"{base(other.slug)}/live/conversations/{group['id']}/member-ids/"
        with override_settings(LIVE_SERVER_SECRET_KEY="s3cret"):
            assert APIClient().get(url, HTTP_X_LIVE_SECRET="s3cret").status_code == 404

    def test_access_check(self, workspace, alice, guest):
        client = APIClient()
        with override_settings(LIVE_SERVER_SECRET_KEY="s3cret"):
            member = client.get(f"{base(workspace.slug)}/live/users/{alice.id}/access/", HTTP_X_LIVE_SECRET="s3cret")
            denied = client.get(f"{base(workspace.slug)}/live/users/{guest.id}/access/", HTTP_X_LIVE_SECRET="s3cret")
        assert member.data == {"allowed": True}
        assert denied.data == {"allowed": False}
