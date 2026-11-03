# 03 — Real-time protocol

## Connection

- URL: `wss://<host>/live/chat/?workspace=<slug>` (path under `LIVE_BASE_PATH`, proxied by Caddy `/live/*`).
- Auth: session cookie, same as the collaboration socket. Live server calls `handleAuthentication` (`apps/live/src/lib/auth.ts`) → `GET /api/users/me/`. On failure: close `4401`.
- Workspace check: live server calls `GET /api/workspaces/<slug>/chat/membership-check/` _(add to 02 if not present — or reuse `/api/users/me/workspaces/`)_ and closes `4403` if the user is not an active admin/member.
- Origin check: `Origin` header must be in `CORS_ALLOWED_ORIGINS`; else `4403`.
- One socket per tab. The server keeps `Map<userId, Set<WebSocket>>` plus `socket → {userId, workspaceSlug}`.
- Max 10 sockets per user; the 11th closes the oldest.

## Frames

All frames are JSON `{ "t": "<type>", "d": {…}, "ts": <unix ms> }`.

### Client → server

| `t`         | `d`                             | Rules                                                                                                           |
| ----------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `ping`      | `{}`                            | Every 30 s. Server replies `pong`. Refreshes presence TTL                                                       |
| `typing`    | `{ "conversation_id": "uuid" }` | Client throttles to 1 per 3 s per conversation. Server drops frames above 1/s                                   |
| `subscribe` | `{ "conversation_id": "uuid" }` | Optional hint of the open thread; used only to decide typing fan-out targets. Not required for message delivery |

Unknown `t` → ignored. Malformed JSON → close `4400`.

### Server → client

| `t`                    | `d`                                       | Source                                                      |
| ---------------------- | ----------------------------------------- | ----------------------------------------------------------- |
| `pong`                 | `{}`                                      |                                                             |
| `message.created`      | `{ "message": Message }`                  | Redis                                                       |
| `message.updated`      | `{ "message": Message }`                  | Redis                                                       |
| `message.deleted`      | `{ "conversation_id", "id", "seq" }`      | Redis                                                       |
| `conversation.created` | `{ "conversation": Conversation }`        | Redis (sent to each new member)                             |
| `conversation.updated` | `{ "conversation": Conversation }`        | Redis                                                       |
| `conversation.deleted` | `{ "id" }`                                | Redis                                                       |
| `member.added`         | `{ "conversation_id", "member": Member }` | Redis                                                       |
| `member.removed`       | `{ "conversation_id", "user_id" }`        | Redis. If `user_id == me` the client drops the conversation |
| `read.updated`         | `{ "conversation_id", "user_id", "seq" }` | Redis                                                       |
| `typing`               | `{ "conversation_id", "user_id" }`        | Live server                                                 |
| `presence`             | `{ "user_id", "online": true\|false }`    | Live server                                                 |
| `error`                | `{ "code", "message" }`                   | Live server                                                 |

`Message` / `Conversation` / `Member` are exactly the REST shapes from `02-api-contracts.md`; the serializer output is published verbatim so client code has one type.

## Redis

### Channels (published by Django, `plane/utils/chat_events.py`)

```
chat:user:<user_id>      payload: {"t": "...", "d": {...}, "ws": "<slug>"}
```

One PUBLISH per recipient, batched in a pipeline. Recipients = active members of the conversation (for `conversation.created`: the new members). Sender is included (so their other tabs update; the sending tab reconciles by `client_id`).

The live server holds one `PSUBSCRIBE chat:user:*` on a dedicated ioredis connection (subscriber connections cannot issue other commands). On message: extract user id from the channel name, look up sockets, filter by `ws` matching the socket's workspace, send.

### Presence

```
SET chat:online:<user_id> <slug> EX 60       on connect and on every ping
DEL chat:online:<user_id>                     when the user's last socket closes
```

Transitions (first socket opened / last socket closed) publish `presence` to… every online member of the same workspace. To find them: `SCAN chat:online:*` is fine under 500 users; cache the set for 10 s.

`GET /chat/presence/` reads the same keys.

### Typing

Live server receives `typing` → needs recipient ids. Cache: `Map<conversationId, {ids: string[], at: number}>` with 60 s TTL, filled by `GET /api/workspaces/<slug>/chat/conversations/<id>/member-ids/` using header `X-Live-Secret`. Fan-out to each recipient's sockets except the sender's. Never persisted.

## Live server file layout (`apps/live/src`)

```
controllers/chat.controller.ts   @Controller("/chat") + @WSDecorator("/"); auth; frame parsing; registry
chat/registry.ts                 userId ↔ sockets maps, per-user cap
chat/redis-bridge.ts             subscriber connection, psubscribe, dispatch
chat/presence.ts                 TTL keys + transition broadcasts
chat/typing.ts                   member-id cache + fan-out
chat/types.ts                    re-export from @plane/types/chat
```

Register the controller in `controllers/index.ts` `CONTROLLERS`. Add `API_BASE_URL` call helper reuse from `services/api.service.ts`.

Health: extend `health.controller.ts` with `chat: { sockets: n, users: n, redis: "ok" }`.

## Client rules (`apps/web/core/services/chat-socket.ts`)

- `partysocket` `ReconnectingWebSocket` with `maxRetries: Infinity`, backoff 1 s → 30 s, jitter.
- On `open` (including every reconnect): dispatch `chat/reconnected` → stores run catch-up:
  1. `GET conversations/` (replaces list, recomputes unread).
  2. For the open thread: `GET messages/?after_seq=<newest known>` until `has_more=false`.
  3. `GET presence/`.
- `ping` every 30 s while open. If no `pong` within 10 s, force-close to trigger reconnect.
- Incoming frames are queued and flushed to MobX in one `runInAction` per animation frame.
- Stop the socket when the user leaves the workspace or `CHAT_ENABLED` turns off.

## Ordering and idempotency

- Clients apply `message.created` only if `seq > newestKnownSeq`; otherwise ignore (duplicate) — gaps are filled by catch-up, so out-of-order delivery is harmless.
- `message.updated` / `.deleted` apply regardless of order (last write wins by `edited_at`; delete always wins).
- `read.updated` applies if `seq > stored`.
