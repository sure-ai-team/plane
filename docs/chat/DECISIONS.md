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
