# 09 — PR checklists (definition of done)

Integration branch `v2-chat`. Branches `feat/chat-<n>-<slug>`. Each PR ticks its list, updates [PROGRESS.md](PROGRESS.md), and keeps the backend, live and web suites green.

## PR 9 — Backend foundations (L)

Branch `feat/chat-9-backend-foundations`

- [x] Models + migrations `0126_chat_phase2` and `0127_chat_search_index` per `01` (concurrent GIN index, mute data migration, reversible)
- [x] Serializers: reactions summary, `is_pinned`, `forwarded_from` (per viewer), `work_items`, member settings, preferences
- [x] Endpoints per `02`: `around_seq`, reactions, pins, `conversations/<id>/me/`, `?archived=true`, group description/logo, preferences, search, forward, `chat-references`
- [x] `services`: work-item ref extraction on send/edit; pin system lines; Inbox Celery task + read sync + delete cleanup
- [x] Per-recipient payloads for forwarded messages (`services.publish_message`); new events per `03`; the live server relays any event type, so it needed no change
- [x] Throttles `chat_react`, `chat_search`, `chat_pin`
- [x] Tests in `08` § Backend and § Live; `07` checklist ticked
- [x] `packages/types` updated

## PR 10 — Thread interactions (L)

Branch `feat/chat-10-thread-interactions`

- [x] Reaction chips, quick reactions, shared emoji picker (the platform's `frimousse` picker via `@plane/propel`'s `EmojiRoot`; its emoji data loads on first open)
- [x] Hover toolbar: React, Reply, Pin, Forward, Copy link, More
- [x] Pinned bar + pinned panel
- [x] Reply jump + highlight; message links (`?m=`) with `loadAround`
- [x] Unread divider + jump pill (`Shift+J` moves to PR 11 with the other shortcuts)
- [x] Forward dialog + forwarded header; "(edited)"
- [x] Store tests; i18n keys

## PR 11 — Sidebar, search, navigation (M–L)

Branch `feat/chat-11-sidebar-search`

- [x] Filters, sections, star, archive + archived list, mention badge, row context menu ("last seen" deferred: the API has no last-seen time yet; presence dots stay)
- [x] Drafts persisted per user + sidebar draft line; cleared on sign-out
- [x] Search route with filters, grouped results, context pane, keyboard nav, URL state
- [x] Power K: "Go to chat" (`G T`; `G C` is cycles), "Open a conversation" (`O T`), "Search chat messages"; shortcuts + `?` sheet (Alt+↑/↓, Alt+Shift+↓, Ctrl+Shift+F, ↑ edit last, Esc, Shift+J)
- [x] Group description/logo editing in details

## PR 12 — Notifications (M)

Branch `feat/chat-12-notifications`

- [x] Level popover + snooze in the thread header and row menu
- [x] Chat settings dialog (sidebar gear; per workspace, so not in profile settings) + permission banner
- [x] Desktop notifications with leader tab, sound, preview toggle, click-through
- [x] Tab title count + favicon dot
- [x] Inbox: list endpoint includes `chat_message`; mentions under Mentions (`sender = "chat_mentioned"`); chat card opens the message
- [x] Decision-table tests

## PR 13 — Composer (M)

Branch `feat/chat-13-composer`

- [x] Formatting toolbar on `LiteTextEditor` (the comment editor's own items and commands; toggled with the Aa button, remembered)
- [x] Emoji button (shared picker) + `:shortcode` suggestions (built-in list of common names; ↑ ↓ Enter/Tab Esc)
- [x] Slash commands `/workitem` (create + insert link), `/link` (workspace-wide work-item picker), `/mute`, `/code`, `/shrug`
- [x] Lists, quotes and code blocks render in the compact layout (bubbles layout checked in PR 14)

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
