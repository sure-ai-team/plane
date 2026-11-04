# 01 — Data model changes

Two migrations: **`0126_chat_phase2`** (schema and data) and **`0127_chat_search_index`** (the search index, built concurrently in a non-atomic migration so a failure there can't leave 0126 half-applied). All new chat models inherit `ChatBaseModel` (hard delete, D2). Everything cascades from `Message` or `Conversation`, so phase 1's delete paths keep working.

## New tables

### `MessageReaction`

| Field       | Type                                       | Notes                                                        |
| ----------- | ------------------------------------------ | ------------------------------------------------------------ |
| `message`   | FK `Message`, CASCADE, related `reactions` |                                                              |
| `user`      | FK `User`, CASCADE                         |                                                              |
| `workspace` | FK `Workspace`, CASCADE                    | For workspace-scoped queries and cleanup                     |
| `emoji`     | CharField(32)                              | One emoji grapheme (with skin tone / ZWJ). Validated (P2-D1) |

- Unique `(message, user, emoji)`.
- Index `(message, emoji)`.
- Limit: 20 distinct emoji per message, enforced in the service.

### `MessagePin`

| Field          | Type                                       | Notes                                           |
| -------------- | ------------------------------------------ | ----------------------------------------------- |
| `conversation` | FK `Conversation`, CASCADE, related `pins` |                                                 |
| `message`      | OneToOne `Message`, CASCADE, related `pin` | One pin per message                             |
| `workspace`    | FK `Workspace`, CASCADE                    |                                                 |
| `pinned_by`    | FK `User`, SET_NULL, null                  | `created_by` also set; kept explicit for the UI |

- Index `(conversation, -created_at)`.
- Limit: 50 pins per conversation (P2-D2).

### `MessageWorkItem`

Structured link from a message to a work item, extracted on send/edit (P2-D13). This edition's editor has no work-item embed node, so a reference is an ordinary link to `/<slug>/browse/<PROJECT>-<n>/` (or `/<slug>/projects/<id>/issues/<id>/`), relative or absolute, into the same workspace (`plane/utils/chat_work_items.py`).

| Field          | Type                                        | Notes                                |
| -------------- | ------------------------------------------- | ------------------------------------ |
| `message`      | FK `Message`, CASCADE, related `work_items` |                                      |
| `conversation` | FK `Conversation`, CASCADE                  | Denormalized for "Discussed in chat" |
| `issue`        | FK `Issue`, CASCADE, related `chat_refs`    |                                      |
| `workspace`    | FK `Workspace`, CASCADE                     |                                      |

- Unique `(message, issue)`.
- Index `(issue, -created_at)`.
- Max 10 refs per message.

### `ChatPreference`

Per user per workspace. Created lazily with defaults on first read.

| Field                   | Type                            | Default   | Notes                                  |
| ----------------------- | ------------------------------- | --------- | -------------------------------------- |
| `user`                  | FK `User`                       |           |                                        |
| `workspace`             | FK `Workspace`                  |           | Unique `(user, workspace)`             |
| `desktop_notifications` | Boolean                         | `true`    | Browser permission still applies       |
| `sound`                 | Boolean                         | `true`    |                                        |
| `show_preview`          | Boolean                         | `true`    | Message text in desktop notifications  |
| `inbox_mentions`        | Boolean                         | `true`    | Create Inbox entries for chat mentions |
| `message_layout`        | Char(10): `compact` / `bubbles` | `bubbles` | P2-D11                                 |
| `bubbles_direct_only`   | Boolean                         | `true`    | Bubbles only in direct messages        |
| `minimize_style`        | Char(10): `docked` / `heads`    | `docked`  | P2-D10                                 |

## Changed tables

### `ConversationMember`

| Change                                                      | Notes                                                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Add** `notify_level` Char(10): `all` / `mentions` / `off` | Data migration: `is_muted=True` → `off`; otherwise `all` for direct and `mentions` for groups (P2-D4)                    |
| **Add** `snoozed_until` DateTime, null                      | Notifications suppressed until then; unread counts unaffected                                                            |
| **Add** `is_starred` Boolean, default false                 | Starred section                                                                                                          |
| **Add** `archived_at` DateTime, null                        | Archived conversations leave the main list; new messages don't unarchive (P2-D8)                                         |
| **Remove** `is_muted`                                       | In the same migration, after the data step. API keeps a read-only `is_muted` (= `notify_level == "off"`) for one release |

Index `(member, workspace, is_active, archived_at)` for the sidebar query.

### `Conversation`

| Change                            | Notes                                             |
| --------------------------------- | ------------------------------------------------- |
| **Add** `description` Text, blank | Group description (details panel)                 |
| `logo_props` (exists)             | Now editable for groups: emoji or color + initial |

### `Message`

| Change                                         | Notes                                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `meta.forwarded_from` (JSON, no schema change) | `{message_id, conversation_id, sender_id, sent_at}` copied at forward time (P2-D6)             |
| **Search index**                               | `GinIndex(SearchVector("body_stripped", config="simple"), name="chat_msg_search_idx")` (P2-D3) |
| `kind` gains `forwarded`? **No**               | Forwarded messages keep their natural kind; the flag is `meta.forwarded_from`                  |

### `Notification` (existing, Inbox)

No schema change. Chat rows use:

- `entity_name = "chat_message"`, `entity_identifier = message.id`, `project = conversation.project` (null allowed).
- `data = {"conversation_id", "message_id", "seq", "conversation_name", "type": "mention" | "direct"}`.
- `sender = "chat_mentioned"` for mentions (the Inbox's Mentions tab matches "mentioned"), `"chat"` for direct messages.

Rows are deleted when the message is deleted (hard delete, in `services.delete_message`).

## System events (`SystemEvent` enum)

Add `pinned` and `unpinned` ("Sara pinned a message"). Reactions produce no system lines.

## Migration notes

- `0126` order: create tables → add fields → data migration for `notify_level` → remove `is_muted`.
- `0127`: GIN index with `AddIndexConcurrently` (`atomic = False`) so large message tables don't lock.
- Reverse: recreate `is_muted` from `notify_level == "off"`, drop the rest.
- Test the migration forwards and backwards in the Docker suite (as with `0125_chat`).
