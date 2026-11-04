# Workspace chat — phase 2 (UI and UX)

Read in order. Phase 1 docs are one level up (`docs/chat/`). Their decisions still apply.

| File                                       | What it covers                                                     |
| ------------------------------------------ | ------------------------------------------------------------------ |
| [00-overview.md](00-overview.md)           | Scope, what changes where, PR plan, risks, definition of done      |
| [01-data-model.md](01-data-model.md)       | Migrations `0126`/`0127`: new tables, changed fields, search index |
| [02-api-contracts.md](02-api-contracts.md) | New and changed endpoints, payloads, throttles                     |
| [03-realtime.md](03-realtime.md)           | New live events; client-side desktop notification decision         |
| [04-frontend.md](04-frontend.md)           | Stores and every UI feature, mapped to the mockup boards           |
| [05-notifications.md](05-notifications.md) | Levels, Inbox entries, desktop notifications, tab title            |
| [06-search.md](06-search.md)               | Postgres full-text design, query shape, performance budget         |
| [07-security.md](07-security.md)           | New threats P2-S1… and per-PR checklist                            |
| [08-testing.md](08-testing.md)             | Backend, live, web, end-to-end, manual matrix, load                |
| [09-pr-checklists.md](09-pr-checklists.md) | PR 9–16 definition of done                                         |
| [10-i18n-keys.md](10-i18n-keys.md)         | New `chat.*` string inventory                                      |
| [DECISIONS.md](DECISIONS.md)               | P2-D0… (locked vs proposed)                                        |
| [PROGRESS.md](PROGRESS.md)                 | Status board, open questions, session log                          |

Mockups: _SURE Workspace Chat_ canvas → page "Phase 2 — UI & UX" (https://claude.ai/artifact/Pqw2s7Wc5uEq2PEC3ch3Ae).
