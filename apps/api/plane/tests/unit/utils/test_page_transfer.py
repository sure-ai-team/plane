# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest

from plane.utils.page_transfer import (
    CONFLICT_SKIP,
    CONFLICT_UPDATE,
    EMPTY_CONTENT_HTML,
    MAX_LABELS_PER_PAGE,
    MAX_NAME_LENGTH,
    MAX_PAGES,
    parse_conflict_mode,
    parse_import_payload,
)


def _payload(*pages, **extra):
    return {"version": 1, "pages": list(pages), **extra}


def _fields(errors):
    return [(error["index"], error["field"]) for error in errors]


@pytest.mark.unit
class TestParseImportPayload:
    def test_minimal_page_gets_defaults(self):
        pages, errors = parse_import_payload(_payload({"name": "  Onboarding  "}))

        assert errors == []
        assert len(pages) == 1
        page = pages[0]
        assert page.name == "Onboarding"
        assert page.access == 0
        assert page.labels == []
        assert page.content_html == EMPTY_CONTENT_HTML
        assert page.external_id is None
        assert page.logo_props is None

    def test_full_page(self):
        pages, errors = parse_import_payload(
            _payload(
                {
                    "external_id": 42,
                    "name": "Runbook",
                    "access": "Private",
                    "labels": ["Ops", "ops", " Infra ", ""],
                    "content_html": "<h1>Title</h1><p>Body</p>",
                    "logo_props": {"in_use": "emoji", "emoji": {"value": "128512"}},
                }
            )
        )

        assert errors == []
        page = pages[0]
        assert page.external_id == "42"
        assert page.access == 1
        # de-duplicated case-insensitively, blanks dropped, first spelling kept
        assert page.labels == ["Ops", "Infra"]
        assert "<h1>Title</h1>" in page.content_html
        assert page.logo_props["in_use"] == "emoji"

    def test_labels_accept_comma_separated_text(self):
        pages, errors = parse_import_payload(_payload({"name": "A", "labels": "one, two ,three"}))

        assert errors == []
        assert pages[0].labels == ["one", "two", "three"]

    def test_access_accepts_numeric_values(self):
        pages, errors = parse_import_payload(_payload({"name": "A", "access": 1}, {"name": "B", "access": 0}))

        assert errors == []
        assert [page.access for page in pages] == [1, 0]

    def test_html_is_sanitized(self):
        pages, errors = parse_import_payload(
            _payload({"name": "A", "content_html": '<p onclick="steal()">hi</p><script>alert(1)</script>'})
        )

        assert errors == []
        html = pages[0].content_html
        assert "<script" not in html
        assert "onclick" not in html
        assert "hi" in html

    def test_html_that_sanitizes_to_nothing_becomes_empty_paragraph(self):
        pages, errors = parse_import_payload(_payload({"name": "A", "content_html": "<script>x</script>"}))

        assert errors == []
        assert pages[0].content_html == EMPTY_CONTENT_HTML

    @pytest.mark.parametrize(
        "page, field",
        [
            ({}, "name"),
            ({"name": "   "}, "name"),
            ({"name": "x" * (MAX_NAME_LENGTH + 1)}, "name"),
            ({"name": "A", "access": "team"}, "access"),
            ({"name": "A", "access": True}, "access"),
            ({"name": "A", "labels": {"a": 1}}, "labels"),
            ({"name": "A", "labels": [1]}, "labels"),
            ({"name": "A", "labels": [f"l{i}" for i in range(MAX_LABELS_PER_PAGE + 1)]}, "labels"),
            ({"name": "A", "external_id": {"x": 1}}, "external_id"),
            ({"name": "A", "logo_props": "emoji"}, "logo_props"),
            ({"name": "A", "content_html": 5}, "content_html"),
        ],
    )
    def test_invalid_fields_are_reported_with_index(self, page, field):
        pages, errors = parse_import_payload(_payload({"name": "ok"}, page))

        assert pages == []
        assert (1, field) in _fields(errors)

    def test_all_errors_are_collected(self):
        _, errors = parse_import_payload(_payload({"access": "x"}, {"name": "ok"}, {"name": ""}))

        assert _fields(errors) == [(0, "name"), (0, "access"), (2, "name")]

    def test_errors_carry_codes_and_params_for_translation(self):
        _, errors = parse_import_payload(
            _payload(
                {"name": "x" * (MAX_NAME_LENGTH + 1), "access": "team"},
                {"name": "A", "external_id": "dup"},
                {"name": "B", "external_id": "dup"},
            )
        )

        by_field = {(error["index"], error["field"]): error for error in errors}
        assert by_field[(0, "name")]["code"] == "name_too_long"
        assert by_field[(0, "name")]["params"] == {"max": MAX_NAME_LENGTH}
        assert by_field[(0, "access")]["code"] == "access_invalid"
        assert by_field[(2, "external_id")]["code"] == "duplicate_external_id"
        assert by_field[(2, "external_id")]["params"] == {"external_id": "dup", "other": 2}
        assert all(error["message"] for error in errors)

    def test_payload_errors_have_codes(self):
        _, errors = parse_import_payload({"version": 1, "pages": []})

        assert errors[0]["code"] == "no_pages"

    def test_duplicate_external_ids_are_rejected(self):
        _, errors = parse_import_payload(
            _payload({"name": "A", "external_id": "x"}, {"name": "B", "external_id": "x"})
        )

        assert _fields(errors) == [(1, "external_id")]
        assert "page 1" in errors[0]["message"]

    @pytest.mark.parametrize(
        "data",
        [
            None,
            [],
            {"version": 2, "pages": [{"name": "A"}]},
            {"version": 1},
            {"version": 1, "pages": "nope"},
            {"version": 1, "pages": []},
            {"version": 1, "pages": [{"name": "A"}] * (MAX_PAGES + 1)},
        ],
    )
    def test_invalid_payloads(self, data):
        pages, errors = parse_import_payload(data)

        assert pages == []
        assert len(errors) == 1
        assert errors[0]["index"] is None

    def test_page_must_be_an_object(self):
        _, errors = parse_import_payload(_payload("just a string"))

        assert _fields(errors) == [(0, None)]


@pytest.mark.unit
class TestParseConflictMode:
    def test_defaults_to_skip(self):
        assert parse_conflict_mode(None) == CONFLICT_SKIP
        assert parse_conflict_mode("") == CONFLICT_SKIP

    def test_known_mode(self):
        assert parse_conflict_mode("update") == CONFLICT_UPDATE

    def test_unknown_mode(self):
        assert parse_conflict_mode("merge") is None
