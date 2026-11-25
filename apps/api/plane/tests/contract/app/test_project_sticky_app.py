# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Project stickies: who may see, edit, share, pin and delete them."""

import uuid

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import (
    Project,
    ProjectMember,
    Sticky,
    StickyAccess,
    StickyShare,
    User,
    WorkspaceMember,
)

ADMIN, MEMBER, GUEST = 20, 15, 5
OK, CREATED, NO_CONTENT = status.HTTP_200_OK, status.HTTP_201_CREATED, status.HTTP_204_NO_CONTENT
BAD_REQUEST, FORBIDDEN = status.HTTP_400_BAD_REQUEST, status.HTTP_403_FORBIDDEN
NOT_FOUND, CONFLICT = status.HTTP_404_NOT_FOUND, status.HTTP_409_CONFLICT

pytestmark = [pytest.mark.contract, pytest.mark.django_db]


def make_user(name):
    return User.objects.create(email=f"{name}@sure.com.sa", username=f"{name}_{uuid.uuid4().hex[:8]}")


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def ids(response):
    assert response.status_code == OK, response.content
    return {item["id"] for item in response.json()["results"]}


class World:
    """A project with one person per role, and the sticky API as seen by each of them."""

    def __init__(self, workspace):
        self.workspace = workspace
        self.project = self.make_project("PRJA")
        self.owner = self.join("owner", MEMBER)
        self.member = self.join("member", MEMBER)
        self.other = self.join("other", MEMBER)
        self.admin = self.join("admin", ADMIN)
        self.guest = self.join("guest", GUEST)

    def make_project(self, identifier):
        return Project.objects.create(name=f"Project {identifier}", identifier=identifier, workspace=self.workspace)

    def join(self, name, role, project=None):
        user = make_user(name)
        WorkspaceMember.objects.create(workspace=self.workspace, member=user, role=min(role, MEMBER))
        ProjectMember.objects.create(workspace=self.workspace, project=project or self.project, member=user, role=role)
        return user

    def url(self, sticky=None, suffix="", project=None):
        project = project or self.project
        base = f"/api/workspaces/{self.workspace.slug}/projects/{project.id}/stickies/"
        return f"{base}{sticky.id}/{suffix}" if sticky else base

    def sticky(self, access=StickyAccess.PRIVATE, project_permission="view", shares=None, owner=None, **kwargs):
        sticky = Sticky.objects.create(
            workspace=self.workspace,
            project=self.project,
            owner=owner or self.owner,
            access=access,
            project_permission=project_permission,
            description_html="<p>note</p>",
            **kwargs,
        )
        for user, permission in (shares or {}).items():
            StickyShare.objects.create(workspace=self.workspace, sticky=sticky, member=user, permission=permission)
        return sticky

    def edit(self, user, sticky, text="<p>changed</p>", **payload):
        payload = {"description_html": text, "content_version": sticky.content_version, **payload}
        return client_for(user).patch(self.url(sticky), payload, format="json")

    def share(self, user, sticky, access, members=None, project_permission="view"):
        payload = {
            "access": access,
            "project_permission": project_permission,
            "members": [{"member_id": str(m.id), "permission": p} for m, p in (members or {}).items()],
        }
        return client_for(user).put(self.url(sticky, "shares/"), payload, format="json")


@pytest.fixture
def world(workspace):
    return World(workspace)


class TestAccessMatrix:
    """Read / edit / manage, for every role and kind of sharing."""

    # sharing -> {person: my_permission, or None when the sticky is invisible}
    MATRIX = {
        "private": {"owner": "manage", "member": None, "other": None, "admin": None, "guest": None},
        "member_view": {"owner": "manage", "member": "view", "other": None, "admin": "manage", "guest": None},
        "member_edit": {"owner": "manage", "member": "edit", "other": None, "admin": "manage", "guest": None},
        "guest_view": {"owner": "manage", "member": None, "other": None, "admin": "manage", "guest": "view"},
        "project_view": {"owner": "manage", "member": "view", "other": "view", "admin": "manage", "guest": None},
        "project_edit": {"owner": "manage", "member": "edit", "other": "edit", "admin": "manage", "guest": None},
        "project_view_member_edit": {
            "owner": "manage",
            "member": "edit",
            "other": "view",
            "admin": "manage",
            "guest": None,
        },
    }

    def build(self, world, sharing):
        return {
            "private": lambda: world.sticky(),
            "member_view": lambda: world.sticky(StickyAccess.MEMBERS, shares={world.member: "view"}),
            "member_edit": lambda: world.sticky(StickyAccess.MEMBERS, shares={world.member: "edit"}),
            "guest_view": lambda: world.sticky(StickyAccess.MEMBERS, shares={world.guest: "view"}),
            "project_view": lambda: world.sticky(StickyAccess.PROJECT),
            "project_edit": lambda: world.sticky(StickyAccess.PROJECT, "edit"),
            "project_view_member_edit": lambda: world.sticky(StickyAccess.PROJECT, shares={world.member: "edit"}),
        }[sharing]()

    @pytest.mark.parametrize("sharing", MATRIX)
    @pytest.mark.parametrize("person", ["owner", "member", "other", "admin", "guest"])
    def test_matrix(self, world, sharing, person):
        sticky = self.build(world, sharing)
        user = getattr(world, person)
        expected = self.MATRIX[sharing][person]
        client = client_for(user)

        # list and detail agree
        assert ids(client.get(world.url())) == ({str(sticky.id)} if expected else set())
        detail = client.get(world.url(sticky))
        if expected is None:
            assert detail.status_code == NOT_FOUND
        else:
            assert detail.json()["my_permission"] == expected

        denied = NOT_FOUND if expected is None else FORBIDDEN
        can_edit = expected in ("edit", "manage")
        assert world.edit(user, sticky).status_code == (OK if can_edit else denied)
        assert client.patch(world.url(sticky), {"background_color": "gray"}, format="json").status_code == (
            OK if can_edit else denied
        )

        can_manage = expected == "manage"
        pin = client.post(world.url(sticky, "pin/"))
        if can_manage:
            assert pin.status_code == (OK if sticky.access == StickyAccess.PROJECT else BAD_REQUEST)
        else:
            assert pin.status_code == denied
        assert client.delete(world.url(sticky, "pin/")).status_code == (OK if can_manage else denied)
        assert world.share(user, sticky, StickyAccess.PROJECT).status_code == (OK if can_manage else denied)
        assert client.delete(world.url(sticky)).status_code == (NO_CONTENT if can_manage else denied)

    def test_guest_sees_project_wide_when_the_project_allows_it(self, world):
        sticky = world.sticky(StickyAccess.PROJECT, "edit")
        world.project.guest_view_all_features = True
        world.project.save()

        response = client_for(world.guest).get(world.url(sticky))
        assert response.json()["my_permission"] == "view"
        assert world.edit(world.guest, sticky).status_code == FORBIDDEN

    def test_owner_demoted_to_guest_can_only_view(self, world):
        sticky = world.sticky()
        ProjectMember.objects.filter(member=world.owner).update(role=GUEST)

        assert client_for(world.owner).get(world.url(sticky)).json()["my_permission"] == "view"
        assert world.edit(world.owner, sticky).status_code == FORBIDDEN

    def test_workspace_admin_who_is_a_project_member_acts_as_admin(self, world):
        sticky = world.sticky(StickyAccess.MEMBERS, shares={world.member: "view"})
        WorkspaceMember.objects.filter(member=world.guest).update(role=ADMIN)

        assert client_for(world.guest).get(world.url(sticky)).json()["my_permission"] == "manage"

    def test_leftover_share_does_not_open_a_private_sticky(self, world):
        sticky = world.sticky(StickyAccess.PRIVATE, shares={world.member: "edit"})

        assert client_for(world.member).get(world.url(sticky)).status_code == NOT_FOUND


class TestMembershipBoundary:
    def test_removed_member_loses_access_at_once(self, world):
        sticky = world.sticky(StickyAccess.MEMBERS, shares={world.member: "edit"})
        ProjectMember.objects.filter(member=world.member).update(is_active=False)

        client = client_for(world.member)
        assert client.get(world.url()).status_code == FORBIDDEN
        assert client.get(world.url(sticky)).status_code == FORBIDDEN
        assert world.edit(world.member, sticky).status_code == FORBIDDEN
        # and is no longer shown as someone it is shared with
        assert client_for(world.owner).get(world.url(sticky)).json()["shares"] == []

    def test_removed_owner_loses_access(self, world):
        sticky = world.sticky()
        ProjectMember.objects.filter(member=world.owner).update(is_active=False)

        assert client_for(world.owner).get(world.url(sticky)).status_code == FORBIDDEN

    def test_workspace_admin_outside_the_project_is_denied(self, world, session_client):
        sticky = world.sticky(StickyAccess.PROJECT)

        assert session_client.get(world.url()).status_code == FORBIDDEN
        assert session_client.get(world.url(sticky)).status_code == FORBIDDEN

    def test_sticky_is_not_reachable_through_another_project(self, world):
        sticky = world.sticky(StickyAccess.PROJECT, "edit")
        project_b = world.make_project("PRJB")
        outsider = world.join("outsider", ADMIN, project=project_b)
        client = client_for(outsider)

        assert ids(client.get(world.url(project=project_b))) == set()
        url = world.url(sticky, project=project_b)
        assert client.get(url).status_code == NOT_FOUND
        assert client.patch(url, {"background_color": "gray"}, format="json").status_code == NOT_FOUND
        assert client.delete(url).status_code == NOT_FOUND
        assert client.post(world.url(sticky, "pin/", project=project_b)).status_code == NOT_FOUND
        assert (
            client.put(world.url(sticky, "shares/", project=project_b), {"access": 2}, format="json").status_code
            == NOT_FOUND
        )

    def test_archived_project_is_closed(self, world):
        world.sticky(StickyAccess.PROJECT)
        Project.objects.filter(pk=world.project.pk).update(archived_at=timezone.now())

        assert client_for(world.owner).get(world.url()).status_code == FORBIDDEN

    def test_anonymous_is_denied(self, world):
        assert APIClient().get(world.url()).status_code in (status.HTTP_401_UNAUTHORIZED, FORBIDDEN)


class TestCreate:
    def test_member_creates_a_private_sticky(self, world):
        response = client_for(world.member).post(
            world.url(), {"description_html": "<p>hello</p>", "background_color": "gray"}, format="json"
        )

        assert response.status_code == CREATED, response.content
        body = response.json()
        assert body["access"] == StickyAccess.PRIVATE
        assert body["my_permission"] == "manage"
        assert body["shares"] == []
        sticky = Sticky.objects.get(pk=body["id"])
        assert sticky.project_id == world.project.id
        assert sticky.owner_id == world.member.id
        assert sticky.description_stripped == "hello"

    def test_guest_cannot_create(self, world):
        assert client_for(world.guest).post(world.url(), {}, format="json").status_code == FORBIDDEN

    def test_sharing_and_ownership_cannot_be_set_through_the_sticky_itself(self, world):
        project_b = world.make_project("PRJB")
        forged = {
            "access": StickyAccess.PROJECT,
            "project_permission": "edit",
            "project": str(project_b.id),
            "owner": str(world.other.id),
            "pinned_at": timezone.now().isoformat(),
            "content_version": 99,
            "deleted_at": timezone.now().isoformat(),
        }
        created = client_for(world.member).post(world.url(), forged, format="json").json()
        sticky = Sticky.objects.get(pk=created["id"])
        client_for(world.member).patch(world.url(sticky), forged, format="json")
        sticky.refresh_from_db()

        assert (sticky.access, sticky.project_permission) == (StickyAccess.PRIVATE, "view")
        assert (sticky.project_id, sticky.owner_id) == (world.project.id, world.member.id)
        assert (sticky.pinned_at, sticky.content_version, sticky.deleted_at) == (None, 1, None)

    def test_sort_order_is_counted_per_project(self, world):
        Sticky.objects.create(workspace=world.workspace, owner=world.owner)
        Sticky.objects.create(workspace=world.workspace, owner=world.owner)
        first, second = world.sticky(), world.sticky()

        assert first.sort_order == 65535
        assert second.sort_order == 75535


class TestList:
    def test_search(self, world):
        match = world.sticky()
        Sticky.objects.filter(pk=match.pk).update(description_stripped="Quarterly budget")
        world.sticky()

        assert ids(client_for(world.owner).get(world.url(), {"query": "budget"})) == {str(match.id)}

    def test_newest_first(self, world):
        first, second = world.sticky(), world.sticky()

        results = client_for(world.owner).get(world.url()).json()["results"]
        assert [item["id"] for item in results] == [str(second.id), str(first.id)]

    def test_pinned_filter_respects_visibility(self, world):
        pinned = world.sticky(StickyAccess.PROJECT, pinned_at=timezone.now())
        world.sticky(StickyAccess.PROJECT)

        assert ids(client_for(world.member).get(world.url(), {"pinned": "true"})) == {str(pinned.id)}
        assert ids(client_for(world.guest).get(world.url(), {"pinned": "true"})) == set()

    def test_query_count_does_not_grow_with_stickies(self, world, django_assert_max_num_queries):
        for _ in range(8):
            world.sticky(StickyAccess.PROJECT, shares={world.member: "edit", world.other: "view"})

        with django_assert_max_num_queries(8):
            assert len(ids(client_for(world.member).get(world.url()))) == 8


class TestConcurrentEditing:
    def test_content_change_increments_the_version(self, world):
        sticky = world.sticky()

        response = world.edit(world.owner, sticky, "<p>new</p>")
        assert response.status_code == OK
        assert response.json()["content_version"] == 2
        assert response.json()["description_html"] == "<p>new</p>"

    def test_stale_save_is_refused_and_returns_the_current_sticky(self, world):
        sticky = world.sticky(StickyAccess.PROJECT, "edit")
        assert world.edit(world.member, sticky, "<p>first</p>").status_code == OK

        response = world.edit(world.other, sticky, "<p>second</p>")  # still based on version 1
        assert response.status_code == CONFLICT
        assert response.json()["sticky"]["description_html"] == "<p>first</p>"
        assert response.json()["sticky"]["content_version"] == 2
        sticky.refresh_from_db()
        assert sticky.description_html == "<p>first</p>"

    @pytest.mark.parametrize("version", [None, "1", True])
    def test_content_change_needs_a_version(self, world, version):
        sticky = world.sticky()

        assert world.edit(world.owner, sticky, content_version=version).status_code == BAD_REQUEST

    def test_colour_order_and_pin_do_not_conflict_with_typing(self, world):
        sticky = world.sticky(StickyAccess.PROJECT, "edit")
        client = client_for(world.owner)
        client.patch(world.url(sticky), {"background_color": "gray", "sort_order": 5}, format="json")
        client.post(world.url(sticky, "pin/"))

        assert world.edit(world.member, sticky).status_code == OK


class TestSharing:
    def test_replaces_the_previous_sharing(self, world):
        sticky = world.sticky()
        response = world.share(world.owner, sticky, StickyAccess.MEMBERS, {world.member: "edit", world.guest: "view"})
        assert response.status_code == OK, response.content

        response = world.share(world.owner, sticky, StickyAccess.MEMBERS, {world.member: "view", world.other: "edit"})
        assert {s["member_id"]: s["permission"] for s in response.json()["shares"]} == {
            str(world.member.id): "view",
            str(world.other.id): "edit",
        }
        assert client_for(world.guest).get(world.url(sticky)).status_code == NOT_FOUND

    def test_member_can_be_shared_with_again_after_removal(self, world):
        sticky = world.sticky()
        world.share(world.owner, sticky, StickyAccess.MEMBERS, {world.member: "edit"})
        world.share(world.owner, sticky, StickyAccess.PRIVATE)
        assert client_for(world.member).get(world.url(sticky)).status_code == NOT_FOUND

        assert world.share(world.owner, sticky, StickyAccess.MEMBERS, {world.member: "view"}).status_code == OK
        assert client_for(world.member).get(world.url(sticky)).json()["my_permission"] == "view"

    def test_narrowing_access_unpins(self, world):
        sticky = world.sticky(StickyAccess.PROJECT, pinned_at=timezone.now())

        response = world.share(world.owner, sticky, StickyAccess.MEMBERS, {world.member: "view"})
        assert response.json()["pinned_at"] is None

    def test_admin_making_anothers_sticky_private_loses_sight_of_it(self, world):
        sticky = world.sticky(StickyAccess.PROJECT)

        assert world.share(world.admin, sticky, StickyAccess.PRIVATE).status_code == NO_CONTENT
        assert client_for(world.owner).get(world.url(sticky)).json()["access"] == StickyAccess.PRIVATE

    def test_rejected_member_lists(self, world):
        sticky = world.sticky()
        outsider = make_user("outsider")
        removed = world.join("removed", MEMBER)
        ProjectMember.objects.filter(member=removed).update(is_active=False)

        members = StickyAccess.MEMBERS
        assert world.share(world.owner, sticky, members).status_code == BAD_REQUEST
        assert world.share(world.owner, sticky, members, {outsider: "view"}).status_code == BAD_REQUEST
        assert world.share(world.owner, sticky, members, {removed: "view"}).status_code == BAD_REQUEST
        assert world.share(world.owner, sticky, members, {world.owner: "view"}).status_code == BAD_REQUEST
        assert world.share(world.owner, sticky, members, {world.guest: "edit"}).status_code == BAD_REQUEST
        assert world.share(world.owner, sticky, members, {world.member: "manage"}).status_code == BAD_REQUEST
        assert world.share(world.owner, sticky, StickyAccess.PRIVATE, {world.member: "view"}).status_code == BAD_REQUEST
        assert world.share(world.owner, sticky, 7).status_code == BAD_REQUEST
        duplicate = [{"member_id": str(world.member.id), "permission": p} for p in ("view", "edit")]
        response = client_for(world.owner).put(
            world.url(sticky, "shares/"), {"access": members, "members": duplicate}, format="json"
        )
        assert response.status_code == BAD_REQUEST

        sticky.refresh_from_db()
        assert sticky.access == StickyAccess.PRIVATE
        assert not StickyShare.objects.filter(sticky=sticky).exists()


class TestPin:
    def test_pin_is_shared_and_idempotent(self, world):
        sticky = world.sticky(StickyAccess.PROJECT)

        first = client_for(world.owner).post(world.url(sticky, "pin/")).json()
        assert first["pinned_by"] == str(world.owner.id)
        second = client_for(world.admin).post(world.url(sticky, "pin/")).json()
        assert (second["pinned_at"], second["pinned_by"]) == (first["pinned_at"], first["pinned_by"])

        unpinned = client_for(world.admin).delete(world.url(sticky, "pin/")).json()
        assert (unpinned["pinned_at"], unpinned["pinned_by"]) == (None, None)


class TestPersonalStickiesStaySeparate:
    def personal_url(self, world, sticky=None):
        base = f"/api/workspaces/{world.workspace.slug}/stickies/"
        return f"{base}{sticky.id}/" if sticky else base

    def test_project_stickies_are_not_in_the_personal_list(self, world):
        personal = Sticky.objects.create(workspace=world.workspace, owner=world.owner)
        project_sticky = world.sticky()
        client = client_for(world.owner)

        assert ids(client.get(self.personal_url(world))) == {str(personal.id)}
        assert client.get(self.personal_url(world, project_sticky)).status_code == NOT_FOUND
        assert ids(client.get(world.url())) == {str(project_sticky.id)}

    def test_personal_sticky_cannot_be_placed_in_a_project(self, world):
        client = client_for(world.owner)
        forged = {"project": str(world.project.id), "access": StickyAccess.PROJECT, "project_permission": "edit"}

        created = client.post(self.personal_url(world), forged, format="json")
        assert created.status_code == CREATED, created.content
        sticky = Sticky.objects.get(pk=created.json()["id"])
        # created_by is what the personal endpoint authorises updates on
        Sticky.objects.filter(pk=sticky.pk).update(created_by=world.owner)
        assert client.patch(self.personal_url(world, sticky), forged, format="json").status_code == OK

        sticky.refresh_from_db()
        assert (sticky.project_id, sticky.access) == (None, StickyAccess.PRIVATE)

    def test_public_api_lists_personal_stickies_only(self, world, api_key_client, create_user):
        ProjectMember.objects.create(workspace=world.workspace, project=world.project, member=create_user, role=MEMBER)
        personal = Sticky.objects.create(workspace=world.workspace, owner=create_user)
        project_sticky = world.sticky(owner=create_user)
        base = f"/api/v1/workspaces/{world.workspace.slug}/stickies/"

        assert ids(api_key_client.get(base)) == {str(personal.id)}
        assert api_key_client.get(f"{base}{project_sticky.id}/").status_code == NOT_FOUND
        response = api_key_client.patch(f"{base}{personal.id}/", {"project": str(world.project.id)}, format="json")
        assert response.status_code == OK
        personal.refresh_from_db()
        assert personal.project_id is None


class TestModelConstraints:
    def test_personal_sticky_cannot_be_shared(self, world):
        with pytest.raises(IntegrityError), transaction.atomic():
            Sticky.objects.create(workspace=world.workspace, owner=world.owner, access=StickyAccess.PROJECT)

    def test_only_project_wide_stickies_can_be_pinned(self, world):
        with pytest.raises(IntegrityError), transaction.atomic():
            world.sticky(StickyAccess.PRIVATE, pinned_at=timezone.now())

    def test_one_active_share_per_member(self, world):
        sticky = world.sticky(StickyAccess.MEMBERS, shares={world.member: "view"})
        with pytest.raises(IntegrityError), transaction.atomic():
            StickyShare.objects.create(workspace=world.workspace, sticky=sticky, member=world.member, permission="edit")
