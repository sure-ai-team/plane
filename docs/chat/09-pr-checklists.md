# 09 — PR checklists (definition of done)

Branch naming: `feat/chat-<n>-<slug>` (use the `branch-name` skill). PR title prefix per repo convention (`create-pull-request` skill). Each PR links back to this folder and ticks its list in the description.

## PR 1 — Backend core (L)

Branch `feat/chat-1-backend-core`

- [x] `db/models/chat.py` per `01` (ChatBaseModel, 4 models, enums, constraints, indexes); exported in `db/models/__init__.py`
- [x] `FileAsset`: `CHAT_ATTACHMENT`, `chat_message`, `chat_conversation`, `asset_url` branch
- [x] Migration `0125_chat` applies and reverses cleanly
- [x] `app/serializers/chat.py` producing exactly the shapes in `02`
- [x] `app/views/chat/` + `app/urls/chat.py` — every endpoint in `02`, including attachments and `member-ids`
- [x] `app/views/chat/services.py`: `send_message`, `get_membership_or_403`, preview builder, mention parser
- [x] `plane/utils/chat_events.py` `publish_chat_event` (pipeline, on_commit)
- [x] `plane/utils/chat_config.py` with defaults (config page itself is PR 2)
- [x] `throttles/chat.py` + rates registered
- [x] `bgtasks/chat_cleanup_task.py`: `delete_chat_objects`, `purge_orphan_chat_uploads`; beat schedule (membership deactivation dropped, D15)
- [x] **S1 fix** in `asset/v2.py` (both endpoints) + regression test
- [x] `filetype` in `requirements/base.txt`
- [x] All tests in `08` § Backend (unit + contract) green in Docker; the end-to-end flow lives in the contract tests rather than a separate smoke file
- [x] `07` per-PR checklist ticked
- [x] `PROGRESS.md` updated

## PR 2 — Superadmin config (S)

Branch `feat/chat-2-superadmin-config`

- [x] Keys seeded in `configure_instance.py` per `06`
- [x] Cache + invalidation on the config PATCH (no signal needed)
- [x] `ChatBaseEndpoint` returns 404 `CHAT_DISABLED` for every chat view (done in PR 1); live server honours it in PR 3
- [x] Public instance payload exposes `config.chat`
- [x] Admin page `/superadmin/chat/` with validation and toast; sidebar entry
- [x] English copy (admin app has no i18n)
- [x] `contract/app/test_chat_config_admin.py` green
- [x] `PROGRESS.md` updated

## PR 3 — Real-time (M)

Branch `feat/chat-3-realtime`

- [x] `controllers/chat.controller.ts` + `chat/{registry,redis-bridge,presence,typing}.ts` per `03`
- [x] Registered in `CONTROLLERS`; health endpoint extended
- [x] Origin check, per-user socket cap, membership re-check timer
- [x] `member-ids` call uses `X-Live-Secret`
- [x] Vitest suites in `08` § Live server green
- [ ] Manual: two browsers exchange messages; presence and typing visible (needs the web UI from PR 5; covered by unit tests with a fake Redis until then)
- [x] `PROGRESS.md` updated

## PR 4 — Web data layer (M)

Branch `feat/chat-4-web-data-layer`

- [x] `packages/types/src/chat/*` (shapes = `02` + `03`)
- [x] `chat.service.ts`, `chat-socket.ts` (partysocket, catch-up, ping/pong)
- [x] Four stores registered on `RootStore`; `applyEvent` router
- [x] Vitest suites in `08` § Web green
- [x] Catalog entries: `partysocket` 1.3.0 added; `vitest` (already in the catalog) added to `apps/web`. `react-virtuoso`, `wavesurfer.js` and `yet-another-react-lightbox` are added in the PRs that use them
- [x] `PROGRESS.md` updated

## PR 5 — Chat UI: text (M)

Branch `feat/chat-5-ui-text`

- [ ] Routes + `(chat)/layout.tsx`; gated by `CHAT_ENABLED` and role
- [ ] App rail item with badge (`AppSidebarItem.badge`)
- [ ] Sidebar (groups, directs, quick links, footer)
- [ ] Thread: header, Virtuoso list, day dividers, grouping, system messages, "new messages" pill, mark-read hook
- [ ] Composer (text only): editor wrapper, mention + work-item pickers, Enter/Shift+Enter
- [ ] Message hover toolbar: Reply, Create work item, Edit, Delete, Copy link
- [ ] New-conversation modal, members modal, delete-group modal, details panel (members tab)
- [ ] Shared components + stories: `MessageItem`, `MessageGroup`, `DayDivider`, `SystemMessage`, `TypingIndicator`, `PresenceDot`, `ConversationListItem`, `UnreadBadge`
- [ ] `chat.json` keys from `10` in **both** locale trees (en + ar at minimum; others via translate skill)
- [ ] Matches mockup; RTL and dark checked in Storybook
- [ ] `PROGRESS.md` updated

## PR 6 — Attachments UI (M)

Branch `feat/chat-6-ui-attachments`

- [ ] `upload.store` wired to composer; paste + drop; tray with progress/cancel/retry/errors
- [ ] `image-thumb.ts`, `video-poster.ts`
- [ ] `AttachmentGrid`, `FileCard`, `VideoTile`, `UploadTray` + stories
- [ ] Lightbox (lazy) with zoom + video
- [ ] Details panel: media + files tabs
- [ ] Client-side size pre-check from `config.chat`
- [ ] Manual matrix rows for images/video/files in all four browsers
- [ ] `PROGRESS.md` updated

## PR 7 — Voice notes (S)

Branch `feat/chat-7-voice-notes`

- [ ] `VoiceRecorder`, `VoiceNotePlayer` + stories (wavesurfer.js + record plugin)
- [ ] `waveform.ts`; MIME preference incl. Safari `audio/mp4`
- [ ] Hard stop at `CHAT_MAX_VOICE_SECONDS`; permission-denied toast
- [ ] Single-player-at-a-time; playback rates
- [ ] Manual matrix voice rows in all four browsers
- [ ] `PROGRESS.md` updated

## PR 8 — Hardening (S)

Branch `feat/chat-8-hardening`

- [ ] Load test script + results recorded in `PROGRESS.md`
- [ ] Range-request check through Caddy
- [ ] Full manual matrix in `08` completed and recorded
- [ ] `07` release gate completed
- [ ] `pnpm audit --prod`, `pip-audit`
- [ ] `README.md` (repo) feature list mentions Chat; `docs/chat/00-overview.md` status → "shipped"
- [ ] `PROGRESS.md` updated
