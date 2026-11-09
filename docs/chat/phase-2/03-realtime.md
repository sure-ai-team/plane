# 03 — Realtime events (additions)

The live server stays a delivery hub. It relays any frame Django publishes to `chat:user:<id>`. New event types need **no live-server code**, only types in `apps/live/src/chat/types.ts` and handlers in the web realtime store. Envelope as in phase 1: `{ "t": "<type>", "d": { … } }`.

| Event                  | Sent to                         | Payload `d`                                                                 | Client effect                                                     |
| ---------------------- | ------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `reaction.updated`     | All active members              | `{ conversation_id, message_id, emoji, count, user_id, added: bool }`       | Patch the message's reaction summary                              |
| `pin.added`            | All active members              | `{ conversation_id, message_id, pinned_by }`                                | Update pinned bar/panel; system line arrives as `message.created` |
| `pin.removed`          | All active members              | `{ conversation_id, message_id }`                                           | Same                                                              |
| `membership.updated`   | **Only that member** (all tabs) | `{ conversation_id, notify_level, snoozed_until, is_starred, archived_at }` | Sync personal settings across tabs and devices                    |
| `preferences.updated`  | That user                       | Full `ChatPreference`                                                       | Layout and notification settings update live                      |
| `conversation.updated` | All active members (exists)     | Adds `description`, `logo_props`                                            | Header and details panel                                          |

`message.created` for a forwarded message carries `forwarded_from` like the REST payload. Since that payload is per-viewer, the publisher sends the conversation fields only to members of the source conversation. This is the one per-recipient payload. `publish_chat_event` gains a `per_user_payload(user_id) -> dict` hook.

## Desktop notification decision (client side)

When a `message.created` frame arrives, the web app decides whether to notify. This avoids any server push:

1. Skip if the sender is me, or the message is a system line.
2. Skip if the tab is visible **and** that conversation is open (full page or an expanded dock window).
3. Look up my member settings: `off` → skip; `mentions` → only if I'm mentioned, `@here` / `@all`, or it's a reply to my message; `all` → notify. Skip while `snoozed_until > now`.
4. Respect `ChatPreference.desktop_notifications`, `sound` and `show_preview`, plus browser permission.
5. Only **one tab** shows it: tabs elect a leader with a `BroadcastChannel("chat-notify")` heartbeat. The leader shows the notification with `tag = conversation_id`, so a newer message replaces the older one.
6. Clicking the notification focuses the tab and opens the message (`around_seq`).

Tab title: `(<total unread>) <page title>` while total unread > 0, updated from the unread store. The favicon gets a dot (canvas-drawn) when there are mentions.

## Load

Reactions are the most frequent new event. Clients batch reaction UI updates per animation frame. The k6 script gains a reaction step (one reaction per 10 messages) and a search step; budgets are unchanged from phase 1.
