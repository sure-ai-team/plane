# 02 — API contracts

Base: `/api/workspaces/<slug>/chat/`. Files: `app/urls/chat.py`, `app/views/chat/{conversation,message,member,attachment,misc}.py`, `app/serializers/chat.py`.

Common rules:

- Auth: session cookie (existing). Every view: `@allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")`.
- Conversation-scoped views call `get_membership_or_403(request.user, conversation_id, slug)` which also verifies the row's `workspace__slug == slug`.
- If instance config `CHAT_ENABLED` is false → `404 {"error": "Chat is disabled"}` on every chat route.
- Pagination for messages is cursor-by-`seq`, not offset. Conversation list is not paginated (bounded by membership count); cap at 500.
- Timestamps are ISO-8601 UTC. IDs are UUID strings.
- Errors: `{"error": "<human message>", "code": "<SCREAMING_SNAKE>"}` with the status codes listed per endpoint.

## Shared shapes

```jsonc
// UserLite
{ "id": "uuid", "display_name": "Omar Khalid", "avatar_url": "…|null", "is_active": true }

// Attachment
{
  "id": "uuid", "kind": "image|video|audio|file", "name": "crash-repro.mp4", "type": "video/mp4", "size": 38123456,
  "url": "/api/assets/v2/workspaces/<slug>/chat/attachments/<id>/",
  "thumb_url": "…?thumb=1|null",          // images, videos (poster)
  "width": 1080, "height": 1920,          // images/videos, else null
  "duration": 78.4,                       // audio/video seconds, else null
  "waveform": [0.1, 0.4, …],              // audio only, 64 floats 0..1, else null
  "created_at": "…"
}

// Message
{
  "id": "uuid", "conversation_id": "uuid", "seq": 1042, "kind": "text",
  "sender": UserLite|null, "body_html": "<p>…</p>", "body_json": {…}, "body_stripped": "…",
  "reply_to": { "id": "uuid", "seq": 1001, "sender": UserLite|null, "kind": "voice", "body_stripped": "…" } | null,
  "attachments": [Attachment], "mentions": ["uuid"], "meta": {},
  "client_id": "uuid|null", "edited_at": "…|null", "created_at": "…",
  "seen_by_count": 5                       // members with last_read_seq >= seq, excluding sender
}

// Conversation
{
  "id": "uuid", "type": "direct|group", "name": "Mobile App Release", "logo_props": {},
  "project": { "id": "uuid", "identifier": "MOB", "name": "Mobile App", "logo_props": {} } | null,
  "direct_user": UserLite|null,            // the other party, direct only
  "member_count": 8, "my_role": 20, "is_muted": false,
  "last_message_seq": 1042, "last_read_seq": 1040, "unread_count": 2,
  "last_message_at": "…|null", "last_message_preview": { "sender_id": "uuid", "kind": "attachment", "attachment_kinds": ["image"], "text": "Reproduced it" },
  "created_at": "…", "created_by": "uuid"
}

// Member
{ "id": "uuid", "member": UserLite, "role": 20, "is_muted": false, "last_read_seq": 1040, "joined_at": "…" }
```

## Conversations

### `GET conversations/`

Query: `type=direct|group` (optional). Returns `[Conversation]` sorted by `last_message_at` desc, nulls last. One query with annotations (unread, member_count) — no N+1.

### `POST conversations/`

```jsonc
// direct
{ "type": "direct", "user_id": "uuid" }
// group
{ "type": "group", "name": "…", "logo_props": {}, "project_id": "uuid|null", "member_ids": ["uuid", …] }
```

- Direct: if a conversation with the same `direct_key` exists → `200` with it (reactivating my membership if needed); else `201`.
- Group: creator becomes ADMIN; `member_ids` become MEMBER; emits `system/created`. `201`.
- Errors: `400 INVALID_MEMBER` (not an active admin/member of the workspace, or self in direct), `400 NAME_REQUIRED`, `400 PROJECT_NOT_IN_WORKSPACE`.

### `GET conversations/<id>/` → `Conversation` (+ `members: [Member]` first 50).

### `PATCH conversations/<id>/` — group ADMIN only. Body: any of `name`, `logo_props`, `project_id`. Emits `conversation.updated` + a system message. `403 NOT_ADMIN`.

### `DELETE conversations/<id>/` — group ADMIN only. Hard-deletes the conversation (CASCADE) and enqueues object deletion for all its assets. Emits `conversation.deleted` to all members first. `204`. Direct chats cannot be deleted (`400 CANNOT_DELETE_DIRECT`); use leave/mute.

## Members

### `GET conversations/<id>/members/` → `[Member]` (active only; `?include_inactive=1` for admins).

### `POST conversations/<id>/members/` — group ADMIN. `{ "member_ids": ["uuid"] }`. Skips existing active members; reactivates inactive ones. Emits `member.added` + system message per user. `201 [Member]`.

### `PATCH conversations/<id>/members/<member_id>/`

- Own row: `{ "is_muted": bool }`.
- ADMIN on others: `{ "role": 20|15 }`. Cannot demote the last admin (`400 LAST_ADMIN`).

### `DELETE conversations/<id>/members/<member_id>/`

- Own row = leave. Last admin leaving promotes the longest-standing member (`meta.event = member_left`).
- ADMIN on others = remove. Direct: `400 CANNOT_LEAVE_DIRECT`.
- Sets `is_active=False, left_at=now`. Emits `member.removed`. `204`.

## Messages

### `GET conversations/<id>/messages/`

Query: `before_seq` (exclusive, page backwards), `after_seq` (exclusive, page forwards / catch-up), `limit` (default 50, max 100). Exactly one of before/after, or neither (= latest page).

```jsonc
{ "results": [Message], "has_more": true, "oldest_seq": 993, "newest_seq": 1042 }
```

`results` always ascending by `seq`.

### `POST conversations/<id>/messages/`

```jsonc
{ "body_html": "<p>…</p>", "body_json": {…}, "reply_to_id": "uuid|null", "client_id": "uuid", "attachment_ids": ["uuid"] }
```

- At least one of non-empty `body_stripped` or `attachment_ids`. `400 EMPTY_MESSAGE`.
- `attachment_ids`: each must be `CHAT_ATTACHMENT`, `is_uploaded=True`, `chat_conversation_id == id`, `created_by == me`, `chat_message IS NULL`. Else `400 INVALID_ATTACHMENT`. Count ≤ `CHAT_MAX_FILES_PER_MESSAGE` → `400 TOO_MANY_FILES`.
- `kind`: `voice` if the only attachment is audio and body empty; `attachment` if any attachments; else `text`.
- Mentions parsed from `<mention-component entity_name="user_mention">` tags in the sanitised `body_html` (same as comments) → `MessageMention` rows (only active conversation members; others silently dropped).
- Duplicate `client_id` → `200` existing message. New → `201 Message`.
- Throttle: `chat_send` 60/min/user.

### `PATCH messages/<id>/` — sender only, text/attachment kinds, within no time limit. Body: `body_html`, `body_json`. Sets `edited_at`. Re-parses mentions. Emits `message.updated`. `403 NOT_SENDER`.

### `DELETE messages/<id>/` — sender, or conversation ADMIN. Hard delete; CASCADE removes assets rows; enqueue `delete_chat_objects(asset_keys)`. Replies keep `reply_to=null`. Emits `message.deleted {id, seq}`. `204`.

### `POST conversations/<id>/read/`

`{ "seq": 1042 }` → sets `last_read_seq = max(current, min(seq, last_message_seq))`. Emits `read.updated` to other members. `200 { "last_read_seq": 1042, "unread_count": 0 }`.

## Attachments (see 04 for the full flow)

### `POST conversations/<id>/attachments/`

```jsonc
{
  "name": "crash-repro.mp4",
  "type": "video/mp4",
  "size": 38123456,
  "kind": "video",
  "width": 1080,
  "height": 1920,
  "duration": 78.4,
  "waveform": null,
}
```

→ `200 { "asset_id": "uuid", "upload_data": { "url": "…", "fields": {…} }, "asset_url": "…", "attachment": Attachment }`. Upload links expire after 15 minutes. Recorded voice notes send `"is_voice": true` and a `duration` (D18).
Errors: `400 TYPE_NOT_ALLOWED`, `413 FILE_TOO_LARGE { "limit_bytes": … }`, `400 DURATION_TOO_LONG`.
Throttle: `chat_upload` 30/min/user.

### `POST conversations/<id>/attachments/<asset_id>/thumbnail/`

`{ "type": "image/webp", "size": 41200 }` → presigned post for the thumbnail/poster object, stored under `attributes.thumb_key`. Only for `kind` image/video.

### `PATCH attachments/<asset_id>/`

Marks uploaded. Server: `head_object` for real size (`413` if over limit), reads first 8 KB and runs `filetype.guess()`; mismatch with declared `type` family → delete object, `400 TYPE_MISMATCH`. `200 Attachment`.

### `DELETE attachments/<asset_id>/` — uploader only, only while `chat_message IS NULL` (cancel before send). `204`.

### `GET attachments/<asset_id>/?thumb=1`

Membership check on `chat_conversation` → `302` to presigned GET (5 min). `disposition=inline` for image/video/audio, `attachment` otherwise. `?thumb=1` serves `thumb_key`.

## Misc

### `GET unread-count/` → `{ "total": 7, "by_conversation": { "uuid": 2, … } }` (muted conversations excluded from `total`, included in map).

### `GET presence/` → `{ "online_user_ids": ["uuid"] }` (from Redis `chat:online:*` for this workspace's members).

### `GET live/conversations/<id>/member-ids/` and `GET live/users/<user_id>/access/` — **live-server only**: header `X-Live-Secret: <LIVE_SERVER_SECRET_KEY>`; no session. `{ "member_ids": ["uuid"] }`. Any other caller → `403`.

## Throttles (`plane/throttles/chat.py`)

| Scope         | Rate    | Key  |
| ------------- | ------- | ---- |
| `chat_send`   | 60/min  | user |
| `chat_upload` | 30/min  | user |
| `chat_read`   | 120/min | user |

Registered in `REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]`.

## Added during PR 1

- `GET config/` → the chat limits for the web client's pre-upload checks: `{ enabled, max_image_mb, max_video_mb, max_audio_mb, max_file_mb, max_files_per_message, max_voice_seconds }`.
- `GET live/users/<user_id>/access/` (live-server only, `X-Live-Secret`) → `{ "allowed": bool }`: may this user open a chat socket for this workspace.
- `GET attachments/<asset_id>/?download=1` forces `Content-Disposition: attachment` for media too.
- `Attachment` also carries `is_voice` and `is_uploaded`.
- Member URLs (`members/<member_id>/`) take the member's **user id**.
- An attachment uploaded but not yet sent is visible only to its uploader.
- Every chat id in REST and socket payloads is a string.
- Events: see `03-realtime-protocol.md` (conversation events carry ids, D16; `member.updated` added for role/mute changes and admin promotion).
