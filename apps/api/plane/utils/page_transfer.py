# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Validation for the project pages import/export format.

The web app converts every supported file type (JSON, Markdown, HTML,
Excel/CSV) into this one canonical shape before sending it to the API, so
the server only ever has to understand this:

    {
      "version": 1,
      "pages": [
        {
          "external_id": "onboarding",      # optional, used to match pages on re-import
          "name": "Onboarding",             # required
          "access": "public",               # "public" | "private" (default "public")
          "labels": ["HR"],                 # optional, project label names
          "content_html": "<p>...</p>",     # optional, sanitized server side
          "logo_props": {...}               # optional
        }
      ]
    }

Every validation error carries a stable ``code`` and ``params`` so the web
app can show it in the user's language; ``message`` is an English fallback.

Everything here is pure (no database access) so it can be unit tested.
"""

import json
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from plane.utils.content_validator import validate_html_content

FORMAT_VERSION = 1
EXTERNAL_SOURCE = "page_import"

MAX_PAGES = 500
MAX_NAME_LENGTH = 255
MAX_EXTERNAL_ID_LENGTH = 255
MAX_LABELS_PER_PAGE = 50
MAX_LABEL_NAME_LENGTH = 255
MAX_LOGO_PROPS_BYTES = 10 * 1024
EMPTY_CONTENT_HTML = "<p></p>"

ACCESS_PUBLIC = "public"
ACCESS_PRIVATE = "private"
# Page.PUBLIC_ACCESS / Page.PRIVATE_ACCESS
ACCESS_TO_INT = {ACCESS_PUBLIC: 0, ACCESS_PRIVATE: 1}
INT_TO_ACCESS = {value: key for key, value in ACCESS_TO_INT.items()}

CONFLICT_SKIP = "skip"
CONFLICT_UPDATE = "update"
CONFLICT_DUPLICATE = "duplicate"
CONFLICT_MODES = (CONFLICT_SKIP, CONFLICT_UPDATE, CONFLICT_DUPLICATE)


@dataclass
class ImportedPage:
    index: int
    name: str
    access: int
    labels: List[str] = field(default_factory=list)
    content_html: str = EMPTY_CONTENT_HTML
    external_id: Optional[str] = None
    logo_props: Optional[Dict[str, Any]] = None


@dataclass
class Problem:
    """A validation problem: a stable code for translation plus an English message."""

    code: str
    message: str
    params: Dict[str, Any] = field(default_factory=dict)


def make_error(index: Optional[int], field_name: Optional[str], problem: Problem) -> Dict[str, Any]:
    return {
        "index": index,
        "field": field_name,
        "code": problem.code,
        "params": problem.params,
        "message": problem.message,
    }


def _parse_access(value: Any) -> Optional[int]:
    if value is None or value == "":
        return ACCESS_TO_INT[ACCESS_PUBLIC]
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value in INT_TO_ACCESS else None
    if isinstance(value, str):
        return ACCESS_TO_INT.get(value.strip().lower())
    return None


def _parse_labels(value: Any) -> Tuple[List[str], Optional[Problem]]:
    if value is None or value == "":
        return [], None
    if isinstance(value, str):
        # Spreadsheet cells and front matter often hold "a, b, c"
        value = value.split(",")
    if not isinstance(value, list):
        return [], Problem("labels_not_list", "Labels must be a list of label names.")

    labels: List[str] = []
    seen = set()
    for raw in value:
        if not isinstance(raw, str):
            return [], Problem("label_not_text", "Every label must be text.")
        name = raw.strip()
        if not name:
            continue
        if len(name) > MAX_LABEL_NAME_LENGTH:
            return [], Problem(
                "label_too_long",
                f"Label names can be at most {MAX_LABEL_NAME_LENGTH} characters.",
                {"max": MAX_LABEL_NAME_LENGTH},
            )
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        labels.append(name)

    if len(labels) > MAX_LABELS_PER_PAGE:
        return [], Problem(
            "too_many_labels",
            f"A page can have at most {MAX_LABELS_PER_PAGE} labels.",
            {"max": MAX_LABELS_PER_PAGE},
        )
    return labels, None


def _parse_external_id(value: Any) -> Tuple[Optional[str], Optional[Problem]]:
    if value is None or value == "":
        return None, None
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        return None, Problem("external_id_not_text", "external_id must be text.")
    text = str(value).strip()
    if not text:
        return None, None
    if len(text) > MAX_EXTERNAL_ID_LENGTH:
        return None, Problem(
            "external_id_too_long",
            f"external_id can be at most {MAX_EXTERNAL_ID_LENGTH} characters.",
            {"max": MAX_EXTERNAL_ID_LENGTH},
        )
    return text, None


def _parse_logo_props(value: Any) -> Tuple[Optional[Dict[str, Any]], Optional[Problem]]:
    if value is None or value == "" or value == {}:
        return None, None
    if not isinstance(value, dict):
        return None, Problem("logo_not_object", "logo_props must be an object.")
    try:
        size = len(json.dumps(value).encode("utf-8"))
    except (TypeError, ValueError):
        return None, Problem("logo_invalid", "logo_props must be valid JSON.")
    if size > MAX_LOGO_PROPS_BYTES:
        return None, Problem("logo_too_large", "logo_props is too large.")
    return value, None


def _parse_page(index: int, item: Any) -> Tuple[Optional[ImportedPage], List[Dict[str, Any]]]:
    if not isinstance(item, dict):
        return None, [make_error(index, None, Problem("page_not_object", "Each page must be an object."))]

    errors: List[Dict[str, Any]] = []

    name = item.get("name")
    if not isinstance(name, str) or not name.strip():
        errors.append(make_error(index, "name", Problem("name_required", "Name is required.")))
        name = ""
    else:
        name = name.strip()
        if len(name) > MAX_NAME_LENGTH:
            errors.append(
                make_error(
                    index,
                    "name",
                    Problem(
                        "name_too_long",
                        f"Name can be at most {MAX_NAME_LENGTH} characters.",
                        {"max": MAX_NAME_LENGTH},
                    ),
                )
            )

    access = _parse_access(item.get("access"))
    if access is None:
        errors.append(
            make_error(index, "access", Problem("access_invalid", 'Access must be "public" or "private".'))
        )

    labels, label_problem = _parse_labels(item.get("labels"))
    if label_problem:
        errors.append(make_error(index, "labels", label_problem))

    external_id, external_id_problem = _parse_external_id(item.get("external_id"))
    if external_id_problem:
        errors.append(make_error(index, "external_id", external_id_problem))

    logo_props, logo_problem = _parse_logo_props(item.get("logo_props"))
    if logo_problem:
        errors.append(make_error(index, "logo_props", logo_problem))

    content_html = item.get("content_html")
    if content_html is None or content_html == "":
        content_html = EMPTY_CONTENT_HTML
    elif not isinstance(content_html, str):
        errors.append(make_error(index, "content_html", Problem("content_not_text", "content_html must be text.")))
        content_html = EMPTY_CONTENT_HTML
    else:
        is_valid, message, clean_html = validate_html_content(content_html)
        if not is_valid:
            errors.append(
                make_error(index, "content_html", Problem("content_invalid", message or "Content is not valid HTML."))
            )
            content_html = EMPTY_CONTENT_HTML
        else:
            content_html = clean_html if clean_html and clean_html.strip() else EMPTY_CONTENT_HTML

    if errors:
        return None, errors

    return (
        ImportedPage(
            index=index,
            name=name,
            access=access,
            labels=labels,
            content_html=content_html,
            external_id=external_id,
            logo_props=logo_props,
        ),
        [],
    )


def parse_import_payload(data: Any) -> Tuple[List[ImportedPage], List[Dict[str, Any]]]:
    """
    Validate and normalize an import payload.

    Returns (pages, errors). When errors is non-empty the payload must not be
    imported; every error carries the page index it belongs to (or None for
    errors about the payload as a whole).
    """
    if not isinstance(data, dict):
        problem = Problem("payload_not_object", "The import must be a JSON object with a pages list.")
        return [], [make_error(None, None, problem)]

    version = data.get("version", FORMAT_VERSION)
    if version != FORMAT_VERSION:
        problem = Problem(
            "unsupported_version",
            f"Unsupported format version {version!r}; expected {FORMAT_VERSION}.",
            {"version": str(version), "expected": FORMAT_VERSION},
        )
        return [], [make_error(None, "version", problem)]

    items = data.get("pages")
    if not isinstance(items, list):
        return [], [make_error(None, "pages", Problem("pages_not_list", "pages must be a list."))]
    if not items:
        return [], [make_error(None, "pages", Problem("no_pages", "The file does not contain any pages."))]
    if len(items) > MAX_PAGES:
        problem = Problem(
            "too_many_pages",
            f"A single import can contain at most {MAX_PAGES} pages.",
            {"max": MAX_PAGES},
        )
        return [], [make_error(None, "pages", problem)]

    pages: List[ImportedPage] = []
    errors: List[Dict[str, Any]] = []
    seen_external_ids: Dict[str, int] = {}

    for index, item in enumerate(items):
        page, page_errors = _parse_page(index, item)
        errors.extend(page_errors)
        if page is None:
            continue
        if page.external_id is not None:
            first = seen_external_ids.get(page.external_id)
            if first is not None:
                problem = Problem(
                    "duplicate_external_id",
                    f'external_id "{page.external_id}" is also used by page {first + 1}.',
                    {"external_id": page.external_id, "other": first + 1},
                )
                errors.append(make_error(index, "external_id", problem))
                continue
            seen_external_ids[page.external_id] = index
        pages.append(page)

    if errors:
        return [], errors
    return pages, []


def parse_conflict_mode(value: Any) -> Optional[str]:
    if value is None or value == "":
        return CONFLICT_SKIP
    if isinstance(value, str) and value in CONFLICT_MODES:
        return value
    return None


def as_uuid(value: Optional[str]) -> Optional[uuid.UUID]:
    if not value:
        return None
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        return None
