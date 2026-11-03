# 04 — Frontend (apps/web)

Builds on phase 1's `core/components/chat/` and `core/store/chat/`. Same rules: MobX stores, `observable()` before inserting into maps (phase 1 gotcha), `@plane/propel` primitives, no UI kit (D21), i18n keys in `chat.*` (see [10-i18n-keys.md](10-i18n-keys.md)).

## Store changes

| Store                    | Additions                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| `message.store`          | `reactions` per message; `toggleReaction`; pins (`pinnedIds`, `fetchPins`, `pin`, `unpin`); `loadAround(seq)`; `forward`; `highlightedMessageId` (clears after 2 s) |
| `conversation.store`     | `notify_level`, `snoozed_until`, `is_starred`, `archived_at`, `description`; `updateMySettings`; `filter: all                                                       | unread | mentions`; `archived` list; sections (starred / groups / direct) as computed values |
| `preference.store` (new) | `ChatPreference`; `update`; reacts to `preferences.updated`                                                                                                         |
| `search.store` (new)     | query, filters, results, cursor, `selectedIndex`, context preview                                                                                                   |
| `dock.store` (new)       | `openIds` (max 3, newest first), `minimizedIds`, `heads`; persisted in `localStorage` per workspace (`chat:dock:<slug>`)                                            |
| `notify.store` (new)     | Permission state, leader election, `shouldNotify(message)`, sound, tab title, favicon dot                                                                           |
| `root.store` drafts      | Persist to `localStorage` (`chat:drafts:<slug>`, debounced 500 ms, cleared on send). Sidebar reads `hasDraft(id)`                                                   |
| `realtime.store`         | Handlers for the events in `03`                                                                                                                                     |

## Features

### Reactions — `thread/reactions.tsx`, `common/emoji-picker.tsx` [P2Thread]

- Chips under the message: emoji + count. Your own reaction is highlighted. A tooltip lists up to 10 names, then "and N others". Clicking toggles.
- Hover toolbar: four quick reactions (👍 ❤️ 😂 🎉), then Reply, Pin, Forward, Copy link, More. Keyboard: focus a message, `E` opens the picker.
- Picker: search, Frequently used (per user, `localStorage`), categories. Emoji data comes from a pinned `emoji-mart`-compatible JSON loaded lazily (P2-D12). The same picker serves the composer.
- Optimistic update with rollback on error.

### Pins — `thread/pinned-bar.tsx`, `details/pins-tab.tsx`

- A bar under the header shows the newest pin with "1 of N" and next/previous. Clicking jumps to the message.
- Pinned panel (right side, replaces details while open) with "Jump" per pin.
- Pin/unpin from the toolbar and the More menu. A system line appears in the thread.

### Reply jump, message links, highlight

- A reply quote is a button. If the original is loaded, scroll to it; otherwise `loadAround(seq)`, then scroll. The target gets the highlight background for 2 s ("Jumped here from a reply").
- "Copy link" copies `/<slug>/chat/<conversationId>?m=<messageId>`. Opening that URL calls `loadAround`. If you're not a member, show "You don't have access to this message".
- Virtuoso: use `initialTopMostItemIndex` / `scrollToIndex` with the loaded window. Keep phase 1's `firstItemIndex` prepend logic.

### Unread divider and jump pill

- On open, capture `last_read_seq` before marking read. Render a "New" divider above the first message after it.
- If the first unread is off-screen: a floating pill "N new messages since HH:MM — Jump · ×". `×` marks read without jumping. `Shift+J` jumps.
- The divider stays until the conversation is reopened.

### Forward — `modals/forward.tsx`

- Conversation picker (multi-select up to 5, search), optional note, preview of the message. Calls `POST messages/<id>/forward/`.
- Forwarded messages render a "Forwarded from <name>" header. The conversation name is a link only when the API returns it.

### "(edited)"

Shown next to the time when `edited_at` is set. The tooltip shows the edit time.

### Sidebar — `sidebar/root.tsx` [P2Thread, P2MobileList]

- Filter chips: All / Unread N / Mentions N.
- Sections: **Starred** (if any), **Groups**, **Direct messages**, each collapsible (state in `localStorage`). An **Archived · N** link at the bottom opens the archived list.
- Row extras: red `@` badge when you're mentioned, a "Draft: …" second line, a muted icon when `notify_level = off` or snoozed, and "last seen" (from presence) for direct messages.
- Context menu on a row: Star, Mark as read, Notifications ▸, Archive.

### Search — route `/<slug>/chat/search` [P2Search]

- Opened from the sidebar search icon, `Ctrl+Shift+F`, Power K, or the in-thread search (pre-filters `In: this conversation`).
- Filters: In (conversation picker), From (member picker), Has (file, image, video, voice, link, work item), Date (presets + range).
- Results grouped by conversation with `<mark>` highlights (server-provided, rendered via sanitized HTML). The right pane shows context (`around_seq`, 2 before / 2 after). `↑ ↓` move, `Enter` jumps.
- Empty and no-results states. Query and filters live in the URL so results can be shared.

### Power K and shortcuts [P2PowerK]

- Register a "Chat" group in the existing Power K command registry: conversations (by name, direct partner name), plus "Go to chat" (`G C`), "New conversation", and "Search messages for '<query>'".
- Shortcuts in `hooks/use-chat-shortcuts.ts`, active only on chat routes or in a focused dock window. Never when typing in an input except `Esc` and `↑` (in an empty composer). A `?` sheet lists them.

### Notifications UI [P2Notify]

- Thread header button with the current level → popover (All / Mentions only / Off + Snooze 1 h / 8 h / until tomorrow 08:00 local).
- Profile settings → new "Chat" section with the four toggles and the permission banner ("Your browser is blocking notifications" + help link).
- Inbox: chat rows render with the chat badge, conversation name and snippet. Clicking opens the message in chat.
- Permission prompt: only after a user action (e.g. turning the toggle on), never on page load.

### Composer [P2Composer]

- Formatting toolbar row above the editor: Bold, Italic, Strike, Inline code / Code block, Bulleted and numbered list, Quote, Link. Uses `LiteTextEditor`'s existing commands (no new editor). Markdown shortcuts keep working.
- Emoji button → shared picker. Typing `:` + 2 characters → inline shortcode suggestions.
- Slash commands (`/` at the start of an empty line): `/workitem`, `/link`, `/mute`, `/code`, `/shrug`. They're client-side only; each maps to an existing action. Implemented as a Tiptap suggestion extension next to mentions.
- Drafts persist (see store). "Draft saved" hint after the first save.

### Minimized chat (dock) [P2Docked]

- `components/chat/dock/` mounted once in the workspace layout (next to `ChatBootstrap`). Hidden on chat routes and below 768 px.
- Entry points: "Open in a window" in a conversation's More menu, "Discuss in chat" on work items, clicking a desktop notification while on another page, and the dock launcher.
- Up to **3 expanded windows** (300 × 460, right-aligned with 12 px gaps). Opening a fourth minimizes the oldest to a tab. Windows show a compact thread (bubbles always), composer with attach and voice, typing indicator, and an "Open in full chat" button.
- Minimized tab: header only, with unread badge. **Chat heads** (if `minimize_style = heads`): 52 px avatars stacked on the right edge, with unread badge and hover preview. They're draggable vertically, and their position persists.
- The launcher shows total unread; expanding it gives a compact conversation list.
- State persists across navigation and reloads (`dock.store`). Windows share the same message store as the full page (no duplicate fetching).
- Focus management: each window is a `role="dialog"` with `aria-label`. `Esc` minimizes. Focus returns to the launcher.

### Bubbles layout [P2Bubbles]

- `thread/message-item.tsx` gets a `layout` prop. Bubbles = own messages right-aligned on the primary color, others left on the neutral background. Runs from the same sender within 5 minutes share one name and avatar, with corner radii by position.
- Reactions overlap the bubble's bottom edge. Reply quotes sit inside the bubble. Attachments get bubble corners. "Seen by" sits under your last message.
- The layout comes from preferences (`message_layout`, `bubbles_direct_only`). Dock windows always use bubbles. Same DOM order and ARIA in both layouts.

### Work-item integration [P2Project]

- **Rich card**: state icon, identifier, title, then chips for state, priority, due date and assignee, plus sub-item progress. Data comes from a `workItemCache` that batches by project through the existing issue APIs. If you can't view the project: a plain "Work item" chip with no details.
- **Share to chat**: a button in the work-item header → dialog (To: up to 5 conversations, optional note, card preview) → sends a message with the embed.
- **Discuss in chat**: opens a dock window with a picker. The project-linked groups come first, or "New group for this project". The composer is prefilled with the work-item embed.
- **Project navigation**: a "Chat" entry under the project (after Intake). It lists project-linked groups you belong to, with unread badges, and opens them in the full chat page.
- **"Discussed in chat"** section on the work-item page (`chat-references` endpoint). It's collapsed when empty, and only lists conversations you're in.

### Polish, mobile, states [P2States, P2Mobile*]

- **Phone layout** (< 768 px): the list and the thread are separate screens with a back button. Details and pins open as full-screen sheets.
- **Gestures**: swipe a row left for Mute / Archive. Long-press a message opens a bottom sheet with quick reactions and actions. Touch targets are at least 44 px.
- **States**: a skeleton when loading a thread. First-visit empty state with CTAs. An empty new conversation ("Say hi" / "Share a work item"). An offline banner with queued sends ("Waiting to send"), then "Back online · caught up on N".
- **Media gallery**: details → Media tab gets a "View all" grid with filters (images / videos), opening the existing lightbox.
- **Accessibility pass**: keyboard reachability of every action, focus rings, `aria-live="polite"` for new messages in the open thread (throttled), reduced motion, contrast check on bubbles and badges.
