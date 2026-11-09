# 02 — API contracts (additions)

Prefix as in phase 1: `/api/workspaces/<slug>/chat/`. Same auth, `ChatBaseEndpoint`, `CHAT_DISABLED` 404, error shape `{code, error, ...}`, and membership checks (`get_membership`). New throttle scopes in brackets.

## Messages

### `GET conversations/<id>/messages/?around_seq=<n>&limit=<k>`

New `around_seq` parameter (mutually exclusive with `before_seq` / `after_seq`). Returns up to `limit` messages centred on `seq = n`, plus `has_before` / `has_after`. Used by reply jump, pinned "Jump", search "Jump" and message links.

### `GET messages/<id>/`

One message (full payload). Used to resolve a message link (`?m=<id>`) to its `seq` before `around_seq`. 404 for non-members.

### Message payload additions

```json
{
  "reactions": [{ "emoji": "🎉", "count": 4, "reacted": true, "user_ids": ["…up to 10…"] }],
  "is_pinned": true,
  "forwarded_from": {
    "sender_name": "Faisal Nasser",
    "conversation_id": "…|null",
    "conversation_name": "…|null",
    "sent_at": "…"
  },
  "work_items": [{ "id": "…", "project_id": "…", "sequence_id": 142, "project_identifier": "MOB" }]
}
```

- `reactions` is ordered by first reaction time. `user_ids` is capped at 10; the full list comes from the reactions endpoint.
- `forwarded_from.conversation_*` is null unless the viewer is a member of the source conversation (P2-D6). The raw source lives in `meta.forwarded_from` on the server and is stripped from `meta` in responses.
- Socket `message.created` / `message.updated` payloads **omit `reactions`** (the `reacted` flag is per viewer). Clients keep their local reactions and apply `reaction.updated`.
- `work_items` carries ids only. The client fetches details through existing work-item APIs, which apply project permissions (P2-D13).

### `POST messages/<id>/forward/` [chat_send]

```json
{ "conversation_ids": ["…"], "comment_html": "<p>optional note</p>" }
```

- At most 5 targets. The sender must be an active member of the source and of every target.
- Creates one new message per target: same body, `meta.forwarded_from`, attachments copied server-side (`copy_object`, new `FileAsset` per target), work-item refs copied.
- `comment_html` is sent first as a normal message in each target.
- 201 `{ "messages": [{ "conversation_id", "id", "seq" }] }`.
- Errors: 403 not a member, 404 message, 400 `FORWARD_LIMIT`, 413 if a copied file exceeds the target's current limits.

## Reactions

| Method | Path                                          | Body                | Result                                    | Throttle   |
| ------ | --------------------------------------------- | ------------------- | ----------------------------------------- | ---------- |
| POST   | `messages/<id>/reactions/`                    | `{ "emoji": "👍" }` | 201 reaction summary for the message      | chat_react |
| DELETE | `messages/<id>/reactions/<urlencoded emoji>/` | —                   | 204                                       | chat_react |
| GET    | `messages/<id>/reactions/?emoji=👍`           | —                   | `[{ user_id, created_at }]` (who reacted) | default    |

- Adding an existing reaction is idempotent (200). 400 `INVALID_EMOJI`, 400 `REACTION_LIMIT`.
- System messages and deleted messages can't be reacted to.
- Throttle `chat_react`: 60/min per user.

## Pins

| Method | Path                       | Result                                                 |
| ------ | -------------------------- | ------------------------------------------------------ |
| GET    | `conversations/<id>/pins/` | Pinned messages, newest first, full message payloads   |
| POST   | `messages/<id>/pin/`       | 201; system line "X pinned a message"; 400 `PIN_LIMIT` |
| DELETE | `messages/<id>/pin/`       | 204; system line "X unpinned a message"                |

Any active member can pin and unpin (P2-D2).

## Member settings (per conversation)

`PATCH conversations/<id>/me/`

```json
{ "notify_level": "mentions", "snoozed_until": "2026-11-04T08:00:00Z", "is_starred": true, "archived": true }
```

All fields optional. `archived: true` sets `archived_at = now`; `false` clears it. Replaces phase 1's mute toggle (the old field stays readable as `is_muted` for one release).

Conversation list payload gains `notify_level`, `snoozed_until`, `is_starred`, `archived_at` and `description`. The list endpoint takes `?archived=true` to return archived conversations only. The default excludes them.

## Group details

`PATCH conversations/<id>/` accepts `description` (max 500 chars) and `logo_props` (group admins only, as for `name`). System line for description changes: none (avoids noise).

## Preferences

| Method | Path           | Body / result                                   |
| ------ | -------------- | ----------------------------------------------- |
| GET    | `preferences/` | `ChatPreference` fields (created with defaults) |
| PATCH  | `preferences/` | Any subset of the fields; validated enums       |

## Search

`GET search/?q=<text>&conversation_id=&from=<user_id>&has=file|image|video|voice|link|work_item&after=<date>&before=<date>&cursor=<opaque>`

- `q` is required, 2–200 characters, unless `has` is set.
- Results only from conversations where the caller is an **active** member (P2-D3).
- Response:

```json
{
  "results": [{
    "conversation": { "id", "type", "name", "logo_props" },
    "message": { "id", "seq", "sender_id", "created_at", "kind" },
    "snippet_html": "It can ride Thursday… no new <mark>store build</mark>.",
    "attachment_names": ["release-notes.pdf"]
  }],
  "next_cursor": "…|null",
  "total_estimate": 14
}
```

- Page size 25. Ordering: rank, then newest. `snippet_html` comes from `ts_headline` with `<mark>` only (escaped otherwise).
- Throttle `chat_search`: 30/min per user.

## Work-item references

`GET /api/workspaces/<slug>/projects/<pid>/issues/<issue_id>/chat-references/`

- Conversations the caller is a member of that mention this work item, with the latest snippet per conversation (P2-D13).
- Lives under the issue routes; permission = can view the project **and** chat member.

### Share to chat

The client calls `POST conversations/<id>/messages/` with a link to the work item (`<a href="/<slug>/browse/MOB-142/">`) in `body_html` (one call per target, max 5). No new endpoint. The client renders such links as rich cards.

## Inbox

No new endpoint. Existing notification endpoints return chat rows (`entity_name = "chat_message"`). Marking an Inbox row read does **not** change chat `last_read_seq`. Reading the message in chat marks matching Inbox rows read (P2-D5).

## Throttles (new)

| Scope         | Rate        |
| ------------- | ----------- |
| `chat_react`  | 60/min/user |
| `chat_search` | 30/min/user |
| `chat_pin`    | 20/min/user |
