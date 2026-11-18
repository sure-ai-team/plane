# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Superadmin chat settings (docs/chat/06-superadmin-config.md)."""

import pytest
from django.utils import timezone

from plane.license.models import Instance, InstanceAdmin, InstanceConfiguration
from plane.utils.chat_config import (
    CHAT_CONFIG_KEYS,
    get_chat_config,
    invalidate_chat_config,
    validate_chat_config_updates,
)
from plane.utils.instance_config_variables import instance_config_variables

CONFIG_URL = "/api/instances/configurations/"
INSTANCE_URL = "/api/instances/"


@pytest.fixture
def instance(db):
    return Instance.objects.create(
        instance_name="Test", instance_id="test-instance", current_version="1.0", last_checked_at=timezone.now()
    )


@pytest.fixture
def instance_admin(instance, create_user):
    InstanceAdmin.objects.create(user=create_user, instance=instance, role=20)
    return create_user


@pytest.fixture
def seeded(db):
    for item in instance_config_variables:
        if item["category"] == "CHAT":
            InstanceConfiguration.objects.update_or_create(
                key=item["key"], defaults={"value": item["value"], "category": "CHAT", "is_encrypted": False}
            )
    invalidate_chat_config()
    yield
    invalidate_chat_config()


@pytest.mark.unit
class TestChatConfigSeed:
    def test_every_chat_key_is_seeded_unencrypted(self):
        seeded = {item["key"]: item for item in instance_config_variables if item["category"] == "CHAT"}
        assert set(seeded) == set(CHAT_CONFIG_KEYS)
        assert all(item["is_encrypted"] is False for item in seeded.values())

    def test_validation(self):
        assert validate_chat_config_updates({"CHAT_ENABLED": "1", "CHAT_MAX_IMAGE_MB": "20"}) == {}
        errors = validate_chat_config_updates(
            {"CHAT_ENABLED": "yes", "CHAT_MAX_IMAGE_MB": "0", "CHAT_MAX_FILES_PER_MESSAGE": "x", "OTHER": "?"}
        )
        assert set(errors) == {"CHAT_ENABLED", "CHAT_MAX_IMAGE_MB", "CHAT_MAX_FILES_PER_MESSAGE"}
        assert "between" in validate_chat_config_updates({"CHAT_MAX_VIDEO_MB": "999999"})["CHAT_MAX_VIDEO_MB"]


@pytest.mark.contract
@pytest.mark.django_db
class TestChatConfigAdmin:
    def test_non_admin_cannot_change(self, session_client, seeded, instance):
        response = session_client.patch(CONFIG_URL, {"CHAT_ENABLED": "0"}, format="json")
        assert response.status_code == 403

    def test_invalid_values_rejected_and_nothing_saved(self, session_client, instance_admin, seeded):
        response = session_client.patch(CONFIG_URL, {"CHAT_MAX_IMAGE_MB": "0", "CHAT_ENABLED": "0"}, format="json")
        assert response.status_code == 400
        assert "CHAT_MAX_IMAGE_MB" in response.data["fields"]
        assert InstanceConfiguration.objects.get(key="CHAT_ENABLED").value == "1"

    def test_save_applies_immediately(self, session_client, instance_admin, seeded, settings):
        settings.SKIP_ENV_VAR = True
        assert get_chat_config().max_image_mb == 10  # warms the cache
        response = session_client.patch(CONFIG_URL, {"CHAT_MAX_IMAGE_MB": "25", "CHAT_ENABLED": "0"}, format="json")
        assert response.status_code == 200
        config = get_chat_config()
        assert config.max_image_mb == 25
        assert config.enabled is False

    def test_instance_payload_exposes_limits(self, api_client, instance, seeded):
        from django.core.cache import cache

        cache.clear()  # the instance payload is response-cached for hours
        response = api_client.get(INSTANCE_URL)
        assert response.status_code == 200
        chat = response.data["config"]["chat"]
        assert set(chat) == {
            "enabled",
            "max_image_mb",
            "max_video_mb",
            "max_audio_mb",
            "max_file_mb",
            "max_files_per_message",
            "max_voice_seconds",
        }
