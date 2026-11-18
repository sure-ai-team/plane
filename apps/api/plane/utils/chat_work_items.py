# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Work-item references in chat messages (docs/chat/phase-2/DECISIONS.md P2-D13).

A message links to a work item with an ordinary link to the work item's page:
``/<slug>/browse/<PROJECT>-<n>/`` (the canonical URL) or
``/<slug>/projects/<project_id>/issues/<issue_id>/``. Links may be relative or
absolute; only links into the message's own workspace count. The references are
stored in ``MessageWorkItem`` so the client can render rich cards and the work
item page can list the conversations that discuss it.

Plain text counts too: a pasted work-item URL that the editor did not turn into a
link, and a bare key such as ``MOB-12``. Keys must be upper case (as identifiers
are) and only resolve when that work item exists in the workspace, so ordinary
words like ``covid-19`` or ``UTF-8`` (with no ``UTF`` project) never match. Text
inside code blocks is ignored.
"""

# Python imports
import re
from urllib.parse import urlparse

# Third party imports
from bs4 import BeautifulSoup

# Module imports
from plane.db.models import MAX_WORK_ITEM_REFS_PER_MESSAGE, Issue, MessageWorkItem

BROWSE_PATH = re.compile(r"^/(?P<slug>[^/]+)/browse/(?P<identifier>[A-Za-z0-9]+)-(?P<sequence>\d+)/?$")
ISSUE_PATH = re.compile(
    r"^/(?P<slug>[^/]+)/projects/(?P<project_id>[0-9a-fA-F-]{36})/issues/(?P<issue_id>[0-9a-fA-F-]{36})/?$"
)


# A URL or root-relative path written as text; trailing punctuation is trimmed below.
TEXT_URL = re.compile(r"(?:https?://[^\s/]+)?/[^\s<>\"']+/(?:browse|projects)/[^\s<>\"']+")
# A bare key: upper-case identifier (as projects use), not part of a longer word or path.
BARE_KEY = re.compile(r"(?<![\w/-])(?P<identifier>[A-Z][A-Z0-9]{0,11})-(?P<sequence>\d{1,9})(?![\w-])")


def _add(items: list, value) -> None:
    if value not in items:
        items.append(value)


def _match_path(path: str, slug: str, browse_keys: list, issue_ids: list) -> bool:
    match = BROWSE_PATH.match(path)
    if match and match.group("slug") == slug:
        _add(browse_keys, (match.group("identifier").upper(), int(match.group("sequence"))))
        return True
    match = ISSUE_PATH.match(path)
    if match and match.group("slug") == slug:
        _add(issue_ids, match.group("issue_id").lower())
        return True
    return False


def linked_work_item_keys(body_html: str, slug: str):
    """Return ``(browse_keys, issue_ids)`` for work items ``body_html`` refers to in
    workspace ``slug``: links first, then URLs and keys in the text, in order.
    ``browse_keys`` are ``(IDENTIFIER, sequence)``."""
    if not body_html:
        return [], []
    browse_keys, issue_ids = [], []
    soup = BeautifulSoup(body_html, "html.parser")
    for anchor in soup.find_all("a", href=True):
        _match_path(urlparse(anchor["href"]).path or "", slug, browse_keys, issue_ids)
    # Text outside links and code: pasted URLs and bare keys.
    for node in soup.find_all(string=True):
        if node.find_parent(["a", "code", "pre"]):
            continue
        text = str(node)
        for url in TEXT_URL.findall(text):
            _match_path(urlparse(url.rstrip(".,;:!?)]}")).path or "", slug, browse_keys, issue_ids)
        text = TEXT_URL.sub(" ", text)
        for match in BARE_KEY.finditer(text):
            _add(browse_keys, (match.group("identifier"), int(match.group("sequence"))))
    return browse_keys, issue_ids


def resolve_work_item_ids(body_html: str, workspace_id, slug: str) -> list:
    """Ids of existing work items the message links to, in link order, capped."""
    browse_keys, issue_ids = linked_work_item_keys(body_html, slug)
    if not browse_keys and not issue_ids:
        return []
    found = []
    if browse_keys:
        identifiers = {identifier for identifier, _ in browse_keys}
        rows = Issue.objects.filter(
            is_draft=False, workspace_id=workspace_id, project__identifier__in=identifiers
        ).values_list("id", "project__identifier", "sequence_id")
        by_key = {(identifier.upper(), sequence): str(issue_id) for issue_id, identifier, sequence in rows}
        found.extend(by_key[key] for key in browse_keys if key in by_key)
    if issue_ids:
        existing = {
            str(issue_id)
            for issue_id in Issue.objects.filter(
                is_draft=False, workspace_id=workspace_id, id__in=issue_ids
            ).values_list("id", flat=True)
        }
        found.extend(issue_id for issue_id in issue_ids if issue_id in existing)
    unique = list(dict.fromkeys(found))
    return unique[:MAX_WORK_ITEM_REFS_PER_MESSAGE]


def sync_message_work_items(message, slug: str) -> list:
    """Make ``MessageWorkItem`` rows match the links in the message body."""
    wanted = resolve_work_item_ids(message.body_html, message.workspace_id, slug)
    MessageWorkItem.objects.filter(message=message).exclude(issue_id__in=wanted).delete()
    MessageWorkItem.objects.bulk_create(
        [
            MessageWorkItem(
                message=message,
                conversation_id=message.conversation_id,
                issue_id=issue_id,
                workspace_id=message.workspace_id,
                created_by_id=message.sender_id,
            )
            for issue_id in wanted
        ],
        ignore_conflicts=True,
    )
    return wanted


def work_item_refs(message_ids) -> dict:
    """``{message_id: [{"id", "project_id", "project_identifier", "sequence_id"}]}``.

    Ids and keys only: the client loads details through the work-item APIs, which
    apply project permissions (07-security.md P2-S4)."""
    refs = {}
    rows = (
        MessageWorkItem.objects.filter(message_id__in=message_ids)
        .order_by("created_at")
        .values_list("message_id", "issue_id", "issue__project_id", "issue__project__identifier", "issue__sequence_id")
    )
    for message_id, issue_id, project_id, identifier, sequence in rows:
        refs.setdefault(str(message_id), []).append(
            {
                "id": str(issue_id),
                "project_id": str(project_id),
                "project_identifier": identifier,
                "sequence_id": sequence,
            }
        )
    return refs
