# Deploying workspace chat

How to take the `v1-chat` branch live, and what to check once it's up. Written for whoever runs the Docker stack (`docker-compose.yml`, project `sgtpm`).

## 1. Before you start

- **Back up the database.** Migration `0125_chat` only adds tables and two nullable columns on `file_assets`, and reverses cleanly, but back up anyway.
- **Check the shared secret.** `LIVE_SERVER_SECRET_KEY` must be set to the **same value** in `apps/api/.env` and `apps/live/.env`. The live server uses it to ask the API who may chat and who is in a conversation. If it is missing or different, every chat socket is refused.
- **Optional:** set `UPLOAD_SIZE_LIMIT` in the root `.env` (default 2 GB). This is the largest upload the proxy lets through to the storage bucket. Each file type is limited further in Superadmin → Chat.

## 2. Deploy

```bash
git checkout v1-chat
docker compose build api migrator worker beat-worker live web admin proxy
docker compose up -d
```

The `migrator` service applies `0125_chat`, and the API runs `configure_instance` on start, which seeds the `CHAT_*` settings. Check both in the logs:

```bash
docker compose logs migrator | grep 0125_chat     # "Applying db.0125_chat... OK"
docker compose logs api | grep CHAT_ENABLED       # "CHAT_ENABLED loaded with value from environment variable."
```

What gets rebuilt and why:

| Image                              | Why it needs rebuilding                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| api, migrator, worker, beat-worker | New models, endpoints and Celery tasks (`chat_cleanup_task`, nightly orphan purge at 02:15 UTC). New Python package `filetype` |
| live                               | New `/live/chat/` socket                                                                                                       |
| web                                | Chat screens, app-rail item, `partysocket`, `react-virtuoso`, `yet-another-react-lightbox`                                     |
| admin                              | Superadmin → Chat page                                                                                                         |
| proxy                              | Storage uploads above 5 MB were blocked by the proxy (see § 4)                                                                 |

## 3. Smoke test (about 10 minutes, two browsers)

Use two accounts that are **members or admins** of the same workspace, A and B.

1. `GET /live/health/` returns `chat: { users, sockets, redis: "ok" }`.
2. Superadmin → Chat shows the settings with chat enabled.
3. A opens **Chat** in the app rail, starts a direct message with B, and sends "hello". B sees it instantly, and B's rail badge shows 1.
4. B opens the conversation. The badge clears, and A sees "Seen by 1".
5. B starts typing. A sees "B is typing…".
6. A creates a group with B and renames it. B gets the new group and the "renamed" line.
7. Attachments:
   - A drags in an image, a PDF and a 50 MB video. Progress shows; Send waits; all three arrive.
   - B opens the image and plays the video.
   - B downloads the PDF.
8. Voice: A records about 10 s, reviews and sends. B plays it at 1.5×.
9. A edits, then deletes, a message. B sees both changes.
10. Security spot check: a third member C (not in the group) can't open the group's URL (they get "no longer exists") and can't download its files.
11. Superadmin → Chat → turn chat off. The rail item disappears, and `/chat` redirects home. Turn it back on.

## 4. Proxy note: uploads larger than 5 MB

`apps/proxy/Caddyfile.ce` used to cap **every** request body at `FILE_SIZE_LIMIT` (5 MB), including uploads to the MinIO bucket. Chat files go browser → MinIO through the proxy, so anything larger was refused before it reached storage.

The bucket path now has its own cap (`UPLOAD_SIZE_LIMIT`, default 2 GB). The presigned upload policy still enforces each file's exact limit. Every other path keeps `FILE_SIZE_LIMIT`. Video seeking uses HTTP range requests, which `reverse_proxy` passes through unchanged.

## 5. Load test (staging)

See `apps/live/loadtest/chat.js` (k6). The target is 500 sockets, with p95 delivery under 200 ms and live-server memory under 512 MB. Record the results in `PROGRESS.md`.

## 6. Rolling back

```bash
docker compose exec api python manage.py migrate db 0124   # drops the chat tables (and their messages)
git checkout main && docker compose build && docker compose up -d
```

Rolling back deletes all chat data, and stored chat files stay in the bucket under `<workspace_id>/chat/`. To pause chat without losing anything, turn it off in Superadmin → Chat instead.

## 7. Running the backend tests locally

`docker-compose-test.yml` references `minio/minio`, which is no longer published on Docker Hub. Until that file is fixed, add an override that swaps in `cgr.dev/chainguard/minio` (the image the main stack uses):

```yaml
services:
  test-minio:
    image: cgr.dev/chainguard/minio:latest
    user: "0"
    entrypoint: ["/usr/bin/minio"]
    command: ["server", "/export", "--console-address", ":9090"]
    healthcheck:
      test: ["CMD", "/usr/bin/minio", "--version"]
```

```bash
docker compose -p sure-chat-test -f docker-compose-test.yml -f test-minio.override.yml run --rm api-tests pytest
```

Always pass `-p sure-chat-test` (or any name other than `sgtpm`) so the test stack never touches the live stack's volumes.
