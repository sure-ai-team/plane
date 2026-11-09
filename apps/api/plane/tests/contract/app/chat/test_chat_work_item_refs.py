# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Work-item references in messages (P2-D13) and "Discussed in chat"."""

import pytest

from plane.db.models import Issue, MessageWorkItem, Project, ProjectMember, State
from plane.utils.chat_work_items import linked_work_item_keys

from .conftest import message_url, messages_url, send


@pytest.fixture
def project(workspace, create_user, alice):
    project = Project.objects.create(name="Mobile", identifier="MOB", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    ProjectMember.objects.create(project=project, member=alice, role=15, is_active=True)
    return project


@pytest.fixture
def issue(workspace, project, create_user):
    state = State.objects.create(name="Todo", project=project, workspace=workspace, group="backlog", default=True)
    return Issue.objects.create(
        name="Fix login crash", workspace=workspace, project=project, state=state, created_by=create_user
    )


def link(workspace, issue):
    return f'<p>see <a href="/{workspace.slug}/browse/MOB-{issue.sequence_id}/">MOB-{issue.sequence_id}</a></p>'


@pytest.mark.unit
def test_link_parsing():
    html = (
        '<a href="https://pm.example.com/acme/browse/mob-7/">x</a>'
        '<a href="/other/browse/MOB-8/">other workspace</a>'
        '<a href="/acme/projects/11111111-1111-1111-1111-111111111111/'
        'issues/22222222-2222-2222-2222-222222222222/">y</a>'
        '<a href="/acme/browse/MOB-7">duplicate</a>'
    )
    browse, ids = linked_work_item_keys(html, "acme")
    assert browse == [("MOB", 7)]
    assert ids == ["22222222-2222-2222-2222-222222222222"]


@pytest.mark.unit
def test_text_keys_and_urls():
    html = (
        "<p>MOB-3 and WEB-12, again MOB-3. Pasted https://pm.example.com/acme/browse/API-4/, "
        "other workspace /zzz/browse/MOB-9/</p>"
        "<p>not keys: mob-5, covid-19x, x-MOB-6, MOB-7-b, /path/MOB-8</p>"
        "<pre><code>CODE-1</code></pre><p><code>CODE-2</code></p>"
        '<p><a href="/acme/browse/LINK-1/">TEXT-1 in a link</a></p>'
    )
    browse, ids = linked_work_item_keys(html, "acme")
    assert browse == [("LINK", 1), ("API", 4), ("MOB", 3), ("WEB", 12)]
    assert ids == []


@pytest.mark.contract
@pytest.mark.django_db
class TestWorkItemRefs:
    def test_bare_key_and_pasted_url_create_refs(self, owner_client, workspace, group, issue):
        key = f"MOB-{issue.sequence_id}"
        for body in (f"<p>Looking at {key} now</p>", f"<p>http://localhost/{workspace.slug}/browse/{key}/</p>"):
            message = owner_client.post(
                messages_url(workspace.slug, group["id"]), {"body_html": body}, format="json"
            ).data
            assert [ref["id"] for ref in message["work_items"]] == [str(issue.id)]
        # A key with no matching work item is just text.
        message = owner_client.post(
            messages_url(workspace.slug, group["id"]), {"body_html": "<p>UTF-8 and MOB-999</p>"}, format="json"
        ).data
        assert message["work_items"] == []

    def test_refs_extracted_on_send_and_edit(self, owner_client, workspace, group, issue):
        message = owner_client.post(
            messages_url(workspace.slug, group["id"]), {"body_html": link(workspace, issue)}, format="json"
        ).data
        assert message["work_items"] == [
            {
                "id": str(issue.id),
                "project_id": str(issue.project_id),
                "project_identifier": "MOB",
                "sequence_id": issue.sequence_id,
            }
        ]
        owner_client.patch(
            message_url(workspace.slug, message["id"]), {"body_html": "<p>never mind</p>"}, format="json"
        )
        assert not MessageWorkItem.objects.filter(message_id=message["id"]).exists()

    def test_unknown_or_foreign_links_ignored(self, owner_client, workspace, group, issue):
        html = (
            f'<p><a href="/{workspace.slug}/browse/MOB-999/">x</a>'
            f'<a href="/elsewhere/browse/MOB-{issue.sequence_id}/">y</a></p>'
        )
        message = owner_client.post(messages_url(workspace.slug, group["id"]), {"body_html": html}, format="json").data
        assert message["work_items"] == []

    def test_discussed_in_chat_lists_only_my_conversations(
        self, owner_client, alice_client, bob_client, workspace, group, direct, issue, project
    ):
        owner_client.post(
            messages_url(workspace.slug, group["id"]), {"body_html": link(workspace, issue)}, format="json"
        )
        owner_client.post(
            messages_url(workspace.slug, direct["id"]), {"body_html": link(workspace, issue)}, format="json"
        )
        send(owner_client, workspace.slug, group["id"], "unrelated")
        url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/{issue.id}/chat-references/"

        owner_view = owner_client.get(url).data
        assert {row["conversation_id"] for row in owner_view} == {group["id"], direct["id"]}
        assert all(row["count"] == 1 for row in owner_view)

        alice_view = alice_client.get(url).data  # alice is in both
        assert len(alice_view) == 2

        # bob is in the group but not a project member: no access to the work item
        assert bob_client.get(url).status_code == 404
