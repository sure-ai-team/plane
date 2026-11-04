# 08 — Testing

Same tools as phase 1: pytest in Docker (`docker-compose-test.yml`), vitest for web and live, the `surechat` local stack for end-to-end, k6 for load.

## Backend (PR 9) — `plane/tests/contract/app/chat/`

| File                           | Covers                                                                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test_chat_reactions.py`       | Add / idempotent add / remove; 20-emoji limit; invalid emoji; system and deleted messages refused; non-member 404; event published                                    |
| `test_chat_pins.py`            | Pin / unpin; 50 limit; system lines; list order; non-member 404                                                                                                       |
| `test_chat_member_settings.py` | notify level, snooze, star, archive; `?archived=true`; legacy `is_muted` read; `membership.updated` only to self                                                      |
| `test_chat_preferences.py`     | Lazy defaults; validation; event                                                                                                                                      |
| `test_chat_search.py`          | Terms, prefix, phrase, Arabic text; filters (in, from, has, dates); former member and outsider see nothing (P2-S1); snippet escaping (P2-S2); cursor paging; throttle |
| `test_chat_forward.py`         | Multi-target; files copied (new keys); non-member source/target refused; `forwarded_from` visibility (P2-S3); limits                                                  |
| `test_chat_around.py`          | `around_seq` window, edges, mutually exclusive params, non-member                                                                                                     |
| `test_chat_work_item_refs.py`  | Refs extracted on send/edit, removed on edit/delete; `chat-references` endpoint scoping (P2-S5)                                                                       |
| `test_chat_inbox.py`           | Rows per level; one row per direct conversation; read sync; delete removes rows; snooze                                                                               |
| Migration                      | `0126`/`0127` forwards/backwards; mute → `off` mapping                                                                                                                |

Unit: emoji validator, tsquery builder, snippet sanitizer, notify-level resolver.

## Live (PR 9)

`tests/chat/` — the new event types pass through the hub unchanged, and `membership.updated` reaches only that user's sockets.

## Web (PRs 10–16) — vitest

- Stores: reactions (optimistic + rollback), pins, `loadAround`, dock (max 3, persistence, user-keyed), drafts persistence and sign-out clear, notify decision table (every row of `03`), leader election (mocked `BroadcastChannel`), search store paging.
- Helpers: bubble run grouping (5-minute rule), unread divider position, shortcut guard (not while typing).
- Components (testing-library): reaction chips toggle, pinned bar navigation, forward dialog limits, slash menu keyboard, dock window focus/`Esc`.

## End-to-end (surechat stack)

Extend `apps/live/loadtest/chat_smoke.py` with: react, pin, forward with a file, search hit and non-member miss, `around_seq` jump, notify level change syncing to a second socket, an Inbox row created for a mention.

## Manual matrix (PR 16)

Browsers: Chrome, Edge, Firefox, Safari (macOS); Safari iOS, Chrome Android at phone width. Per browser:

- [ ] Reactions, picker, quick reactions
- [ ] Pin bar, panel, jump
- [ ] Reply jump and message link (cold load)
- [ ] Unread divider and pill
- [ ] Search with filters, keyboard navigation
- [ ] Desktop notification + sound + click-through; one tab only
- [ ] Tab title count, favicon dot
- [ ] Composer toolbar, shortcodes, slash commands, draft after reload
- [ ] Dock: 3 windows, minimize, heads, survives navigation and reload
- [ ] Bubbles and compact layouts; DM-only option
- [ ] Share to chat, Discuss in chat, project Chat entry, "Discussed in chat"
- [ ] Phone: list/thread screens, swipe, long-press sheet
- [ ] Offline banner and queued send
- [ ] Keyboard-only pass and screen reader smoke (VoiceOver / NVDA)

## Load (PR 16)

Phase 1 k6 script plus one reaction per 10 messages and one search per user per minute. Budgets unchanged from phase 1 (delivery p95 < 300 ms at 500 connections); search p95 < 300 ms.
