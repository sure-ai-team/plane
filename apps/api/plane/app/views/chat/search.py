# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Message search (docs/chat/phase-2/06-search.md).

Postgres full-text search with the ``simple`` configuration (same handling for
Arabic and English, P2-D3) over ``body_stripped``, using the GIN expression
index ``chat_msg_search_idx``. Results only come from conversations where the
caller is an active member (07-security.md P2-S1). Snippets are escaped before
the ``<mark>`` tags are added back (P2-S2).
"""

# Python imports
import base64
import binascii
import html
import re
from datetime import datetime, time

# Django imports
from django.contrib.postgres.search import SearchHeadline, SearchQuery, SearchRank, SearchVector
from django.db.models import Exists, OuterRef, Q
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers.chat import user_lite
from plane.db.models import SEARCH_CONFIG, ConversationType, FileAsset, Message, MessageKind, MessageWorkItem
from plane.throttles.chat import ChatSearchThrottle

from . import services
from .base import ChatBaseEndpoint

CHAT_ROLES = [ROLE.ADMIN, ROLE.MEMBER]
PAGE_SIZE = 25
MAX_TERMS = 10
MIN_QUERY_LENGTH = 2
MAX_QUERY_LENGTH = 200
TOTAL_CAP = 1000
# Private-use markers survive ts_headline and html.escape untouched.
MARK_START, MARK_END = "", ""
HAS_FILTERS = ("file", "image", "video", "voice", "link", "work_item")
WORD = re.compile(r"\w+", re.UNICODE)
PHRASE = re.compile(r'"([^"]+)"')


def build_tsquery(text: str):
    """Turn user text into a raw tsquery: words are ANDed, the last word matches
    as a prefix (search as you type), and "quoted phrases" match in order.
    Only word characters reach the query, so user input can't inject syntax."""
    parts = []
    for phrase in PHRASE.findall(text):
        words = WORD.findall(phrase.lower())
        if words:
            parts.append("(" + " <-> ".join(words) + ")")
    rest = PHRASE.sub(" ", text)
    words = WORD.findall(rest.lower())
    terms = (parts + words)[:MAX_TERMS]
    if not terms:
        return None
    if len(terms) > len(parts):  # the last term is a plain word, not a phrase
        terms[-1] = f"{terms[-1]}:*"
    return " & ".join(terms)


def safe_snippet(text: str) -> str:
    escaped = html.escape(text or "")
    return escaped.replace(MARK_START, "<mark>").replace(MARK_END, "</mark>")


def parse_cursor(cursor):
    if not cursor:
        return 0
    try:
        return max(0, int(base64.urlsafe_b64decode(cursor.encode()).decode()))
    except (ValueError, binascii.Error, UnicodeDecodeError):
        raise services.ChatError(400, "INVALID_PARAM", "Invalid cursor.")


def make_cursor(offset: int) -> str:
    return base64.urlsafe_b64encode(str(offset).encode()).decode()


def parse_date(value, name, *, end_of_day=False):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise services.ChatError(400, "INVALID_PARAM", f"'{name}' must be a date.")
    if len(value) <= 10:  # a plain date covers the whole day
        parsed = datetime.combine(parsed.date(), time.max if end_of_day else time.min)
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return parsed


def has_filter(queryset, has):
    attachments = FileAsset.objects.filter(chat_message_id=OuterRef("pk"))
    if has == "file":
        return queryset.filter(Exists(attachments.filter(attributes__kind="file")))
    if has in ("image", "video"):
        return queryset.filter(Exists(attachments.filter(attributes__kind=has)))
    if has == "voice":
        return queryset.filter(Exists(attachments.filter(attributes__is_voice=True)))
    if has == "link":
        return queryset.filter(Q(body_html__icontains='href="http') | Q(body_html__icontains="href='http"))
    if has == "work_item":
        return queryset.filter(Exists(MessageWorkItem.objects.filter(message_id=OuterRef("pk"))))
    return queryset


def conversation_summary(membership, partner):
    conversation = membership.conversation
    return {
        "id": str(conversation.id),
        "type": conversation.type,
        "name": conversation.name,
        "logo_props": conversation.logo_props,
        "direct_user": user_lite(partner) if conversation.type == ConversationType.DIRECT else None,
    }


class ChatSearchEndpoint(ChatBaseEndpoint):
    throttle_classes = [ChatSearchThrottle]

    @allow_permission(CHAT_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        params = request.query_params
        text = (params.get("q") or "").strip()
        has = params.get("has") or None
        if has and has not in HAS_FILTERS:
            raise services.ChatError(400, "INVALID_PARAM", f"'has' must be one of: {', '.join(HAS_FILTERS)}.")
        if len(text) > MAX_QUERY_LENGTH:
            raise services.ChatError(400, "QUERY_TOO_LONG", "The search is too long.")
        tsquery = build_tsquery(text) if text else None
        if not has and (len(text) < MIN_QUERY_LENGTH or tsquery is None):
            raise services.ChatError(400, "QUERY_TOO_SHORT", "Type at least two characters.")

        memberships = {str(m.conversation_id): m for m in services.user_memberships(request.user, slug)}
        conversation_id = params.get("conversation_id")
        if conversation_id:
            if conversation_id not in memberships:
                raise services.not_found()
            allowed = [conversation_id]
        else:
            allowed = list(memberships)

        queryset = Message.objects.filter(conversation_id__in=allowed).exclude(kind=MessageKind.SYSTEM)
        if params.get("from"):
            queryset = queryset.filter(sender_id=params.get("from"))
        after = parse_date(params.get("after"), "after")
        before = parse_date(params.get("before"), "before", end_of_day=True)
        if after:
            queryset = queryset.filter(created_at__gte=after)
        if before:
            queryset = queryset.filter(created_at__lte=before)
        if has:
            queryset = has_filter(queryset, has)

        if tsquery:
            query = SearchQuery(tsquery, search_type="raw", config=SEARCH_CONFIG)
            vector = SearchVector("body_stripped", config=SEARCH_CONFIG)
            queryset = (
                queryset.annotate(search=vector)
                .filter(search=query)
                .annotate(rank=SearchRank(vector, query))
                .order_by("-rank", "-created_at", "-id")
            )
        else:
            queryset = queryset.order_by("-created_at", "-id")

        offset = parse_cursor(params.get("cursor"))
        page = list(queryset.select_related("sender")[offset : offset + PAGE_SIZE + 1])
        has_next = len(page) > PAGE_SIZE
        page = page[:PAGE_SIZE]

        snippets = {}
        if tsquery and page:
            rows = Message.objects.filter(id__in=[message.id for message in page]).annotate(
                snippet=SearchHeadline(
                    "body_stripped",
                    SearchQuery(tsquery, search_type="raw", config=SEARCH_CONFIG),
                    config=SEARCH_CONFIG,
                    start_sel=MARK_START,
                    stop_sel=MARK_END,
                    max_words=30,
                    min_words=12,
                )
            )
            snippets = {str(row.id): row.snippet for row in rows}

        names = {}
        for message_id, name in FileAsset.objects.filter(chat_message_id__in=[m.id for m in page]).values_list(
            "chat_message_id", "attributes__name"
        ):
            names.setdefault(str(message_id), []).append(name)

        direct_ids = [cid for cid in {str(m.conversation_id) for m in page} if memberships[cid].conversation.is_direct]
        partners = services.direct_partners(direct_ids, request.user) if direct_ids else {}

        results = []
        for message in page:
            key = str(message.id)
            membership = memberships[str(message.conversation_id)]
            snippet = snippets.get(key)
            results.append(
                {
                    "conversation": conversation_summary(membership, partners.get(str(message.conversation_id))),
                    "message": {
                        "id": key,
                        "seq": message.seq,
                        "kind": message.kind,
                        "sender": user_lite(message.sender),
                        "created_at": message.created_at,
                    },
                    "snippet_html": safe_snippet(
                        snippet if snippet is not None else (message.body_stripped or "")[:200]
                    ),
                    "attachment_names": names.get(key, []),
                }
            )

        data = {"results": results, "next_cursor": make_cursor(offset + PAGE_SIZE) if has_next else None}
        if offset == 0:
            data["total_estimate"] = queryset.order_by()[: TOTAL_CAP + 1].count()
        return Response(data, status=status.HTTP_200_OK)
