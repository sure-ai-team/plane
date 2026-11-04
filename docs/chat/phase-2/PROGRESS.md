# Phase 2 progress

## Status board

| PR  | Title                       | Branch                             | Status                       |
| --- | --------------------------- | ---------------------------------- | ---------------------------- |
| —   | Mockups                     | design canvas, "Phase 2 — UI & UX" | ✅ done                      |
| —   | Spec docs                   | `docs/chat/phase-2/`               | ✅ done                      |
| 9   | Backend foundations         | `feat/chat-9-backend-foundations`  | ✅ merged                    |
| 10  | Thread interactions         | `feat/chat-10-thread-interactions` | ✅ merged                    |
| 11  | Sidebar, search, navigation | `feat/chat-11-sidebar-search`      | ✅ merged                    |
| 12  | Notifications               | `feat/chat-12-notifications`       | ✅ merged                    |
| 13  | Composer                    | `feat/chat-13-composer`            | ✅ merged                    |
| 14  | Minimized chat and bubbles  | `feat/chat-14-dock-bubbles`        | ✅ merged                    |
| 15  | Work-item integration       | `feat/chat-15-work-items`          | ✅ merged                    |
| 16  | Polish, mobile, release     | `feat/chat-16-polish-release`      | 🟡 code merged; runs pending |

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
