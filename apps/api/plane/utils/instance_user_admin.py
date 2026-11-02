# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Account management for instance admins (admin console > Users > All users).

Instance admins can edit any account, set a new password, deactivate, reactivate
or permanently delete it, and manage its workspace and project memberships.
The rules mirror the in-app flows so a workspace or project is never left
without an admin.
"""

import logging

from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.db.models import Count, Exists, OuterRef, Q
from django.utils import timezone

from plane.db.models import (
    Profile,
    Project,
    ProjectMember,
    ProjectUserProperty,
    Session,
    User,
    Workspace,
    WorkspaceMember,
    WorkspaceMemberInvite,
)
from plane.license.models import InstanceAdmin
from plane.utils.bulk_user_import import (
    ADMIN,
    GUEST,
    ROLE_NAMES,
    RowError,
    generate_password,
    is_strong_password,
    normalize_phone,
    parse_role,
)
from plane.utils.cache import invalidate_cache_directly

logger = logging.getLogger("plane.api")

EDITABLE_FIELDS = ("email", "first_name", "last_name", "display_name", "phone")
STATUS_FILTERS = ("active", "deactivated")


class UserAdminError(Exception):
    """The requested change breaks a rule; the message is shown to the admin as is."""


def _role_name(role):
    return ROLE_NAMES.get(role, str(role))


def parse_role_name(value):
    try:
        role = parse_role(str(value or ""), None)
    except RowError as exc:
        raise UserAdminError(str(exc))
    if role is None:
        raise UserAdminError("Choose a role: admin, member or guest.")
    return role


def invalidate_member_caches(*slugs):
    for slug in {s for s in slugs if s}:
        try:
            invalidate_cache_directly(path=f"/api/workspaces/{slug}/members/", user=False, multiple=True)
        except Exception:
            # The member list refreshes when the cache entry expires; not worth failing the change over.
            logger.warning("Could not clear the member cache for workspace %s", slug, exc_info=True)


def end_sessions(user):
    Session.objects.filter(user_id=str(user.id)).delete()


# ---------------------------------------------------------------------------
# Reading


def user_queryset(search="", status="", workspace=""):
    users = User.objects.filter(is_bot=False).annotate(
        workspace_count=Count(
            "member_workspace",
            filter=Q(member_workspace__is_active=True, member_workspace__deleted_at__isnull=True),
            distinct=True,
        ),
        is_instance_admin=Exists(InstanceAdmin.objects.filter(user=OuterRef("pk"))),
    )
    search = (search or "").strip()
    if search:
        users = users.filter(
            Q(email__icontains=search)
            | Q(first_name__icontains=search)
            | Q(last_name__icontains=search)
            | Q(display_name__icontains=search)
            | Q(mobile_number__icontains=search)
        )
    if status == "active":
        users = users.filter(is_active=True)
    elif status == "deactivated":
        users = users.filter(is_active=False)
    if workspace:
        users = users.filter(
            member_workspace__workspace__slug=workspace,
            member_workspace__is_active=True,
            member_workspace__deleted_at__isnull=True,
        )
    return users.order_by("-created_at")


def serialize_user(user):
    return {
        "id": str(user.id),
        "email": user.email or "",
        "first_name": user.first_name,
        "last_name": user.last_name,
        "display_name": user.display_name,
        "phone": user.mobile_number or "",
        "is_active": user.is_active,
        "is_instance_admin": bool(getattr(user, "is_instance_admin", False)),
        "workspace_count": getattr(user, "workspace_count", 0),
        "date_joined": user.date_joined,
        "last_login_time": user.last_login_time,
        "last_login_medium": user.last_login_medium,
        "has_password": not user.is_password_autoset,
    }


def get_user(pk):
    user = user_queryset().filter(pk=pk).first()
    if user is None:
        raise User.DoesNotExist
    return user


def user_detail(user):
    """The account plus every workspace it belongs (or used to belong) to, with each workspace's projects."""
    data = serialize_user(user)
    memberships = (
        WorkspaceMember.objects.filter(member=user, workspace__deleted_at__isnull=True)
        .select_related("workspace")
        .order_by("workspace__name")
    )
    project_memberships = {
        pm.project_id: pm for pm in ProjectMember.objects.filter(member=user, project__deleted_at__isnull=True)
    }
    workspaces = []
    for membership in memberships:
        workspace = membership.workspace
        projects = Project.objects.filter(workspace=workspace, archived_at__isnull=True).order_by("name")
        workspaces.append(
            {
                "id": str(workspace.id),
                "slug": workspace.slug,
                "name": workspace.name,
                "role": _role_name(membership.role),
                "is_active": membership.is_active,
                "is_owner": workspace.owner_id == user.id,
                "projects": [
                    {
                        "id": str(project.id),
                        "identifier": project.identifier,
                        "name": project.name,
                        "role": _role_name(project_memberships[project.id].role)
                        if project.id in project_memberships and project_memberships[project.id].is_active
                        else None,
                    }
                    for project in projects
                ],
            }
        )
    data["workspaces"] = workspaces
    return data


# ---------------------------------------------------------------------------
# Account changes


def update_user(user, data):
    """Edit the account's name, email and phone. Only the keys present in data change."""
    changed = []
    if "email" in data:
        email = str(data.get("email") or "").strip().lower()
        try:
            validate_email(email)
        except ValidationError:
            raise UserAdminError("Enter a valid email address.")
        if email != (user.email or "").lower():
            if User.objects.filter(email__iexact=email).exclude(pk=user.pk).exists():
                raise UserAdminError("Another account already uses this email.")
            user.email = email
            changed.append("email")
    for key in ("first_name", "last_name"):
        if key in data:
            value = str(data.get(key) or "").strip()
            if len(value) > 255:
                raise UserAdminError("Names can be at most 255 characters.")
            setattr(user, key, value)
            changed.append(key)
    if "display_name" in data:
        value = str(data.get("display_name") or "").strip()
        if not value:
            raise UserAdminError("The display name cannot be empty.")
        if len(value) > 255:
            raise UserAdminError("The display name can be at most 255 characters.")
        user.display_name = value
        changed.append("display_name")
    if "phone" in data:
        try:
            user.mobile_number = normalize_phone(str(data.get("phone") or "").strip()) or None
        except RowError as exc:
            raise UserAdminError(str(exc))
        changed.append("mobile_number")
    if changed:
        user.save(update_fields=[*changed, "updated_at"])
    return changed


def set_password(user, password="", sign_out=True):
    """Give the account a new password: the one supplied, or a generated one. Returns the password."""
    if not user.is_active:
        raise UserAdminError("Reactivate the account before setting a password.")
    password = str(password or "")
    if password and not is_strong_password(password):
        raise UserAdminError("This password is too weak. Use a longer mix of words, numbers and symbols.")
    password = password or generate_password()
    user.set_password(password)
    user.is_password_autoset = False
    user.save(update_fields=["password", "is_password_autoset", "updated_at"])
    if sign_out:
        end_sessions(user)
    return password


def _sole_admin_workspaces(user):
    """Workspaces where the user is the only active admin while other people are still members."""
    admin_counts = WorkspaceMember.objects.filter(
        member=user, is_active=True, role=ADMIN, workspace__deleted_at__isnull=True
    ).annotate(
        admins=Count(
            "workspace__workspace_member",
            filter=Q(
                workspace__workspace_member__role=ADMIN,
                workspace__workspace_member__is_active=True,
                workspace__workspace_member__deleted_at__isnull=True,
            ),
            distinct=True,
        ),
        members=Count(
            "workspace__workspace_member",
            filter=Q(
                workspace__workspace_member__is_active=True,
                workspace__workspace_member__deleted_at__isnull=True,
                workspace__workspace_member__member__is_bot=False,
            ),
            distinct=True,
        ),
    )
    return [m.workspace.name for m in admin_counts.select_related("workspace") if m.admins <= 1 and m.members > 1]


def _sole_admin_projects(user, workspace=None):
    """Projects where the user is the only active admin while other people are still members."""
    memberships = ProjectMember.objects.filter(
        member=user, is_active=True, role=ADMIN, project__deleted_at__isnull=True
    )
    if workspace is not None:
        memberships = memberships.filter(workspace=workspace)
    memberships = memberships.annotate(
        admins=Count(
            "project__project_projectmember",
            filter=Q(
                project__project_projectmember__role=ADMIN,
                project__project_projectmember__is_active=True,
                project__project_projectmember__deleted_at__isnull=True,
            ),
            distinct=True,
        ),
        members=Count(
            "project__project_projectmember",
            filter=Q(
                project__project_projectmember__is_active=True,
                project__project_projectmember__deleted_at__isnull=True,
            ),
            distinct=True,
        ),
    )
    return [m.project.name for m in memberships.select_related("project") if m.admins <= 1 and m.members > 1]


def _ensure_not_last_admin(user):
    workspaces = _sole_admin_workspaces(user)
    if workspaces:
        raise UserAdminError(
            f"This user is the only admin of {', '.join(workspaces)}. Make someone else an admin there first."
        )
    projects = _sole_admin_projects(user)
    if projects:
        raise UserAdminError(
            f"This user is the only admin of the project(s) {', '.join(projects)}. Make someone else an admin first."
        )


def _ensure_can_lose_access(user, acting_user, action):
    if user.pk == acting_user.pk:
        raise UserAdminError(f"You cannot {action} your own account.")
    if InstanceAdmin.objects.filter(user=user).exists():
        raise UserAdminError(f"Instance admins cannot be {action}d here. Remove their instance admin access first.")


@transaction.atomic
def deactivate_user(user, acting_user):
    """Block sign-in, end every session and suspend the account in all workspaces and projects."""
    if not user.is_active:
        raise UserAdminError("The account is already deactivated.")
    _ensure_can_lose_access(user, acting_user, "deactivate")
    _ensure_not_last_admin(user)

    slugs = list(WorkspaceMember.objects.filter(member=user, is_active=True).values_list("workspace__slug", flat=True))
    ProjectMember.objects.filter(member=user, is_active=True).update(is_active=False, updated_at=timezone.now())
    WorkspaceMember.objects.filter(member=user, is_active=True).update(is_active=False, updated_at=timezone.now())
    WorkspaceMemberInvite.objects.filter(email__iexact=user.email).delete()
    end_sessions(user)

    user.is_active = False
    # Sign-in rejects inactive accounts only once they have a logout time; without it the
    # next login would silently reactivate the account.
    user.last_logout_time = timezone.now()
    user.save(update_fields=["is_active", "last_logout_time", "updated_at"])
    transaction.on_commit(lambda: invalidate_member_caches(*slugs))


def reactivate_user(user):
    """Allow sign-in again. Workspace access is restored separately, per workspace."""
    if user.is_active:
        raise UserAdminError("The account is already active.")
    user.is_active = True
    user.save(update_fields=["is_active", "updated_at"])


@transaction.atomic
def delete_user(user, acting_user, confirm_email):
    """Remove the account and everything tied to it (its pages, comments, notifications and so on)."""
    if str(confirm_email or "").strip().lower() != (user.email or "").lower():
        raise UserAdminError("Type the user's email exactly to confirm the deletion.")
    _ensure_can_lose_access(user, acting_user, "delete")
    owned = list(Workspace.objects.filter(owner=user).values_list("name", flat=True))
    if owned:
        raise UserAdminError(
            f"This user owns the workspace(s) {', '.join(owned)}. Deleting the account would delete them too. "
            "Deactivate the account instead."
        )
    _ensure_not_last_admin(user)

    slugs = list(WorkspaceMember.objects.filter(member=user).values_list("workspace__slug", flat=True))
    email = user.email
    end_sessions(user)
    user.delete()
    logger.info("User %s permanently deleted by instance admin %s", email, acting_user.email)
    transaction.on_commit(lambda: invalidate_member_caches(*slugs))


# ---------------------------------------------------------------------------
# Memberships


def _get_workspace(slug):
    workspace = Workspace.objects.filter(slug=slug).first()
    if workspace is None:
        raise UserAdminError(f"Workspace '{slug}' does not exist.")
    return workspace


def _active_workspace_member(user, workspace):
    member = WorkspaceMember.objects.filter(member=user, workspace=workspace, is_active=True).first()
    if member is None:
        raise UserAdminError(f"The user is not an active member of {workspace.name}. Add them to it first.")
    return member


def _workspace_has_other_admin(user, workspace):
    return WorkspaceMember.objects.filter(workspace=workspace, role=ADMIN, is_active=True).exclude(member=user).exists()


@transaction.atomic
def add_to_workspace(user, slug, role):
    """Add the user to a workspace, or restore a removed membership, with the given role."""
    if not user.is_active:
        raise UserAdminError("Reactivate the account before adding it to a workspace.")
    workspace = _get_workspace(slug)
    member = WorkspaceMember.objects.filter(member=user, workspace=workspace).first()
    if member is None:
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=role)
    elif member.is_active:
        raise UserAdminError(f"The user is already a member of {workspace.name}.")
    else:
        member.is_active = True
        member.role = role
        member.save(update_fields=["is_active", "role", "updated_at"])
    WorkspaceMemberInvite.objects.filter(workspace=workspace, email__iexact=user.email).delete()
    profile, _ = Profile.objects.get_or_create(user=user)
    if profile.last_workspace_id is None:
        profile.last_workspace_id = workspace.id
        profile.save(update_fields=["last_workspace_id"])
    transaction.on_commit(lambda: invalidate_member_caches(workspace.slug))


@transaction.atomic
def change_workspace_role(user, slug, role):
    workspace = _get_workspace(slug)
    member = _active_workspace_member(user, workspace)
    if member.role == role:
        return
    if member.role == ADMIN and not _workspace_has_other_admin(user, workspace):
        raise UserAdminError(f"This user is the only admin of {workspace.name}. Make someone else an admin first.")
    if role == GUEST:
        # Same rule as the in-app member settings: a workspace guest is a guest in every project.
        if _sole_admin_projects(user, workspace):
            raise UserAdminError(
                "This user is the only admin of some projects in this workspace. Make someone else an admin first."
            )
        ProjectMember.objects.filter(workspace=workspace, member=user).update(role=GUEST, updated_at=timezone.now())
    member.role = role
    member.save(update_fields=["role", "updated_at"])
    transaction.on_commit(lambda: invalidate_member_caches(workspace.slug))


@transaction.atomic
def remove_from_workspace(user, slug):
    """Suspend the membership (it shows as Suspended in the workspace) and leave every project in it."""
    workspace = _get_workspace(slug)
    member = _active_workspace_member(user, workspace)
    if member.role == ADMIN and not _workspace_has_other_admin(user, workspace):
        raise UserAdminError(f"This user is the only admin of {workspace.name}. Make someone else an admin first.")
    projects = _sole_admin_projects(user, workspace)
    if projects:
        raise UserAdminError(
            f"This user is the only admin of the project(s) {', '.join(projects)}. Make someone else an admin first."
        )
    ProjectMember.objects.filter(workspace=workspace, member=user, is_active=True).update(
        is_active=False, updated_at=timezone.now()
    )
    member.is_active = False
    member.save(update_fields=["is_active", "updated_at"])
    profile = Profile.objects.filter(user=user, last_workspace_id=workspace.id).first()
    if profile is not None:
        other = (
            WorkspaceMember.objects.filter(member=user, is_active=True).values_list("workspace_id", flat=True).first()
        )
        profile.last_workspace_id = other
        profile.save(update_fields=["last_workspace_id"])
    transaction.on_commit(lambda: invalidate_member_caches(workspace.slug))


def _get_project(project_id):
    project = Project.objects.filter(pk=project_id, archived_at__isnull=True).select_related("workspace").first()
    if project is None:
        raise UserAdminError("The project does not exist or is archived.")
    return project


@transaction.atomic
def set_project_role(user, project_id, role):
    """Add the user to a project with the given role, or change their role in it."""
    project = _get_project(project_id)
    workspace_member = _active_workspace_member(user, project.workspace)
    if role > workspace_member.role:
        raise UserAdminError(
            f"A workspace {_role_name(workspace_member.role)} cannot be a project {_role_name(role)}. "
            "Raise their workspace role first."
        )
    member = ProjectMember.objects.filter(project=project, member=user).first()
    if member is None:
        ProjectMember.objects.create(project=project, workspace=project.workspace, member=user, role=role)
    else:
        if (
            member.is_active
            and member.role == ADMIN
            and role != ADMIN
            and project.name in _sole_admin_projects(user, project.workspace)
        ):
            raise UserAdminError(f"This user is the only admin of {project.name}. Make someone else an admin first.")
        member.is_active = True
        member.role = role
        member.save(update_fields=["is_active", "role", "updated_at"])
    ProjectUserProperty.objects.get_or_create(user=user, project=project, workspace=project.workspace)


@transaction.atomic
def remove_from_project(user, project_id):
    project = _get_project(project_id)
    member = ProjectMember.objects.filter(project=project, member=user, is_active=True).first()
    if member is None:
        raise UserAdminError(f"The user is not a member of {project.name}.")
    if member.role == ADMIN and project.name in _sole_admin_projects(user, project.workspace):
        raise UserAdminError(f"This user is the only admin of {project.name}. Make someone else an admin first.")
    member.is_active = False
    member.save(update_fields=["is_active", "updated_at"])
