# 08 — Testing

Conventions: `apps/api/tests/TESTING_GUIDE.md`, markers `unit` / `contract` / `smoke` (`pytest.ini`, strict). Factories in `apps/api/tests/factories.py` — add `ConversationFactory`, `ConversationMemberFactory`, `MessageFactory`, `ChatAttachmentFactory`.

## Backend (`apps/api/tests/`)

### unit/models/test_chat_models.py

- Direct conversation unique per workspace (second create raises).
- `direct_key` check constraint (group with key / direct without key → IntegrityError).
- `ChatBaseModel.delete()` is a hard delete (row gone, no `deleted_at`).
- Rejoin reactivates existing membership row.

### unit/utils/test_chat_services.py

- `send_message` assigns consecutive `seq` under concurrency (two threads, `select_for_update`).
- Duplicate `client_id` returns the original message.
- `kind` derivation: text / attachment / voice.
- Mentions: only active members become `MessageMention`.
- `publish_chat_event` runs only after commit (wrap in `transaction.atomic` and roll back → no publish). Redis mocked with `unittest.mock`.

### unit/bg_tasks/test_chat_cleanup.py

- `delete_chat_objects` batches and retries.
- `purge_orphan_chat_uploads` removes only orphans older than 24 h.

### contract/test_chat_conversations.py

- List returns unread counts and `direct_user`; muted excluded from `unread-count` total.
- Create direct: 201 then 200 (same id); self → 400; guest target → 400.
- Create group: creator ADMIN, members MEMBER, system message exists.
- PATCH/DELETE by non-admin → 403; delete direct → 400; delete group hard-deletes messages and enqueues object deletion.
- Non-member GET → 404 (not 403).

### contract/test_chat_members.py

- Add, remove, leave, last-admin promotion, cannot demote last admin, cannot leave direct.

### contract/test_chat_messages.py

- Paging: latest, `before_seq`, `after_seq`, `has_more`, limit cap 100.
- Send: empty → 400; too many files → 400; foreign/unuploaded/other-conversation attachment → 400.
- Edit by non-sender → 403; delete by admin OK; reply `reply_to` nulled after target delete.
- Read: monotonic, clamped to `last_message_seq`.
- Throttle `chat_send` triggers 429 at 61st request (override rate in test settings).

### contract/test_chat_attachments.py

- Upload request: allow-list, blocklist, size per kind, voice duration.
- Confirm: `head_object` oversize → 413 + object deleted; `filetype` mismatch → 400; OK → `is_uploaded`.
- GET: member → 302 with inline/attachment disposition per kind; non-member → 404; `?thumb=1`.
- **S1 regression:** `WorkspaceFileAssetEndpoint` and `StaticFileAssetEndpoint` return 404 for `CHAT_ATTACHMENT`.
- Storage mocked via the existing `S3Storage` patching pattern in `tests/fixtures`.

### contract/test_chat_config.py

- `CHAT_ENABLED=0` → all chat routes 404; admin config PATCH validates ranges; hard caps.

### smoke/test_chat_flow.py

- Create group → send text → upload image → send with attachment → read → delete message → delete group. One linear flow.

Run: `docker compose -f docker-compose-test.yml run --rm api-tests pytest -m "unit or contract" tests -k chat`.

## Live server (`apps/live`, vitest)

`src/chat/__tests__/`:

- `registry.test.ts`: add/remove sockets, per-user cap, cleanup on close.
- `redis-bridge.test.ts`: channel → user id parsing; workspace filter; malformed payload ignored (ioredis mocked).
- `presence.test.ts`: first-open / last-close transitions publish; TTL refresh on ping.
- `typing.test.ts`: cache TTL, fan-out excludes sender, throttle above 1/s.
- `chat.controller.test.ts`: auth failure closes 4401; origin check 4403; frame parsing errors 4400.

## Web (`apps/web`, vitest)

`core/store/chat/__tests__/`:

- `message.store.test.ts`: optimistic send → reconcile by `client_id`; ignore duplicate `message.created`; `catchUp` pages until `has_more=false`; `fetchBefore` adjusts `firstItemIndex`.
- `conversation.store.test.ts`: sorting, `totalUnread` excludes muted, `member.removed(me)` drops conversation.
- `upload.store.test.ts`: state machine, cancel mid-upload aborts and calls DELETE, `canSend` false while any item not ready, max 3 parallel.
- `realtime.store.test.ts`: typing expiry after 5 s, presence set/unset.

Storybook: one story per shared component including states (loading, error, RTL via `dir="rtl"` decorator, dark theme).

## Browser / manual matrix (PR 8)

| Check                                                                      | Chrome | Firefox | Safari | Edge |
| -------------------------------------------------------------------------- | ------ | ------- | ------ | ---- |
| Send text, mention, work-item card                                         |        |         |        |      |
| Image paste + grid + lightbox                                              |        |         |        |      |
| Video upload, poster, play, seek                                           |        |         |        |      |
| Voice record (format: webm / **mp4 on Safari**), review, send, 2× playback |        |         |        |      |
| File card download (disposition attachment)                                |        |         |        |      |
| Reconnect: kill network 30 s, resume → no gaps                             |        |         |        |      |
| RTL (`ar`) layout                                                          |        |         |        |      |
| Dark mode                                                                  |        |         |        |      |
| Mobile width (390 px)                                                      |        |         |        |      |

## Load test (PR 8)

- Tool: `k6` with the WebSocket module, or `artillery`.
- 500 connections to `/live/chat/`, each pinging every 30 s; 20 msgs/s sent via REST by 20 virtual users across 10 groups of 50.
- Pass: p95 delivery latency < 200 ms on the same network; live server RSS < 512 MB; no socket drops; Redis CPU < 20 %.
- Script lives in `apps/live/loadtest/chat.js` (not run in CI).
