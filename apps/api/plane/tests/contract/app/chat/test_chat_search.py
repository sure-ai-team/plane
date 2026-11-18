# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Message search (docs/chat/phase-2/06-search.md)."""

import pytest

from plane.app.views.chat.search import build_tsquery, safe_snippet

from .conftest import member_url, search_url, send, upload


@pytest.mark.unit
class TestQueryBuilding:
    def test_terms_are_anded_with_prefix_on_last(self):
        assert build_tsquery("store build") == "store & build:*"

    def test_phrase(self):
        assert build_tsquery('"release cut" thursday') == "(release <-> cut) & thursday:*"

    def test_syntax_is_stripped(self):
        assert build_tsquery("a & b | !c:*") == "a & b & c:*"
        assert build_tsquery("&|!") is None

    def test_arabic(self):
        assert build_tsquery("إصدار التطبيق") == "إصدار & التطبيق:*"

    def test_snippet_escapes_html_but_keeps_marks(self):
        assert safe_snippet("<b>x</b> hit") == "&lt;b&gt;x&lt;/b&gt; <mark>hit</mark>"


@pytest.mark.contract
@pytest.mark.django_db
class TestSearch:
    def test_finds_with_prefix_and_highlight(self, owner_client, alice_client, workspace, group):
        send(owner_client, workspace.slug, group["id"], "No new store build is needed")
        send(owner_client, workspace.slug, group["id"], "Lunch at one")
        response = alice_client.get(search_url(workspace.slug) + "?q=store bui")
        assert response.status_code == 200
        assert len(response.data["results"]) == 1
        hit = response.data["results"][0]
        assert hit["conversation"]["id"] == group["id"]
        assert "<mark>store</mark>" in hit["snippet_html"] and "<mark>build</mark>" in hit["snippet_html"]
        assert response.data["total_estimate"] == 1

    def test_arabic_text(self, owner_client, workspace, group):
        send(owner_client, workspace.slug, group["id"], "موعد إصدار التطبيق يوم الخميس")
        response = owner_client.get(search_url(workspace.slug) + "?q=إصدار")
        assert len(response.data["results"]) == 1

    def test_outsider_and_former_member_see_nothing(
        self, owner_client, alice_client, bob_client, bob, workspace, group, direct
    ):
        send(owner_client, workspace.slug, direct["id"], "secret roadmap")
        assert bob_client.get(search_url(workspace.slug) + "?q=secret").data["results"] == []

        send(owner_client, workspace.slug, group["id"], "group roadmap")
        assert len(bob_client.get(search_url(workspace.slug) + "?q=roadmap").data["results"]) == 1
        owner_client.delete(member_url(workspace.slug, group["id"], bob.id))
        assert bob_client.get(search_url(workspace.slug) + "?q=roadmap").data["results"] == []

    def test_conversation_filter_requires_membership(self, owner_client, bob_client, workspace, direct):
        response = bob_client.get(search_url(workspace.slug) + f"?q=hello&conversation_id={direct['id']}")
        assert response.status_code == 404

    def test_snippet_never_contains_message_html(self, owner_client, workspace, group):
        send(owner_client, workspace.slug, group["id"], "deploy &lt;img src=x onerror=alert(1)&gt; today")
        hit = owner_client.get(search_url(workspace.slug) + "?q=deploy").data["results"][0]
        assert "<img" not in hit["snippet_html"]

    def test_from_and_has_filters(self, owner_client, alice_client, alice, storage, workspace, group):
        send(alice_client, workspace.slug, group["id"], "alice plan")
        send(owner_client, workspace.slug, group["id"], "owner plan")
        results = owner_client.get(search_url(workspace.slug) + f"?q=plan&from={alice.id}").data["results"]
        assert [r["message"]["sender"]["id"] for r in results] == [str(alice.id)]

        asset_id, _, _ = upload(owner_client, storage, workspace.slug, group["id"])
        send(owner_client, workspace.slug, group["id"], "the screenshot", attachment_ids=[asset_id])
        images = owner_client.get(search_url(workspace.slug) + "?has=image").data["results"]
        assert len(images) == 1 and images[0]["attachment_names"] == ["shot.png"]
        link = '<p>see <a href="https://example.com">this</a></p>'
        owner_client.post(
            f"/api/workspaces/{workspace.slug}/chat/conversations/{group['id']}/messages/",
            {"body_html": link},
            format="json",
        )
        links = owner_client.get(search_url(workspace.slug) + "?has=link").data["results"]
        assert len(links) == 1

    def test_paging(self, owner_client, workspace, group):
        for i in range(27):
            send(owner_client, workspace.slug, group["id"], f"standup note {i}")
        first = owner_client.get(search_url(workspace.slug) + "?q=standup").data
        assert len(first["results"]) == 25 and first["next_cursor"]
        assert first["total_estimate"] == 27
        second = owner_client.get(search_url(workspace.slug) + f"?q=standup&cursor={first['next_cursor']}").data
        assert len(second["results"]) == 2 and second["next_cursor"] is None

    def test_validation(self, owner_client, workspace):
        assert owner_client.get(search_url(workspace.slug) + "?q=a").status_code == 400
        assert owner_client.get(search_url(workspace.slug) + "?has=gif").status_code == 400

    def test_uses_the_search_index(self, db):
        """The search filter must match the GIN expression index exactly, or
        Postgres falls back to scanning every message (06-search.md)."""
        from django.contrib.postgres.search import SearchQuery, SearchVector
        from django.db import connection

        from plane.db.models import Message

        queryset = Message.objects.annotate(search=SearchVector("body_stripped", config="simple")).filter(
            search=SearchQuery("x:*", search_type="raw", config="simple")
        )
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL enable_seqscan = off")
            plan = queryset.explain()
        assert "chat_msg_search_idx" in plan
