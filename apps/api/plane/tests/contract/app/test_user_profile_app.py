# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for the member profile endpoints: workspace scoping and work item counts."""

from datetime import timedelta
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import (
    Cycle,
    CycleIssue,
    Issue,
    IssueAssignee,
    Project,
    ProjectMember,
    State,
    User,
    WorkspaceMember,
)


def _user(prefix):
    uid = uuid4().hex[:8]
    return User.objects.create(email=f"{prefix}-{uid}@sure.com.sa", username=f"{prefix}_{uid}")


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def env(db, workspace, create_user):
    owner = create_user
    shared = Project.objects.create(name="Web", identifier="WEB", workspace=workspace)
    private = Project.objects.create(name="Secret", identifier="SEC", workspace=workspace, network=0)
    ProjectMember.objects.create(project=shared, member=owner, workspace=workspace, role=20)

    target, other = _user("target"), _user("other")
    for user in (target, other):
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
        for project in (shared, private):
            ProjectMember.objects.create(project=project, member=user, workspace=workspace, role=15)

    states = {
        project.id: State.objects.create(name="Todo", group="unstarted", project=project, workspace=workspace)
        for project in (shared, private)
    }

    def issue(project, *assignees, created_by=owner, **kw):
        item = Issue(name="Item", project=project, workspace=workspace, state=states[project.id], **kw)
        item.save(created_by_id=created_by.id)
        for user in assignees:
            IssueAssignee.objects.create(issue=item, assignee=user, project=project, workspace=workspace)
        return item

    def cycle(project, name, *items, days=0):
        now = timezone.now()
        item = Cycle.objects.create(
            name=name,
            project=project,
            workspace=workspace,
            owned_by=target,
            start_date=now + timedelta(days=days - 2),
            end_date=now + timedelta(days=days + 5),
        )
        for work_item in items:
            CycleIssue.objects.create(cycle=item, issue=work_item, project=project, workspace=workspace)
        return item

    return {
        "owner": owner,
        "target": target,
        "other": other,
        "shared": shared,
        "private": private,
        "issue": issue,
        "cycle": cycle,
    }


@pytest.mark.contract
@pytest.mark.django_db
class TestUserStats:
    def _url(self, workspace, user):
        return f"/api/workspaces/{workspace.slug}/user-stats/{user.id}/"

    def test_outsider_is_rejected(self, workspace, env):
        env["cycle"](env["private"], "Secret sprint", env["issue"](env["private"], env["target"]))
        response = _client(_user("outsider")).get(self._url(workspace, env["target"]))
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_cycles_of_projects_the_requester_has_not_joined_are_hidden(self, workspace, env):
        env["cycle"](env["private"], "Secret sprint", env["issue"](env["private"], env["target"]))
        env["cycle"](env["private"], "Secret next", env["issue"](env["private"], env["target"]), days=20)
        response = _client(env["owner"]).get(self._url(workspace, env["target"]))
        assert response.status_code == status.HTTP_200_OK
        assert list(response.data["present_cycles"]) == []
        assert list(response.data["upcoming_cycles"]) == []

    def test_each_cycle_is_listed_once(self, workspace, env):
        items = [env["issue"](env["shared"], env["target"]) for _ in range(3)]
        env["cycle"](env["shared"], "Sprint 1", *items)
        response = _client(env["owner"]).get(self._url(workspace, env["target"]))
        assert [c["cycle__name"] for c in response.data["present_cycles"]] == ["Sprint 1"]

    def test_removed_assignee_and_cycle_links_are_ignored(self, workspace, env):
        unassigned = env["issue"](env["shared"], env["target"], env["other"])
        env["cycle"](env["shared"], "Sprint 1", unassigned)
        IssueAssignee.objects.filter(issue=unassigned, assignee=env["target"]).update(deleted_at=timezone.now())
        response = _client(env["owner"]).get(self._url(workspace, env["target"]))
        assert list(response.data["present_cycles"]) == []
        assert response.data["assigned_issues"] == 0
        assert list(response.data["state_distribution"]) == []


@pytest.mark.contract
@pytest.mark.django_db
class TestUserProfile:
    def _project(self, workspace, env):
        response = _client(env["owner"]).get(f"/api/workspaces/{workspace.slug}/user-profile/{env['target'].id}/")
        assert response.status_code == status.HTTP_200_OK
        rows = {str(p["id"]): p for p in response.data["project_data"]}
        assert str(env["private"].id) not in rows
        return rows[str(env["shared"].id)]

    def test_several_assignees_do_not_inflate_counts(self, workspace, env):
        env["issue"](env["shared"], env["target"], env["other"], env["owner"], created_by=env["target"])
        row = self._project(workspace, env)
        assert (row["created_issues"], row["assigned_issues"], row["pending_issues"]) == (1, 1, 1)

    def test_deleted_items_and_removed_assignees_are_not_counted(self, workspace, env):
        deleted = env["issue"](env["shared"], env["target"], created_by=env["target"])
        Issue.objects.filter(id=deleted.id).update(deleted_at=timezone.now())
        unassigned = env["issue"](env["shared"], env["target"])
        IssueAssignee.objects.filter(issue=unassigned).update(deleted_at=timezone.now())
        row = self._project(workspace, env)
        assert (row["created_issues"], row["assigned_issues"], row["pending_issues"]) == (0, 0, 0)

    def test_completed_items_are_counted_apart_from_pending(self, workspace, env):
        done = State.objects.create(name="Done", group="completed", project=env["shared"], workspace=workspace)
        item = env["issue"](env["shared"], env["target"])
        item.state = done
        item.save()
        env["issue"](env["shared"], env["target"])
        row = self._project(workspace, env)
        assert (row["assigned_issues"], row["completed_issues"], row["pending_issues"]) == (2, 1, 1)
