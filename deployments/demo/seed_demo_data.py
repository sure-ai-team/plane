"""
Seed a SURE Project Management Platform instance with demo users, a workspace, projects and work items.

Run against the running stack (safe to re-run, it skips what already exists):

    docker compose exec -T api python manage.py shell < deployments/demo/seed_demo_data.py

All demo accounts share the password in DEMO_PASSWORD.
"""

import uuid
from datetime import timedelta

from django.contrib.auth.hashers import make_password
from django.db import transaction
from django.utils import timezone

from plane.db.models import (
    Cycle,
    CycleIssue,
    Issue,
    IssueAssignee,
    IssueLabel,
    Label,
    Module,
    ModuleIssue,
    Profile,
    Project,
    ProjectIdentifier,
    ProjectMember,
    State,
    User,
    Workspace,
    WorkspaceMember,
)
from plane.db.models.state import DEFAULT_STATES
from plane.license.models import Instance, InstanceAdmin

DEMO_PASSWORD = "Sgt@Demo2026!"
ADMIN, MEMBER, GUEST = 20, 15, 5

WORKSPACE = {"name": "Sure Global Tech", "slug": "sgt"}

# email, first, last, workspace role, job title, instance admin
USERS = [
    ("admin@demo.local", "Alice", "Admin", ADMIN, "IT Administrator", True),
    ("pm@demo.local", "Peter", "Manager", ADMIN, "Project Manager", False),
    ("lead@demo.local", "Lina", "Lead", MEMBER, "Tech Lead", False),
    ("dev1@demo.local", "Omar", "Developer", MEMBER, "Backend Developer", False),
    ("dev2@demo.local", "Sara", "Developer", MEMBER, "Frontend Developer", False),
    ("qa@demo.local", "Yousef", "Tester", MEMBER, "QA Engineer", False),
    ("guest@demo.local", "Gina", "Guest", GUEST, "Stakeholder", False),
]

LABELS = [("Bug", "#e5484d"), ("Feature", "#3e63dd"), ("Improvement", "#30a46c"), ("Tech Debt", "#f76b15")]

# project name, identifier, description, lead email, members (email -> project role)
PROJECTS = [
    (
        "Web Platform",
        "WEB",
        "Customer facing web portal",
        "lead@demo.local",
        {
            "pm@demo.local": ADMIN,
            "lead@demo.local": ADMIN,
            "dev1@demo.local": MEMBER,
            "dev2@demo.local": MEMBER,
            "qa@demo.local": MEMBER,
            "guest@demo.local": GUEST,
        },
    ),
    (
        "Mobile App",
        "MOB",
        "iOS and Android companion app",
        "pm@demo.local",
        {
            "pm@demo.local": ADMIN,
            "dev2@demo.local": MEMBER,
            "qa@demo.local": MEMBER,
            "guest@demo.local": GUEST,
        },
    ),
]

# title, state group, priority, assignee emails, labels, in cycle, in module
ISSUES = {
    "WEB": [
        ("Set up CI pipeline for the web app", "completed", "high", ["lead@demo.local"], ["Tech Debt"], True, False),
        ("Login page fails on Safari", "started", "urgent", ["dev2@demo.local"], ["Bug"], True, True),
        ("Implement SSO with company directory", "started", "high", ["dev1@demo.local"], ["Feature"], True, True),
        (
            "Password reset email has broken link",
            "unstarted",
            "high",
            ["dev1@demo.local", "qa@demo.local"],
            ["Bug"],
            True,
            True,
        ),
        ("Dashboard widgets load slowly", "unstarted", "medium", ["dev2@demo.local"], ["Improvement"], True, False),
        ("Add dark mode toggle", "backlog", "low", [], ["Feature"], False, False),
        ("Write regression test plan for release 1.0", "unstarted", "medium", ["qa@demo.local"], [], True, False),
        ("Upgrade frontend dependencies", "backlog", "none", ["lead@demo.local"], ["Tech Debt"], False, False),
        ("Export reports to PDF", "backlog", "medium", [], ["Feature"], False, False),
        ("Remove legacy session cookies", "cancelled", "low", ["dev1@demo.local"], ["Tech Debt"], False, True),
    ],
    "MOB": [
        ("Push notifications for task updates", "started", "high", ["dev2@demo.local"], ["Feature"], True, False),
        (
            "App crashes when offline",
            "unstarted",
            "urgent",
            ["dev2@demo.local", "qa@demo.local"],
            ["Bug"],
            True,
            False,
        ),
        ("Biometric login", "backlog", "medium", [], ["Feature"], False, False),
        ("Publish beta build to TestFlight", "completed", "high", ["pm@demo.local"], [], True, False),
        ("Improve list scrolling performance", "backlog", "low", ["dev2@demo.local"], ["Improvement"], False, False),
    ],
}


def log(msg):
    print(f"[seed] {msg}")


def upsert_user(email, first, last, title):
    user = User.objects.filter(email=email).first()
    if user:
        log(f"user exists: {email}")
        return user
    user = User.objects.create(
        email=email,
        username=uuid.uuid4().hex,
        first_name=first,
        last_name=last,
        display_name=email.split("@")[0],
        password=make_password(DEMO_PASSWORD),
        is_password_autoset=False,
        is_email_verified=True,
        is_active=True,
        last_active=timezone.now(),
        token_updated_at=timezone.now(),
    )
    Profile.objects.get_or_create(
        user=user,
        defaults={
            "role": title,
            "is_onboarded": True,
            "is_tour_completed": True,
            "onboarding_step": {
                "profile_complete": True,
                "workspace_create": True,
                "workspace_invite": True,
                "workspace_join": True,
            },
        },
    )
    log(f"user created: {email}")
    return user


@transaction.atomic
def run():
    instance = Instance.objects.first()
    if instance is None:
        raise SystemExit("No instance registered yet. Wait for the api container to finish starting.")

    users = {}
    for email, first, last, _, title, _ in USERS:
        users[email] = upsert_user(email, first, last, title)

    # Instance admin (superadmin) and finish instance setup
    for email, *_, is_instance_admin in USERS:
        if is_instance_admin:
            InstanceAdmin.objects.get_or_create(user=users[email], instance=instance, defaults={"role": 20})
    instance.is_setup_done = True
    instance.is_signup_screen_visited = True
    if not instance.instance_name:
        instance.instance_name = WORKSPACE["name"]
    instance.save()

    owner = users[USERS[0][0]]
    workspace, created = Workspace.objects.get_or_create(
        slug=WORKSPACE["slug"], defaults={"name": WORKSPACE["name"], "owner": owner}
    )
    log(f"workspace {'created' if created else 'exists'}: /{workspace.slug}")

    for email, _, _, role, title, _ in USERS:
        WorkspaceMember.objects.get_or_create(
            workspace=workspace, member=users[email], defaults={"role": role, "company_role": title}
        )
        Profile.objects.filter(user=users[email]).update(last_workspace_id=workspace.id)

    for name, ident, desc, lead_email, members in PROJECTS:
        project = Project.objects.filter(workspace=workspace, identifier=ident).first()
        if project:
            log(f"project exists: {ident}")
            continue

        project = Project.objects.create(
            workspace=workspace,
            name=name,
            identifier=ident,
            description=desc,
            network=2,
            project_lead=users[lead_email],
            created_by=owner,
            cycle_view=True,
            module_view=True,
            issue_views_view=True,
            page_view=True,
            intake_view=False,
        )
        ProjectIdentifier.objects.create(name=ident, project=project, workspace=workspace)

        ProjectMember.objects.create(project=project, member=owner, role=ADMIN)
        for email, role in members.items():
            ProjectMember.objects.get_or_create(project=project, member=users[email], defaults={"role": role})

        State.objects.bulk_create(
            [
                State(
                    name=s["name"],
                    color=s["color"],
                    project=project,
                    workspace=workspace,
                    sequence=s["sequence"],
                    group=s["group"],
                    default=s.get("default", False),
                    created_by=owner,
                )
                for s in DEFAULT_STATES
            ]
        )
        states = {}
        for s in State.objects.filter(project=project).order_by("sequence"):
            states.setdefault(s.group, s)

        labels = {}
        for lname, color in LABELS:
            labels[lname] = Label.objects.create(project=project, workspace=workspace, name=lname, color=color)

        today = timezone.now()
        cycle = Cycle.objects.create(
            project=project,
            workspace=workspace,
            name="Sprint 1",
            description="Current two-week sprint",
            start_date=today - timedelta(days=4),
            end_date=today + timedelta(days=10),
            owned_by=users[lead_email],
        )
        module = None
        if ident == "WEB":
            module = Module.objects.create(
                project=project,
                workspace=workspace,
                name="Authentication",
                description="Login, SSO and password flows",
                status="in-progress",
                lead=users["dev1@demo.local"],
                start_date=(today - timedelta(days=7)).date(),
                target_date=(today + timedelta(days=21)).date(),
            )

        for title, group, priority, assignees, lnames, in_cycle, in_module in ISSUES[ident]:
            reporter = users["pm@demo.local"]
            issue = Issue.objects.create(
                project=project,
                workspace=workspace,
                name=title,
                description_html=f"<p>{title}.</p>",
                state=states[group],
                priority=priority,
                created_by=reporter,
                start_date=today.date() if group == "started" else None,
                target_date=(today + timedelta(days=7)).date() if group in ("started", "unstarted") else None,
            )
            for email in assignees:
                IssueAssignee.objects.create(issue=issue, assignee=users[email], project=project, workspace=workspace)
            for lname in lnames:
                IssueLabel.objects.create(issue=issue, label=labels[lname], project=project, workspace=workspace)
            if in_cycle:
                CycleIssue.objects.create(issue=issue, cycle=cycle, project=project, workspace=workspace)
            if in_module and module:
                ModuleIssue.objects.create(issue=issue, module=module, project=project, workspace=workspace)

        log(f"project created: {ident} with {len(ISSUES[ident])} work items")

    log("done")
    print()
    print("Demo accounts (password for all: %s)" % DEMO_PASSWORD)
    role_names = {ADMIN: "Admin", MEMBER: "Member", GUEST: "Guest"}
    for email, first, last, role, title, is_ia in USERS:
        extra = " + instance admin" if is_ia else ""
        print(f"  {email:<20} {first} {last:<10} workspace {role_names[role]}{extra}  ({title})")


run()
