# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Instance admin endpoints for bulk user creation (admin console > Users)."""

import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from django.utils import timezone
from openpyxl import load_workbook
from rest_framework import status

from plane.db.models import User, WorkspaceMember
from plane.license.models import Instance, InstanceAdmin

CREATE_URL = "instance-bulk-user-create"
TEMPLATE_URL = "instance-bulk-user-template"
HEADER = "email,first_name,last_name,phone,workspace,role,projects,project_role\n"


@pytest.fixture
def instance_admin(db, create_user):
    instance = Instance.objects.create(
        instance_name="Test", instance_id="test-instance", current_version="1.0", last_checked_at=timezone.now()
    )
    InstanceAdmin.objects.create(user=create_user, instance=instance, role=20)
    return create_user


def csv_upload(text, name="users.csv"):
    return SimpleUploadedFile(name, text.encode("utf-8"), content_type="text/csv")


@pytest.mark.contract
@pytest.mark.django_db
class TestInstanceBulkUserEndpoints:
    def test_requires_instance_admin(self, session_client):
        assert session_client.get(reverse(TEMPLATE_URL)).status_code == status.HTTP_403_FORBIDDEN
        response = session_client.post(reverse(CREATE_URL), {"file": csv_upload(HEADER + "a@x.com,,,,,,,\n")})
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert not User.objects.filter(email="a@x.com").exists()

    def test_template_is_an_excel_file_with_text_columns(self, session_client, instance_admin):
        response = session_client.get(reverse(TEMPLATE_URL))

        assert response.status_code == status.HTTP_200_OK
        assert "users-template.xlsx" in response["Content-Disposition"]
        sheet = load_workbook(io.BytesIO(response.content)).worksheets[0]
        assert [c.value for c in sheet[1]] == HEADER.strip().split(",")
        assert sheet["D2"].value == "+966551234567"
        assert sheet["D50"].number_format == "@"

    def test_dry_run_reports_without_creating(self, session_client, instance_admin, workspace):
        response = session_client.post(
            reverse(CREATE_URL),
            {
                "file": csv_upload(HEADER + "new@x.com,New,User,,,,,\nbad,,,,,,,\n"),
                "dry_run": "true",
                "workspace": "test-workspace",
            },
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data["dry_run"] is True
        assert response.data["summary"] == {"created": 1, "existing": 0, "failed": 1}
        assert not User.objects.filter(email="new@x.com").exists()

    def test_creates_users_and_returns_passwords(self, session_client, instance_admin, workspace):
        response = session_client.post(
            reverse(CREATE_URL),
            {
                "file": csv_upload(HEADER + "new@x.com,New,User,00966 55 123 4567,,,,\n"),
                "workspace": "test-workspace",
                "role": "guest",
            },
        )

        assert response.status_code == status.HTTP_200_OK
        assert response["Cache-Control"] == "no-store"
        [row] = response.data["results"]
        assert row["status"] == "created"
        assert row["phone"] == "+966551234567"
        user = User.objects.get(email="new@x.com")
        assert user.check_password(row["password"])
        assert user.mobile_number == "+966551234567"
        assert WorkspaceMember.objects.get(workspace=workspace, member=user).role == 5

    @pytest.mark.parametrize(
        "data, code",
        [
            ({}, "missing_file"),
            ({"file": csv_upload("x", name="users.txt")}, "invalid_file"),
            ({"file": csv_upload("name\nAmr\n")}, "invalid_file"),
            ({"file": csv_upload(HEADER + "a@x.com,,,,,,,\n"), "workspace": "nope"}, "invalid_workspace"),
            ({"file": csv_upload(HEADER + "a@x.com,,,,,,,\n"), "role": "owner"}, "invalid_role"),
        ],
    )
    def test_rejects_bad_requests(self, session_client, instance_admin, workspace, data, code):
        response = session_client.post(reverse(CREATE_URL), data)

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["code"] == code
        assert not User.objects.filter(email="a@x.com").exists()


@pytest.mark.contract
@pytest.mark.django_db
class TestInstanceUserCreateEndpoint:
    URL = "instance-user-create"

    def test_requires_instance_admin(self, session_client):
        response = session_client.post(reverse(self.URL), {"email": "one@x.com"}, format="json")
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert not User.objects.filter(email="one@x.com").exists()

    def test_creates_one_user_with_generated_password(self, session_client, instance_admin, workspace):
        response = session_client.post(
            reverse(self.URL),
            {
                "email": " One@X.com ",
                "first_name": "One",
                "last_name": "User",
                "phone": "+966 55 123 4567",
                "workspace": "test-workspace",
                "role": "admin",
                "password": "ignored-Kx9#mPq2!vLr7Tz",
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response["Cache-Control"] == "no-store"
        assert response.data["status"] == "created"
        user = User.objects.get(email="one@x.com")
        assert response.data["password"] != "ignored-Kx9#mPq2!vLr7Tz"
        assert user.check_password(response.data["password"])
        assert (user.first_name, user.mobile_number) == ("One", "+966551234567")
        assert WorkspaceMember.objects.get(workspace=workspace, member=user).role == 20

    def test_existing_account_is_added_to_workspace_without_password(self, session_client, instance_admin, workspace):
        other = User.objects.create(email="old@x.com", username="old")

        response = session_client.post(
            reverse(self.URL), {"email": "old@x.com", "workspace": "test-workspace"}, format="json"
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data["status"] == "existing"
        assert response.data["password"] == ""
        assert WorkspaceMember.objects.get(workspace=workspace, member=other).role == 15

    @pytest.mark.parametrize(
        "payload, message",
        [
            ({}, "Email is empty"),
            ({"email": "nope"}, "not a valid email"),
            ({"email": "a@x.com", "phone": "0551234567"}, "country code"),
            ({"email": "a@x.com", "workspace": "missing"}, "does not exist"),
            ({"email": "a@x.com", "role": "owner"}, "Unknown role"),
        ],
    )
    def test_rejects_invalid_user(self, session_client, instance_admin, workspace, payload, message):
        response = session_client.post(reverse(self.URL), payload, format="json")

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["code"] == "invalid_user"
        assert message in response.data["error"]
        assert not User.objects.filter(email="a@x.com").exists()
