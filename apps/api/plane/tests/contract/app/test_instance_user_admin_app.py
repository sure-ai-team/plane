# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Instance admin endpoints for managing existing accounts (admin console > Users > All users)."""

import pytest
from django.urls import reverse
from django.utils import timezone
from rest_framework import status

from plane.db.models import Page, Project, ProjectMember, Session, User, Workspace, WorkspaceMember
from plane.license.models import Instance, InstanceAdmin


@pytest.fixture
def instance_admin(db, create_user):
    instance = Instance.objects.create(
        instance_name="Test", instance_id="test-instance", current_version="1.0", last_checked_at=timezone.now()
    )
    InstanceAdmin.objects.create(user=create_user, instance=instance, role=20)
    return create_user


@pytest.fixture
def member(db, workspace):
    """A regular member of the test workspace, in one project."""
    user = User.objects.create(email="omnia@x.com", username="omnia", first_name="Omnia", display_name="osaeed")
    user.set_password("Old-pass-12345!")
    user.save()
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
    return user


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(name="Web", identifier="WEB", workspace=workspace)
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    return project


def url(name, **kwargs):
    return reverse(name, kwargs=kwargs)


@pytest.mark.contract
@pytest.mark.django_db
class TestInstanceUserList:
    def test_requires_instance_admin(self, session_client, member):
        assert session_client.get(reverse("instance-user-create")).status_code == status.HTTP_403_FORBIDDEN
        response = session_client.post(url("instance-user-activation", pk=member.pk), {"is_active": False})
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert User.objects.get(pk=member.pk).is_active

    def test_lists_and_filters_users(self, session_client, instance_admin, member):
        User.objects.create(email="gone@x.com", username="gone", is_active=False)
        User.objects.create(email="bot@x.com", username="bot", is_bot=True)

        response = session_client.get(reverse("instance-user-create"))
        assert response.status_code == status.HTTP_200_OK
        emails = {row["email"] for row in response.data["results"]}
        assert emails == {"test@sure.com.sa", "omnia@x.com", "gone@x.com"}
        admin_row = next(row for row in response.data["results"] if row["email"] == "test@sure.com.sa")
        assert admin_row["is_instance_admin"] is True
        assert admin_row["workspace_count"] == 1

        response = session_client.get(reverse("instance-user-create"), {"search": "omn"})
        assert [row["email"] for row in response.data["results"]] == ["omnia@x.com"]

        response = session_client.get(reverse("instance-user-create"), {"status": "deactivated"})
        assert [row["email"] for row in response.data["results"]] == ["gone@x.com"]

        response = session_client.get(reverse("instance-user-create"), {"workspace": "test-workspace"})
        assert {row["email"] for row in response.data["results"]} == {"test@sure.com.sa", "omnia@x.com"}

    def test_detail_lists_workspaces_with_projects(self, session_client, instance_admin, member, project):
        response = session_client.get(url("instance-user-detail", pk=member.pk))

        assert response.status_code == status.HTTP_200_OK
        [workspace] = response.data["workspaces"]
        assert workspace["slug"] == "test-workspace"
        assert workspace["role"] == "member"
        assert workspace["is_active"] is True
        assert workspace["projects"] == [{"id": str(project.id), "identifier": "WEB", "name": "Web", "role": None}]


@pytest.mark.contract
@pytest.mark.django_db
class TestInstanceUserAccount:
    def test_updates_details(self, session_client, instance_admin, member):
        response = session_client.patch(
            url("instance-user-detail", pk=member.pk),
            {"email": "Omnia.Saeed@X.com", "first_name": "Omnia", "last_name": "Saeed", "phone": "00966551234567"},
            format="json",
        )

        assert response.status_code == status.HTTP_200_OK
        member.refresh_from_db()
        assert member.email == "omnia.saeed@x.com"
        assert member.last_name == "Saeed"
        assert member.mobile_number == "+966551234567"

    @pytest.mark.parametrize(
        "payload,message",
        [
            ({"email": "not-an-email"}, "valid email"),
            ({"email": "TEST@sure.com.sa"}, "already uses"),
            ({"display_name": " "}, "cannot be empty"),
            ({"phone": "0551234567"}, "country code"),
        ],
    )
    def test_rejects_invalid_details(self, session_client, instance_admin, member, payload, message):
        response = session_client.patch(url("instance-user-detail", pk=member.pk), payload, format="json")

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert message in response.data["error"]

    def test_sets_generated_password_and_signs_out(self, session_client, instance_admin, member):
        Session.objects.create(session_key="s" * 40, session_data="", expire_date=timezone.now(), user_id=member.id)

        response = session_client.post(url("instance-user-password", pk=member.pk), {}, format="json")

        assert response.status_code == status.HTTP_200_OK
        assert response["Cache-Control"] == "no-store"
        member.refresh_from_db()
        assert member.check_password(response.data["password"])
        assert not Session.objects.filter(user_id=str(member.id)).exists()

    def test_sets_chosen_password_and_rejects_weak_ones(self, session_client, instance_admin, member):
        weak = session_client.post(url("instance-user-password", pk=member.pk), {"password": "123"}, format="json")
        assert weak.status_code == status.HTTP_400_BAD_REQUEST

        strong = "Blue-Falcon-Harbor-42"
        response = session_client.post(url("instance-user-password", pk=member.pk), {"password": strong}, format="json")
        assert response.status_code == status.HTTP_200_OK
        member.refresh_from_db()
        assert member.check_password(strong)

    def test_cannot_reset_own_password(self, session_client, instance_admin):
        response = session_client.post(url("instance-user-password", pk=instance_admin.pk), {}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_deactivate_suspends_everywhere_and_reactivate(self, session_client, instance_admin, member, project):
        ProjectMember.objects.create(project=project, member=member, role=15)

        response = session_client.post(
            url("instance-user-activation", pk=member.pk), {"is_active": False}, format="json"
        )

        assert response.status_code == status.HTTP_200_OK
        member.refresh_from_db()
        assert member.is_active is False
        # Without a logout time the next sign-in would silently reactivate the account.
        assert member.last_logout_time is not None
        assert not WorkspaceMember.objects.get(member=member).is_active
        assert not ProjectMember.objects.get(member=member).is_active

        response = session_client.post(
            url("instance-user-activation", pk=member.pk), {"is_active": True}, format="json"
        )
        assert response.status_code == status.HTTP_200_OK
        member.refresh_from_db()
        assert member.is_active is True

    def test_cannot_deactivate_self_or_last_admin(self, session_client, instance_admin, workspace, member):
        response = session_client.post(
            url("instance-user-activation", pk=instance_admin.pk), {"is_active": False}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

        other_admin = User.objects.create(email="boss@x.com", username="boss")
        other_workspace = Workspace.objects.create(name="Other", slug="other", owner=instance_admin)
        WorkspaceMember.objects.create(workspace=other_workspace, member=other_admin, role=20)
        WorkspaceMember.objects.create(workspace=other_workspace, member=member, role=15)

        response = session_client.post(
            url("instance-user-activation", pk=other_admin.pk), {"is_active": False}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "only admin of Other" in response.data["error"]

    def test_delete_needs_matching_email(self, session_client, instance_admin, member):
        response = session_client.delete(
            url("instance-user-detail", pk=member.pk), {"confirm_email": "wrong@x.com"}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert User.objects.filter(pk=member.pk).exists()

        response = session_client.delete(
            url("instance-user-detail", pk=member.pk), {"confirm_email": "OMNIA@x.com"}, format="json"
        )
        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not User.objects.filter(pk=member.pk).exists()
        assert not WorkspaceMember.objects.filter(member_id=member.pk).exists()

    def test_delete_refuses_workspace_owner(self, session_client, instance_admin, member):
        Workspace.objects.create(name="Owned", slug="owned", owner=member)

        response = session_client.delete(
            url("instance-user-detail", pk=member.pk), {"confirm_email": "omnia@x.com"}, format="json"
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "owns the workspace" in response.data["error"]
        assert Workspace.objects.filter(slug="owned").exists()

    def test_delete_keeps_data_owned_by_others(self, session_client, instance_admin, member, workspace):
        page = Page.objects.create(name="Kept", workspace=workspace, owned_by=instance_admin)

        response = session_client.delete(
            url("instance-user-detail", pk=member.pk), {"confirm_email": "omnia@x.com"}, format="json"
        )

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert Page.objects.filter(pk=page.pk).exists()

    def test_unknown_user_is_404(self, session_client, instance_admin):
        response = session_client.get(url("instance-user-detail", pk="00000000-0000-0000-0000-000000000000"))
        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.contract
@pytest.mark.django_db
class TestInstanceUserMemberships:
    def test_restores_suspended_workspace_member(self, session_client, instance_admin, workspace, member):
        WorkspaceMember.objects.filter(member=member).update(is_active=False)

        response = session_client.post(
            url("instance-user-workspaces", pk=member.pk),
            {"workspace": "test-workspace", "role": "admin"},
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        membership = WorkspaceMember.objects.get(member=member, workspace=workspace)
        assert membership.is_active and membership.role == 20

    def test_rejects_adding_existing_member(self, session_client, instance_admin, member):
        response = session_client.post(
            url("instance-user-workspaces", pk=member.pk),
            {"workspace": "test-workspace", "role": "member"},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_guest_role_lowers_project_roles(self, session_client, instance_admin, member, project):
        ProjectMember.objects.create(project=project, member=member, role=15)

        response = session_client.patch(
            url("instance-user-workspace", pk=member.pk, slug="test-workspace"), {"role": "guest"}, format="json"
        )

        assert response.status_code == status.HTTP_200_OK
        assert WorkspaceMember.objects.get(member=member).role == 5
        assert ProjectMember.objects.get(member=member).role == 5

    def test_cannot_demote_or_remove_last_workspace_admin(self, session_client, instance_admin, member):
        demote = session_client.patch(
            url("instance-user-workspace", pk=instance_admin.pk, slug="test-workspace"),
            {"role": "member"},
            format="json",
        )
        remove = session_client.delete(url("instance-user-workspace", pk=instance_admin.pk, slug="test-workspace"))

        assert demote.status_code == status.HTTP_400_BAD_REQUEST
        assert remove.status_code == status.HTTP_400_BAD_REQUEST
        assert WorkspaceMember.objects.get(member=instance_admin).role == 20

    def test_remove_from_workspace_suspends_projects(self, session_client, instance_admin, member, project):
        ProjectMember.objects.create(project=project, member=member, role=15)

        response = session_client.delete(url("instance-user-workspace", pk=member.pk, slug="test-workspace"))

        assert response.status_code == status.HTTP_200_OK
        assert not WorkspaceMember.objects.get(member=member).is_active
        assert not ProjectMember.objects.get(member=member).is_active
        assert response.data["workspaces"][0]["is_active"] is False

    def test_adds_changes_and_removes_project_role(self, session_client, instance_admin, member, project):
        project_url = url("instance-user-project", pk=member.pk, project_id=project.pk)

        too_high = session_client.put(project_url, {"role": "admin"}, format="json")
        assert too_high.status_code == status.HTTP_400_BAD_REQUEST

        added = session_client.put(project_url, {"role": "member"}, format="json")
        assert added.status_code == status.HTTP_200_OK
        assert added.data["workspaces"][0]["projects"][0]["role"] == "member"

        removed = session_client.delete(project_url)
        assert removed.status_code == status.HTTP_200_OK
        assert removed.data["workspaces"][0]["projects"][0]["role"] is None

    def test_project_needs_active_workspace_membership(self, session_client, instance_admin, member, project):
        WorkspaceMember.objects.filter(member=member).update(is_active=False)

        response = session_client.put(
            url("instance-user-project", pk=member.pk, project_id=project.pk), {"role": "member"}, format="json"
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "not an active member" in response.data["error"]
