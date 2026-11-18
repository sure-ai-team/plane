# Seed the isolated "surechat" smoke-test stack (run with: python manage.py shell < seed.py).
import os

from plane.db.models import Profile, User, Workspace, WorkspaceMember
from plane.license.models import Instance

PASSWORD = "ChatSmoke#2026-x"

instance = Instance.objects.first()
instance.is_setup_done = True
instance.save(update_fields=["is_setup_done"])

users = {}
for name in ("alice", "bob", "carol", "guest"):
    user, _ = User.objects.get_or_create(
        email=f"{name}@chat.test",
        defaults={"username": f"{name}_smoke", "first_name": name.title(), "display_name": name},
    )
    user.set_password(PASSWORD)
    user.is_active = True
    user.is_password_autoset = False
    user.save()
    users[name] = user

workspace, _ = Workspace.objects.get_or_create(
    slug=os.environ.get("SMOKE_SLUG", "chat-smoke"),
    defaults={"name": "Chat Smoke", "owner": users["alice"]},
)
for name, role in (("alice", 20), ("bob", 15), ("carol", 15), ("guest", 5)):
    WorkspaceMember.objects.update_or_create(
        workspace=workspace, member=users[name], defaults={"role": role, "is_active": True}
    )
# Sign-up normally creates the profile; without it the web app shows "Server Error" after sign-in.
for user in users.values():
    profile, _ = Profile.objects.get_or_create(user=user)
    profile.is_onboarded = True
    profile.is_tour_completed = True
    profile.is_navigation_tour_completed = True
    profile.last_workspace_id = workspace.id
    profile.onboarding_step = {"profile_complete": True, "workspace_create": True, "workspace_invite": True, "workspace_join": True}
    profile.save()
print("SEEDED", {name: str(user.id) for name, user in users.items()})
