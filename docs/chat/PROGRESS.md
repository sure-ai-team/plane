# Progress

Update at the end of every working session. Keep it short; details live in the PRs.

## Status board

| PR                  | Branch                          | Status      | Opened     | Merged | Notes                                                                               |
| ------------------- | ------------------------------- | ----------- | ---------- | ------ | ----------------------------------------------------------------------------------- |
| 1 Backend core      | `feat/chat-1-backend-core`      | in review   | 2026-11-03 |        | 117 chat tests; full suite green; S1 widened (D20)                                  |
| 2 Superadmin config | `feat/chat-2-superadmin-config` | in review   | 2026-11-03 |        | Seeded `CHAT_*` keys, validated save, `config.chat` in instance payload, admin page |
| 3 Real-time         | `feat/chat-3-realtime`          | in review   | 2026-11-03 |        | Live chat socket, Redis bridge, typing, presence, heartbeats; 26 tests              |
| 4 Web data layer    | `feat/chat-4-web-data-layer`    | in review   | 2026-11-03 |        | Types, service, socket client, 4 stores; 43 tests                                   |
| 5 Chat UI: text     | `feat/chat-5-ui-text`           | in review   | 2026-11-03 |        | Routes, rail badge, sidebar, thread, composer, modals, details; en strings          |
| 6 Attachments UI    | `feat/chat-6-ui-attachments`    | in review   | 2026-11-03 |        | Upload tray, paste/drop, thumbnails/posters, grid, video, files, lightbox           |
| 7 Voice notes       | `feat/chat-7-voice-notes`       | in review   | 2026-11-03 |        | Native recorder + waveform player (D23)                                             |
| 8 Hardening         | `feat/chat-8-hardening`         | not started |            |        |                                                                                     |

Status values: `not started` · `in progress` · `in review` · `merged` · `blocked`.

## Open questions

| #   | Question                                                                                                                    | Owner | Needed by | Answer                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ----- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Which locales must ship with phase 1 besides `en` and `ar`?                                                                 | user  | PR 5      | English only for now; no Arabic locale exists in the platform. Translation PR for the 18 existing locales is a follow-up (D22). Confirm whether Arabic should be added as a new locale. |
| Q2  | Should project-linked groups appear in the project sidebar in phase 1 or 2? (doc says phase 2)                              | user  | PR 5      |                                                                                                                                                                                         |
| Q3  | Does the deletion task in `bgtasks/deletion_task.py` walk reverse relations that would touch chat rows? (verify in PR 1)    | dev   | PR 1      | No. It skips models without `deleted_at`; a project soft delete only nulls `Conversation.project`. Covered by `test_workspace_soft_delete_leaves_chat_rows`.                            |
| Q4  | Membership-check endpoint for the live server: new `membership-check/` route or reuse `/api/users/me/workspaces/`? (see 03) | dev   | PR 3      | New `GET chat/live/users/<user_id>/access/` with `X-Live-Secret` (built in PR 1).                                                                                                       |

## Blockers

none

## Session log

- **2026-11-03** — Planning complete. Decisions D1–D14 recorded. Docs 00–10 written. Mockups published.
- **2026-11-03** — PR 1 built: models + migration `0125_chat`, REST API (conversations, members, messages, read, attachments, unread, presence, config, live endpoints), Redis publishing, cleanup tasks, S1 fix across all generic asset paths. 117 chat tests. Decisions D15–D20. Test stack note: `minio/minio` is gone from Docker Hub; run tests with an override that uses `cgr.dev/chainguard/minio` (see PR description).
- **2026-11-03** — PR 2 built: `CHAT_*` keys seeded, Superadmin save validates ranges and clears the chat config cache, `config.chat` in `/api/instances/`, new Superadmin → Chat page.
- **2026-11-03** — Integration branch `v1-chat` created; PR 1 and PR 2 merged into it. Every later PR branches from `v1-chat` and merges back.
- **2026-11-03** — PR 3 built: `/live/chat/` socket with cookie auth + API access check, one Redis pattern subscription for user and workspace channels, typing and presence through Redis, heartbeats and periodic access re-checks, health stats. 26 live tests.
- **2026-11-03** — PR 4 built: shared chat types, REST service with direct-to-storage upload, `ChatSocket` (partysocket, heartbeat, terminal close codes, typing throttle), stores for conversations, messages (optimistic sends, gap detection, catch-up, live Seen by), uploads (queue, concurrency 3, retry/cancel, prepare hook) and realtime state; `rootStore.chat` + `useChat()`. vitest added to `apps/web`; 43 tests.
- **2026-11-03** — PR 5 built: chat section (routes, layout, sidebar, Virtuoso thread, composer on the comment editor, new-conversation and add-members modals, details panel), Chat item with unread badge in the app rail, `ChatBootstrap` at workspace level, `chat` i18n namespace (en). Follow-ups: translations (D22), Create work item from message and composer drafts (PR 8).
- **2026-11-03** — PR 6 built: browser-side thumbnails/posters/waveforms, attach button + paste + drag-and-drop with pre-checks, upload tray, attachments in messages (image grid, video tiles, file cards), lazy lightbox, media/files in the details panel.
- **2026-11-03** — PR 7 built: voice recorder (MediaRecorder, Safari mp4 fallback, live meter, review step, hard stop) and waveform player (seek, speed, one at a time) with native APIs instead of wavesurfer.js (D23). 50 web tests.

## Load-test results (PR 8)

| Date | Connections | Msg rate | p95 latency | Live RSS | Result |
| ---- | ----------- | -------- | ----------- | -------- | ------ |
|      |             |          |             |          |        |

## Manual matrix results (PR 8)

Copy the table from `08-testing.md` here with ✅/❌ per browser and the date.
