# 05 — Notifications

Scope: **in-app + desktop** while a tab is open (P2-D4). No service worker, no email in phase 2.

## Levels

| Level      | Desktop notification for                                  | Inbox entry for                |
| ---------- | --------------------------------------------------------- | ------------------------------ |
| `all`      | Every message from someone else                           | Mentions; every direct message |
| `mentions` | `@you`, `@here`/`@all` (groups), replies to your messages | Mentions only                  |
| `off`      | Nothing                                                   | Nothing                        |

- Defaults: `all` for direct messages, `mentions` for groups. Set when the member row is created; the migration maps phase 1 mute to `off`.
- Snooze (`snoozed_until`) suppresses desktop notifications and Inbox entries for that conversation. Unread counts and badges are unaffected.
- Global switches in `ChatPreference` apply on top: `desktop_notifications`, `sound`, `show_preview`, `inbox_mentions`.

## Inbox entries (server)

Created in `services.send_message`, after commit, by a Celery task `chat_inbox_notifications(message_id)`:

1. Recipients are active members other than the sender, filtered by level, snooze and `inbox_mentions`.
2. Direct messages create at most **one unread Inbox row per conversation** for the recipient. A new message updates that row's snippet and time instead of adding rows.
3. Mentions always create their own row.
4. When the recipient reads past that seq in chat (`read/` endpoint), matching Inbox rows are marked read.
5. Deleting a message deletes its rows. Leaving or being removed from a conversation deletes your unread rows for it.

The Inbox list endpoint returns `entity_name` `issue` and `chat_message` rows. Mention rows use `sender = "chat_mentioned"` so they appear under the Inbox's Mentions tab; direct-message rows use `sender = "chat"`. `message_html` is escaped text. The web Inbox renders chat rows with a chat badge; clicking one marks it read and opens the message in chat (`?m=`).

## Desktop notifications (client)

Decision flow is in `03-realtime.md`. Details:

- Title: `<sender> · <conversation name>` (direct: sender only). Body: the message preview (respecting `show_preview`; otherwise "New message"). Attachments only: "Sent a photo", "Sent a voice note", etc. Icon: the workspace logo.
- Sound: the tone and volume chosen in Chat settings (Chime, Ding, Pop, Marimba or Ringtone), made with Web Audio (no audio file), throttled to one play per 3 s. It follows the same rules as the notification but needs neither browser permission nor the **Desktop notifications** switch, only **Sound**. Audio unlocks on the first click or key press on the page (P2-D16).
- Leader tab election via `BroadcastChannel`, so only one tab notifies. If `BroadcastChannel` is unavailable (old Safari), every tab notifies but uses the same `tag`, so the OS collapses them.
- Permission is requested only from a user gesture (preferences toggle or the one-time prompt in the chat empty state).

## Tab title and favicon

- `(<N>) <title>` where N = total unread across non-archived conversations whose level isn't `off`.
- Favicon dot when you have unread mentions. Restored when the count reaches 0.
