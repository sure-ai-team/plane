# Decision log

Append-only. Newest at the bottom. Format: number, date, decision, why, alternatives rejected, consequences.

## D1 — 2026-11-03 — Chat is built in-platform, not integrated from a third party

**Why:** must look native, keep data on own servers (PDPL), no per-seat cost.
**Rejected:** Mattermost / Rocket.Chat / Matrix embed (separate identity + UI, ops burden); Stream / Sendbird / CometChat (hosted data, cost).
**Consequences:** ~8 PRs of work; everything in this repo.

## D2 — 2026-11-03 — Hard delete

**Why:** user decision; no audit/compliance requirement today.
**Rejected:** soft delete + admin export.
**Consequences:** chat models must not inherit `BaseModel`; storage objects deleted by Celery; if a compliance need appears later, add a retention switch + export (raise before building).

## D3 — 2026-11-03 — Workspace members only; guests excluded; per-workspace scope

**Why:** user decision; simplest permission model, matches `allow_permission` roles.
**Rejected:** guests in project-linked groups.
**Consequences:** no cross-workspace conversations; `direct_key` unique per workspace.

## D4 — 2026-11-03 — No voice/video calls

**Why:** WebRTC + TURN is a separate project.
**Consequences:** "voice" means recorded voice notes only.

## D5 — 2026-11-03 — Under 500 concurrent users → one live server instance

**Why:** user's expected scale.
**Consequences:** `SCAN` for presence and in-memory socket registry are acceptable; per-user Redis channels keep horizontal scaling possible later (sticky sessions only).

## D6 — 2026-11-03 — Attachments and voice notes are phase 1

**Why:** user decision (originally phase 2).
**Consequences:** `FileAsset` changes and the S1 file-access fix ship in PR 1; phase 1 grew ~40 %.

## D7 — 2026-11-03 — Real-time via existing `apps/live` + Redis pub/sub; not Django Channels

**Why:** API workers are recycled by gunicorn `--max-requests`; live server already does WebSocket auth; no new service.
**Rejected:** Django Channels consumers; Centrifugo.
**Consequences:** Django publishes only; live server never authorises content; typing/presence never touch Postgres.

## D8 — 2026-11-03 — Writes go through REST, not the socket

**Why:** idempotency (`client_id`), validation, throttling and attachments are simpler over HTTP; the socket is delivery-only.
**Consequences:** a sent message appears via optimistic UI, then reconciles.

## D9 — 2026-11-03 — Per-conversation `seq` for ordering and paging

**Why:** gap-free ordering; cheap unread counts; cursor paging without timestamps.
**Rejected:** ordering by `created_at`/UUID; per-message receipt table.

## D10 — 2026-11-03 — One Redis channel per user

**Why:** live server needs no membership knowledge for delivery; multi-tab works for free.
**Rejected:** per-conversation channels with live-side membership checks.

## D11 — 2026-11-03 — Libraries: react-virtuoso, wavesurfer.js, yet-another-react-lightbox, partysocket, filetype (Python); no chat UI kit

**Why:** each solves a hard, well-bounded problem; all MIT/BSD; UI kits clash with the design system and RTL.
**Rejected:** `@tanstack/react-virtual` for the list (would need custom bottom-pinning), `@chatscope`, `react-chat-elements`, vendor UIKits, Uppy (overkill until resumable uploads are needed), `python-magic` (libmagic dependency), `media-chrome`.

## D12 — 2026-11-03 — Media processing in the browser; no server-side ffmpeg in phase 1

**Why:** no new infra; thumbnails/posters/waveforms are cheap client-side.
**Consequences:** HEVC `.mov` may show as a file card in Chrome; server transcoding is a phase 2 option.

## D13 — 2026-11-03 — SVG and HTML uploads are rejected

**Why:** inline rendering would execute scripts.
**Consequences:** designers share PNG/WebP; raise if SVG becomes a real need (could be served `attachment`-only).

## D14 — 2026-11-03 — Thread messages are comment-style, not bubbles

**Why:** matches the platform's work-item comments and the approved mockup; better for RTL and density.

## D15 — 2026-11-03 — Chat access follows workspace membership live; no deactivation hooks

**Why:** workspace members are deactivated in several places, some with `QuerySet.update()`, which bypasses signals. Hooking each one is fragile.
**How:** every chat query and every event fan-out joins an active `WorkspaceMember` (admin or member role). A `ConversationMember` row is left as-is when someone leaves the workspace; it simply stops counting.
**Rejected:** a `deactivate_chat_memberships` task called from each removal path (was in the original plan).
**Consequences:** re-adding someone to the workspace restores their chats automatically.

## D16 — 2026-11-03 — Conversation events carry ids and shared fields only

**Why:** unread count, role and the direct-chat partner differ per viewer, so one payload can't serve every recipient.
**How:** `conversation.created` / `conversation.deleted` send `{conversation_id}`; `conversation.updated` adds `name`, `logo_props`, `project`. Clients re-fetch `GET conversations/<id>/` when they need the full row. Message and member events still carry full payloads (they are the same for everyone).

## D17 — 2026-11-03 — System lines are messages and are published as `message.created`

**Why:** one code path on the client for "X added Y", "renamed to …", etc.; unread counts stay correct.

## D18 — 2026-11-03 — A voice note is an audio upload flagged `is_voice`

**Why:** an uploaded `.mp3` is a file attachment, a recording is a voice note; the server can't tell them apart from the MIME type.
**How:** the recorder sends `is_voice: true` and a `duration`; the server enforces `CHAT_MAX_VOICE_SECONDS` and sets message `kind = "voice"` when it's sent alone.

## D19 — 2026-11-03 — File sniffing is strict for images, lenient for audio/video containers

**Why:** every allowed image format has a signature; some recorders produce audio/video containers `filetype` doesn't recognise.
**How:** unrecognised images are rejected; unrecognised audio/video is accepted. Storage serves every object with its declared media type (pinned in the presigned POST), so it can't execute. Recognised executables are always rejected.

## D20 — 2026-11-03 — S1 covers every generic asset path, not just one endpoint

**Why:** the generic endpoints accepted any `EntityTypeContext` value and looked up assets by id within the workspace, so chat files could have been read, downloaded, duplicated, restored or re-linked through them.
**How:** `FileAsset.PRIVATE_ENTITY_TYPES` / `PUBLIC_ENTITY_TYPES`; `non_chat_assets()` in `asset/v2.py`; the same exclusion in the v1 and public-API asset views; `chat_conversation` / `chat_message` read-only in every `FileAsset` serializer.
