# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Bulk user creation from CSV (plane.utils.bulk_user_import and the bulk_create_users command)."""

import csv
import io

import pytest
from django.core.management import CommandError, call_command
from openpyxl import Workbook

from plane.db.models import (
    Profile,
    Project,
    ProjectMember,
    ProjectUserProperty,
    User,
    WorkspaceMember,
    WorkspaceMemberInvite,
)
from plane.utils.bulk_user_import import (
    STATUS_CREATED,
    STATUS_ERROR,
    STATUS_EXISTING,
    BulkUserImporter,
    BulkUserImportError,
    RowError,
    build_template_xlsx,
    generate_password,
    is_strong_password,
    normalize_phone,
    read_rows,
    read_upload,
    read_xlsx_rows,
)

HEADER = "email,first_name,last_name,display_name,password,workspace,role,projects,project_role\n"


@pytest.fixture
def projects(db, workspace):
    return {
        "WEB": Project.objects.create(name="Web", identifier="WEB", workspace=workspace),
        "API": Project.objects.create(name="Api", identifier="API", workspace=workspace),
    }


def run(text, dry_run=False, **kwargs):
    return BulkUserImporter(**kwargs).run(read_rows(text), dry_run=dry_run)


@pytest.mark.unit
class TestReadRows:
    def test_normalizes_headers_strips_bom_and_skips_blank_rows(self):
        rows = read_rows("﻿Email, First Name ,ROLE\n a@x.com , Amr ,admin\n,,\n")
        assert rows == [(2, {"email": "a@x.com", "first_name": "Amr", "role": "admin"})]

    def test_requires_email_column(self):
        with pytest.raises(BulkUserImportError, match="email"):
            read_rows("name\nAmr\n")

    def test_rejects_unknown_columns(self):
        with pytest.raises(BulkUserImportError, match="fax"):
            read_rows("email,fax\na@x.com,123\n")

    def test_rejects_file_without_rows(self):
        with pytest.raises(BulkUserImportError, match="no user rows"):
            read_rows(HEADER)


@pytest.mark.unit
class TestReadExcelAndUploads:
    def test_template_round_trips_with_phone_numbers_intact(self):
        rows = read_xlsx_rows(build_template_xlsx())

        assert [line for line, _ in rows] == [2, 3]
        assert rows[0][1]["email"] == "ahmed@example.com"
        assert rows[0][1]["phone"] == "+966551234567"

    def test_numeric_excel_cells_read_without_decimals(self):
        workbook = Workbook()
        workbook.active.append(["Email", "Phone"])
        workbook.active.append(["a@x.com", 966551234567])
        buffer = io.BytesIO()
        workbook.save(buffer)

        assert read_xlsx_rows(buffer.getvalue()) == [(2, {"email": "a@x.com", "phone": "966551234567"})]

    def test_read_upload_picks_format_by_extension(self):
        assert read_upload("Users.CSV", "﻿email\na@x.com\n".encode("utf-8")) == [(2, {"email": "a@x.com"})]
        with pytest.raises(BulkUserImportError, match="xlsx or .csv"):
            read_upload("users.txt", b"email\n")
        with pytest.raises(BulkUserImportError, match="not a valid Excel"):
            read_upload("users.xlsx", b"not a zip")
        with pytest.raises(BulkUserImportError, match="UTF-8"):
            read_upload("users.csv", "email\nsal\xe9@x.com\n".encode("latin-1"))


@pytest.mark.unit
@pytest.mark.parametrize(
    "value, expected",
    [
        ("+966551234567", "+966551234567"),
        ("+966 55 123-4567", "+966551234567"),
        ("00966551234567", "+966551234567"),
        ("966551234567", "+966551234567"),
        ("", ""),
    ],
)
def test_normalize_phone(value, expected):
    assert normalize_phone(value) == expected


@pytest.mark.unit
@pytest.mark.parametrize("value", ["0551234567", "+0551234567", "phone", "+1234"])
def test_normalize_phone_rejects_numbers_without_country_code(value):
    with pytest.raises(RowError, match="country code"):
        normalize_phone(value)


@pytest.mark.unit
def test_generated_passwords_are_strong_unique_and_start_with_a_letter():
    passwords = {generate_password() for _ in range(20)}
    assert len(passwords) == 20
    for password in passwords:
        assert len(password) == 16
        assert password[0].isalpha()
        assert is_strong_password(password)


@pytest.mark.unit
@pytest.mark.django_db
class TestBulkUserImporter:
    def test_creates_user_with_workspace_and_project_memberships(self, workspace, projects):
        WorkspaceMemberInvite.objects.create(workspace=workspace, email="NEW@x.com", token="t", role=5)

        [result] = run(HEADER + "New@X.com,Nora,Saleh,nora,,test-workspace,member,web;API,\n")

        assert result.status == STATUS_CREATED
        user = User.objects.get(email="new@x.com")
        assert user.check_password(result.password)
        assert not user.is_password_autoset
        assert (user.first_name, user.last_name, user.display_name) == ("Nora", "Saleh", "nora")

        assert WorkspaceMember.objects.get(workspace=workspace, member=user).role == 15
        for project in projects.values():
            assert ProjectMember.objects.get(project=project, member=user).role == 15
            assert ProjectUserProperty.objects.filter(project=project, user=user).exists()
        assert result.projects == ["WEB", "API"]
        assert not WorkspaceMemberInvite.objects.filter(workspace=workspace).exists()

        profile = Profile.objects.get(user=user)
        assert profile.is_onboarded
        assert all(profile.onboarding_step.values())
        assert profile.last_workspace_id == workspace.id

    def test_uses_password_from_file_and_default_workspace(self, workspace):
        [result] = run(HEADER + "a@x.com,,,,Kx9#mPq2!vLr7Tz,,admin,,\n", default_workspace="test-workspace")

        user = User.objects.get(email="a@x.com")
        assert result.password == "Kx9#mPq2!vLr7Tz"
        assert user.check_password("Kx9#mPq2!vLr7Tz")
        assert WorkspaceMember.objects.get(workspace=workspace, member=user).role == 20

    def test_user_without_workspace_keeps_onboarding(self, db):
        [result] = run(HEADER + "solo@x.com,,,,,,,,\n")

        assert result.status == STATUS_CREATED
        assert not Profile.objects.get(user__email="solo@x.com").is_onboarded

    def test_existing_user_keeps_password_and_joins_workspace(self, workspace, create_user):
        [result] = run(HEADER + f"{create_user.email},,,,Kx9#mPq2!vLr7Tz,,,,\n", default_workspace="test-workspace")

        create_user.refresh_from_db()
        assert result.status == STATUS_EXISTING
        assert result.password == ""
        assert create_user.check_password("test-password")
        assert "left unchanged" in result.messages[0]

    def test_existing_member_role_changes_only_when_given(self, workspace, create_user):
        [result] = run(HEADER + f"{create_user.email},,,,,test-workspace,,,\n")
        assert WorkspaceMember.objects.get(workspace=workspace, member=create_user).role == 20
        assert not any("role changed" in message for message in result.messages)

        [result] = run(HEADER + f"{create_user.email},,,,,test-workspace,guest,,\n")
        assert WorkspaceMember.objects.get(workspace=workspace, member=create_user).role == 5
        assert any("admin to guest" in message for message in result.messages)

    def test_reactivates_removed_workspace_member(self, workspace):
        user = User.objects.create(email="gone@x.com", username="gone")
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=5, is_active=False)

        run(HEADER + "gone@x.com,,,,,test-workspace,member,,\n")

        member = WorkspaceMember.objects.get(workspace=workspace, member=user)
        assert member.is_active and member.role == 15

    def test_saves_phone_numbers(self, workspace, create_user):
        User.objects.create(email="has-phone@x.com", username="hp", mobile_number="+966500000000")

        results = run(
            "email,phone\n"
            "new@x.com,00966 55 123 4567\n"
            f"{create_user.email},+966551111111\n"
            "has-phone@x.com,+966552222222\n"
            "bad-phone@x.com,0551234567\n"
        )

        assert results[0].phone == "+966551234567"
        assert User.objects.get(email="new@x.com").mobile_number == "+966551234567"
        create_user.refresh_from_db()
        assert create_user.mobile_number == "+966551111111"
        assert User.objects.get(email="has-phone@x.com").mobile_number == "+966500000000"
        assert results[2].phone == "+966500000000"
        assert any("Kept the phone number" in message for message in results[2].messages)
        assert results[3].status == STATUS_ERROR
        assert not User.objects.filter(email="bad-phone@x.com").exists()

    @pytest.mark.parametrize(
        "row, message",
        [
            ("not-an-email,,,,,,,,", "not a valid email"),
            ("a@x.com,,,,,missing-ws,,,", "Workspace 'missing-ws' does not exist"),
            ("a@x.com,,,,,test-workspace,,NOPE,", "Project 'NOPE' does not exist"),
            ("a@x.com,,,,,,,WEB,", "Projects need a workspace"),
            ("a@x.com,,,,,test-workspace,owner,,", "Unknown role 'owner'"),
            ("a@x.com,,,,,test-workspace,guest,WEB,member", "guest can only be a project guest"),
            ("a@x.com,,,,password,,,,", "too weak"),
        ],
    )
    def test_invalid_rows_fail_without_creating_anything(self, workspace, projects, row, message):
        [result] = run(HEADER + row + "\n")

        assert result.status == STATUS_ERROR
        assert message in result.messages[0]
        assert not User.objects.filter(email="a@x.com").exists()

    def test_bad_row_does_not_stop_other_rows(self, workspace, projects):
        results = run(
            HEADER
            + "ok1@x.com,,,,,test-workspace,,WEB,\n"
            + "bad@x.com,,,,,test-workspace,,NOPE,\n"
            + "ok1@x.com,,,,,test-workspace,,,\n"
            + "ok2@x.com,,,,,test-workspace,,,\n"
        )

        assert [r.status for r in results] == [STATUS_CREATED, STATUS_ERROR, STATUS_ERROR, STATUS_CREATED]
        assert "earlier in the file" in results[2].messages[0]
        assert [r.line for r in results] == [2, 3, 4, 5]
        assert set(
            User.objects.filter(email__in=["ok1@x.com", "ok2@x.com", "bad@x.com"]).values_list("email", flat=True)
        ) == {
            "ok1@x.com",
            "ok2@x.com",
        }

    def test_rejects_bot_and_deactivated_accounts(self, workspace, create_bot_user):
        User.objects.create(email="off@x.com", username="off", is_active=False)

        results = run(HEADER + f"{create_bot_user.email},,,,,,,,\noff@x.com,,,,,,,,\n")

        assert "bot account" in results[0].messages[0]
        assert "deactivated" in results[1].messages[0]

    def test_dry_run_saves_nothing(self, workspace, projects):
        [result] = run(HEADER + "dry@x.com,,,,,test-workspace,,WEB,\n", dry_run=True)

        assert result.status == STATUS_CREATED
        assert not User.objects.filter(email="dry@x.com").exists()


@pytest.mark.unit
@pytest.mark.django_db
class TestBulkCreateUsersCommand:
    def test_writes_credentials_file(self, workspace, tmp_path):
        source = tmp_path / "users.csv"
        source.write_text(HEADER + "cmd@x.com,Cmd,User,,,test-workspace,,,\n", encoding="utf-8")

        call_command("bulk_create_users", str(source), stdout=io.StringIO())

        with open(tmp_path / "users_credentials.csv", encoding="utf-8", newline="") as handle:
            [row] = list(csv.DictReader(handle))
        assert row["email"] == "cmd@x.com"
        assert row["status"] == STATUS_CREATED
        assert User.objects.get(email="cmd@x.com").check_password(row["password"])

    def test_refuses_to_overwrite_credentials_file(self, workspace, tmp_path):
        source = tmp_path / "users.csv"
        source.write_text(HEADER + "cmd@x.com,,,,,,,,\n", encoding="utf-8")
        (tmp_path / "users_credentials.csv").write_text("old passwords", encoding="utf-8")

        with pytest.raises(CommandError, match="already exists"):
            call_command("bulk_create_users", str(source), stdout=io.StringIO())
        assert not User.objects.filter(email="cmd@x.com").exists()

    def test_failed_rows_exit_with_error_after_saving_good_rows(self, workspace, tmp_path):
        source = tmp_path / "users.csv"
        source.write_text(HEADER + "good@x.com,,,,,,,,\nbad,,,,,,,,\n", encoding="utf-8")

        with pytest.raises(CommandError, match="1 row"):
            call_command("bulk_create_users", str(source), stdout=io.StringIO())
        assert User.objects.filter(email="good@x.com").exists()
        assert (tmp_path / "users_credentials.csv").exists()

    def test_template_lists_columns(self):
        out = io.StringIO()
        call_command("bulk_create_users", template=True, stdout=out)
        assert out.getvalue().startswith("email,first_name,last_name")
