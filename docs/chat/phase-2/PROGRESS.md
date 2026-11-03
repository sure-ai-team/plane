# Phase 2 progress

## Status board

| PR  | Title                       | Branch                             | Status      |
| --- | --------------------------- | ---------------------------------- | ----------- |
| —   | Mockups                     | design canvas, "Phase 2 — UI & UX" | ✅ done     |
| —   | Spec docs                   | `docs/chat/phase-2/`               | ✅ done     |
| 9   | Backend foundations         | `feat/chat-9-backend-foundations`  | not started |
| 10  | Thread interactions         | `feat/chat-10-thread-interactions` | not started |
| 11  | Sidebar, search, navigation | `feat/chat-11-sidebar-search`      | not started |
| 12  | Notifications               | `feat/chat-12-notifications`       | not started |
| 13  | Composer                    | `feat/chat-13-composer`            | not started |
| 14  | Minimized chat and bubbles  | `feat/chat-14-dock-bubbles`        | not started |
| 15  | Work-item integration       | `feat/chat-15-work-items`          | not started |
| 16  | Polish, mobile, release     | `feat/chat-16-polish-release`      | not started |

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
