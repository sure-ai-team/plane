# Seed the isolated "surechat" smoke-test stack (run with: python manage.py shell < seed.py).
from plane.db.models import User, Workspace, WorkspaceMember
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
    slug="chat-smoke", defaults={"name": "Chat Smoke", "owner": users["alice"]}
)
for name, role in (("alice", 20), ("bob", 15), ("carol", 15), ("guest", 5)):
    WorkspaceMember.objects.update_or_create(
        workspace=workspace, member=users[name], defaults={"role": role, "is_active": True}
    )
print("SEEDED", {name: str(user.id) for name, user in users.items()})
