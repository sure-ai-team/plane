# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Chat instance configuration (docs/chat/06-superadmin-config.md).

Values come from ``InstanceConfiguration`` (edited in Superadmin) or, when the
instance runs on environment variables, from the environment. Results are
cached for a minute; ``invalidate_chat_config()`` clears the cache after an
admin save.
"""

# Python imports
import os
from dataclasses import asdict, dataclass

# Django imports
from django.core.cache import cache

CHAT_CONFIG_CACHE_KEY = "chat:config:v1"
CHAT_CONFIG_CACHE_SECONDS = 60

MB = 1024 * 1024

# Hard caps applied regardless of configuration, so a typo in Superadmin can
# never effectively disable a limit.
HARD_MAX_FILE_MB = 2048
HARD_MAX_FILES_PER_MESSAGE = 50
HARD_MAX_VOICE_SECONDS = 3600

# key -> (default, minimum, maximum)
CHAT_CONFIG_KEYS = {
    "CHAT_ENABLED": ("1", None, None),
    "CHAT_MAX_IMAGE_MB": ("10", 1, HARD_MAX_FILE_MB),
    "CHAT_MAX_VIDEO_MB": ("200", 1, HARD_MAX_FILE_MB),
    "CHAT_MAX_AUDIO_MB": ("25", 1, HARD_MAX_FILE_MB),
    "CHAT_MAX_FILE_MB": ("50", 1, HARD_MAX_FILE_MB),
    "CHAT_MAX_FILES_PER_MESSAGE": ("10", 1, HARD_MAX_FILES_PER_MESSAGE),
    "CHAT_MAX_VOICE_SECONDS": ("300", 1, HARD_MAX_VOICE_SECONDS),
}


@dataclass(frozen=True)
class ChatConfig:
    enabled: bool
    max_image_mb: int
    max_video_mb: int
    max_audio_mb: int
    max_file_mb: int
    max_files_per_message: int
    max_voice_seconds: int

    def limit_bytes(self, kind: str) -> int:
        """Size limit in bytes for an attachment kind (image, video, audio, file)."""
        mb = {
            "image": self.max_image_mb,
            "video": self.max_video_mb,
            "audio": self.max_audio_mb,
        }.get(kind, self.max_file_mb)
        return mb * MB

    def as_public_dict(self) -> dict:
        """Non-secret values exposed to the web client for pre-upload checks."""
        return asdict(self)


def _to_bool(value) -> bool:
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def _to_int(value, default: str, minimum, maximum) -> int:
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError):
        number = int(default)
    if minimum is not None:
        number = max(minimum, number)
    if maximum is not None:
        number = min(maximum, number)
    return number


def _load_chat_config() -> ChatConfig:
    # Imported lazily: this module is also imported by the instance config seed list.
    from plane.license.utils.instance_value import get_configuration_value

    keys =[{"key": key, "default": os.environ.get(key, default)} for key, (default, _, _) in CHAT_CONFIG_KEYS.items()]
    values = dict(zip(CHAT_CONFIG_KEYS.keys(), get_configuration_value(keys)))

    def number(key):
        default, minimum, maximum = CHAT_CONFIG_KEYS[key]
        return _to_int(values.get(key), default, minimum, maximum)

    return ChatConfig(
        enabled=_to_bool(values.get("CHAT_ENABLED", "1")),
        max_image_mb=number("CHAT_MAX_IMAGE_MB"),
        max_video_mb=number("CHAT_MAX_VIDEO_MB"),
        max_audio_mb=number("CHAT_MAX_AUDIO_MB"),
        max_file_mb=number("CHAT_MAX_FILE_MB"),
        max_files_per_message=number("CHAT_MAX_FILES_PER_MESSAGE"),
        max_voice_seconds=number("CHAT_MAX_VOICE_SECONDS"),
    )


def get_chat_config() -> ChatConfig:
    try:
        cached = cache.get(CHAT_CONFIG_CACHE_KEY)
    except Exception:
        cached = None
    if isinstance(cached, dict):
        return ChatConfig(**cached)

    config = _load_chat_config()
    try:
        cache.set(CHAT_CONFIG_CACHE_KEY, asdict(config), CHAT_CONFIG_CACHE_SECONDS)
    except Exception:
        pass
    return config


def validate_chat_config_updates(data: dict) -> dict:
    """Validate ``CHAT_*`` values from a Superadmin save.

    Returns ``{key: error}`` for invalid entries; an empty dict means all good.
    Non-chat keys are ignored.
    """
    errors = {}
    for key, raw in data.items():
        if key not in CHAT_CONFIG_KEYS:
            continue
        default, minimum, maximum = CHAT_CONFIG_KEYS[key]
        value = "" if raw is None else str(raw).strip()
        if key == "CHAT_ENABLED":
            if value not in ("0", "1"):
                errors[key] = "Must be 0 or 1."
            continue
        try:
            number = int(value)
        except ValueError:
            errors[key] = "Must be a whole number."
            continue
        if number < minimum or number > maximum:
            errors[key] = f"Must be between {minimum} and {maximum}."
    return errors


def invalidate_chat_config() -> None:
    try:
        cache.delete(CHAT_CONFIG_CACHE_KEY)
    except Exception:
        pass
