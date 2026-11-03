# Workspace Chat — Phase 1 implementation plan

Status: approved, not started
Last updated: 2026-11-03
UI mockups: https://claude.ai/artifact/Pqw2s7Wc5uEq2PEC3ch3Ae (private; share from the page's Share menu)

This document is the single source of truth for the chat feature. Update it when a decision changes.

---

## 1. Scope

**Goal:** members of a workspace can chat one-to-one or in groups inside the platform, and share images, videos, files and voice notes. Chat is linked to work items.

### Locked decisions

| Decision                    | Choice                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| Who can chat                | Workspace admins and members only; guests can't. Each workspace has its own separate chat. |
| Delete                      | Permanent: database rows and stored files are removed. No soft delete, no audit export.    |
| Calls                       | None. Messaging only (no WebRTC / TURN).                                                   |
| Scale                       | Fewer than 500 users online at once, on one live server instance.                          |
| Attachments and voice notes | Included in phase 1.                                                                       |
| Chat UI kit                 | None. Build on `@plane/propel` / `@plane/ui`.                                              |

### In phase 1

- 1:1 and group chats, groups optionally linked to a project, member roles (admin/member), mute, leave, delete group.
- Text messages with `@mentions` and work-item cards, reply, edit, permanent delete.
- Unread counts, "Seen by", typing indicator, online status, catch-up after a reconnect.
- Images, videos, files and voice notes, with upload progress, cancel, size checks, drag and drop, and paste.
- Superadmin settings: chat on/off and size limits.

### Phase 2 (not now)

- Mention notifications in the Inbox, and email digests.
- Reactions, message search, pinned messages.
- The mini chat drawer on work-item pages ("Discuss in chat").
- Server-side video conversion (only if browser-format problems show up).
- Browser push notifications.

---

## 2. Architecture

```
Browser ──REST──▶ Django API ──▶ Postgres
   ▲               │  └─ presigned links ──▶ MinIO/S3 ◀── browser uploads and downloads files directly
   │               └─ after commit: Redis PUBLISH chat:user:{id}, once per member
   │                                   │
   └── WebSocket /live/chat/ ◀── live server (psubscribe chat:user:*)
```

- **All writes go through Django** over REST, which owns the data and the permission checks.
- **The live server only delivers.** It sends events to each user's open tabs and handles typing and online status. It reuses the existing cookie login (`apps/live/src/lib/auth.ts`).
- **File bytes never pass through Django or the live server.** Browsers upload and download directly from storage using presigned links.
- **No new services.** Postgres, Redis, MinIO, the live server, Celery and the Caddy proxy (which already forwards `/live/*`) are all already deployed.
- **Why not Django Channels:** it is in `requirements/base.txt` and `asgi.py` uses its router, but only for HTTP. The API runs under gunicorn with `--max-requests 1200`, which recycles workers and would drop every socket on that worker. Long-lived connections belong in `apps/live`.

---

## 3. Tech stack

| Layer                       | Choice                                                                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Interface components        | `@plane/propel` and `@plane/ui` (avatar, menu, context-menu, dialog, combobox, emoji-reaction, emoji-icon-picker, toast, skeleton, tabs, badge, scrollarea), plus new chat components with Storybook stories |
| Composer                    | The `@plane/editor` comment editor (mentions, work-item links, emoji, paste already work)                                                                                                                    |
| Message list                | `react-virtuoso` (MIT). Use the free `Virtuoso` component with `followOutput` and `firstItemIndex`; **not** the paid `VirtuosoMessageList`                                                                   |
| Voice notes                 | `wavesurfer.js` v7 with its Record plugin (BSD-3)                                                                                                                                                            |
| Image and video viewer      | `yet-another-react-lightbox` (MIT) with zoom and video plugins, loaded the first time it's opened                                                                                                            |
| Socket client               | `partysocket`'s `ReconnectingWebSocket` (MIT)                                                                                                                                                                |
| Drag and drop, dates, state | Already installed: `react-dropzone`, `date-fns`, MobX, SWR                                                                                                                                                   |
| Real-time server            | The existing `apps/live` (`ws`, `express-ws`, `ioredis`)                                                                                                                                                     |
| Server-side file check      | `filetype` (Python, MIT; pure Python, no libmagic)                                                                                                                                                           |

Rules:

- New JavaScript packages go into the pnpm `catalog:` (AGENTS.md).
- All licenses are compatible with the platform's AGPL-3.0 license.
- Rejected: Django Channels for sockets, Centrifugo, embedded Mattermost/Rocket.Chat/Matrix, hosted chat APIs (Stream, Sendbird, CometChat — cost and data residency), chat UI kits (`@chatscope`, `react-chat-elements`, vendor UIKits).

---

## 4. Data model

Files: `apps/api/plane/db/models/chat.py`, migration `0125_chat`.

A new `ChatBaseModel` has a UUID primary key plus the time and user audit fields (`TimeAuditModel`, `UserAuditModel`). It deliberately does **not** inherit `BaseModel`, because `BaseModel` soft-deletes (it inherits `SoftDeleteModel` in `db/mixins.py`) and chat deletes must be permanent.

| Model                                        | Fields                                                                                                                                                                                                           | Constraints and indexes                                                                                                          |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `Conversation`                               | `workspace`, `type` (direct/group), `name`, `logo_props`, `project` (nullable), `direct_key`, `last_message_seq`, `last_message_at`                                                                              | Unique `(workspace, direct_key)` for direct chats (`direct_key` = the two user IDs sorted); index `(workspace, last_message_at)` |
| `ConversationMember`                         | `conversation`, `member`, `role` (admin/member), `last_read_seq`, `is_muted`, `is_active`                                                                                                                        | Unique `(conversation, member)`; index `(member, is_active)`                                                                     |
| `Message`                                    | `conversation`, `sender` (nullable), `seq`, `kind` (text/system/attachment/voice), `body_html`, `body_json`, `body_stripped`, `reply_to` (SET_NULL), `client_id`, `edited_at`                                    | Unique `(conversation, seq)` and `(conversation, sender, client_id)`                                                             |
| `MessageMention`                             | `message`, `user`                                                                                                                                                                                                | Index `(user)`                                                                                                                   |
| `FileAsset` (existing, `db/models/asset.py`) | New `EntityTypeContext.CHAT_ATTACHMENT` and a nullable `chat_message` FK. `attributes` holds `kind` (image/video/audio/file), `type`, `size`, `width`, `height`, `duration`, `poster_asset_id`, `waveform` peaks | Index `(chat_message)`                                                                                                           |

- **Message numbers:** each conversation has its own counter. On send, lock the conversation row (`select_for_update`) and increment `last_message_seq`. Order and page by `seq`, never by UUID or timestamp.
- **Unread** is `last_message_seq − last_read_seq`. **"Seen by"** compares each member's `last_read_seq` with the message's `seq`. No per-message receipt rows.

---

## 5. REST API

Files: `app/urls/chat.py`, `app/views/chat/`, `app/serializers/chat.py`.

Every endpoint uses `@allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")` plus a shared `get_membership_or_403()` that checks the user is an active member of the conversation. All paths are under `workspaces/<slug>/chat/`.

| Endpoint                                                           | Purpose                                                                                                              |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `GET` / `POST conversations/`                                      | List with last message and unread count, in one query. Create a group, or open the existing direct chat with someone |
| `GET` / `PATCH` / `DELETE conversations/<id>/`                     | Details; rename or change icon; delete the group permanently (group admins)                                          |
| `GET` / `POST conversations/<id>/members/`                         | List or add members (group admins)                                                                                   |
| `PATCH` / `DELETE conversations/<id>/members/<mid>/`               | Change role or mute; remove a member or leave                                                                        |
| `GET conversations/<id>/messages/?before_seq=&after_seq=&limit=50` | Page through history; catch up after a reconnect                                                                     |
| `POST conversations/<id>/messages/`                                | Send `{body, reply_to, client_id, attachment_ids[]}`                                                                 |
| `PATCH` / `DELETE messages/<id>/`                                  | Edit your own message; delete permanently (your own, or any if you're a group admin)                                 |
| `POST conversations/<id>/read/`                                    | Mark as read up to a given `seq`                                                                                     |
| `POST conversations/<id>/attachments/`                             | Get a presigned upload link. Checks file type and size limit                                                         |
| `PATCH attachments/<id>/`                                          | Confirm the upload: checks the real size and file type (`filetype`), then marks it uploaded                          |
| `GET attachments/<id>/?thumb=1`                                    | Membership check, then redirect to a presigned link                                                                  |
| `GET unread-count/`, `GET presence/`                               | Chat badge in the app rail; who is online                                                                            |
| `GET conversations/<id>/member-ids/`                               | Used only by the live server (secret-key auth), for typing fan-out                                                   |
| Instance config: the `CHAT_*` keys                                 | Superadmin settings (section 8)                                                                                      |

Rules when sending:

- Attachments must be uploaded, belong to the same conversation, and be uploaded by the sender.
- The message `kind` is set from what's attached.
- `client_id` makes retries idempotent (unique constraint).
- The Redis event is published only after the database save commits (`transaction.on_commit`).
- Removed/deactivated workspace members lose access immediately: every query joins on active `WorkspaceMember` rows. A cleanup task marks their `ConversationMember` rows inactive.

---

## 6. Real-time

### Events (types in `packages/types/src/chat`)

| From the server                                  | From the client                                          |
| ------------------------------------------------ | -------------------------------------------------------- |
| `message.created` / `.updated` / `.deleted`      | `typing {conversation_id}`, at most once every 3 seconds |
| `conversation.created` / `.updated` / `.deleted` | `ping` every 30 seconds                                  |
| `member.added` / `.removed`                      |                                                          |
| `read.updated {conversation_id, user_id, seq}`   |                                                          |
| `typing {conversation_id, user_id}`              |                                                          |
| `presence {user_id, online}`                     |                                                          |

### Live server (`apps/live/src`)

- `controllers/chat.controller.ts`, at `/live/chat/`. Logs in with the existing helper in `lib/auth.ts` and keeps a map from user ID to open sockets.
- `chat/redis-bridge.ts` holds one `psubscribe chat:user:*` subscription and routes each event to the right user's sockets.
- `chat/typing.ts` fetches member IDs from the API and caches them for 60 seconds.
- `chat/presence.ts` sets `chat:online:{user_id}` with a 60-second expiry, refreshed by each ping, and broadcasts when someone comes online or goes offline.
- Only accept WebSocket connections from `CORS_ALLOWED_ORIGINS`.

### Django side

- `plane/utils/chat_events.py` provides `publish_chat_event()`, built on the existing `plane.settings.redis.redis_instance()`, and publishes to all recipients in one Redis pipeline.
- One channel per user (`chat:user:{id}`), so the live server never does permission checks per message.

### Reconnect

The client re-fetches the conversation list and the open thread's newer messages (`after_seq`), so nothing is lost if a socket drops.

---

## 7. Attachments and voice notes

| Type                                         | Default limit    | Handled in the browser before upload                            | How it's shown                                                           |
| -------------------------------------------- | ---------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Image (png, jpg, webp, gif)                  | 10 MB            | Thumbnail of about 400px made with canvas, uploaded alongside   | Grid of thumbnails, then the lightbox                                    |
| Video (mp4, webm, mov)                       | 200 MB           | Poster frame grabbed with `<video>` + canvas, plus the duration | Poster with play button; `<video preload="none">`; lightbox video plugin |
| Voice note (webm/opus, or mp4/aac on Safari) | 25 MB, 5 minutes | Waveform peaks computed while recording                         | wavesurfer.js player drawn from the saved waveform; speed 1x / 1.5x / 2x |
| File (pdf, docx, xlsx, txt, zip, …)          | 50 MB            | none                                                            | Card with name, size and download button                                 |
| Per message                                  | 10 files         |                                                                 |                                                                          |

### Upload steps

1. `POST attachments/` → presigned upload link (server checks declared type and size against limits).
2. Upload directly to storage, with progress and a cancel button.
3. `PATCH attachments/<id>/` → server reads the stored file's first bytes with `filetype`, checks the real size, marks it uploaded.
4. `POST messages/` with the attachment IDs. The Send button waits until every upload is done.

### Deleting

Deleting a message or a group permanently deletes the `FileAsset` rows and queues a Celery task that deletes the stored objects. A nightly Celery Beat job deletes uploads that were never attached to a message and are more than 24 hours old.

### Playback

Video and audio play straight from presigned links and rely on HTTP range requests (MinIO and S3 support them). Verify Caddy passes range requests through.

---

## 8. Superadmin

A new **Chat** page in the instance admin app (`apps/admin`), saved as instance configuration:

| Key                          | Default |
| ---------------------------- | ------- |
| `CHAT_ENABLED`               | on      |
| `CHAT_MAX_IMAGE_MB`          | 10      |
| `CHAT_MAX_VIDEO_MB`          | 200     |
| `CHAT_MAX_AUDIO_MB`          | 25      |
| `CHAT_MAX_FILE_MB`           | 50      |
| `CHAT_MAX_FILES_PER_MESSAGE` | 10      |
| `CHAT_MAX_VOICE_SECONDS`     | 300     |

When chat is turned off, the app rail item is hidden and the API returns 404. The existing global `FILE_SIZE_LIMIT` (5 MB) does not apply to chat.

---

## 9. Web app (`apps/web`)

### Routes and layout

- New layout `app/(all)/[workspaceSlug]/(chat)/layout.tsx` with its own sidebar, as a sibling of `(projects)`.
- Routes added in `app/routes/core.ts`: `:workspaceSlug/chat` (empty state) and `:workspaceSlug/chat/:conversationId`.
- The whole chat section loads only when it's first opened (lazy route).
- App rail: a Chat item with an unread badge in `core/components/navigation/app-rail-hoc.tsx` (`withDockItems`), next to Projects.

### Data layer

- `core/services/chat.service.ts` for REST calls, extending `APIService`.
- `core/services/chat-socket.ts` uses partysocket and dispatches incoming events to the stores.

### Stores (`core/store/chat/`, registered in `root.store.ts`)

| Store                   | Holds                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `conversation.store.ts` | Conversations by ID, sorted list, unread counts, total unread                                              |
| `message.store.ts`      | Messages by conversation and `seq`, page loading, optimistic sends matched by `client_id`, batched updates |
| `upload.store.ts`       | Upload queue: progress, cancel, retry, errors                                                              |
| `realtime.store.ts`     | Who is typing (cleared after 5 s), who is online                                                           |

### Components

In `@plane/propel` / `@plane/ui`, with Storybook stories:

- `MessageItem`, `MessageGroup` (same sender within 5 min shares one header), `DayDivider`, `SystemMessage`
- `AttachmentGrid`, `FileCard`, `VideoTile`
- `VoiceNotePlayer`, `VoiceRecorder` (thin wrappers around wavesurfer.js)
- `UploadTray`, `TypingIndicator`, `PresenceDot`, `ConversationListItem`

In `apps/web/core/components/chat/`:

- `sidebar/` (Groups and Direct messages sections, same pattern as the Projects sidebar)
- `thread/` (header, Virtuoso list, message rendering)
- `composer/` (editor, attachments, recorder)
- `modals/new-conversation.tsx`
- `details-panel/` (members, media, files, linked work items)

### Languages

A new `chat.*` key group, added to **both** `packages/i18n/src/locales` and `packages/i18n/locales` (the runtime loads the second tree), using the `translate` skill. Layouts use Tailwind logical spacing (`ps-`, `ms-`, …) so they flip correctly for Arabic.

### Visual spec (from the mockups)

- Light-theme tokens from `packages/tailwind-config/variables.css`; Inter 13px; accent `--brand-default` (#004FFF).
- Thread messages are styled like work-item comments (avatar, name + time, body, hover toolbar), not chat bubbles.
- Work-item cards use the real state icon, priority badge and issue ID.
- Buttons 28px with 6px corners; underline tabs like the Inbox page.

---

## 10. Security checklist

- [ ] **Fix file access:** `WorkspaceFileAssetEndpoint.get` (`apps/api/plane/app/views/asset/v2.py`, around line 462) currently serves any non-project asset to any workspace member. It must refuse `CHAT_ATTACHMENT`. Chat files are only served through the chat endpoint after a membership check. **Ship in PR 1.**
- [ ] Guests are refused; removed or deactivated workspace members lose access immediately.
- [ ] Message HTML is cleaned by the same sanitizer comments use.
- [ ] File types are checked by reading the stored file's first bytes, not trusting the extension.
- [ ] Presigned links are short-lived. Downloads are served as `attachment`, except images, video and audio, which play inline.
- [ ] Sending, typing and upload-link requests are rate-limited using the existing throttles.
- [ ] WebSocket connections are only accepted from the configured `CORS_ALLOWED_ORIGINS`.
- [ ] The `member-ids` endpoint used by the live server requires the live server secret, not a user session.

---

## 11. Performance targets

| Area                | Target                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Opening a thread    | Last 50 messages appear in under 300 ms; older messages load on scroll                                                 |
| Message delivery    | Under 200 ms from send to the other person's screen, on the same network                                               |
| Long threads        | Only visible messages are on the page, so 10,000 messages scroll smoothly                                              |
| Load on other pages | Chat code doesn't load until Chat is opened; only the badge store and the socket load up front                         |
| Media               | Thumbnails, posters and waveforms show first; full images, video and audio load on demand; seeking uses range requests |
| Server              | Files never pass through API workers; conversation list in one query; unread counts are a subtraction                  |

Optimizations to apply:

1. Lazy-load the chat routes, recorder, lightbox and emoji picker.
2. Page 50 messages at a time (`before_seq` / `after_seq`).
3. Optimistic sends matched by `client_id`.
4. Thumbnails (~400px) in the thread; full image only in the lightbox; `preload="none"` on video.
5. Throttle typing to one event per 3 s; batch bursts of incoming events into one store update.
6. Files go browser → storage directly via presigned links.
7. Counters instead of receipt tables.
8. Indexes on `(conversation, seq)` and `(member, is_active)`.
9. One Redis channel per user; publish in a pipeline.
10. File deletion and cleanup run as Celery tasks.

---

## 12. Tests

### pytest (Docker test stack: `docker compose -f docker-compose-test.yml ...`)

- Models: direct-chat uniqueness, message numbering under concurrent sends, duplicate `client_id` ignored.
- Permissions: non-member, guest, removed member and non-admin all refused.
- Permanent delete removes `FileAsset` rows and queues object deletion.
- Attachment checks: wrong file type, too large, belongs to a different conversation, not yet uploaded.
- The file-access fix in `WorkspaceFileAssetEndpoint`.
- Events published only after commit, with Redis mocked.

### Live server

- Login refusal, routing to the right user's sockets, typing throttle, presence expiry.

### Web

- Store tests for optimistic sends, catch-up after reconnect and the upload queue.
- Storybook stories for each new component.

### Before release

- Load test with 500 sockets on one live instance.
- Manual check in Chrome, Firefox, Safari and Edge: Safari voice recording (mp4/aac), video seeking through Caddy, Arabic right-to-left layout, dark mode.

---

## 13. Delivery order (one pull request each)

| #   | PR                                                                                                                               | Size | Done when                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------- |
| 1   | Models and migration, serializers, REST endpoints including attachments, **file-access fix**, deletion and cleanup tasks, pytest | L    | All API tests pass; every chat flow works through the REST API alone |
| 2   | Superadmin Chat settings page and `CHAT_*` config                                                                                | S    | Limits are editable and the API enforces them                        |
| 3   | Event publishing, live chat socket, presence and typing                                                                          | M    | Two browser sessions receive each other's messages instantly         |
| 4   | Shared types, chat service, socket client, MobX stores, tests                                                                    | M    | Store tests pass; reconnect catch-up verified                        |
| 5   | App-rail item, sidebar, thread with Virtuoso, message components with stories, new-conversation modal, i18n                      | M    | Text chat works end to end and matches the mockups                   |
| 6   | Composer attachments (drag and drop, paste, upload tray), lightbox, video and file cards                                         | M    | All four file types send, display and enforce limits                 |
| 7   | Voice recorder and player with wavesurfer.js, Safari fallback                                                                    | S    | Recording, review, sending and playback work in all four browsers    |
| 8   | Hardening: load test, cross-browser and right-to-left checks, video seeking through Caddy                                        | S    | Section 11 targets met                                               |

PRs 1–3 are backend only. PRs 4–8 can start once the API shape from PR 1 is merged.

---

## 14. Risks

| Risk                                                 | How it's handled                                                                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Large video uploads fail on poor connections         | Retry button in the upload tray. Switch to multipart, resumable uploads (`@uppy/aws-s3`) only if this happens in practice     |
| Safari records audio in a different format           | Accept both `audio/webm` and `audio/mp4` and test playback in every browser                                                   |
| Some phone videos (HEVC `.mov`) won't play in Chrome | Show the file card with a download button. Server-side conversion stays a phase 2 option                                      |
| Deleted files remaining in storage                   | The deletion task plus the nightly cleanup job, with logging                                                                  |
| Growth beyond 500 users online                       | Each user has their own Redis channel, so adding live server instances later needs no redesign, only sticky sessions in Caddy |
| A later compliance/audit requirement                 | Conflicts with hard delete. Would need a retention switch and an export tool; raise before building if it appears             |

---

## 15. Existing code to build on

| What                               | Where                                                         |
| ---------------------------------- | ------------------------------------------------------------- |
| Live server, WebSocket auth, Redis | `apps/live/src/server.ts`, `lib/auth.ts`, `redis.ts`          |
| File assets and presigned uploads  | `apps/api/plane/db/models/asset.py`, `app/views/asset/v2.py`  |
| Permission decorator               | `apps/api/plane/app/permissions/base.py` (`allow_permission`) |
| Redis client                       | `apps/api/plane/settings/redis.py` (`redis_instance`)         |
| Soft-delete mixins to avoid        | `apps/api/plane/db/mixins.py`                                 |
| Upload service (browser)           | `apps/web/core/services/file-upload.service.ts`               |
| App rail items                     | `apps/web/core/components/navigation/app-rail-hoc.tsx`        |
| Sidebar wrapper pattern            | `apps/web/core/components/sidebar/sidebar-wrapper.tsx`        |
| Route registration                 | `apps/web/app/routes/core.ts`                                 |
| Theme tokens                       | `packages/tailwind-config/variables.css`                      |
| Component library                  | `packages/propel/src`                                         |
