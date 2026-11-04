# Deploying chat phase 2

How to upgrade a stack running chat phase 1 (`v1-chat`) to phase 2 (`v2-chat`). For a first install, follow [`../DEPLOYMENT.md`](../DEPLOYMENT.md) with `v2-chat` instead of `v1-chat`; everything below is included.

`v2-chat` also contains everything merged into `main` up to the point it was cut (including the SURE rebrand), so check `main`'s own release notes too.

## 1. Before you start

- **Back up the database.** The two migrations below add tables, columns and an index. Both reverse cleanly, but back up anyway.
- **Give the API enough workers.** `GUNICORN_WORKERS` in `apps/api/.env` defaults to 2. That is too few for a busy chat: in the load test (§ 4) 2 workers put message delivery at 2.5 s p95; 8 workers brought it to 135 ms. Use roughly one worker per CPU core you can spare for the API (8 on the test machine).
- Nothing else new is required in `.env`. Optional rate limits (defaults shown): `CHAT_REACT_RATE=60/minute`, `CHAT_SEARCH_RATE=30/minute`, `CHAT_PIN_RATE=20/minute`.

## 2. Deploy

```bash
git checkout v2-chat
docker compose build api migrator worker beat-worker web
docker compose up -d
```

| Image                              | Why it needs rebuilding                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| api, migrator, worker, beat-worker | Migrations `0126`, `0127`; reactions, pins, forward, search, preferences, work-item references; Celery task `chat_inbox_task` (Inbox rows) |
| web                                | All phase 2 screens and the chat translations                                                                                              |

`live`, `admin` and `proxy` have no changes since phase 1 and don't need rebuilding. The live server relays the new event types as they are.

### Migrations

| Migration                | What it does                                                                                                                                                                                                                                                                                               | Time on a large table                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `0126_chat_phase2`       | Adds reactions, pins, message work-item links and chat preferences; adds per-member notify level, snooze, starred and archived; adds message `meta`. Converts phase 1 data: muted chats become notify level **Off**, groups default to **Mentions only**, direct chats to **All**. Messages are untouched. | Seconds                                                     |
| `0127_chat_search_index` | Builds the full-text search index with `CREATE INDEX CONCURRENTLY` (non-atomic migration, no table lock).                                                                                                                                                                                                  | Grows with message count; chat stays usable while it builds |

Check both applied:

```bash
docker compose logs migrator | grep -E "0126_chat_phase2|0127_chat_search_index"
```

If `0127` is interrupted, Postgres can leave an invalid index behind. Drop it and run `migrate` again:

```sql
DROP INDEX CONCURRENTLY IF EXISTS chat_msg_search_idx;
```

## 3. Smoke test (about 10 minutes, two browsers)

Use two members of the same workspace, A and B, with a direct chat and a group between them. Phase 1's checks ([`../DEPLOYMENT.md`](../DEPLOYMENT.md) § 3) still apply; these cover phase 2.

1. A reacts to B's message. B sees the reaction live and, on hover, A's name.
2. A pins a message. B sees the pinned bar and the "A pinned a message · Jump" line; Jump scrolls to it.
3. A forwards a message with a file to another chat. The copy opens there, and deleting the original doesn't remove the copy's file.
4. Search finds a word B sent. A third member C, not in that chat, doesn't find it.
5. A sets a group to **Mentions only**, then mentions in another tab: the setting syncs. B mentions A: it appears in A's Inbox.
6. Chat settings → allow desktop notifications. With the chat in another tab, B's message shows one desktop notification; clicking it opens the message.
7. On a work item, **Discuss in chat** opens the chat with its link ready. Sending it shows a card, and the work item lists the chat under "Discussed in chat".
8. On another page, open a minimized chat and reply from it.
9. Switch your language (Profile → Preferences) to another language; chat is translated, including dates.

## 4. Load test

`apps/live/loadtest/chat.js` (k6) now adds a reaction to every 10th message and one search per user per minute. Budgets: delivery p95 < 200 ms at 500 sockets, search p95 < 300 ms, live memory < 512 MB. The live server allows 10 sockets per user, so 500 sockets need at least 50 test sessions. See the file header.

Result on the local `surechat` copy (one 16-core machine running the whole stack and k6; 500 sockets in one 50-member group, 20 messages/s, 3 minutes, 1.79 million deliveries):

| API workers | Delivery p95 (incl. the HTTP send) | Search p95   | Errors | Live memory  |
| ----------- | ---------------------------------- | ------------ | ------ | ------------ |
| 2 (default) | 2.46 s ✗                           | 528 ms ✗     | —      | 213 MB       |
| 8           | **135 ms** ✓                       | **136 ms** ✓ | 0 ✓    | **210 MB** ✓ |

Run it again on staging before go-live; a separate load generator gives cleaner numbers.

## 5. Rolling back to phase 1

```bash
docker compose exec api python manage.py migrate db 0125_chat   # removes phase 2 tables, columns and the index
git checkout v1-chat && docker compose build api migrator worker beat-worker web && docker compose up -d
```

Phase 1 messages and files are kept. Reactions, pins, preferences, stars, archive state and work-item links are lost, and notify levels go back to plain mute (Off → muted).
