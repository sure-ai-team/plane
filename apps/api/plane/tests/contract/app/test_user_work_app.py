# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Contract tests for the Users list and the User Work pages."""

import io
from datetime import timedelta
from uuid import uuid4

import pytest
from django.utils import timezone
from openpyxl import load_workbook
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import (
    Cycle,
    CycleIssue,
    Estimate,
    EstimatePoint,
    Issue,
    IssueActivity,
    IssueAssignee,
    Project,
    ProjectMember,
    State,
    User,
    Workspace,
    WorkspaceMember,
    WorkspaceMemberInvite,
)

SECRET_TITLE = "Top secret title"


def _user(prefix, **kw):
    uid = uuid4().hex[:8]
    return User.objects.create(email=f"{prefix}-{uid}@sure.com.sa", username=f"{prefix}_{uid}", **kw)


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


class Env:
    def __init__(self, workspace, owner):
        self.workspace, self.owner = workspace, owner
        self.today = timezone.localdate()
        self.public = self.project("Web", "WEB")
        self.joined = self.project("Ops", "OPS", network=0)
        self.private = self.project("Secret", "SEC", network=0)

        self.admin = _user("admin", first_name="Amal", display_name="amal")
        self.member = _user("member", first_name="Musa", display_name="musa")
        self.other = _user("other", first_name="Omar", display_name="omar")
        self.guest = _user("guest", first_name="Ghada", display_name="ghada")
        for user, role in ((self.admin, 20), (self.member, 15), (self.other, 15), (self.guest, 5)):
            WorkspaceMember.objects.create(workspace=workspace, member=user, role=role)
        self.join(self.joined, self.admin, 20)
        for project in (self.public, self.joined, self.private):
            self.join(project, self.member)
        self.join(self.public, self.other)

    def project(self, name, identifier, network=2):
        project = Project.objects.create(name=name, identifier=identifier, workspace=self.workspace, network=network)
        for group in ("backlog", "unstarted", "started", "completed", "cancelled"):
            State.objects.create(
                name=group, group=group, project=project, workspace=self.workspace, default=group == "backlog"
            )
        return project

    def join(self, project, user, role=15):
        ProjectMember.objects.create(project=project, member=user, workspace=self.workspace, role=role)

    def issue(self, project, *assignees, group="unstarted", due=None, completed_days_ago=None, idle_days=0, **kw):
        item = Issue(
            name=kw.pop("name", SECRET_TITLE if project == self.private else f"{project.identifier} item"),
            project=project,
            workspace=self.workspace,
            state=State.objects.get(project=project, group=group),
            target_date=None if due is None else self.today + timedelta(days=due),
            **kw,
        )
        item.save(created_by_id=self.owner.id)
        changes = {}
        if completed_days_ago is not None:
            changes["completed_at"] = timezone.now() - timedelta(days=completed_days_ago)
        if idle_days:
            changes["updated_at"] = timezone.now() - timedelta(days=idle_days)
        if changes:
            Issue.objects.filter(id=item.id).update(**changes)
        for user in assignees:
            IssueAssignee.objects.create(issue=item, assignee=user, project=project, workspace=self.workspace)
        return item

    def cycle(self, project, name, *items, start=-2, end=5):
        now = timezone.now()
        cycle = Cycle.objects.create(
            name=name,
            project=project,
            workspace=self.workspace,
            owned_by=self.owner,
            start_date=now + timedelta(days=start),
            end_date=now + timedelta(days=end),
        )
        for item in items:
            CycleIssue.objects.create(cycle=cycle, issue=item, project=project, workspace=self.workspace)
        return cycle

    def activity(self, item, actor, days_ago=0, **kw):
        row = IssueActivity.objects.create(
            issue=item, project=item.project, workspace=self.workspace, actor=actor, **{"verb": "updated", **kw}
        )
        IssueActivity.objects.filter(id=row.id).update(created_at=timezone.now() - timedelta(days=days_ago))
        return row

    def url(self, path=""):
        return f"/api/workspaces/{self.workspace.slug}/users-work/{path}"

    def person_url(self, user, page, query=""):
        return self.url(f"{user.id}/{page}/{query}")

    def get(self, url, user=None, expected=status.HTTP_200_OK):
        response = _client(user or self.admin).get(url)
        assert response.status_code == expected, getattr(response, "data", None)
        return getattr(response, "data", None)

    def rows(self, query="", user=None):
        return {str(row["id"]): row for row in self.get(self.url(query), user)["results"]}


@pytest.fixture
def env(db, workspace, create_user):
    return Env(workspace, create_user)


PERSON_PAGES = ("summary", "items", "cycles", "activity")


@pytest.mark.contract
@pytest.mark.django_db
class TestAccess:
    @pytest.mark.parametrize("path", ["", "items/"])
    def test_team_pages_are_for_workspace_admins(self, env, path):
        outsider = _user("outsider")
        for user in (env.member, env.guest, outsider):
            env.get(env.url(path), user, status.HTTP_403_FORBIDDEN)
        env.get(env.url(path), env.admin)

    @pytest.mark.parametrize("page", PERSON_PAGES)
    def test_person_pages_are_for_admins_and_the_person(self, env, page):
        url = env.person_url(env.member, page)
        for user in (env.other, env.guest, _user("outsider")):
            env.get(url, user, status.HTTP_403_FORBIDDEN)
        env.get(url, env.admin)
        env.get(url, env.member)

    @pytest.mark.parametrize("page", PERSON_PAGES)
    def test_guests_have_no_page_of_their_own(self, env, page):
        env.get(env.person_url(env.guest, page), env.guest, status.HTTP_403_FORBIDDEN)

    def test_exports_follow_the_same_rules(self, env):
        for user, expected in ((env.member, 403), (env.guest, 403), (env.admin, 200)):
            assert _client(user).post(env.url("export/"), {}, format="json").status_code == expected
        url = env.person_url(env.member, "export")
        for user, expected in ((env.other, 403), (env.guest, 403), (env.admin, 200), (env.member, 200)):
            assert _client(user).post(url, {}, format="json").status_code == expected

    def test_anonymous_is_rejected(self, env):
        assert APIClient().get(env.url()).status_code in (401, 403)

    def test_suspended_admin_is_rejected(self, env):
        WorkspaceMember.objects.filter(member=env.admin).update(is_active=False)
        env.get(env.url(), env.admin, status.HTTP_403_FORBIDDEN)

    def test_admin_of_another_workspace_is_rejected(self, env):
        stranger = _user("stranger")
        elsewhere = Workspace.objects.create(name="Elsewhere", slug="elsewhere", owner=stranger)
        WorkspaceMember.objects.create(workspace=elsewhere, member=stranger, role=20)
        env.get(env.url(), stranger, status.HTTP_403_FORBIDDEN)
        # ...and a person outside the workspace has no page in it
        env.get(env.person_url(stranger, "summary"), env.admin, status.HTTP_404_NOT_FOUND)

    @pytest.mark.parametrize(
        "query",
        [
            "?period=5",
            "?sort=password",
            "?direction=up",
            "?status=x",
            "?role=99",
            "?project=x",
            "?page=0",
            "?per_page=500",
        ],
    )
    def test_invalid_parameters(self, env, query):
        env.get(env.url(query), expected=status.HTTP_400_BAD_REQUEST)


@pytest.mark.contract
@pytest.mark.django_db
class TestTeamList:
    def test_counts(self, env):
        env.issue(env.public, env.member, due=-1)
        env.issue(env.public, env.member, due=3)
        env.issue(env.joined, env.member, group="started", due=-2, idle_days=10)
        env.issue(env.private, env.member, group="backlog")
        env.issue(env.public, env.member, group="completed", completed_days_ago=3, due=-10)
        env.issue(env.public, env.member, group="completed", completed_days_ago=60)
        env.issue(env.public, env.member, group="cancelled", due=-3)
        row = env.rows()[str(env.member.id)]
        assert {k: row[k] for k in ("open", "in_progress", "overdue", "due_soon", "stuck", "no_due_date", "done")} == {
            "open": 4,
            "in_progress": 1,
            "overdue": 2,
            "due_soon": 1,
            "stuck": 1,
            "no_due_date": 1,
            "done": 1,
        }
        assert row["projects"] == 3
        assert env.rows("?period=90")[str(env.member.id)]["done"] == 2

    def test_shared_items_count_for_each_person_but_once_in_totals(self, env):
        env.issue(env.public, env.member, env.other, due=-1)
        data = env.get(env.url())
        rows = {str(row["id"]): row for row in data["results"]}
        assert rows[str(env.member.id)]["overdue"] == rows[str(env.other.id)]["overdue"] == 1
        assert data["totals"]["overdue"] == 1

    def test_deleted_archived_draft_and_unassigned_work_is_left_out(self, env):
        now = timezone.now()
        for change in ({"deleted_at": now}, {"archived_at": env.today}, {"is_draft": True}):
            Issue.objects.filter(id=env.issue(env.public, env.member).id).update(**change)
        removed = env.issue(env.public, env.member)
        IssueAssignee.objects.filter(issue=removed).update(deleted_at=now)
        archived = env.project("Old", "OLD")
        env.issue(archived, env.member)
        Project.objects.filter(id=archived.id).update(archived_at=now)
        assert env.rows()[str(env.member.id)]["open"] == 0

    def test_totals_of_neglected_work(self, env):
        env.issue(env.public)
        env.issue(env.public, group="completed", completed_days_ago=1)
        env.issue(env.private, env.other)
        env.issue(env.public, env.other, env.member)
        WorkspaceMember.objects.filter(member=env.other).update(is_active=False)
        totals = env.get(env.url())["totals"]
        assert (totals["unassigned"], totals["orphaned"]) == (1, 1)
        # workspace fixture owner, admin, member and guest
        assert totals["members"] == 4

    def test_active_members_only_by_default_and_status_filters(self, env):
        WorkspaceMember.objects.filter(member=env.other).update(is_active=False)
        User.objects.filter(id=env.guest.id).update(is_active=False)
        bot = _user("bot", is_bot=True)
        WorkspaceMember.objects.create(workspace=env.workspace, member=bot, role=15)
        WorkspaceMemberInvite.objects.create(
            workspace=env.workspace, email="new@sure.com.sa", role=15, token=uuid4().hex
        )
        assert set(env.rows()) == {str(u.id) for u in (env.owner, env.admin, env.member)}
        suspended = env.rows("?status=suspended")
        assert set(suspended) == {str(env.other.id), str(env.guest.id)}
        assert {row["status"] for row in suspended.values()} == {"suspended"}
        invited = list(env.rows("?status=invited").values())
        assert [(row["email"], row["status"]) for row in invited] == [("new@sure.com.sa", "invited")]
        assert len(env.rows("?status=active,suspended,invited")) == 6

    def test_search_role_and_project_filters(self, env):
        assert set(env.rows("?search=MUSA")) == {str(env.member.id)}
        assert set(env.rows("?search=ghada%20sure.com")) == {str(env.guest.id)}
        assert set(env.rows("?role=5")) == {str(env.guest.id)}
        env.issue(env.public, env.member)
        env.issue(env.private, env.member)
        rows = env.rows(f"?project={env.public.id}")
        assert set(rows) == {str(env.member.id), str(env.other.id)}
        assert rows[str(env.member.id)]["open"] == 1

    def test_projects_of_other_workspaces_cannot_be_requested(self, env):
        elsewhere = Workspace.objects.create(name="Elsewhere", slug="elsewhere", owner=env.owner)
        project = Project.objects.create(name="Far", identifier="FAR", workspace=elsewhere)
        assert env.rows(f"?project={project.id}") == {}

    def test_sorting_and_paging(self, env):
        env.issue(env.public, env.other)
        env.issue(env.public, env.other)
        env.issue(env.public, env.member)
        data = env.get(env.url("?sort=open&direction=desc&per_page=2"))
        assert [row["open"] for row in data["results"]] == [2, 1]
        assert (data["total"], data["has_more"]) == (5, True)
        last = env.get(env.url("?sort=open&direction=desc&per_page=2&page=3"))
        assert (len(last["results"]), last["has_more"]) == (1, False)

    def test_last_activity_comes_from_work_item_changes(self, env):
        item = env.issue(env.public, env.member)
        env.activity(item, env.member, days_ago=4, field="state")
        env.activity(item, env.member, days_ago=2, field="comment")
        row = env.rows()[str(env.member.id)]
        assert (timezone.now() - row["last_activity_at"]).days == 2
        # people without any activity come last in both directions
        for direction in ("asc", "desc"):
            data = env.get(env.url(f"?sort=last_activity_at&direction={direction}"))
            assert data["results"][0]["id"] == env.member.id

    def test_cycle_names_of_private_projects_are_only_counted(self, env):
        env.cycle(env.public, "Sprint 1", env.issue(env.public, env.member), env.issue(env.public, env.member))
        env.cycle(env.private, "Secret sprint", env.issue(env.private, env.member))
        env.cycle(env.public, "Later", env.issue(env.public, env.member), start=3)
        row = env.rows()[str(env.member.id)]
        assert [cycle["name"] for cycle in row["cycles"]] == ["Sprint 1"]
        assert row["hidden_cycles"] == 1

    def test_number_of_queries_does_not_depend_on_the_number_of_members(self, env, django_assert_max_num_queries):
        for n in range(15):
            user = _user(f"m{n}")
            WorkspaceMember.objects.create(workspace=env.workspace, member=user, role=15)
            env.cycle(env.public, f"C{n}", env.issue(env.public, user, due=-1))
        with django_assert_max_num_queries(20):
            env.get(env.url())


@pytest.mark.contract
@pytest.mark.django_db
class TestNeglectedItems:
    def test_buckets_hide_private_titles(self, env):
        env.issue(env.public, name="Open question")
        env.issue(env.private)
        gone = env.issue(env.public, env.other, name="Left behind")
        WorkspaceMember.objects.filter(member=env.other).update(is_active=False)

        unassigned = env.get(env.url("items/?bucket=unassigned"))
        assert [row["name"] for row in unassigned["results"]] == ["Open question"]
        assert [(p["project_name"], p["count"]) for p in unassigned["hidden_projects"]] == [("Secret", 1)]

        orphaned = env.get(env.url("items/?bucket=orphaned"))
        assert [row["id"] for row in orphaned["results"]] == [gone.id]
        assert orphaned["results"][0]["assignee_ids"] == [env.other.id]


@pytest.mark.contract
@pytest.mark.django_db
class TestSummary:
    def test_numbers_include_private_projects_but_titles_do_not(self, env):
        env.issue(env.public, env.member, due=-1, name="Late")
        env.issue(env.private, env.member, due=-1)
        data = env.get(env.person_url(env.member, "summary"))
        assert data["stats"]["overdue"] == 2
        assert [row["name"] for row in data["attention"]["items"]] == ["Late"]
        assert (data["attention"]["total"], data["attention"]["hidden"]) == (2, 1)
        projects = {p["identifier"]: p for p in data["projects"]}
        assert {k: (p["can_read"], p["can_open"]) for k, p in projects.items()} == {
            "WEB": (True, False),
            "OPS": (True, True),
            "SEC": (False, False),
        }
        assert SECRET_TITLE not in str(data)

    def test_joining_a_private_project_shows_its_titles(self, env):
        env.issue(env.private, env.member, due=-1)
        env.join(env.private, env.admin, 20)
        data = env.get(env.person_url(env.member, "summary"))
        assert [row["name"] for row in data["attention"]["items"]] == [SECRET_TITLE]
        assert data["attention"]["items"][0]["can_open"] is True

    def test_state_groups_trend_and_on_time(self, env):
        env.issue(env.public, env.member, group="backlog")
        env.issue(env.public, env.member, group="started")
        env.issue(env.public, env.member, group="completed", completed_days_ago=0, due=0)
        env.issue(env.public, env.member, group="completed", completed_days_ago=2, due=-9)
        env.issue(env.public, env.member, group="completed", completed_days_ago=2)
        env.issue(env.public, env.member, group="completed", completed_days_ago=45, due=0)
        data = env.get(env.person_url(env.member, "summary"))
        assert data["state_groups"] == {
            "backlog": 1,
            "unstarted": 0,
            "started": 1,
            "completed": 3,
            "cancelled": 0,
        }
        assert (data["stats"]["on_time"], data["stats"]["on_time_total"]) == (1, 2)
        assert len(data["trend"]) == 8
        assert sum(week["completed"] for week in data["trend"]) == 4

    def test_a_person_who_left_still_has_a_page(self, env):
        env.issue(env.public, env.member)
        WorkspaceMember.objects.filter(member=env.member).update(is_active=False)
        data = env.get(env.person_url(env.member, "summary"))
        assert data["user"]["status"] == "suspended"
        assert data["stats"]["open"] == 1
        # ...but can no longer open it themselves
        env.get(env.person_url(env.member, "summary"), env.member, status.HTTP_403_FORBIDDEN)

    def test_members_see_the_same_numbers_about_themselves(self, env):
        env.issue(env.public, env.member, due=-1)
        env.issue(env.private, env.member, group="started")
        mine = env.get(env.person_url(env.member, "summary"), env.member)
        theirs = env.get(env.person_url(env.member, "summary"), env.admin)
        assert mine["stats"] == theirs["stats"]
        assert mine["attention"]["hidden"] == 0

    def test_member_does_not_see_private_projects_they_left(self, env):
        env.issue(env.private, env.member, due=-1)
        ProjectMember.objects.filter(project=env.private, member=env.member).update(is_active=False)
        data = env.get(env.person_url(env.member, "summary"), env.member)
        assert data["stats"]["overdue"] == 0
        assert "Secret" not in [p["name"] for p in data["projects"]]


@pytest.mark.contract
@pytest.mark.django_db
class TestItems:
    def test_grouping_filters_and_hidden_projects(self, env):
        env.issue(env.public, env.member, group="started", name="Doing", idle_days=9)
        env.issue(env.joined, env.member, group="unstarted", name="Next", due=-1)
        env.issue(env.private, env.member, group="started")
        started = env.get(env.person_url(env.member, "items", "?state_group=started"))
        assert [(r["name"], r["is_stuck"], r["can_open"]) for r in started["results"]] == [("Doing", True, False)]
        assert started["total"] == 1
        assert [p["count"] for p in started["hidden_projects"]] == [1]
        overdue = env.get(env.person_url(env.member, "items", "?focus=overdue"))
        assert [(r["name"], r["is_overdue"], r["can_open"]) for r in overdue["results"]] == [("Next", True, True)]
        one_project = env.get(env.person_url(env.member, "items", f"?project={env.joined.id}"))
        assert [r["name"] for r in one_project["results"]] == ["Next"]
        assert SECRET_TITLE not in str(env.get(env.person_url(env.member, "items")))

    def test_private_project_cannot_be_read_by_asking_for_it(self, env):
        env.issue(env.private, env.member)
        data = env.get(env.person_url(env.member, "items", f"?project={env.private.id}"))
        assert data["results"] == []
        assert data["hidden_projects"][0]["count"] == 1

    def test_order_and_paging(self, env):
        env.issue(env.public, env.member, name="none")
        env.issue(env.public, env.member, name="later", due=5)
        env.issue(env.public, env.member, name="late", due=-5)
        first = env.get(env.person_url(env.member, "items", "?per_page=2"))
        assert [r["name"] for r in first["results"]] == ["late", "later"]
        assert first["has_more"] is True
        second = env.get(env.person_url(env.member, "items", "?per_page=2&page=2"))
        assert [r["name"] for r in second["results"]] == ["none"]

    def test_item_with_several_assignees_is_listed_once(self, env):
        env.issue(env.public, env.member, env.other, env.admin)
        data = env.get(env.person_url(env.member, "items"))
        assert len(data["results"]) == data["total"] == 1
        assert len(data["results"][0]["assignee_ids"]) == 3


@pytest.mark.contract
@pytest.mark.django_db
class TestCycles:
    def test_share_of_cycles(self, env):
        estimate = Estimate.objects.create(name="E", project=env.public, workspace=env.workspace, type="points")
        five = EstimatePoint.objects.create(
            estimate=estimate, project=env.public, workspace=env.workspace, key=0, value="5"
        )
        items = [
            env.issue(env.public, env.member, group="completed", completed_days_ago=1, estimate_point=five),
            env.issue(env.public, env.member, group="started", due=-1, estimate_point=five),
            env.issue(env.public, env.member, group="unstarted"),
            env.issue(env.public, env.member, group="cancelled"),
            env.issue(env.public, env.other, group="unstarted"),
        ]
        env.cycle(env.public, "Sprint 1", *items)
        env.cycle(env.public, "Sprint 2", env.issue(env.public, env.member), start=6, end=20)
        env.cycle(env.public, "Past", env.issue(env.public, env.member), start=-20, end=-6)
        env.cycle(env.private, "Secret sprint", env.issue(env.private, env.member))
        data = env.get(env.person_url(env.member, "cycles"))
        assert [c["name"] for c in data["upcoming"]] == ["Sprint 2"]
        assert data["hidden"] == 1
        (cycle,) = data["active"]
        assert {k: cycle[k] for k in ("total", "done", "in_progress", "not_started", "cancelled", "overdue")} == {
            "total": 3,
            "done": 1,
            "in_progress": 1,
            "not_started": 1,
            "cancelled": 1,
            "overdue": 1,
        }
        assert (cycle["points"], cycle["points_done"], cycle["days_left"]) == (10.0, 5.0, 5)
        assert "Secret" not in str(data)


@pytest.mark.contract
@pytest.mark.django_db
class TestActivity:
    def test_comments_are_included_but_only_readable_in_joined_projects(self, env):
        public, joined, private = (env.issue(p, env.member) for p in (env.public, env.joined, env.private))
        env.activity(joined, env.member, field="comment", new_value="<p>joined text</p>", verb="created")
        env.activity(public, env.member, field="comment", new_value="<p>public text</p>", verb="created")
        env.activity(public, env.member, field="link", new_value="https://internal.example")
        env.activity(public, env.member, field="state", old_value="Todo", new_value="Done")
        env.activity(public, env.member, field=None, verb="created")
        env.activity(private, env.member, field="state", new_value="hidden state")
        env.activity(public, env.member, field="reaction")
        env.activity(public, env.other, field="state")
        data = env.get(env.person_url(env.member, "activity"))
        assert len(data["results"]) == 5
        assert "joined text" in str(data)
        assert "Done" in str(data)
        for hidden in ("public text", "internal.example", "hidden state", SECRET_TITLE):
            assert hidden not in str(data)

    def test_project_and_date_filters_and_paging(self, env):
        item, other = env.issue(env.public, env.member), env.issue(env.joined, env.member)
        for days in (0, 5, 10):
            env.activity(item, env.member, days_ago=days, field="priority")
        env.activity(other, env.member, field="priority")
        assert len(env.get(env.person_url(env.member, "activity", f"?project={env.public.id}"))["results"]) == 3
        start, end = env.today - timedelta(days=6), env.today - timedelta(days=4)
        ranged = env.get(env.person_url(env.member, "activity", f"?start={start}&end={end}"))
        assert len(ranged["results"]) == 1
        page = env.get(env.person_url(env.member, "activity", "?per_page=3"))
        assert (len(page["results"]), page["has_more"]) == (3, True)
        env.get(env.person_url(env.member, "activity", f"?start={end}&end={start}"), expected=400)
        env.get(env.person_url(env.member, "activity", "?start=yesterday"), expected=400)

    def test_number_of_queries_does_not_depend_on_the_number_of_rows(self, env, django_assert_max_num_queries):
        for _ in range(20):
            env.activity(env.issue(env.public, env.member), env.member, field="state")
        with django_assert_max_num_queries(12):
            env.get(env.person_url(env.member, "activity"))


@pytest.mark.contract
@pytest.mark.django_db
class TestExport:
    def test_team_export_uses_filters_and_labels(self, env):
        User.objects.filter(id=env.member.id).update(first_name="=HYPERLINK(1)")
        response = _client(env.admin).post(
            env.url("export/"),
            {"format": "csv", "search": "musa", "labels": {"name": "الاسم", "role_15": "عضو"}},
            format="json",
        )
        lines = response.content.decode("utf-8-sig").splitlines()
        assert response.status_code == 200 and len(lines) == 2
        assert lines[0].startswith("الاسم,")
        assert "عضو" in lines[1]
        # spreadsheet formulas in names are neutralised
        assert not lines[1].startswith("=")

    def test_item_export_leaves_private_titles_out(self, env):
        env.issue(env.public, env.member, name="Shown", due=-1)
        env.issue(env.private, env.member)
        response = _client(env.admin).post(
            env.person_url(env.member, "export"), {"format": "xlsx", "type": "items"}, format="json"
        )
        sheet = load_workbook(io.BytesIO(response.content)).worksheets[0]
        cells = [cell for row in sheet.iter_rows(values_only=True) for cell in row]
        assert sheet.max_row == 2
        assert "Shown" in cells and SECRET_TITLE not in cells

    def test_activity_export_hides_comments_outside_joined_projects(self, env):
        public, joined = env.issue(env.public, env.member), env.issue(env.joined, env.member)
        env.activity(public, env.member, field="comment", new_value="<p>public text</p>")
        env.activity(joined, env.member, field="comment", new_value="<p>joined text</p>")
        response = _client(env.admin).post(
            env.person_url(env.member, "export"), {"type": "activity"}, format="json"
        )
        content = response.content.decode("utf-8-sig")
        assert "joined text" in content and "<p>" not in content
        assert "public text" not in content

    def test_invalid_export(self, env):
        client = _client(env.admin)
        assert client.post(env.url("export/"), {"format": "pdf"}, format="json").status_code == 400
        assert client.post(env.url("export/"), {"labels": ["x"]}, format="json").status_code == 400


@pytest.mark.contract
@pytest.mark.django_db
def test_users_is_pinned_in_the_sidebar_by_default(env):
    preferences = env.get(f"/api/workspaces/{env.workspace.slug}/sidebar-preferences/")
    assert preferences["users"]["is_pinned"] is True
