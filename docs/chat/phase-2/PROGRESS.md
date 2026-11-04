# Phase 2 progress

## Status board

| PR  | Title                       | Branch                             | Status    |
| --- | --------------------------- | ---------------------------------- | --------- |
| —   | Mockups                     | design canvas, "Phase 2 — UI & UX" | ✅ done   |
| —   | Spec docs                   | `docs/chat/phase-2/`               | ✅ done   |
| 9   | Backend foundations         | `feat/chat-9-backend-foundations`  | ✅ merged |
| 10  | Thread interactions         | `feat/chat-10-thread-interactions` | ✅ merged |
| 11  | Sidebar, search, navigation | `feat/chat-11-sidebar-search`      | ✅ merged |
| 12  | Notifications               | `feat/chat-12-notifications`       | ✅ merged |
| 13  | Composer                    | `feat/chat-13-composer`            | ✅ merged |
| 14  | Minimized chat and bubbles  | `feat/chat-14-dock-bubbles`        | ✅ merged |
| 15  | Work-item integration       | `feat/chat-15-work-items`          | ✅ merged |
| 16  | Polish, mobile, release     | `feat/chat-16-polish-release`      | ✅ merged |
| 17  | Work-item link fixes        | `feat/chat-17-work-item-links`     | ✅ merged |
| 18  | UI polish, all translations | `feat/chat-18-ui-i18n-polish`      | ✅ merged |
| 19  | Release: load test, docs    | `feat/chat-19-phase2-release`      | ✅ merged |

**Phase 2 is complete on `v2-chat`.** Release notes: [`RELEASE_NOTES.md`](RELEASE_NOTES.md). Upgrade guide: [`DEPLOYMENT.md`](DEPLOYMENT.md).

Left for people, not code:

- **Browser matrix on real browsers and phones.** Chrome (desktop and phone-sized, light and dark, English, German and Japanese) was driven end to end. Firefox, Safari (incl. voice notes and desktop notifications) and real iOS/Android phones still need a manual pass (`08-testing.md`).
- **Staging.** Deploy `v2-chat` to staging, run `DEPLOYMENT.md` § 3, and repeat the load test there.
- **Translation review.** All 18 locales were machine-translated with the repo's translate skill and checked for placeholders, plurals and terminology. A native-speaker pass is still worthwhile, especially it/pl register (informal, matching the rest of those locales), ro "Inbox", ko "archive", and "Chat heads".
- **Merging into `main` and pushing** are the owner's call (phase 1's `v1-chat` was not merged either).

## Open questions

All answered on 2026-11-03: the user accepted every default below (decisions P2-D1–P2-D14 are now locked).

| #     | Question                                                  | Answer                  |
| ----- | --------------------------------------------------------- | ----------------------- |
| P2-Q1 | Reactions: any emoji (P2-D1) or a fixed set of 6?         | Any emoji               |
| P2-Q2 | Pins: any member (P2-D2) or group admins only?            | Any member              |
| P2-Q3 | Offer both minimize styles (P2-D10) or docked tabs only?  | Both, docked by default |
| P2-Q4 | Bubbles default: DMs only (P2-D11) or everywhere?         | DMs only                |
| P2-Q5 | Archive sticky (P2-D8) or unarchive on new message?       | Sticky                  |
| P2-Q6 | Cut `v2-chat` from `v1-chat` now, or after phase 1 ships? | From `v1-chat` now      |

## Session log

- **2026-11-03** — Scope agreed (A–G, in-app + desktop notifications, mockups first). Mockups added as the "Phase 2 — UI & UX" page (11 boards, including minimized chat and bubbles). Spec set written (`00`–`10`, decisions, this file).
- **2026-11-03** — User accepted all defaults (P2-Q1–Q6); decisions locked. `v2-chat` cut from `v1-chat`.
- **2026-11-04** — PR 9 built and merged into `v2-chat`: migrations `0126_chat_phase2` + `0127_chat_search_index` (verified forward/reverse/forward on the `surechat` copy's phase 1 data: mute → `off`, groups → `mentions`, messages intact), reactions, pins, per-chat settings, preferences, search, forward with file copies, `around_seq` + single-message GET, work-item references, Inbox task. Backend suite **874 passed** (789 before). Live API check on `surechat`: reactions, pins, search highlight, preferences, unread counts. Spec corrections: work items are referenced by links (no embed node in this editor), separate index migration, event `membership.updated`, socket message payloads omit reactions.
- **2026-11-04** — PR 10 merged into `v2-chat`: reactions (chips with names, four quick reactions, shared emoji picker), hover toolbar (React, Reply, Pin, Forward, More), pinned bar + panel, reply jump with highlight, message links (`?m=`), loading around an older message with paging forward and "Jump to latest", "New" divider + jump pill, forward dialog and forwarded header. Web tests 64 (51 before), type check and lint clean, production build OK; deployed to the `surechat` copy for browser testing.
- **2026-11-04** — PR 11 merged into `v2-chat`: sidebar filters (All / Unread / Mentions), Starred / Groups / Direct sections (collapsible, remembered), star and archive (archived list, sticky), mention badge, draft line, row menu, star in the thread header; drafts persisted per user + workspace and cleared on sign-out; message search page (`/chat/search`, filters in the URL, grouped results, context pane, keyboard); Power K commands and an "Open a conversation" page; shortcuts + `?` sheet; group About (icon + description). Web tests 76, type check and lint clean, deployed to `surechat`. Deferred: "last seen" for direct chats (no API data).
- **2026-11-04** — PR 12 merged into `v2-chat`: per-chat level (All / Mentions only / Off) + snooze in the thread header; Chat settings dialog (desktop notifications, sound, preview, chat in Inbox) with the browser-permission banner; desktop notifications decided client-side (one leader tab via BroadcastChannel, tagged per conversation, click opens the message), Web Audio chime; unread count in the tab title and a favicon dot for mentions; chat rows in the Inbox (backend list now includes `chat_message`; mentions use `sender = "chat_mentioned"`; `message_html` escaped). Web tests 96, backend inbox tests 8.
- **2026-11-04** — PR 13 merged into `v2-chat`: composer formatting toolbar (reuses the comment editor's items), emoji button, `:shortcode` suggestions, slash commands (`/workitem` creates a work item and inserts its link, `/link` picks existing ones workspace-wide, `/mute`, `/code`, `/shrug`); suggestions take ↑ ↓ Enter/Tab Esc before the editor sees them. Web tests 102.
- **2026-11-04** — PR 14 merged into `v2-chat`: dock on every non-chat page (≥ 768 px): up to 3 windows (bubbles, typing, full composer), minimized tabs or chat heads, launcher with total unread and a quick list; persisted per user + workspace and cleared on sign-out; desktop-notification clicks open a dock window when you're on another page; open windows suppress notifications for their conversation. Bubbles layout (mine on the right) with the Message layout / DMs-only / Minimize style settings. Web tests 108. Deferred: dragging chat heads.
- **2026-11-04** — PR 15 merged into `v2-chat`: rich work-item cards under messages (state, priority, due date, assignee, sub-items; details through the existing work-item API, batched per project; a plain chip when not visible), Share to chat and Discuss in chat in the work-item header (this project's groups first; Discuss opens a dock window or the chat page with the link ready), "Discussed in chat" above the activity, and a project "Chat" entry that filters chat to the project's groups. Web tests 111.
- **2026-11-04** — PR 16 code merged into `v2-chat`: phone layout (back button, full-screen details and pins), swipe on rows (Mute / Archive), long-press message sheet, first-visit and new-conversation empty states, offline banner with queued sends that go out on reconnect, media gallery, screen-reader announcements and reduced motion; smoke script extended with reactions, pins, jump, search, forward, settings sync and Inbox checks. Web tests 113. Still to do: run the smoke script, the load test and the browser matrix (Docker Desktop has stopped responding), then release notes and merging `v2-chat`.
- **2026-11-04** — End-to-end smoke test on the rebuilt `surechat` copy (all of phase 2, fresh workspace `chat-smoke-p2` via `SMOKE_SLUG`): **59/59 passed** — the 43 phase 1 checks plus reactions live, pins live, jump (`around_seq`), search hit and outsider miss, forward with an independent file copy, notify level + settings sync to other tabs, preferences, mention reaching the Inbox through the worker. Delivery 61 ms incl. HTTP. Fixed before the run: emoji picker lost its anchor when the hover toolbar hid, and its list didn't scroll.
- **2026-11-04** — PR 17 merged: work-item links. The composer's insert did nothing with a plain cursor (`/link`, `/workitem`, emoji button, `/shrug`) — now inserts at the cursor; bare keys (`MOB-12`) and pasted work-item URLs create references (upper-case keys that exist, code blocks ignored); archived work items show a card with an "Archived" badge; cards refresh after a minute; Discuss in chat updates an already-open composer.
- **2026-11-04** — PR 18 merged: browser review of the chat (desktop, phone, dark; en/de/ja) and fixes — member pickers were always empty (stale memo; members now loaded by the chat bootstrap), pin/unpin events showed raw keys (now text + Jump), search context shows system events and attachment-only messages properly, previews show work-item keys instead of URLs, empty state has an action, phone header has room for the name. Localisation: chat dates follow the app language; priority and toolbar label translated; **all 18 locales translated** (344 keys + 4 Power K keys, both trees, `sync-check` clean). Web tests 120.
- **2026-11-04** — PR 19 merged: release. Backend suite **877 passed**; web 120; smoke test **59/59** on the rebuilt copy (fresh workspace `chat-smoke-final`). First load test run (k6, 500 sockets, 20 msg/s + reactions + searches, 3 min): with the default 2 API workers delivery p95 was 2.46 s; with 8 workers **delivery p95 135 ms, search p95 136 ms, 0 errors, live 210 MB** — all budgets met. Fixed the k6 script (sockets and sends piled onto a few users and hit the per-user caps), added `ORIGIN`, reactions and searches. Wrote `RELEASE_NOTES.md` and the upgrade guide `DEPLOYMENT.md` (worker sizing, migrations, smoke test, rollback).
- **2026-11-04** — PR 20 merged: component-level polish from a close-up review (desktop, phone, light and dark, every interaction state). Fixed: image tiles collapsed to a sliver for tiny or broken images (now a 160 px floor and an icon + filename placeholder, also in the details panel and gallery); voice notes in my bubble were a white card inside a blue frame (now flat on the bubble); other people's bubbles stretched to the full 78 % width (now shrink to their text); editing a message in bubble layout lost its grouping (now a neutral wide bubble). Web tests 120.
