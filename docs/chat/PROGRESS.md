# Progress

Update at the end of every working session. Keep it short; details live in the PRs.

## Status board

| PR                  | Branch                          | Status      | Opened | Merged | Notes |
| ------------------- | ------------------------------- | ----------- | ------ | ------ | ----- |
| 1 Backend core      | `feat/chat-1-backend-core`      | not started |        |        |       |
| 2 Superadmin config | `feat/chat-2-superadmin-config` | not started |        |        |       |
| 3 Real-time         | `feat/chat-3-realtime`          | not started |        |        |       |
| 4 Web data layer    | `feat/chat-4-web-data-layer`    | not started |        |        |       |
| 5 Chat UI: text     | `feat/chat-5-ui-text`           | not started |        |        |       |
| 6 Attachments UI    | `feat/chat-6-ui-attachments`    | not started |        |        |       |
| 7 Voice notes       | `feat/chat-7-voice-notes`       | not started |        |        |       |
| 8 Hardening         | `feat/chat-8-hardening`         | not started |        |        |       |

Status values: `not started` · `in progress` · `in review` · `merged` · `blocked`.

## Open questions

| #   | Question                                                                                                                    | Owner | Needed by | Answer |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ----- | --------- | ------ |
| Q1  | Which locales must ship with phase 1 besides `en` and `ar`?                                                                 | user  | PR 5      |        |
| Q2  | Should project-linked groups appear in the project sidebar in phase 1 or 2? (doc says phase 2)                              | user  | PR 5      |        |
| Q3  | Does the deletion task in `bgtasks/deletion_task.py` walk reverse relations that would touch chat rows? (verify in PR 1)    | dev   | PR 1      |        |
| Q4  | Membership-check endpoint for the live server: new `membership-check/` route or reuse `/api/users/me/workspaces/`? (see 03) | dev   | PR 3      |        |

## Blockers

none

## Session log

- **2026-11-03** — Planning complete. Decisions D1–D14 recorded. Docs 00–10 written. Mockups published. No code yet.

## Load-test results (PR 8)

| Date | Connections | Msg rate | p95 latency | Live RSS | Result |
| ---- | ----------- | -------- | ----------- | -------- | ------ |
|      |             |          |             |          |        |

## Manual matrix results (PR 8)

Copy the table from `08-testing.md` here with ✅/❌ per browser and the date.
