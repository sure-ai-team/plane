# 05 — Frontend

## Routes

`apps/web/app/routes/core.ts` — add, lazy:

```ts
layout("./(all)/[workspaceSlug]/(chat)/layout.tsx", [
  route(":workspaceSlug/chat", "./(all)/[workspaceSlug]/(chat)/page.tsx"),                 // empty state
  route(":workspaceSlug/chat/:conversationId", "./(all)/[workspaceSlug]/(chat)/[conversationId]/page.tsx"),
]),
```

Layout mirrors `(projects)/layout.tsx`: rounded bordered panel, `ChatSidebar` on the left (resizable, same `ResizableSidebar`), `<Outlet/>` main. Hidden entirely (redirect to `/:workspaceSlug/`) when `CHAT_ENABLED` is false or the user is a guest.

## App rail

`core/components/navigation/app-rail-hoc.tsx` `withDockItems`: append

```ts
{ label: "Chat", icon: <ChatIcon className="size-5"/>, href: `/${workspaceSlug}/chat`, isActive: isChatPath,
  shouldRender: chatEnabled && !isGuest, badge: totalUnread }
```

`AppSidebarItem` gets an optional `badge?: number` prop (renders the blue count pill from the mockup). Add `isChatPath` to `useWorkspacePaths`.

## Services

- `core/services/chat.service.ts` — `class ChatService extends APIService`, one method per endpoint in `02-api-contracts.md`, typed with `@plane/types`.
- `core/services/chat-socket.ts` — see `03-realtime-protocol.md` § Client rules. Exposes `connect(slug)`, `disconnect()`, `sendTyping(conversationId)`, `onEvent(cb)`.

## Types (`packages/types/src/chat/`)

`conversation.ts`, `message.ts`, `attachment.ts`, `events.ts` (discriminated union on `t`), `index.ts`. These are the single source for API and socket shapes.

## Stores (`core/store/chat/`)

Registered on `RootStore` as `chat: { conversation, message, upload, realtime }`.

| Store                   | State                                                                                                                                                                                | Actions                                                                                        | Computed                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `conversation.store.ts` | `byId: Map<id, Conversation>`, `fetched: boolean`                                                                                                                                    | `fetchAll`, `create`, `update`, `remove`, `markRead(id, seq)`, `applyEvent`                    | `sorted` (by `last_message_at`), `groups`, `directs`, `totalUnread` (excl. muted), `getById` |
| `message.store.ts`      | `byConv: Map<id, { bySeq: Map<seq, Message>, oldestSeq, newestSeq, hasMoreBefore, loading }>`, `pending: Map<client_id, PendingMessage>`                                             | `fetchLatest`, `fetchBefore`, `catchUp(id)`, `send(id, draft)`, `edit`, `delete`, `applyEvent` | `list(id)` (ascending, pending appended), `seenBy(msg)`                                      |
| `upload.store.ts`       | `queue: Map<convId, UploadItem[]>` where `UploadItem = { localId, file, kind, status: queued\|processing\|uploading\|ready\|failed, progress, assetId?, error?, previewUrl?, meta }` | `add(files)`, `cancel`, `retry`, `clear(convId)`                                               | `readyIds(convId)`, `canSend(convId)`                                                        |
| `realtime.store.ts`     | `typing: Map<convId, Map<userId, expiresAt>>`, `online: Set<userId>`, `connected: boolean`                                                                                           | `applyEvent`, `prune()` (every 1 s)                                                            | `typingUsers(convId)`, `isOnline(userId)`                                                    |

Rules:

- Optimistic send: `send()` creates `PendingMessage { client_id, body, attachments, created_at: now }`; on `201`/`200` or on `message.created` with the same `client_id`, replace. On failure keep it with `status: failed` and a retry action.
- All socket events go through `rootStore.chat.applyEvent(frame)` which routes by `t`.
- `message.store` keeps at most 500 messages per conversation in memory; older pages are dropped when scrolled far away (`firstItemIndex` adjusted).

## Components

### Shared (`packages/propel/src/chat/` or `packages/ui/src/chat/`, with `*.stories.tsx`)

| Component              | Props (key ones)                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| `MessageItem`          | `message`, `isOwn`, `showHeader`, `onReply`, `onEdit`, `onDelete`, `onCreateWorkItem`, `renderBody` |
| `MessageGroup`         | groups consecutive messages: same sender, < 5 min apart, no reply/system between                    |
| `DayDivider`           | `date`                                                                                              |
| `SystemMessage`        | `message` → copy from `meta.event` via i18n                                                         |
| `AttachmentGrid`       | `attachments`, `onOpen(index)`; 1 → single, 2 → 2 cols, ≥3 → 3 cols with `+N` overlay               |
| `FileCard`             | `attachment`, `onDownload`                                                                          |
| `VideoTile`            | `attachment`, `onOpen`                                                                              |
| `VoiceNotePlayer`      | `attachment`, `playing`, `onPlay`, `onPause`, `rate`, `onRateChange`                                |
| `VoiceRecorder`        | `maxSeconds`, `onRecorded(blob, duration, waveform)`, `onCancel`                                    |
| `UploadTray`           | `items: UploadItem[]`, `onCancel`, `onRetry`, `onRemove`                                            |
| `TypingIndicator`      | `names: string[]`                                                                                   |
| `PresenceDot`          | `online`                                                                                            |
| `ConversationListItem` | `conversation`, `active`, `onClick`                                                                 |
| `UnreadBadge`          | `count`                                                                                             |

### App (`apps/web/core/components/chat/`)

```
sidebar/   root.tsx, header.tsx, quick-links.tsx, groups-section.tsx, directs-section.tsx, footer.tsx
thread/    root.tsx, header.tsx, message-list.tsx (Virtuoso), message-renderer.tsx, empty-state.tsx
composer/  root.tsx, editor.tsx (wraps @plane/editor comment editor), toolbar.tsx, attachments.tsx,
           voice.tsx, media/{image-thumb,video-poster,waveform}.ts, use-paste.ts, use-drop.ts
modals/    new-conversation.tsx, members.tsx, delete-group.tsx, create-work-item-from-message.tsx
details/   root.tsx, members-tab.tsx, media-tab.tsx, files-tab.tsx, work-items-tab.tsx
lightbox/  root.tsx (lazy; yet-another-react-lightbox + zoom + video)
hooks/     use-chat.ts, use-conversation.ts, use-thread-scroll.ts, use-mark-read.ts
```

### Virtuoso configuration (`message-list.tsx`)

```ts
<Virtuoso
  firstItemIndex={firstItemIndex}          // decreases when older pages prepend
  initialTopMostItemIndex={items.length - 1}
  data={items}
  followOutput={(atBottom) => atBottom ? "smooth" : false}
  startReached={loadOlder}
  atBottomStateChange={setAtBottom}
  increaseViewportBy={{ top: 600, bottom: 300 }}
  components={{ Header: loadingSpinner, Footer: typingIndicator }}
/>
```

New message while not at bottom → "↓ New messages" pill; clicking scrolls to bottom. `use-mark-read` posts `read/` when the newest item is visible, debounced 1 s, and on window focus.

## UX rules

- Enter sends, Shift+Enter newline (desktop). On touch devices Enter is newline and the Send button sends.
- Draft text and queued uploads are kept per conversation in the store while navigating within the app (not persisted).
- Edit: inline, Esc cancels. Deleted message: removed from the list immediately (no tombstone — hard delete).
- `#` triggers the work-item picker (reuse the editor's issue-embed extension); `@` the mention picker (conversation members only).
- "Create work item" opens the existing create-issue modal prefilled with `body_stripped` as the title/description and the conversation's project, if any.
- Direct conversation title = other user's display name + `PresenceDot`.
- Group with a linked project shows the project chip in the thread header and a "Chat" entry in that project's navigation (phase 1: header chip only; project nav entry is phase 2).
- Keyboard: `Ctrl/Cmd+K` already opens Power-K; add "Go to chat" and conversations to its index (phase 2).
- RTL: use `ps-/pe-/ms-/me-`, `start/end`, never `left/right` for layout. Test with `dir="rtl"`.
- Dark mode: tokens only, no hex in components.

## Visual spec (from the mockups)

- Font: Inter 13 px body, 12 px meta, 11 px labels; headings 14–16 px medium.
- Colors: `bg-surface-1` panels, `border-subtle` dividers, `text-primary/secondary/tertiary`, accent `bg-accent-primary` / `text-accent-primary`.
- Thread header 52 px; sidebar header matches `SidebarWrapper`; buttons 28 px / `rounded-md`; avatars 28 px in thread, 20 px in sidebar.
- Messages are comment-style (avatar · name · time / body / attachments / reactions row), own messages are not right-aligned or coloured.
- Hover toolbar on a message: React (phase 2), Reply, Create work item, More (Edit, Delete, Copy link).
- Work-item card: state icon · identifier · title · priority badge · assignee avatar, one line.

## i18n

Namespace `chat` → `packages/i18n/src/locales/<lang>/chat.json` **and** `packages/i18n/locales/<lang>/chat.json`; add `"chat"` to `packages/i18n/src/constants/namespaces.ts`. Full key list: `10-i18n-keys.md`.

## New dependencies (pnpm catalog)

```
react-virtuoso            ^4.12
wavesurfer.js             ^7.9
yet-another-react-lightbox ^3.21
partysocket               ^1.1
```

Add to `pnpm-workspace.yaml` catalog, then `catalog:` in `apps/web/package.json` (and `packages/propel` for the two media components).

## As built (PR 4)

- **Types:** `packages/types/src/chat/index.ts`. All REST shapes, payloads, and the socket frame unions (`TChatServerFrame`, `TChatClientFrame`).
- **Service:** `core/services/chat.service.ts`. One method per endpoint. Errors are normalised to `TChatApiError { error, code }`. `uploadToStorage()` posts straight to MinIO/S3 with progress and `AbortSignal`.
- **Socket:** `core/services/chat-socket.ts` (`ChatSocket` over `partysocket/ws`).
  - Statuses: `idle → connecting → open ⇄ reconnecting`, plus `blocked`.
  - Reaching `blocked` (close codes 4400, 4401, 4403, 4404) stops reconnecting.
  - Heartbeat: a ping every 30 s; a ping still unanswered at the next heartbeat forces a reconnect.
  - Typing is throttled client-side to one frame per conversation every 3 s.
  - `onReady(isReconnect)` triggers catch-up.
- **Stores:** `core/store/chat/`, registered as `rootStore.chat`. Use them through `useChat()` (`core/hooks/store/use-chat.ts`).
  - `ChatRootStore` (`root.store.ts`):
    - `init(slug)`, `teardown()`, `openConversation(id)`, `markRead(id)`
    - `send(id, draft)`: takes the ready uploads with it
    - `sendTyping(id)`, `applyFrame(frame)`, `catchUp()`
  - `ChatConversationStore`:
    - `sorted` / `groups` / `directs` / `totalUnread`
    - optimistic `markRead` that never moves backwards
    - `setMuted` rolls back if the server refuses
    - `leave`, `create`, `update`, `remove`
  - `ChatMessageStore`:
    - `items(id)` = confirmed messages in `seq` order, then this tab's pending sends
    - `open` / `loadOlder` / `catchUp`
    - `send` / `retry` / `discardPending` (optimistic, reconciled by `client_id`)
    - `applyCreated` returns `applied | duplicate | gap | not-loaded`; a gap triggers catch-up
    - live "Seen by" via `setReadPositions` + `applyRead`
    - at most 500 live messages kept per thread
  - `ChatUploadStore`:
    - `add(conversationId, files, {isVoice, media})` checks type, size and count before uploading (mirrors the server)
    - up to 3 uploads at a time
    - pipeline: `queued → preparing → uploading → confirming → ready | failed`
    - `retry`, `remove` (also deletes the server record), `takeReady`, `canSend` / `isBusy` / `hasFailures`
    - `prepare` hook for thumbnails, posters and dimensions, wired in PR 6
  - `ChatRealtimeStore`: `typingUserIds(id)` (5 s expiry, cleared by that user's next message), `isOnline(userId)`, socket `status` / `closeCode`.
- **MobX gotcha:** objects that the stores later mutate in place (thread state, pending messages, upload items, typing maps) are made `observable()` _before_ they go into an observable `Map`. Otherwise MobX stores a copy and the in-place mutations are lost.
- **Tests:** vitest in `apps/web` (`pnpm --filter web test`), config `apps/web/vitest.config.ts`, 43 tests covering the socket client and all four stores.

## As built (PR 5)

- **Routes:** `app/(all)/[workspaceSlug]/(chat)/layout.tsx` with `chat/page.tsx` (empty state) and `chat/[conversationId]/page.tsx`, registered in `app/routes/core.ts` as a sibling of the projects section.
  - The layout redirects to the workspace home when chat isn't available (`useChatAvailability`: chat enabled in Superadmin, and the user is a workspace admin or member).
  - On narrow screens the sidebar and the thread take turns.
- **Bootstrap:** `ChatBootstrap`, mounted once in `WorkspaceContentWrapper`, calls `chat.init(slug)`. The socket and the conversation list are live on every page, which keeps the app-rail badge current.
- **App rail:** a Chat item in `navigation/app-rail-hoc.tsx`, with `AppSidebarItemData.badge` (new, generic) showing `chat.conversation.totalUnread`. `useWorkspacePaths` gains `isChatPath`, and Projects is no longer highlighted on chat pages.
- **Components** (`core/components/chat/`):
  - `sidebar/`: header with search and new conversation; collapsible Groups and Direct messages; items show presence, unread, mute, typing and a localised preview.
  - `thread/`:
    - `root` holds the header, connection banner, list, typing line, composer and the details toggle.
    - `message-list` is Virtuoso, with `firstItemIndex` prepend handling, a "new messages" pill, and mark-read when the newest message is visible and the tab is visible.
    - `message-item` renders the body through a read-only `LiteTextEditor`; it has inline edit, delete confirm, reply and copy link.
    - `small-items` has the day divider, system lines, pending and failed sends, and the typing indicator.
  - `composer/`: `LiteTextEditor` with `variant="none"` and images disabled; Enter sends; reply banner; sends typing frames.
  - `modals/`: new conversation (direct or group, workspace-member picker), add members.
  - `details/`: members with admin actions (promote, demote, remove), mute, leave, delete group.
- **i18n:** namespace `chat` (D22).
- **Dependency:** `react-virtuoso` 4.18.19 (catalog).

### Deferred from PR 5 (tracked in PROGRESS.md)

- **"Create work item from message":** needs the create-issue modal to accept prefilled data. Planned for PR 8.
- **Composer drafts kept while switching conversations:** today the composer resets per conversation. Planned for PR 8.
- **Project chip in the thread header and a link from project navigation:** phase 2 (Q2).
- **Copy link:** copies the conversation link, not a message deep link (phase 2).
- **Media and files tabs in the details panel:** PR 6.
