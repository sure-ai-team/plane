# 01 — Data model

File: `apps/api/plane/db/models/chat.py`. Export from `db/models/__init__.py`. Migration: `0125_chat.py`.

## Base class

```python
class ChatBaseModel(TimeAuditModel, UserAuditModel):
    id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True)

    class Meta:
        abstract = True
```

**Do not** inherit `BaseModel` (`db/models/base.py`) — it pulls in `SoftDeleteModel` from `db/mixins.py`, which turns `.delete()` into a soft delete. Chat deletes are permanent (DECISIONS.md #2). `objects` is the plain `models.Manager`.

## Enums

```python
class ConversationType(models.TextChoices):
    DIRECT = "direct"
    GROUP = "group"

class ConversationRole(models.IntegerChoices):   # mirrors workspace ROLE ints for familiarity
    ADMIN = 20
    MEMBER = 15

class MessageKind(models.TextChoices):
    TEXT = "text"
    SYSTEM = "system"
    ATTACHMENT = "attachment"
    VOICE = "voice"

class SystemEvent(models.TextChoices):   # stored in Message.meta["event"] for kind=system
    CREATED = "created"
    MEMBER_ADDED = "member_added"
    MEMBER_REMOVED = "member_removed"
    MEMBER_LEFT = "member_left"
    RENAMED = "renamed"
    ICON_CHANGED = "icon_changed"
    PROJECT_LINKED = "project_linked"
```

## Conversation

| Field                  | Type                                                               | Notes                                                         |
| ---------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| `workspace`            | FK `db.Workspace`, CASCADE, related_name `chat_conversations`      |                                                               |
| `type`                 | CharField(10), choices `ConversationType`                          |                                                               |
| `name`                 | CharField(255), blank                                              | Required for groups; empty for direct                         |
| `logo_props`           | JSONField, default dict                                            | Same shape as project `logo_props` (emoji / icon)             |
| `project`              | FK `db.Project`, SET_NULL, null, related_name `chat_conversations` | Group only                                                    |
| `direct_key`           | CharField(80), null, db_index                                      | `f"{min(uid_a, uid_b)}:{max(uid_a, uid_b)}"`; null for groups |
| `last_message_seq`     | PositiveBigIntegerField, default 0                                 | Per-conversation counter                                      |
| `last_message_at`      | DateTimeField, null, db_index                                      | Sort key for the sidebar                                      |
| `last_message_preview` | CharField(200), blank                                              | Stripped text or "Photo", "Voice note", …                     |

Constraints / indexes:

```python
constraints = [
    UniqueConstraint(fields=["workspace", "direct_key"], condition=Q(direct_key__isnull=False), name="chat_unique_direct_per_workspace"),
    CheckConstraint(check=Q(type="direct", direct_key__isnull=False) | Q(type="group", direct_key__isnull=True), name="chat_direct_key_matches_type"),
]
indexes = [Index(fields=["workspace", "-last_message_at"], name="chat_conv_ws_last_msg")]
db_table = "chat_conversations"
```

## ConversationMember

| Field           | Type                                                                  | Notes                                                |
| --------------- | --------------------------------------------------------------------- | ---------------------------------------------------- |
| `conversation`  | FK `Conversation`, CASCADE, related_name `members`                    |                                                      |
| `member`        | FK `db.User`, CASCADE, related_name `chat_memberships`                |                                                      |
| `workspace`     | FK `db.Workspace`, CASCADE                                            | Denormalised for cheap workspace-scoped queries      |
| `role`          | PositiveSmallIntegerField, choices `ConversationRole`, default MEMBER | Direct chats: both ADMIN                             |
| `last_read_seq` | PositiveBigIntegerField, default 0                                    |                                                      |
| `is_muted`      | BooleanField, default False                                           |                                                      |
| `is_active`     | BooleanField, default True                                            | False after leave / removal / workspace deactivation |
| `joined_at`     | DateTimeField, auto_now_add                                           |                                                      |
| `left_at`       | DateTimeField, null                                                   |                                                      |

```python
constraints = [UniqueConstraint(fields=["conversation", "member"], name="chat_unique_member_per_conversation")]
indexes = [
    Index(fields=["member", "is_active"], name="chat_member_active"),
    Index(fields=["workspace", "member", "is_active"], name="chat_member_ws_active"),
]
db_table = "chat_conversation_members"
```

Rejoining a group reactivates the existing row (sets `is_active=True`, clears `left_at`); it does not create a second row.

## Message

| Field           | Type                                                       | Notes                                                                  |
| --------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| `conversation`  | FK, CASCADE, related_name `messages`                       |                                                                        |
| `workspace`     | FK `db.Workspace`, CASCADE                                 | Denormalised                                                           |
| `sender`        | FK `db.User`, SET_NULL, null, related_name `chat_messages` | Null for system messages or deleted users                              |
| `seq`           | PositiveBigIntegerField                                    | Assigned by the service, see below                                     |
| `kind`          | CharField(16), choices `MessageKind`, default TEXT         | Derived at send time                                                   |
| `body_html`     | TextField, blank                                           | Sanitised with the same sanitizer as issue comments                    |
| `body_json`     | JSONField, default dict                                    | Editor document                                                        |
| `body_stripped` | TextField, blank                                           | Plain text for previews and future search                              |
| `reply_to`      | FK `self`, SET_NULL, null, related_name `replies`          |                                                                        |
| `client_id`     | UUIDField, null                                            | Client-generated idempotency key                                       |
| `meta`          | JSONField, default dict                                    | System-event payload, e.g. `{"event": "member_added", "user_id": "…"}` |
| `edited_at`     | DateTimeField, null                                        |                                                                        |

```python
constraints = [
    UniqueConstraint(fields=["conversation", "seq"], name="chat_unique_seq_per_conversation"),
    UniqueConstraint(fields=["conversation", "sender", "client_id"], condition=Q(client_id__isnull=False), name="chat_unique_client_id"),
]
indexes = [
    Index(fields=["conversation", "-seq"], name="chat_msg_conv_seq_desc"),
    Index(fields=["reply_to"], name="chat_msg_reply_to"),
]
db_table = "chat_messages"
ordering = ["seq"]
```

## MessageMention

| Field       | Type                                                |
| ----------- | --------------------------------------------------- |
| `message`   | FK `Message`, CASCADE, related_name `mentions`      |
| `user`      | FK `db.User`, CASCADE, related_name `chat_mentions` |
| `workspace` | FK `db.Workspace`, CASCADE                          |

Unique `(message, user)`. Index `(user, -created_at)`. `db_table = "chat_message_mentions"`.

## FileAsset changes (`db/models/asset.py`)

- Add `CHAT_ATTACHMENT = "CHAT_ATTACHMENT"` to `EntityTypeContext`.
- Add `chat_message = models.ForeignKey("db.Message", on_delete=models.CASCADE, null=True, related_name="assets")` — CASCADE so deleting a message deletes the rows; object deletion is handled by the Celery task (04 § Deletion).
- Add `chat_conversation = models.ForeignKey("db.Conversation", on_delete=models.CASCADE, null=True, related_name="assets")` — set at upload time, before the message exists; used for the ownership check at send time.
- `asset_url` property: for `CHAT_ATTACHMENT` return `f"/api/assets/v2/workspaces/{slug}/chat/attachments/{self.id}/"`.
- `attributes` shape for chat: see `04-attachments-and-media.md` § Attributes.

## Sequence assignment (service layer: `app/views/chat/services.py`)

```python
with transaction.atomic():
    conv = Conversation.objects.select_for_update().get(id=conversation_id)
    conv.last_message_seq += 1
    message = Message.objects.create(conversation=conv, seq=conv.last_message_seq, ...)
    conv.last_message_at = message.created_at
    conv.last_message_preview = preview_for(message)
    conv.save(update_fields=["last_message_seq", "last_message_at", "last_message_preview"])
    transaction.on_commit(lambda: publish_chat_event(...))
```

`IntegrityError` on `chat_unique_client_id` → return the existing message with `200` (idempotent retry).

## Derived values (never stored)

- Unread for a member: `conversation.last_message_seq - membership.last_read_seq`.
- "Seen by" for message `m`: members with `last_read_seq >= m.seq`, excluding the sender.
- Direct-conversation display name: the _other_ member's display name.

## Migration notes

- One migration `0125_chat` creating the four tables and altering `FileAsset`.
- No data migration.
- Add `Message` to the deletion-task exclusion list if `soft_delete_related_objects` walks reverse relations from `User`/`Workspace` (verify in `bgtasks/deletion_task.py`; chat rows must be hard-deleted by their own CASCADE, not soft-marked).
- Workspace deletion cascades through `Conversation` → everything.
