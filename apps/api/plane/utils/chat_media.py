# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Rules for chat attachments (docs/chat/04-attachments-and-media.md)."""

# Python imports
import os
import re

KIND_IMAGE = "image"
KIND_VIDEO = "video"
KIND_AUDIO = "audio"
KIND_FILE = "file"
KINDS = (KIND_IMAGE, KIND_VIDEO, KIND_AUDIO, KIND_FILE)

ALLOWED_MEDIA_TYPES = {
    KIND_IMAGE: {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"},
    KIND_VIDEO: {"video/mp4", "video/webm", "video/quicktime"},
    KIND_AUDIO: {"audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/aac"},
}

THUMBNAIL_TYPES = {"image/webp", "image/jpeg", "image/png"}
MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024

BLOCKED_EXTENSIONS = frozenset(
    {
        "exe", "msi", "bat", "cmd", "com", "scr", "ps1", "psm1", "sh", "bash", "js", "mjs", "cjs",
        "jar", "vbs", "vbe", "wsf", "dll", "apk", "app", "svg", "svgz", "html", "htm", "xhtml",
        "shtml", "hta", "lnk", "reg", "cpl", "msc", "pif", "gadget",
    }
)  # fmt: skip

BLOCKED_TYPE_PREFIXES = (
    "application/x-msdownload",
    "application/x-msdos-program",
    "application/x-sh",
    "application/x-executable",
    "application/javascript",
    "application/x-javascript",
    "application/xhtml",
    "application/java-archive",
    "application/vnd.android.package-archive",
    "text/html",
    "text/javascript",
    "image/svg",
)

WAVEFORM_POINTS = 64
_TYPE_RE = re.compile(r"^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$")


def normalize_type(content_type) -> str:
    """Lower-case MIME type without parameters (``audio/webm;codecs=opus`` -> ``audio/webm``)."""
    return str(content_type or "").split(";")[0].strip().lower()


def file_extension(name) -> str:
    return os.path.splitext(str(name or ""))[1].lstrip(".").lower()


def is_blocked(name, content_type) -> bool:
    content_type = normalize_type(content_type)
    if file_extension(name) in BLOCKED_EXTENSIONS:
        return True
    return any(content_type.startswith(prefix) for prefix in BLOCKED_TYPE_PREFIXES)


def kind_for_type(content_type) -> str:
    """Server-derived kind for a declared MIME type. Unknown types are plain files."""
    content_type = normalize_type(content_type)
    for kind, types in ALLOWED_MEDIA_TYPES.items():
        if content_type in types:
            return kind
    return KIND_FILE


def is_valid_type(content_type) -> bool:
    return bool(_TYPE_RE.match(normalize_type(content_type)))


def clean_waveform(value):
    """Return a list of exactly ``WAVEFORM_POINTS`` floats in [0, 1], or None."""
    if not isinstance(value, (list, tuple)) or len(value) != WAVEFORM_POINTS:
        return None
    cleaned = []
    for point in value:
        try:
            number = float(point)
        except (TypeError, ValueError):
            return None
        if number != number:  # NaN
            return None
        cleaned.append(round(min(1.0, max(0.0, number)), 3))
    return cleaned


def clean_positive_number(value, maximum=None):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number <= 0:
        return None
    if maximum is not None and number > maximum:
        return None
    return number


def sniffed_type_mismatch(sample: bytes, declared_kind: str, name: str) -> str | None:
    """Compare the first bytes of an uploaded object with its declared kind.

    Returns an error code (``TYPE_MISMATCH`` / ``TYPE_NOT_ALLOWED``) or None.
    ``filetype`` recognises binary signatures only; text formats and some
    containers return no match, which is accepted for plain files.
    """
    import filetype

    if not sample:
        return "TYPE_MISMATCH"
    guess = filetype.guess(sample)
    if guess is None:
        # No recognised signature. Every image format we allow has one, so an
        # unrecognised "image" is rejected. Audio/video containers from some
        # recorders are not always recognised; they are accepted because the
        # object is served with its declared media type and cannot execute.
        return "TYPE_MISMATCH" if declared_kind == KIND_IMAGE else None
    if guess.extension in BLOCKED_EXTENSIONS or is_blocked(name, guess.mime):
        return "TYPE_NOT_ALLOWED"
    family = guess.mime.split("/")[0]
    if declared_kind in (KIND_IMAGE, KIND_VIDEO, KIND_AUDIO):
        # webm/mp4/ogg containers are reported as video even when audio-only.
        if declared_kind == KIND_AUDIO and family in ("audio", "video"):
            return None
        if declared_kind == KIND_VIDEO and family == "video":
            return None
        if declared_kind == KIND_IMAGE and family == "image":
            return None
        return "TYPE_MISMATCH"
    # A "file" must not be an executable disguised under another name.
    if guess.mime in ("application/x-msdownload", "application/x-executable", "application/x-elf"):
        return "TYPE_NOT_ALLOWED"
    return None
