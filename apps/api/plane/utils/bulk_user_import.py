# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Create user accounts in bulk from a CSV or Excel file, without sending any email.

Each row creates (or reuses) an account, gives new accounts a temporary
password, and optionally adds the user to a workspace and to projects in it.
The caller hands the temporary passwords to the users out of band.
"""

import csv
import io
import logging
import re
import secrets
import uuid
from dataclasses import asdict, dataclass, field

from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import transaction
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation
from zxcvbn import zxcvbn

from plane.db.models import (
    Profile,
    Project,
    ProjectMember,
    ProjectUserProperty,
    User,
    Workspace,
    WorkspaceMember,
    WorkspaceMemberInvite,
)
from plane.utils.cache import invalidate_cache_directly

logger = logging.getLogger("plane.api")

COLUMNS = [
    "email",
    "first_name",
    "last_name",
    "phone",
    "display_name",
    "password",
    "workspace",
    "role",
    "projects",
    "project_role",
]

# Columns offered in the downloadable template. Passwords are always generated there.
TEMPLATE_COLUMNS = ["email", "first_name", "last_name", "phone", "workspace", "role", "projects", "project_role"]
TEMPLATE_EXAMPLES = [
    ["ahmed@example.com", "Ahmed", "Ali", "+966551234567", "", "member", "", ""],
    ["sara@example.com", "Sara", "Hassan", "+966501234567", "", "admin", "", ""],
]
TEMPLATE_HELP = [
    ("email", "Required. The address the user signs in with."),
    ("first_name", "Optional."),
    ("last_name", "Optional."),
    ("phone", "Optional. International format with country code, for example +966551234567."),
    (
        "workspace",
        "Optional. Workspace slug (the part after the domain in its URL). Empty uses the default chosen on upload.",
    ),
    ("role", "Optional. Workspace role: admin, member or guest. Empty uses the default chosen on upload."),
    ("projects", "Optional. Project identifiers separated by ; for example WEB;API. Needs a workspace."),
    ("project_role", "Optional. admin, member or guest. Empty uses the workspace role."),
]

# Upper bound for one upload, so a request finishes in reasonable time.
MAX_ROWS = 1000

ADMIN, MEMBER, GUEST = 20, 15, 5
ROLE_ALIASES = {"admin": ADMIN, "member": MEMBER, "guest": GUEST, "20": ADMIN, "15": MEMBER, "5": GUEST}
ROLE_NAMES = {ADMIN: "admin", MEMBER: "member", GUEST: "guest"}

# Same threshold the sign-up and change-password flows enforce.
MIN_PASSWORD_SCORE = 3

# Look-alike characters (I, O, l, 0, 1) are left out so passwords can be read aloud or retyped.
_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
_LOWER = "abcdefghijkmnopqrstuvwxyz"
_DIGITS = "23456789"
_SYMBOLS = "!#$%*+-?@_"

STATUS_CREATED = "created"
STATUS_EXISTING = "existing"
STATUS_ERROR = "error"


class BulkUserImportError(Exception):
    """The file as a whole cannot be processed (bad header, no rows)."""


class RowError(Exception):
    """One row cannot be processed; the other rows continue."""


@dataclass
class RowResult:
    line: int
    email: str
    status: str
    first_name: str = ""
    last_name: str = ""
    phone: str = ""
    password: str = ""
    workspace: str = ""
    projects: list = field(default_factory=list)
    messages: list = field(default_factory=list)

    def as_dict(self):
        return asdict(self)


def normalize_header(name):
    return str(name or "").strip().lower().replace(" ", "_").replace("-", "_")


def _build_rows(headers, records):
    """Turn (line_number, values) records into (line_number, row_dict) pairs keyed by normalized column names."""
    headers = [normalize_header(h) for h in headers]
    if "email" not in headers:
        raise BulkUserImportError("The file needs an 'email' column. Download the template to see the format.")
    unknown = sorted({h for h in headers if h and h not in COLUMNS})
    if unknown:
        raise BulkUserImportError(f"Unknown column(s): {', '.join(unknown)}. Allowed columns: {', '.join(COLUMNS)}.")

    rows = []
    for line, values in records:
        row = {}
        for key, value in zip(headers, values):
            if key in COLUMNS:
                row[key] = str(value if value is not None else "").strip()
        if not any(row.values()):
            continue
        rows.append((line, row))
        if len(rows) > MAX_ROWS:
            raise BulkUserImportError(f"The file has more than {MAX_ROWS} users. Split it into smaller files.")
    if not rows:
        raise BulkUserImportError("The file has no user rows.")
    return rows


def read_rows(text):
    """Parse CSV text into (line_number, row_dict) pairs."""
    reader = csv.reader(io.StringIO(text.lstrip("﻿")))  # Excel writes a UTF-8 BOM
    headers = next(reader, None)
    if not headers:
        raise BulkUserImportError("The file is empty.")
    return _build_rows(headers, ((reader.line_num, values) for values in reader))


def _cell_text(value):
    # Numbers typed into Excel come back as floats; 966551234567.0 must read as 966551234567.
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return "" if value is None else str(value)


def read_xlsx_rows(content):
    """Parse the first sheet of an .xlsx file into (line_number, row_dict) pairs."""
    try:
        workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception:
        raise BulkUserImportError("The file is not a valid Excel (.xlsx) workbook.")
    try:
        rows = workbook.worksheets[0].iter_rows(values_only=True)
        headers = next(rows, None)
        if not headers or not any(headers):
            raise BulkUserImportError("The file is empty.")
        return _build_rows(
            [_cell_text(h) for h in headers],
            ((line, [_cell_text(v) for v in values]) for line, values in enumerate(rows, start=2)),
        )
    finally:
        workbook.close()


def read_upload(filename, content):
    """Read an uploaded .csv or .xlsx file."""
    name = (filename or "").lower()
    if name.endswith(".xlsx"):
        return read_xlsx_rows(content)
    if name.endswith(".csv"):
        try:
            return read_rows(content.decode("utf-8-sig"))
        except UnicodeDecodeError:
            raise BulkUserImportError("Save the CSV file as UTF-8 (in Excel: 'CSV UTF-8'), or upload the .xlsx file.")
    raise BulkUserImportError("Upload a .xlsx or .csv file.")


def build_template_xlsx():
    """The downloadable Excel template. Every column is text so Excel keeps the + in phone numbers."""
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Users"
    sheet.append(TEMPLATE_COLUMNS)
    for example in TEMPLATE_EXAMPLES:
        sheet.append(example)

    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="1F4E79")
    for index, name in enumerate(TEMPLATE_COLUMNS, start=1):
        letter = sheet.cell(row=1, column=index).column_letter
        sheet.cell(row=1, column=index).font = header_font
        sheet.cell(row=1, column=index).fill = header_fill
        sheet.column_dimensions[letter].width = 30 if name == "email" else 18
        for row in range(2, MAX_ROWS + 2):
            sheet.cell(row=row, column=index).number_format = "@"
    sheet.freeze_panes = "A2"

    roles = DataValidation(type="list", formula1='"admin,member,guest"', allow_blank=True)
    sheet.add_data_validation(roles)
    for name in ("role", "project_role"):
        letter = sheet.cell(row=1, column=TEMPLATE_COLUMNS.index(name) + 1).column_letter
        roles.add(f"{letter}2:{letter}{MAX_ROWS + 1}")

    guide = workbook.create_sheet("How to fill")
    guide.append(["Column", "What to enter"])
    guide["A1"].font = guide["B1"].font = Font(bold=True)
    for row in TEMPLATE_HELP:
        guide.append(list(row))
    guide.append([])
    guide.append(["", "Replace the two example rows with your users. Passwords are generated when you upload."])
    guide.column_dimensions["A"].width = 16
    guide.column_dimensions["B"].width = 100

    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def parse_role(value, default):
    if not value:
        return default
    role = ROLE_ALIASES.get(value.strip().lower())
    if role is None:
        raise RowError(f"Unknown role '{value}'. Use admin, member or guest.")
    return role


def normalize_phone(value):
    """Return the phone number as +<digits>, or raise RowError."""
    if not value:
        return ""
    phone = re.sub(r"[\s\-().]", "", value)
    if phone.startswith("00"):
        phone = "+" + phone[2:]
    elif not phone.startswith("+") and phone.isdigit() and len(phone) >= 11:
        # A number with its country code but without the + (Excel drops it from numeric cells).
        phone = "+" + phone
    if not re.fullmatch(r"\+[1-9]\d{7,14}", phone):
        raise RowError(f"Phone '{value}' must include the country code, for example +966551234567.")
    return phone


def is_strong_password(password):
    return zxcvbn(password)["score"] >= MIN_PASSWORD_SCORE


def generate_password(length=16):
    """Random password with every character class, starting with a letter.

    Starting with a letter keeps spreadsheet apps from reading it as a formula.
    """
    rng = secrets.SystemRandom()
    pool = _UPPER + _LOWER + _DIGITS + _SYMBOLS
    while True:
        chars = [rng.choice(_UPPER), rng.choice(_LOWER), rng.choice(_DIGITS), rng.choice(_SYMBOLS)]
        chars += [rng.choice(pool) for _ in range(length - len(chars) - 1)]
        rng.shuffle(chars)
        password = rng.choice(_UPPER + _LOWER) + "".join(chars)
        if is_strong_password(password):
            return password


class BulkUserImporter:
    def __init__(self, default_workspace=None, default_role=MEMBER):
        self.default_workspace = (default_workspace or "").strip()
        self.default_role = default_role
        self._workspaces = {}
        self._projects = {}
        self._touched_workspaces = set()

    def run(self, rows, dry_run=False):
        """Process every row. Each row commits or fails on its own; a dry run rolls everything back."""
        results = []
        seen = set()
        with transaction.atomic():
            for line, row in rows:
                result = RowResult(
                    line=line,
                    email=row.get("email", "").lower(),
                    status=STATUS_ERROR,
                    first_name=row.get("first_name", ""),
                    last_name=row.get("last_name", ""),
                    phone=row.get("phone", ""),
                )
                try:
                    with transaction.atomic():
                        self._process_row(row, result, seen)
                except RowError as exc:
                    result.status = STATUS_ERROR
                    result.password = ""
                    result.messages = [str(exc)]
                results.append(result)
            if dry_run:
                transaction.set_rollback(True)

        if not dry_run:
            self._invalidate_member_caches()
        return results

    def _process_row(self, row, result, seen):
        email = result.email
        if not email:
            raise RowError("Email is empty.")
        try:
            validate_email(email)
        except ValidationError:
            raise RowError(f"'{email}' is not a valid email address.")
        if email in seen:
            raise RowError("This email appears earlier in the file.")
        seen.add(email)

        phone = normalize_phone(row.get("phone", ""))
        result.phone = phone
        role_given = bool(row.get("role"))
        role = parse_role(row.get("role"), self.default_role)
        slug = row.get("workspace") or self.default_workspace
        project_identifiers = [p.strip().upper() for p in row.get("projects", "").replace(",", ";").split(";")]
        project_identifiers = list(dict.fromkeys(p for p in project_identifiers if p))
        project_role = parse_role(row.get("project_role"), role)

        if project_identifiers and not slug:
            raise RowError("Projects need a workspace. Fill the workspace column or choose a default workspace.")
        if role == GUEST and project_role != GUEST:
            raise RowError("A workspace guest can only be a project guest.")

        password = row.get("password", "")
        if password and not is_strong_password(password):
            raise RowError("The password in the file is too weak. Leave it empty to generate one.")

        workspace = self._get_workspace(slug) if slug else None
        projects = [self._get_project(workspace, identifier) for identifier in project_identifiers]

        user = User.objects.filter(email=email).first()
        if user is None:
            password = password or generate_password()
            user = self._create_user(email, row, phone, password)
            result.status = STATUS_CREATED
            result.password = password
        else:
            if user.is_bot:
                raise RowError("This email belongs to a bot account.")
            if not user.is_active:
                raise RowError("This account is deactivated. Reactivate it before adding it again.")
            result.status = STATUS_EXISTING
            result.messages.append("Account already exists; its password was left unchanged.")
            if phone and not user.mobile_number:
                user.mobile_number = phone
                user.save(update_fields=["mobile_number"])
            elif phone and user.mobile_number != phone:
                result.messages.append(f"Kept the phone number already on the account ({user.mobile_number}).")
                result.phone = user.mobile_number

        profile, _ = Profile.objects.get_or_create(user=user)

        if workspace:
            self._add_to_workspace(user, workspace, role, role_given, result)
            result.workspace = workspace.slug
            for project in projects:
                self._add_to_project(user, project, project_role)
            result.projects = [project.identifier for project in projects]

            if result.status == STATUS_CREATED:
                # The admin already supplied the details onboarding asks for, so land the user in the workspace.
                profile.is_onboarded = True
                profile.onboarding_step = {key: True for key in profile.onboarding_step}
            if result.status == STATUS_CREATED or profile.last_workspace_id is None:
                profile.last_workspace_id = workspace.id
            profile.save()

    def _create_user(self, email, row, phone, password):
        user = User(
            email=email,
            username=uuid.uuid4().hex,
            first_name=row.get("first_name", ""),
            last_name=row.get("last_name", ""),
            display_name=row.get("display_name", ""),
            mobile_number=phone or None,
        )
        user.set_password(password)
        user.is_password_autoset = False
        user.save()
        return user

    def _get_workspace(self, slug):
        if slug not in self._workspaces:
            workspace = Workspace.objects.filter(slug=slug).first()
            if workspace is None:
                raise RowError(f"Workspace '{slug}' does not exist.")
            self._workspaces[slug] = workspace
        return self._workspaces[slug]

    def _get_project(self, workspace, identifier):
        key = (workspace.id, identifier)
        if key not in self._projects:
            project = Project.objects.filter(
                workspace=workspace, identifier=identifier, archived_at__isnull=True
            ).first()
            if project is None:
                raise RowError(f"Project '{identifier}' does not exist in workspace '{workspace.slug}'.")
            self._projects[key] = project
        return self._projects[key]

    def _add_to_workspace(self, user, workspace, role, role_given, result):
        member = WorkspaceMember.objects.filter(workspace=workspace, member=user).first()
        if member is None:
            WorkspaceMember.objects.create(workspace=workspace, member=user, role=role)
        elif not member.is_active:
            member.is_active = True
            member.role = role
            member.save()
        elif role_given and member.role != role:
            result.messages.append(
                f"Workspace role changed from {ROLE_NAMES.get(member.role, member.role)} to {ROLE_NAMES[role]}."
            )
            member.role = role
            member.save()
        WorkspaceMemberInvite.objects.filter(workspace=workspace, email__iexact=user.email).delete()
        self._touched_workspaces.add(workspace.slug)

    def _add_to_project(self, user, project, role):
        member = ProjectMember.objects.filter(project=project, member=user).first()
        if member is None:
            ProjectMember.objects.create(project=project, workspace=project.workspace, member=user, role=role)
        elif not member.is_active or member.role != role:
            member.is_active = True
            member.role = role
            member.save()
        ProjectUserProperty.objects.get_or_create(user=user, project=project, workspace=project.workspace)

    def _invalidate_member_caches(self):
        for slug in self._touched_workspaces:
            try:
                invalidate_cache_directly(path=f"/api/workspaces/{slug}/members/", user=False, multiple=True)
            except Exception:
                # The member list refreshes when the cache entry expires; not worth failing the import over.
                logger.warning("Could not clear the member cache for workspace %s", slug, exc_info=True)


RESULT_COLUMNS = [
    "line",
    "email",
    "first_name",
    "last_name",
    "phone",
    "status",
    "password",
    "workspace",
    "projects",
    "notes",
]


def write_results(results, stream):
    writer = csv.writer(stream)
    writer.writerow(RESULT_COLUMNS)
    for result in results:
        writer.writerow(
            [
                result.line,
                result.email,
                result.first_name,
                result.last_name,
                result.phone,
                result.status,
                result.password,
                result.workspace,
                ";".join(result.projects),
                " ".join(result.messages),
            ]
        )
