# 09 — PR checklists (definition of done)

Integration branch `v2-chat`. Branches `feat/chat-<n>-<slug>`. Each PR ticks its list, updates [PROGRESS.md](PROGRESS.md), and keeps the backend, live and web suites green.

## PR 9 — Backend foundations (L)

Branch `feat/chat-9-backend-foundations`

- [ ] Models + migration `0126_chat_phase2` per `01` (concurrent GIN index, mute data migration, reversible)
- [ ] Serializers: reactions summary, `is_pinned`, `forwarded_from` (per viewer), `work_items`, member settings, preferences
- [ ] Endpoints per `02`: `around_seq`, reactions, pins, `conversations/<id>/me/`, `?archived=true`, group description/logo, preferences, search, forward, `chat-references`
- [ ] `services`: work-item ref extraction on send/edit; pin system lines; Inbox Celery task + read sync + delete cleanup
- [ ] `publish_chat_event` per-user payload hook; new events per `03`; live `types.ts` updated
- [ ] Throttles `chat_react`, `chat_search`, `chat_pin`
- [ ] Tests in `08` § Backend and § Live; `07` checklist ticked
- [ ] `packages/types` updated

## PR 10 — Thread interactions (L)

Branch `feat/chat-10-thread-interactions`

- [ ] Reaction chips, quick reactions, shared emoji picker (lazy data)
- [ ] Hover toolbar: React, Reply, Pin, Forward, Copy link, More
- [ ] Pinned bar + pinned panel
- [ ] Reply jump + highlight; message links (`?m=`) with `loadAround`
- [ ] Unread divider + jump pill + `Shift+J`
- [ ] Forward dialog + forwarded header; "(edited)"
- [ ] Store tests; i18n keys

## PR 11 — Sidebar, search, navigation (M–L)

Branch `feat/chat-11-sidebar-search`

- [ ] Filters, sections, star, archive + archived list, mention badge, last seen, row context menu
- [ ] Drafts persisted per user + sidebar draft line; cleared on sign-out
- [ ] Search route with filters, grouped results, context pane, keyboard nav, URL state
- [ ] Power K chat group; shortcuts + `?` sheet
- [ ] Group description/logo editing in details

## PR 12 — Notifications (M)

Branch `feat/chat-12-notifications`

- [ ] Level popover + snooze in the thread header and row menu
- [ ] Profile → Chat preferences section + permission banner
- [ ] Desktop notifications with leader tab, sound, preview toggle, click-through
- [ ] Tab title count + favicon dot
- [ ] Inbox rendering of `chat_message` rows + detail pane
- [ ] Decision-table tests

## PR 13 — Composer (M)

Branch `feat/chat-13-composer`

- [ ] Formatting toolbar on `LiteTextEditor`
- [ ] Emoji button + `:shortcode` suggestions
- [ ] Slash commands `/workitem`, `/link`, `/mute`, `/code`, `/shrug`
- [ ] Rendering check for lists, quotes and code blocks in both layouts

## PR 14 — Minimized chat and bubbles (M)

Branch `feat/chat-14-dock-bubbles`

- [ ] `dock/` windows (max 3), minimized tabs, launcher, chat heads option
- [ ] Persistence keyed by user + workspace; hidden on chat routes and < 768 px
- [ ] Bubbles layout with run grouping; preference + DM-only option; dock uses bubbles
- [ ] Focus management and `Esc`

## PR 15 — Work-item integration (M)

Branch `feat/chat-15-work-items`

- [ ] Rich work-item card with permission fallback; batched cache
- [ ] Share to chat dialog; Discuss in chat → dock window
- [ ] Project navigation "Chat" entry
- [ ] "Discussed in chat" section on the work-item page

## PR 16 — Polish, mobile, release (M)

Branch `feat/chat-16-polish-release`

- [ ] Phone layouts, swipe actions, long-press sheet
- [ ] Skeletons, empty states, offline banner and queued sends
- [ ] Media gallery view
- [ ] Accessibility pass
- [ ] Smoke script extended; load test; manual matrix in `PROGRESS.md`
- [ ] Release notes; merge `v2-chat`
