# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import uuid
from unittest import mock

import pytest
from django.utils import timezone
from rest_framework import status

from plane.db.models import (
    Label,
    Page,
    PageLabel,
    PageVersion,
    Project,
    ProjectMember,
    ProjectPage,
    User,
)


@pytest.fixture(autouse=True)
def _no_celery():
    with mock.patch("plane.app.views.page.transfer.page_transaction.delay"):
        yield


def _import_url(slug, project_id):
    return f"/api/workspaces/{slug}/projects/{project_id}/pages/import/"


def _export_url(slug, project_id):
    return f"/api/workspaces/{slug}/projects/{project_id}/pages/export/"


def _project(workspace, identifier="PRJ", **kwargs):
    return Project.objects.create(name=f"Project {identifier}", identifier=identifier, workspace=workspace, **kwargs)


def _member(workspace, project, user, role=20):
    return ProjectMember.objects.create(workspace=workspace, project=project, member=user, role=role)


def _other_user(label="other"):
    suffix = uuid.uuid4().hex[:8]
    return User.objects.create(email=f"{label}-{suffix}@sure.com.sa", username=f"{label}_{suffix}")


def _page(workspace, project, owner, **kwargs):
    page = Page.objects.create(workspace=workspace, owned_by=owner, **{"name": "Existing", **kwargs})
    ProjectPage.objects.create(workspace=workspace, project=project, page=page)
    return page


def _post(client, workspace, project, pages, **extra):
    return client.post(
        _import_url(workspace.slug, project.id),
        {"version": 1, "pages": pages, **extra},
        format="json",
    )


def _project_pages(project):
    return Page.objects.filter(project_pages__project=project, project_pages__deleted_at__isnull=True)


@pytest.mark.contract
class TestPageImport:
    @pytest.mark.django_db
    def test_creates_pages_with_labels(self, session_client, workspace, create_user):
        project = _project(workspace)
        _member(workspace, project, create_user)
        existing_label = Label.objects.create(name="HR", project=project, workspace=workspace)

        response = _post(
            session_client,
            workspace,
            project,
            [
                {"external_id": "onb", "name": "Onboarding", "labels": ["hr", "New"], "content_html": "<p>Hi</p>"},
                {"name": "Secret", "access": "private"},
            ],
        )

        assert response.status_code == status.HTTP_200_OK, response.json()
        body = response.json()
        assert body["created"] == 2
        assert body["labels_created"] == ["New"]

        onboarding = _project_pages(project).get(name="Onboarding")
        assert onboarding.owned_by_id == create_user.id
        assert onboarding.external_id == "onb"
        assert onboarding.description_html == "<p>Hi</p>"
        assert onboarding.description_binary is None
        label_names = set(PageLabel.objects.filter(page=onboarding).values_list("label__name", flat=True))
        assert label_names == {"HR", "New"}
        assert PageLabel.objects.filter(page=onboarding, label=existing_label).exists()
        assert _project_pages(project).get(name="Secret").access == Page.PRIVATE_ACCESS

    @pytest.mark.django_db
    def test_invalid_payload_creates_nothing(self, session_client, workspace, create_user):
        project = _project(workspace)
        _member(workspace, project, create_user)

        response = _post(session_client, workspace, project, [{"name": "Good", "labels": ["X"]}, {"name": ""}])

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.json()["errors"][0]["index"] == 1
        assert not _project_pages(project).exists()
        assert not Label.objects.filter(project=project).exists()

    @pytest.mark.django_db
    def test_dry_run_reports_plan_without_saving(self, session_client, workspace, create_user):
        project = _project(workspace)
        _member(workspace, project, create_user)
        existing = _page(workspace, project, create_user, external_id="a")

        response = _post(
            session_client,
            workspace,
            project,
            [{"external_id": "a", "name": "A"}, {"name": "B", "labels": ["Fresh"]}],
            on_conflict="update",
            dry_run=True,
        )

        assert response.status_code == status.HTTP_200_OK
        body = response.json()
        assert body["valid"] is True
        planned = [(r["action"], r["page_id"]) for r in body["results"]]
        assert planned == [("update", str(existing.id)), ("create", None)]
        assert body["labels_to_create"] == ["Fresh"]
        assert _project_pages(project).count() == 1
        existing.refresh_from_db()
        assert existing.name == "Existing"

    @pytest.mark.django_db
    def test_dry_run_returns_errors_with_200(self, session_client, workspace, create_user):
        project = _project(workspace)
        _member(workspace, project, create_user)

        response = _post(session_client, workspace, project, [{"name": ""}], dry_run=True)

        assert response.status_code == status.HTTP_200_OK
        assert response.json()["valid"] is False

    @pytest.mark.django_db
    def test_skip_mode_leaves_existing_page(self, session_client, workspace, create_user):
        project = _project(workspace)
        _member(workspace, project, create_user)
        existing = _page(workspace, project, create_user, external_id="a")

        response = _post(
            session_client, workspace, project, [{"external_id": "a", "name": "Changed"}], on_conflict="skip"
        )

        assert response.json()["skipped"] == 1
        assert response.json()["results"][0]["reason"] == "already_exists"
        existing.refresh_from_db()
        assert existing.name == "Existing"
        assert _project_pages(project).count() == 1

    @pytest.mark.django_db
    def test_update_mode_matches_by_page_id_and_keeps_version(self, session_client, workspace, create_user):
        """An exported page (external_id = its id) can be edited and re-imported."""
        project = _project(workspace)
        _member(workspace, project, create_user)
        label = Label.objects.create(name="Old", project=project, workspace=workspace)
        existing = _page(workspace, project, create_user, description_html="<p>before</p>")
        PageLabel.objects.create(page=existing, label=label, workspace=workspace)

        response = _post(
            session_client,
            workspace,
            project,
            [{"external_id": str(existing.id), "name": "After", "content_html": "<p>after</p>", "access": "private"}],
            on_conflict="update",
        )

        assert response.json()["updated"] == 1
        existing.refresh_from_db()
        assert existing.name == "After"
        assert existing.description_html == "<p>after</p>"
        assert existing.description_binary is None
        assert existing.access == Page.PRIVATE_ACCESS
        assert not PageLabel.objects.filter(page=existing).exists()
        assert PageVersion.objects.filter(page=existing, description_html="<p>before</p>").exists()

    @pytest.mark.django_db
    def test_update_skips_locked_and_archived_pages(self, session_client, workspace, create_user):
        project = _project(workspace)
        _member(workspace, project, create_user)
        _page(workspace, project, create_user, external_id="locked", is_locked=True)
        _page(workspace, project, create_user, external_id="archived", archived_at=timezone.now().date())

        response = _post(
            session_client,
            workspace,
            project,
            [{"external_id": "locked", "name": "X"}, {"external_id": "archived", "name": "Y"}],
            on_conflict="update",
        )

        reasons = [r["reason"] for r in response.json()["results"]]
        assert reasons == ["locked", "archived"]
        assert set(_project_pages(project).values_list("name", flat=True)) == {"Existing"}

    @pytest.mark.django_db
    def test_update_does_not_change_access_of_someone_elses_page(self, session_client, workspace, create_user):
        project = _project(workspace)
        _member(workspace, project, create_user)
        owner = _other_user("owner")
        existing = _page(workspace, project, owner, external_id="a")

        response = _post(
            session_client,
            workspace,
            project,
            [{"external_id": "a", "name": "New", "access": "private"}],
            on_conflict="update",
        )

        assert response.json()["results"][0]["reason"] == "access_unchanged_not_owner"
        existing.refresh_from_db()
        assert existing.name == "New"
        assert existing.access == Page.PUBLIC_ACCESS

    @pytest.mark.django_db
    def test_duplicate_mode_creates_copy_without_external_id(self, session_client, workspace, create_user):
        project = _project(workspace)
        _member(workspace, project, create_user)
        existing = _page(workspace, project, create_user, external_id="a")

        response = _post(
            session_client, workspace, project, [{"external_id": "a", "name": "Copy"}], on_conflict="duplicate"
        )

        assert response.json()["created"] == 1
        copy = _project_pages(project).get(name="Copy")
        assert copy.id != existing.id
        assert copy.external_id is None

    @pytest.mark.django_db
    def test_does_not_match_someone_elses_private_page(self, session_client, workspace, create_user):
        project = _project(workspace)
        _member(workspace, project, create_user)
        hidden = _page(workspace, project, _other_user(), external_id="a", access=Page.PRIVATE_ACCESS)

        response = _post(
            session_client, workspace, project, [{"external_id": "a", "name": "Mine"}], on_conflict="update"
        )

        assert response.json()["created"] == 1
        hidden.refresh_from_db()
        assert hidden.name == "Existing"

    @pytest.mark.django_db
    def test_does_not_match_pages_of_another_project(self, session_client, workspace, create_user):
        project = _project(workspace, "PRJA")
        other_project = _project(workspace, "PRJB")
        _member(workspace, project, create_user)
        foreign = _page(workspace, other_project, create_user)

        response = _post(
            session_client, workspace, project, [{"external_id": str(foreign.id), "name": "X"}], on_conflict="update"
        )

        assert response.json()["created"] == 1
        foreign.refresh_from_db()
        assert foreign.name == "Existing"

    @pytest.mark.django_db
    def test_guest_cannot_import(self, session_client, workspace, create_user):
        project = _project(workspace)
        _member(workspace, project, create_user, role=5)

        response = _post(session_client, workspace, project, [{"name": "A"}])

        assert response.status_code == status.HTTP_403_FORBIDDEN

    @pytest.mark.django_db
    def test_non_member_cannot_import(self, session_client, workspace, create_user):
        project = _project(workspace)

        response = _post(session_client, workspace, project, [{"name": "A"}])

        assert response.status_code == status.HTTP_403_FORBIDDEN

    @pytest.mark.django_db
    def test_unknown_conflict_mode(self, session_client, workspace, create_user):
        project = _project(workspace)
        _member(workspace, project, create_user)

        response = _post(session_client, workspace, project, [{"name": "A"}], on_conflict="merge")

        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.contract
class TestPageExport:
    @pytest.mark.django_db
    def test_exports_visible_pages(self, session_client, workspace, create_user):
        project = _project(workspace)
        _member(workspace, project, create_user)
        other = _other_user()
        label = Label.objects.create(name="Docs", project=project, workspace=workspace)
        public = _page(workspace, project, other, name="Public", description_html="<p>pub</p>")
        PageLabel.objects.create(page=public, label=label, workspace=workspace)
        _page(workspace, project, create_user, name="Mine private", access=Page.PRIVATE_ACCESS)
        _page(workspace, project, other, name="Their private", access=Page.PRIVATE_ACCESS)
        _page(workspace, project, create_user, name="Archived", archived_at=timezone.now().date())

        response = session_client.get(_export_url(workspace.slug, project.id))

        assert response.status_code == status.HTTP_200_OK
        body = response.json()
        assert body["version"] == 1
        pages = {page["name"]: page for page in body["pages"]}
        assert set(pages) == {"Public", "Mine private"}
        assert pages["Public"]["external_id"] == str(public.id)
        assert pages["Public"]["labels"] == ["Docs"]
        assert pages["Public"]["content_html"] == "<p>pub</p>"
        assert pages["Mine private"]["access"] == "private"

    @pytest.mark.django_db
    def test_type_and_page_ids_filters(self, session_client, workspace, create_user):
        project = _project(workspace)
        _member(workspace, project, create_user)
        first = _page(workspace, project, create_user, name="First")
        _page(workspace, project, create_user, name="Second")
        _page(workspace, project, create_user, name="Archived", archived_at=timezone.now().date())

        archived = session_client.get(_export_url(workspace.slug, project.id), {"type": "archived"})
        selected = session_client.get(_export_url(workspace.slug, project.id), {"page_ids": str(first.id)})
        bad = session_client.get(_export_url(workspace.slug, project.id), {"page_ids": "nope"})

        assert [page["name"] for page in archived.json()["pages"]] == ["Archived"]
        assert [page["name"] for page in selected.json()["pages"]] == ["First"]
        assert bad.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.django_db
    def test_guest_only_exports_own_pages(self, session_client, workspace, create_user):
        project = _project(workspace)
        _member(workspace, project, create_user, role=5)
        _page(workspace, project, _other_user(), name="Someone else's")
        _page(workspace, project, create_user, name="Mine")

        response = session_client.get(_export_url(workspace.slug, project.id))

        assert response.status_code == status.HTTP_200_OK
        assert [page["name"] for page in response.json()["pages"]] == ["Mine"]

    @pytest.mark.django_db
    def test_export_then_reimport_round_trip(self, session_client, workspace, create_user):
        project = _project(workspace)
        _member(workspace, project, create_user)
        page = _page(workspace, project, create_user, name="Doc", description_html="<p>v1</p>")

        exported = session_client.get(_export_url(workspace.slug, project.id)).json()
        exported["pages"][0]["content_html"] = "<p>v2</p>"
        response = session_client.post(
            _import_url(workspace.slug, project.id), {**exported, "on_conflict": "update"}, format="json"
        )

        assert response.json()["updated"] == 1
        page.refresh_from_db()
        assert page.description_html == "<p>v2</p>"
        assert _project_pages(project).count() == 1

    @pytest.mark.django_db
    def test_non_member_cannot_export(self, session_client, workspace, create_user):
        project = _project(workspace)

        response = session_client.get(_export_url(workspace.slug, project.id))

        assert response.status_code == status.HTTP_403_FORBIDDEN
