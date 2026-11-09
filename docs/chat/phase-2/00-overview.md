# Phase 2 — Chat UI and UX: overview

Phase 1 (docs in `docs/chat/`) shipped working chat: 1:1 and group conversations, mentions, replies, edit/delete, unread counts, "Seen by", typing, presence, attachments and voice notes. Phase 2 makes it pleasant to use every day and connects it to the rest of the platform.

Mockups: the **"Phase 2 — UI & UX"** page of the _SURE Workspace Chat_ design canvas (https://claude.ai/artifact/Pqw2s7Wc5uEq2PEC3ch3Ae). Board names are referenced as `[P2Thread]`, `[P2Search]` etc. throughout these docs.

## 1. Scope

Phase 1 decisions still hold (hard delete, members only, no calls, fewer than 500 users online, no UI kit). New decisions are in [DECISIONS.md](DECISIONS.md) as P2-D1 onwards.

| Theme                        | What ships                                                                                                                                                   | Mockup                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| **A. Message interactions**  | Emoji reactions; jump to the original of a reply; links to a single message; forward; pinned messages (bar + panel); "(edited)" marker                       | P2Thread, P2MobileThread     |
| **B. Find and navigate**     | Message search (workspace-wide and per conversation, with filters); "New messages" divider and "Jump to first unread"; Power K; keyboard shortcuts           | P2Thread, P2Search, P2PowerK |
| **C. Notifications**         | Mentions and direct messages in the Inbox; desktop notifications with sound; unread count in the tab title; per-chat level (All / Mentions / Off) and snooze | P2Notify                     |
| **D. Composer**              | Formatting toolbar; emoji picker and `:shortcode` suggestions; slash commands; drafts that survive a reload and show in the sidebar                          | P2Composer                   |
| **E. Sidebar organization**  | Starred section; All / Unread / Mentions filters; archive; group avatar and description                                                                      | P2Thread, P2MobileList       |
| **F. Work-item integration** | Rich work-item cards; Share to chat; Discuss in chat; Chat in project navigation; "Discussed in chat" on work items                                          | P2Project                    |
| **G. Polish and mobile**     | Narrow and phone layouts; swipe and long-press actions; loading, empty and offline states; accessibility pass; media gallery per conversation                | P2States, P2Mobile\*         |
| **Minimized chat**           | Docked chat windows (and optional chat heads) that stay open while you work on other pages                                                                   | P2Docked                     |
| **Message layout**           | Bubbles layout (yours on the right) as an alternative to the compact layout, per-user setting                                                                | P2Bubbles                    |

### Not in phase 2

- Web push when no tab is open (service worker + VAPID). Notifications only fire while a tab is open (P2-D4).
- Email digests, link previews (server-side URL fetching), server-side video conversion, custom status, `/remind` reminders. Revisit after phase 2 ships.
- Message threads (Slack-style side threads). Replies stay inline quotes.
- A native mobile app. "Mobile" means the responsive web app.

## 2. What changes where

```
apps/api      new tables (reactions, pins, work-item refs, chat preferences), member fields (notify level,
              snooze, star, archive), search index, ~14 endpoints, Inbox notifications, forward
apps/live     relays new event types only (no protocol change): reaction.*, pin.*, membership.updated, preferences.updated
apps/web      most of the work: thread interactions, sidebar, search page, composer, notifications,
              dock + bubbles, work-item integration, responsive layouts
packages/i18n new keys in the "chat" namespace (English; other locales per D22)
packages/types new types for reactions, pins, preferences, search results
```

No new services. Search uses Postgres full-text search (P2-D3). Desktop notifications use the browser's Notification API from the open page.

## 3. PR plan

Integration branch: **`v2-chat`**, cut from `v1-chat` after phase 1 is released (or from `v1-chat` directly if phase 1 is still unreleased; then `v2-chat` merges after `v1-chat`). Every phase 2 PR branches from `v2-chat` and merges back.

| PR  | Title                       | Size | Depends on | Contents                                                                                                                    |
| --- | --------------------------- | ---- | ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| 9   | Backend foundations         | L    | —          | Migrations `0126_chat_phase2` + `0127_chat_search_index`, all new endpoints and events, search, forward, Inbox hooks, tests |
| 10  | Thread interactions         | L    | 9          | Reactions + picker, hover toolbar, pins, reply jump, message links, unread divider, forward UI                              |
| 11  | Sidebar, search, navigation | M–L  | 9          | Sections, filters, star/archive, persisted drafts, search page, Power K, shortcuts                                          |
| 12  | Notifications               | M    | 9          | Per-chat level + snooze UI, preferences, desktop notifications, sound, tab title, Inbox entries                             |
| 13  | Composer                    | M    | 9          | Formatting toolbar, emoji picker + shortcodes, slash commands                                                               |
| 14  | Minimized chat and bubbles  | M    | 9, 10      | Dock windows, chat heads, bubbles layout, layout preference                                                                 |
| 15  | Work-item integration       | M    | 9, 14      | Work-item refs, rich cards, Share to chat, Discuss in chat (opens the dock), project nav, "Discussed in chat"               |
| 16  | Polish, mobile, release     | M    | all        | Responsive layouts, swipe/long-press, states, a11y audit, media gallery, load + browser matrix                              |

PRs 10–13 can run in parallel once PR 9 merges. Checklists: [09-pr-checklists.md](09-pr-checklists.md).

## 4. Risks

| Risk                                                                  | Mitigation                                                                                                      |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Search slows down as messages grow                                    | GIN index on a `tsvector` expression, membership filter first, 50-result pages, `EXPLAIN` checked in tests (06) |
| Inbox UI assumes every notification is a work item                    | New `entity_name = "chat_message"` branch in the Inbox list and detail; covered in PR 12 tests                  |
| Reactions and pins add event volume                                   | Events are small and per-member like phase 1; reactions coalesced client-side; load test re-run in PR 16        |
| Forwarding copies files                                               | Server-side `copy_object` (no download/upload); counts against the sender's limits; hard delete stays per copy  |
| Docked windows and the full chat page both open the same conversation | One shared store per conversation; the dock hides a conversation that's open in the full page                   |
| Desktop notification permission denied                                | Clear in-app warning with "How to allow"; everything else still works                                           |
| Bubbles layout and accessibility                                      | Same DOM order and roles in both layouts; layout is CSS only; screen-reader text includes the sender            |

## 5. Definition of done (phase 2)

- Every item in the scope table works in Chrome, Edge, Firefox and Safari (desktop) and Safari iOS / Chrome Android at phone width.
- Backend and web test suites green; new contract tests for every endpoint in `02`.
- Load test (phase 1 k6 script plus reactions and search) within the phase 1 budgets.
- English strings in both locale trees (memory: runtime loads `packages/i18n/locales`); other locales `{}` per D22.
- `PROGRESS.md` (this folder) updated; release notes drafted.
