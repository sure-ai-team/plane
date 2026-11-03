# Workspace Chat — documentation set

Everything needed to build, review and maintain the chat feature. Read in order the first time; afterwards jump to the file for the area you're touching.

| #   | File                                                       | What it holds                                                                         | Read before                  |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------- |
| 00  | [00-overview.md](00-overview.md)                           | Scope, locked decisions, architecture, stack, delivery order, risks                   | Any chat work                |
| 01  | [01-data-model.md](01-data-model.md)                       | Exact Django models, field types, constraints, indexes, migration notes               | PR 1                         |
| 02  | [02-api-contracts.md](02-api-contracts.md)                 | Every endpoint with request/response JSON, status codes, error shapes                 | PR 1, 4                      |
| 03  | [03-realtime-protocol.md](03-realtime-protocol.md)         | Socket URL, auth, event payloads, Redis channels, reconnect rules                     | PR 3, 4                      |
| 04  | [04-attachments-and-media.md](04-attachments-and-media.md) | Upload flow, limits, MIME allow-lists, thumbnails, posters, waveform format, deletion | PR 1, 6, 7                   |
| 05  | [05-frontend.md](05-frontend.md)                           | Routes, stores, components, props, file layout, UX rules                              | PR 4–7                       |
| 06  | [06-superadmin-config.md](06-superadmin-config.md)         | `CHAT_*` instance config keys, defaults, admin page                                   | PR 2                         |
| 07  | [07-security.md](07-security.md)                           | Threat list and the checklist each PR must satisfy                                    | Every PR                     |
| 08  | [08-testing.md](08-testing.md)                             | Test matrix per layer, fixtures, commands, release checks                             | Every PR                     |
| 09  | [09-pr-checklists.md](09-pr-checklists.md)                 | Definition of done for each of the 8 PRs                                              | Opening/reviewing a PR       |
| 10  | [10-i18n-keys.md](10-i18n-keys.md)                         | The full `chat.*` translation key list                                                | PR 5–7                       |
| —   | [DECISIONS.md](DECISIONS.md)                               | Decision log (why, alternatives rejected)                                             | Before changing any decision |
| —   | [PROGRESS.md](PROGRESS.md)                                 | Live status per PR, open questions, blockers                                          | Start of every session       |
| —   | [DEPLOYMENT.md](DEPLOYMENT.md)                             | Deploy steps, smoke test, proxy upload note, rollback, running backend tests          | Deploying                    |

## Rules for this folder

1. **Docs are the contract.** If code and docs disagree, fix one in the same PR; never leave them diverging.
2. **A new decision goes into `DECISIONS.md` first**, then the affected doc is updated.
3. **`PROGRESS.md` is updated at the end of every working session**, even for partial work.
4. Field names, endpoint paths and event names in these docs are final. Changing one means updating `01`, `02`, `03` and `05` together.
5. UI mockups: https://claude.ai/artifact/Pqw2s7Wc5uEq2PEC3ch3Ae (private artifact; the visual spec summary is in `05-frontend.md` § Visual spec).

## Repo conventions that apply (from `AGENTS.md`)

- `pnpm check` must pass (format, lint, types). `pnpm fix` auto-fixes.
- Internal packages: `workspace:*`; external: `catalog:`.
- Backend tests run in Docker: `docker compose -f docker-compose-test.yml run --rm api-tests pytest -m unit`.
- Mirror every i18n change into both `packages/i18n/src/locales` and `packages/i18n/locales`.
- Keep SPDX headers on new files.
