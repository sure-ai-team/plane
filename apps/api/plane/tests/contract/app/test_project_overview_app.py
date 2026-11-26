# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Project Overview hub: the project README and uploaded spreadsheets."""

import uuid
from unittest.mock import MagicMock

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import FileAsset, Page, Project, ProjectMember, ProjectPage, User, WorkspaceMember

ADMIN, MEMBER, GUEST = 20, 15, 5
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

pytestmark = [pytest.mark.contract, pytest.mark.django_db]


def make_user(name):
    return User.objects.create(
        email=f"{name}-{uuid.uuid4().hex[:8]}@sure.com.sa", username=f"{name}_{uuid.uuid4().hex[:8]}"
    )


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


class World:
    """A project with an admin, a member and a guest."""

    def __init__(self, workspace):
        self.workspace = workspace
        self.project = self.make_project("OVR")
        self.admin = self.join("admin", ADMIN)
        self.member = self.join("member", MEMBER)
        self.guest = self.join("guest", GUEST)

    def make_project(self, identifier):
        return Project.objects.create(name=f"Project {identifier}", identifier=identifier, workspace=self.workspace)

    def join(self, name, role, project=None):
        user = make_user(name)
        WorkspaceMember.objects.get_or_create(
            workspace=self.workspace, member=user, defaults={"role": min(role, MEMBER)}
        )
        ProjectMember.objects.create(workspace=self.workspace, project=project or self.project, member=user, role=role)
        return user

    def base(self, project=None):
        return f"/api/workspaces/{self.workspace.slug}/projects/{(project or self.project).id}"

    def readme_url(self, project=None):
        return f"{self.base(project)}/readme/"

    def sheets_url(self, asset=None, suffix="", project=None):
        url = f"{self.base(project)}/spreadsheets/"
        return f"{url}{asset if isinstance(asset, str) else asset.id}/{suffix}" if asset else url


@pytest.fixture
def world(workspace):
    return World(workspace)


@pytest.fixture
def storage(mocker):
    """A fake S3 storage for the spreadsheet endpoints. ``fake.objects`` maps key -> bytes."""
    fake = MagicMock()
    fake.objects = {}
    fake.generate_presigned_post.side_effect = lambda object_name, file_type, file_size, expiration=None: {
        "url": "https://storage.test/uploads",
        "fields": {"key": object_name, "Content-Type": file_type},
    }
    fake.generate_presigned_url.side_effect = lambda object_name, **kwargs: f"https://storage.test/{object_name}"

    def _head(key):
        data = fake.objects.get(key)
        return None if data is None else {"ContentLength": len(data)}

    def _get(key):
        data = fake.objects.get(key)
        if data is None:
            return None
        body = MagicMock()
        body.iter_chunks.side_effect = lambda size: iter([data])
        return {"Body": body, "ContentLength": len(data)}

    fake.get_object_metadata.side_effect = _head
    fake.get_object.side_effect = _get
    mocker.patch("plane.app.views.project.spreadsheet.S3Storage", return_value=fake)
    return fake


# ---------------------------------------------------------------- README


class TestReadme:
    def test_get_without_readme_returns_null(self, world):
        response = client_for(world.guest).get(world.readme_url())
        assert response.status_code == status.HTTP_200_OK, response.content
        assert response.json() == {"page_id": None}

    def test_create_blank_readme(self, world):
        response = client_for(world.member).post(world.readme_url(), {}, format="json")
        assert response.status_code == status.HTTP_201_CREATED, response.content
        page_id = response.json()["page_id"]

        page = Page.objects.get(pk=page_id)
        assert page.name == "README"
        assert page.access == Page.PUBLIC_ACCESS
        assert page.owned_by_id == world.member.id
        assert page.created_by_id == world.member.id
        assert page.description_html == "<p></p>"
        assert not page.description_binary
        assert ProjectPage.objects.filter(page=page, project=world.project).exists()
        world.project.refresh_from_db()
        assert str(world.project.readme_page_id) == page_id

        response = client_for(world.guest).get(world.readme_url())
        assert response.json() == {"page_id": page_id}

    @pytest.mark.parametrize(
        "template,headings",
        [
            ("product", ["Overview", "Goals", "Guidelines", "Key links"]),
            ("architecture", ["System overview", "Components", "Data flow", "Decisions"]),
            ("onboarding", ["Welcome", "Setup", "Workflow", "Who to ask"]),
        ],
    )
    def test_create_from_template_seeds_html(self, world, template, headings):
        response = client_for(world.admin).post(world.readme_url(), {"template": template}, format="json")
        assert response.status_code == status.HTTP_201_CREATED, response.content
        page = Page.objects.get(pk=response.json()["page_id"])
        for heading in headings:
            assert f"<h2>{heading}</h2>" in page.description_html
        # Empty binary: the live server converts description_html on first open.
        assert not page.description_binary
        assert page.description_stripped

    def test_create_is_idempotent(self, world):
        first = client_for(world.member).post(world.readme_url(), {"template": "product"}, format="json")
        second = client_for(world.admin).post(world.readme_url(), {"template": "onboarding"}, format="json")
        assert first.status_code == status.HTTP_201_CREATED
        assert second.status_code == status.HTTP_200_OK
        assert first.json()["page_id"] == second.json()["page_id"]
        assert Page.objects.filter(name="README", projects=world.project).count() == 1

    def test_unknown_template_rejected(self, world):
        response = client_for(world.member).post(world.readme_url(), {"template": "nope"}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_guest_cannot_create(self, world):
        response = client_for(world.guest).post(world.readme_url(), {}, format="json")
        assert response.status_code == status.HTTP_403_FORBIDDEN
        world.project.refresh_from_db()
        assert world.project.readme_page_id is None

    def test_non_member_cannot_read(self, world):
        outsider = make_user("outsider")
        WorkspaceMember.objects.create(workspace=world.workspace, member=outsider, role=MEMBER)
        assert client_for(outsider).get(world.readme_url()).status_code == status.HTTP_403_FORBIDDEN

    def test_deleted_readme_is_treated_as_missing(self, world):
        page_id = client_for(world.member).post(world.readme_url(), {}, format="json").json()["page_id"]
        Page.objects.get(pk=page_id).delete()

        assert client_for(world.member).get(world.readme_url()).json() == {"page_id": None}
        response = client_for(world.member).post(world.readme_url(), {}, format="json")
        assert response.status_code == status.HTTP_201_CREATED
        assert response.json()["page_id"] != page_id

    def test_readme_hidden_from_pages_list_and_summary(self, world):
        client = client_for(world.member)
        normal = client.post(f"{world.base()}/pages/", {"name": "Notes"}, format="json")
        assert normal.status_code == status.HTTP_201_CREATED, normal.content
        readme_id = client.post(world.readme_url(), {}, format="json").json()["page_id"]

        listed = client.get(f"{world.base()}/pages/")
        assert listed.status_code == status.HTTP_200_OK
        listed_ids = {page["id"] for page in listed.json()}
        assert normal.json()["id"] in listed_ids
        assert readme_id not in listed_ids

        summary = client.get(f"{world.base()}/pages-summary/")
        assert summary.json()["public_pages"] == 1

        # Still readable as a page, so the editor can open it.
        detail = client.get(f"{world.base()}/pages/{readme_id}/")
        assert detail.status_code == status.HTTP_200_OK, detail.content

    def test_readme_cannot_be_archived_or_deleted(self, world):
        client = client_for(world.admin)
        readme_id = client.post(world.readme_url(), {}, format="json").json()["page_id"]

        archive = client.post(f"{world.base()}/pages/{readme_id}/archive/")
        assert archive.status_code == status.HTTP_400_BAD_REQUEST
        assert "README" in archive.json()["error"]

        delete = client.delete(f"{world.base()}/pages/{readme_id}/")
        assert delete.status_code == status.HTTP_400_BAD_REQUEST
        page = Page.objects.get(pk=readme_id)
        assert page.archived_at is None

    def test_project_update_cannot_set_readme(self, world):
        other = Page.objects.create(name="x", workspace=world.workspace, owned_by=world.admin)
        client_for(world.admin).patch(f"{world.base()}/", {"readme_page": str(other.id)}, format="json")
        world.project.refresh_from_db()
        assert world.project.readme_page_id is None


# ---------------------------------------------------------------- Spreadsheets


def request_upload(world, user, name="Budget.xlsx", type=XLSX, size=1024, project=None):
    return client_for(user).post(
        world.sheets_url(project=project), {"name": name, "type": type, "size": size}, format="json"
    )


def uploaded_sheet(world, storage, user=None, name="Budget.xlsx", type=XLSX, data=b"PK\x03\x04data", project=None):
    """Request an upload, put the bytes in storage, and confirm it."""
    user = user or world.member
    response = request_upload(world, user, name=name, type=type, size=len(data), project=project)
    assert response.status_code == status.HTTP_200_OK, response.content
    asset_id = response.json()["asset_id"]
    storage.objects[response.json()["upload_data"]["fields"]["key"]] = data
    confirm = client_for(user).patch(world.sheets_url(asset_id, project=project), {"is_uploaded": True}, format="json")
    assert confirm.status_code == status.HTTP_200_OK, confirm.content
    return FileAsset.objects.get(pk=asset_id)


class TestSpreadsheetUploadValidation:
    def test_request_upload(self, world, storage):
        response = request_upload(world, world.member)
        assert response.status_code == status.HTTP_200_OK, response.content
        body = response.json()
        assert set(body) == {"upload_data", "asset_id", "asset_url"}
        asset = FileAsset.objects.get(pk=body["asset_id"])
        assert asset.entity_type == FileAsset.EntityTypeContext.PROJECT_SPREADSHEET
        assert asset.project_id == world.project.id
        assert asset.is_uploaded is False
        assert asset.created_by_id == world.member.id
        assert body["asset_url"].endswith(f"/spreadsheets/{asset.id}/content/")
        storage.generate_presigned_post.assert_called_once_with(
            object_name=asset.asset.name, file_type=XLSX, file_size=1024
        )

    @pytest.mark.parametrize("type", ["text/csv", "application/vnd.ms-excel", "text/plain", "text/csv; charset=utf-8"])
    def test_csv_types_accepted(self, world, storage, type):
        response = request_upload(world, world.member, name="data.csv", type=type)
        assert response.status_code == status.HTTP_200_OK, response.content
        asset = FileAsset.objects.get(pk=response.json()["asset_id"])
        assert asset.attributes["type"] == "text/csv"

    @pytest.mark.parametrize(
        "name,type",
        [
            ("Budget.xlsx", "text/plain"),  # text/plain only for .csv
            ("Budget.xlsx", "application/vnd.ms-excel"),
            ("data.csv", "image/png"),
            ("report.txt", "text/plain"),  # bad extension
            ("macro.xlsm", XLSX),
            ("Budget", XLSX),
        ],
    )
    def test_bad_type_or_extension_rejected(self, world, storage, name, type):
        response = request_upload(world, world.member, name=name, type=type)
        assert response.status_code == status.HTTP_400_BAD_REQUEST, response.content
        assert not FileAsset.objects.filter(entity_type=FileAsset.EntityTypeContext.PROJECT_SPREADSHEET).exists()

    @pytest.mark.parametrize("size", [0, -1, "abc", None])
    def test_bad_size_rejected(self, world, storage, size):
        assert request_upload(world, world.member, size=size).status_code == status.HTTP_400_BAD_REQUEST

    def test_too_large_rejected(self, world, storage, settings):
        settings.SPREADSHEET_SIZE_LIMIT = 1000
        assert request_upload(world, world.member, size=1001).status_code == status.HTTP_400_BAD_REQUEST
        assert request_upload(world, world.member, size=1000).status_code == status.HTTP_200_OK

    def test_name_is_sanitized(self, world, storage):
        response = request_upload(world, world.member, name="../../etc/Budget.xlsx")
        asset = FileAsset.objects.get(pk=response.json()["asset_id"])
        assert asset.attributes["name"] == "Budget.xlsx"

    def test_guest_cannot_upload(self, world, storage):
        assert request_upload(world, world.guest).status_code == status.HTTP_403_FORBIDDEN

    def test_generic_asset_endpoint_refuses_spreadsheets(self, world, storage):
        response = client_for(world.member).post(
            f"/api/assets/v2/workspaces/{world.workspace.slug}/projects/{world.project.id}/",
            {"name": "a.png", "type": "image/png", "size": 10, "entity_type": "PROJECT_SPREADSHEET"},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST


class TestSpreadsheetLifecycle:
    def test_confirm_requires_object_in_storage(self, world, storage):
        asset_id = request_upload(world, world.member).json()["asset_id"]
        response = client_for(world.member).patch(world.sheets_url(asset_id), {"is_uploaded": True}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert FileAsset.objects.get(pk=asset_id).is_uploaded is False

    def test_list_only_uploaded_and_item_shape(self, world, storage):
        request_upload(world, world.member, name="pending.xlsx")  # never confirmed
        sheet = uploaded_sheet(world, storage)

        response = client_for(world.guest).get(world.sheets_url())
        assert response.status_code == status.HTTP_200_OK
        items = response.json()
        assert len(items) == 1
        item = items[0]
        assert set(item) == {
            "id",
            "name",
            "size",
            "type",
            "project",
            "created_by",
            "created_at",
            "updated_by",
            "updated_at",
        }
        assert item["id"] == str(sheet.id)
        assert item["name"] == "Budget.xlsx"
        assert item["size"] == len(b"PK\x03\x04data")
        assert item["type"] == XLSX
        assert item["project"] == str(world.project.id)
        assert item["created_by"] == str(world.member.id)
        assert item["updated_by"] == str(world.member.id)

    def test_list_ordered_by_updated_at(self, world, storage):
        first = uploaded_sheet(world, storage, name="a.xlsx")
        second = uploaded_sheet(world, storage, name="b.xlsx")
        assert [i["id"] for i in client_for(world.member).get(world.sheets_url()).json()] == [
            str(second.id),
            str(first.id),
        ]
        client_for(world.member).patch(world.sheets_url(first), {"name": "a2"}, format="json")
        assert client_for(world.member).get(world.sheets_url()).json()[0]["id"] == str(first.id)

    def test_rename_keeps_extension(self, world, storage):
        sheet = uploaded_sheet(world, storage)
        client = client_for(world.admin)

        response = client.patch(world.sheets_url(sheet), {"name": "Q3 plan"}, format="json")
        assert response.status_code == status.HTTP_200_OK, response.content
        assert response.json()["name"] == "Q3 plan.xlsx"
        assert response.json()["updated_by"] == str(world.admin.id)

        response = client.patch(world.sheets_url(sheet), {"name": "../Final.XLSX"}, format="json")
        assert response.json()["name"] == "Final.XLSX"

        response = client.patch(world.sheets_url(sheet), {"name": "  "}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_replace_keeps_id(self, world, storage):
        sheet = uploaded_sheet(world, storage)
        old_key = sheet.asset.name
        client = client_for(world.member)

        response = client.post(
            world.sheets_url(sheet, "replace/"), {"name": "Budget v2.csv", "type": "text/csv", "size": 3}, format="json"
        )
        assert response.status_code == status.HTTP_200_OK, response.content
        body = response.json()
        assert body["asset_id"] == str(sheet.id)
        assert set(body) == {"upload_data", "asset_id", "asset_url"}
        new_key = body["upload_data"]["fields"]["key"]
        assert new_key != old_key

        # Until confirmed, the old file is still served.
        sheet.refresh_from_db()
        assert sheet.asset.name == old_key
        assert client.get(world.sheets_url()).json()[0]["name"] == "Budget.xlsx"

        storage.objects[new_key] = b"a,b"
        response = client.patch(world.sheets_url(sheet), {"is_uploaded": True}, format="json")
        assert response.status_code == status.HTTP_200_OK, response.content
        assert response.json()["id"] == str(sheet.id)
        assert response.json()["name"] == "Budget v2.csv"
        assert response.json()["type"] == "text/csv"
        assert response.json()["size"] == 3

        sheet.refresh_from_db()
        assert sheet.asset.name == new_key
        assert "pending_asset" not in sheet.attributes
        assert FileAsset.objects.filter(entity_type=FileAsset.EntityTypeContext.PROJECT_SPREADSHEET).count() == 1

        content = client.get(world.sheets_url(sheet, "content/"))
        assert b"".join(content.streaming_content) == b"a,b"

    def test_replace_validates_file(self, world, storage):
        sheet = uploaded_sheet(world, storage)
        response = client_for(world.member).post(
            world.sheets_url(sheet, "replace/"), {"name": "x.pdf", "type": "application/pdf", "size": 3}, format="json"
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_delete(self, world, storage):
        sheet = uploaded_sheet(world, storage)
        client = client_for(world.member)
        assert client.delete(world.sheets_url(sheet)).status_code == status.HTTP_204_NO_CONTENT
        assert client.get(world.sheets_url()).json() == []
        assert client.get(world.sheets_url(sheet, "content/")).status_code == status.HTTP_404_NOT_FOUND
        assert client.delete(world.sheets_url(sheet)).status_code == status.HTTP_404_NOT_FOUND
        deleted = FileAsset.all_objects.get(pk=sheet.pk)
        assert deleted.is_deleted is True

    def test_guest_is_read_only(self, world, storage):
        sheet = uploaded_sheet(world, storage)
        guest = client_for(world.guest)
        assert guest.patch(world.sheets_url(sheet), {"name": "x"}, format="json").status_code == 403
        assert guest.delete(world.sheets_url(sheet)).status_code == 403
        replace = guest.post(world.sheets_url(sheet, "replace/"), {"name": "a.csv", "type": "text/csv", "size": 1})
        assert replace.status_code == 403
        assert guest.get(world.sheets_url(sheet, "content/")).status_code == 200
        assert guest.get(world.sheets_url(sheet, "download/")).status_code == 302


class TestSpreadsheetContent:
    def test_content_streams_bytes_with_headers(self, world, storage):
        sheet = uploaded_sheet(world, storage, data=b"PK-bytes")
        response = client_for(world.member).get(world.sheets_url(sheet, "content/"))
        assert response.status_code == status.HTTP_200_OK
        assert b"".join(response.streaming_content) == b"PK-bytes"
        assert response["Content-Type"] == XLSX
        assert response["Content-Length"] == "8"
        assert response["Cache-Control"] == "private, no-cache"
        assert response["ETag"].startswith('"')

    def test_if_none_match_returns_304(self, world, storage):
        sheet = uploaded_sheet(world, storage)
        client = client_for(world.member)
        etag = client.get(world.sheets_url(sheet, "content/"))["ETag"]

        storage.get_object.reset_mock()
        response = client.get(world.sheets_url(sheet, "content/"), HTTP_IF_NONE_MATCH=etag)
        assert response.status_code == status.HTTP_304_NOT_MODIFIED
        assert response["ETag"] == etag
        storage.get_object.assert_not_called()

        # A rename changes updated_at, so the old ETag no longer matches.
        client.patch(world.sheets_url(sheet), {"name": "Other"}, format="json")
        response = client.get(world.sheets_url(sheet, "content/"), HTTP_IF_NONE_MATCH=etag)
        assert response.status_code == status.HTTP_200_OK

    def test_unconfirmed_upload_not_served(self, world, storage):
        asset_id = request_upload(world, world.member).json()["asset_id"]
        response = client_for(world.member).get(world.sheets_url(asset_id, "content/"))
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_download_redirects_to_attachment_link(self, world, storage):
        sheet = uploaded_sheet(world, storage)
        response = client_for(world.member).get(world.sheets_url(sheet, "download/"))
        assert response.status_code == status.HTTP_302_FOUND
        assert response["Location"] == f"https://storage.test/{sheet.asset.name}"
        storage.generate_presigned_url.assert_called_with(
            object_name=sheet.asset.name, disposition="attachment", filename="Budget.xlsx"
        )


class TestSpreadsheetScoping:
    def test_cross_project_lookup_is_404(self, world, storage):
        other_project = world.make_project("OTH")
        ProjectMember.objects.create(workspace=world.workspace, project=other_project, member=world.member, role=MEMBER)
        sheet = uploaded_sheet(world, storage, project=other_project)
        client = client_for(world.member)

        # Addressed through a project it does not belong to.
        for suffix in ("content/", "download/"):
            assert client.get(world.sheets_url(sheet, suffix)).status_code == status.HTTP_404_NOT_FOUND
        assert client.patch(world.sheets_url(sheet), {"name": "x"}, format="json").status_code == 404
        assert client.delete(world.sheets_url(sheet)).status_code == 404
        replace = client.post(world.sheets_url(sheet, "replace/"), {"name": "a.csv", "type": "text/csv", "size": 1})
        assert replace.status_code == 404
        assert client.get(world.sheets_url()).json() == []

    def test_other_asset_types_are_404(self, world, storage):
        attachment = FileAsset.objects.create(
            attributes={"name": "x.xlsx", "type": XLSX},
            asset=f"{world.workspace.id}/x.xlsx",
            workspace=world.workspace,
            project=world.project,
            entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
            is_uploaded=True,
        )
        client = client_for(world.member)
        assert client.get(world.sheets_url(attachment, "content/")).status_code == status.HTTP_404_NOT_FOUND
        assert client.patch(world.sheets_url(attachment), {"name": "y"}, format="json").status_code == 404

    def test_generic_project_asset_endpoint_cannot_touch_spreadsheets(self, world, storage):
        sheet = uploaded_sheet(world, storage)
        url = f"/api/assets/v2/workspaces/{world.workspace.slug}/projects/{world.project.id}/{sheet.id}/"
        guest = client_for(world.guest)
        assert guest.delete(url).status_code == status.HTTP_404_NOT_FOUND
        sheet.refresh_from_db()
        assert sheet.is_deleted is False

    def test_non_project_member_forbidden(self, world, storage):
        sheet = uploaded_sheet(world, storage)
        outsider = make_user("outsider")
        WorkspaceMember.objects.create(workspace=world.workspace, member=outsider, role=MEMBER)
        client = client_for(outsider)
        assert client.get(world.sheets_url()).status_code == status.HTTP_403_FORBIDDEN
        assert client.get(world.sheets_url(sheet, "content/")).status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.unit
class TestReadmeTemplates:
    def test_blank_template_is_empty_paragraph(self):
        from plane.utils.project_readme import readme_template_html

        assert readme_template_html("blank") == "<p></p>"

    def test_unknown_template_falls_back_to_blank(self):
        from plane.utils.project_readme import readme_template_html

        assert readme_template_html("missing") == "<p></p>"
