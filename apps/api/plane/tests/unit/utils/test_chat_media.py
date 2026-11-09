# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest

from plane.utils.chat_config import ChatConfig, _to_int
from plane.utils.chat_media import (
    clean_waveform,
    is_blocked,
    kind_for_type,
    normalize_type,
    sniffed_type_mismatch,
)

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
WEBM = (
    b"\x1a\x45\xdf\xa3\x9f\x42\x86\x81\x01\x42\xf7\x81\x01\x42\xf2\x81\x04\x42\xf3\x81\x08"
    b"\x42\x82\x84webm\x42\x87\x81\x04\x42\x85\x81\x02" + b"\x00" * 32
)
EXE = b"MZ" + b"\x00" * 64


@pytest.mark.unit
class TestChatMedia:
    def test_normalize_type(self):
        assert normalize_type("Audio/WebM; codecs=opus") == "audio/webm"

    @pytest.mark.parametrize(
        "content_type, kind",
        [
            ("image/png", "image"),
            ("image/jpeg", "image"),
            ("video/quicktime", "video"),
            ("audio/mp4", "audio"),
            ("audio/webm;codecs=opus", "audio"),
            ("application/pdf", "file"),
            ("text/plain", "file"),
        ],
    )
    def test_kind_for_type(self, content_type, kind):
        assert kind_for_type(content_type) == kind

    @pytest.mark.parametrize(
        "name, content_type",
        [
            ("setup.exe", "application/octet-stream"),
            ("logo.SVG", "image/png"),
            ("x.png", "image/svg+xml"),
            ("index.html", "text/plain"),
            ("a.txt", "text/html"),
            ("app.apk", "application/zip"),
        ],
    )
    def test_blocked(self, name, content_type):
        assert is_blocked(name, content_type)

    def test_not_blocked(self):
        assert not is_blocked("report.pdf", "application/pdf")
        assert not is_blocked("voice.webm", "audio/webm")

    def test_waveform(self):
        assert clean_waveform([0.5] * 64) == [0.5] * 64
        assert clean_waveform([2, -1] + [0.1] * 62)[:2] == [1.0, 0.0]
        assert clean_waveform([0.1] * 10) is None
        assert clean_waveform(["x"] * 64) is None
        assert clean_waveform(None) is None

    def test_sniffing(self):
        assert sniffed_type_mismatch(PNG, "image", "a.png") is None
        assert sniffed_type_mismatch(WEBM, "audio", "v.webm") is None
        assert sniffed_type_mismatch(PNG, "video", "a.mp4") == "TYPE_MISMATCH"
        assert sniffed_type_mismatch(b"plain text", "file", "notes.txt") is None
        assert sniffed_type_mismatch(b"plain text", "image", "a.png") == "TYPE_MISMATCH"
        # Unrecognised containers are accepted for audio/video (served with their declared type).
        assert sniffed_type_mismatch(b"\x00" * 64, "audio", "v.m4a") is None
        assert sniffed_type_mismatch(PNG, "audio", "v.m4a") == "TYPE_MISMATCH"
        assert sniffed_type_mismatch(EXE, "file", "notes.pdf") == "TYPE_NOT_ALLOWED"
        assert sniffed_type_mismatch(b"", "file", "a") == "TYPE_MISMATCH"


@pytest.mark.unit
class TestChatConfig:
    def test_limits(self):
        config = ChatConfig(True, 10, 200, 25, 50, 10, 300)
        assert config.limit_bytes("image") == 10 * 1024 * 1024
        assert config.limit_bytes("video") == 200 * 1024 * 1024
        assert config.limit_bytes("audio") == 25 * 1024 * 1024
        assert config.limit_bytes("file") == 50 * 1024 * 1024
        assert config.limit_bytes("unknown") == 50 * 1024 * 1024

    def test_to_int_clamps_and_falls_back(self):
        assert _to_int("5000", "10", 1, 2048) == 2048
        assert _to_int("0", "10", 1, 2048) == 1
        assert _to_int("abc", "10", 1, 2048) == 10
