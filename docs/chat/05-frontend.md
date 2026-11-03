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
