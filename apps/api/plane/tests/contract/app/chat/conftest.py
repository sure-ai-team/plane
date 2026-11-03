# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Shared fixtures for the chat contract tests."""

# Python imports
from unittest.mock import MagicMock
from uuid import uuid4

# Third party imports
import pytest
from rest_framework.test import APIClient

# Module imports
from plane.db.models import User, WorkspaceMember

PNG_HEADER = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
MP4_HEADER = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64
WEBM_HEADER = (
    b"\x1a\x45\xdf\xa3\x9f\x42\x86\x81\x01\x42\xf7\x81\x01\x42\xf2\x81\x04\x42\xf3\x81\x08"
    b"\x42\x82\x84webm\x42\x87\x81\x04\x42\x85\x81\x02" + b"\x00" * 32
)
EXE_HEADER = b"MZ" + b"\x00" * 64


def make_user(prefix="user"):
    unique = uuid4().hex[:8]
    user = User.objects.create(
        email=f"{prefix}-{unique}@sure.com.sa",
        username=f"{prefix}_{unique}",
        first_name=prefix.title(),
        last_name="Tester",
        display_name=f"{prefix}_{unique}",
    )
    user.set_password("test-password")
    user.save()
    return user


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def make_member(db, workspace):
    """Create a workspace user with a role (20 admin, 15 member, 5 guest)."""

    def _make(prefix="member", role=15):
        user = make_user(prefix)
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=role)
        return user

    return _make


@pytest.fixture
def owner(workspace, create_user):
    """The workspace owner from the shared ``workspace`` fixture (admin)."""
    return create_user


@pytest.fixture
def alice(make_member):
    return make_member("alice", 15)


@pytest.fixture
def bob(make_member):
    return make_member("bob", 15)


@pytest.fixture
def guest(make_member):
    return make_member("guest", 5)


@pytest.fixture
def owner_client(session_client):
    return session_client


@pytest.fixture
def alice_client(alice):
    return client_for(alice)


@pytest.fixture
def bob_client(bob):
    return client_for(bob)


@pytest.fixture
def guest_client(guest):
    return client_for(guest)


@pytest.fixture(autouse=True)
def published(mocker):
    """Capture every chat event instead of talking to Redis.

    Each entry is ``(event_type, data, recipients, slug)``. Events are published
    on commit, so tests that assert on them run the request inside
    ``django_capture_on_commit_callbacks(execute=True)``.
    """
    events = []

    def _capture(event_type, data, recipient_ids, workspace_slug):
        events.append((event_type, data, sorted({str(user_id) for user_id in recipient_ids}), workspace_slug))

    mocker.patch("plane.utils.chat_events.publish_chat_event", side_effect=_capture)
    return events


@pytest.fixture(autouse=True)
def chat_enabled(mocker):
    """Chat on with default limits, independent of cache state."""
    from plane.utils.chat_config import ChatConfig

    config = ChatConfig(
        enabled=True,
        max_image_mb=10,
        max_video_mb=200,
        max_audio_mb=25,
        max_file_mb=50,
        max_files_per_message=10,
        max_voice_seconds=300,
    )
    for target in (
        "plane.app.views.chat.base.get_chat_config",
        "plane.app.views.chat.message.get_chat_config",
        "plane.app.views.chat.attachment.get_chat_config",
        "plane.app.views.chat.misc.get_chat_config",
    ):
        mocker.patch(target, return_value=config)
    return config


@pytest.fixture(autouse=True)
def storage(mocker):
    """A fake S3 storage for the chat attachment endpoints."""
    fake = MagicMock()
    fake.generate_presigned_post.side_effect = lambda object_name, file_type, file_size, expiration=None: {
        "url": "https://storage.test/uploads",
        "fields": {"key": object_name, "Content-Type": file_type},
    }
    fake.generate_presigned_url.side_effect = lambda object_name, **kwargs: f"https://storage.test/{object_name}"
    fake.objects = {}

    def _head(key):
        size = fake.objects.get(key)
        return None if size is None else {"ContentLength": size, "ContentType": "application/octet-stream"}

    fake.get_object_metadata.side_effect = _head
    fake.samples = {}
    fake.get_object_range.side_effect = lambda key, start=0, end=8191: fake.samples.get(key, PNG_HEADER)
    mocker.patch("plane.app.views.chat.attachment.S3Storage", return_value=fake)
    return fake


@pytest.fixture(autouse=True)
def deletion_task(mocker):
    return mocker.patch("plane.bgtasks.chat_cleanup_task.delete_chat_objects.delay")


# --------------------------------------------------------------------------- #
# URL helpers
# --------------------------------------------------------------------------- #


def base(slug):
    return f"/api/workspaces/{slug}/chat"


def conversations_url(slug):
    return f"{base(slug)}/conversations/"


def conversation_url(slug, conversation_id):
    return f"{base(slug)}/conversations/{conversation_id}/"


def members_url(slug, conversation_id):
    return f"{base(slug)}/conversations/{conversation_id}/members/"


def member_url(slug, conversation_id, user_id):
    return f"{base(slug)}/conversations/{conversation_id}/members/{user_id}/"


def messages_url(slug, conversation_id):
    return f"{base(slug)}/conversations/{conversation_id}/messages/"


def message_url(slug, message_id):
    return f"{base(slug)}/messages/{message_id}/"


def read_url(slug, conversation_id):
    return f"{base(slug)}/conversations/{conversation_id}/read/"


def attachments_url(slug, conversation_id):
    return f"{base(slug)}/conversations/{conversation_id}/attachments/"


def thumbnail_url(slug, conversation_id, asset_id):
    return f"{base(slug)}/conversations/{conversation_id}/attachments/{asset_id}/thumbnail/"


def attachment_url(slug, asset_id):
    return f"{base(slug)}/attachments/{asset_id}/"


# --------------------------------------------------------------------------- #
# Builders
# --------------------------------------------------------------------------- #


@pytest.fixture
def group(owner_client, workspace, alice, bob):
    """A group created by the owner with alice and bob as members."""
    response = owner_client.post(
        conversations_url(workspace.slug),
        {"type": "group", "name": "Release", "member_ids": [str(alice.id), str(bob.id)]},
        format="json",
    )
    assert response.status_code == 201, response.data
    return response.data


@pytest.fixture
def direct(owner_client, workspace, alice):
    response = owner_client.post(
        conversations_url(workspace.slug), {"type": "direct", "user_id": str(alice.id)}, format="json"
    )
    assert response.status_code == 201, response.data
    return response.data


def send(client, slug, conversation_id, text="hello", **extra):
    payload = {"body_html": f"<p>{text}</p>", "client_id": str(uuid4()), **extra}
    return client.post(messages_url(slug, conversation_id), payload, format="json")


def upload(
    client, storage, slug, conversation_id, *, name="shot.png", type="image/png", size=1000, sample=PNG_HEADER, **extra
):
    """Request an upload, simulate the storage PUT, and confirm it."""
    response = client.post(
        attachments_url(slug, conversation_id), {"name": name, "type": type, "size": size, **extra}, format="json"
    )
    assert response.status_code == 200, response.data
    asset_id = response.data["asset_id"]
    key = response.data["upload_data"]["fields"]["key"]
    storage.objects[key] = size
    storage.samples[key] = sample
    confirm = client.patch(attachment_url(slug, asset_id), {}, format="json")
    return asset_id, key, confirm
