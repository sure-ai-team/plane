# Chat — what's new (phase 2)

Chat in the SURE Project Management Platform now does a lot more than send messages. Here's what changed.

## Talk faster

- **Reactions.** React to any message with any emoji. Hover a message for four quick reactions, or open the picker. Hover a reaction to see who reacted.
- **Reply, forward, pin.** Hover a message for Reply, Pin, Forward and More. Forward sends a message (and copies of its files) to up to 5 conversations, with an optional note.
- **Pinned messages.** Anyone in a conversation can pin up to 50 messages. Pins show in a bar under the header; "View all" lists them, and each one jumps to the message.
- **Jump anywhere.** Click a reply, a pin, a search result or a notification and chat opens the conversation at that message, even if it's months old. "Jump to latest" brings you back.
- **Know what you missed.** A "New" line marks where you left off, and a pill offers to jump to your first unread message.
- **Composer tools.** A formatting toolbar, an emoji button, `:shortcode` emoji suggestions (type `:thu`), and slash commands: `/workitem`, `/link`, `/mute`, `/code`, `/shrug`.
- **Drafts are kept.** Half-written messages stay in each conversation, even after a reload, and the sidebar shows "Draft: …".

## Find things

- **Search messages** across every conversation you're in: filter by conversation, sender, date, or what a message has (file, image, video, voice note, link, work item). Results show surrounding messages; open one to jump to it.
- **People list.** Everyone in the workspace is listed under **People** in the chat sidebar. Click a name to start a direct chat.
- **Sidebar filters and sections.** All / Unread / Mentions, plus Starred, Groups and Direct messages sections. Star the chats you use most; archive the ones you're done with.
- **Power K.** "Go to chat" (`G` then `T`), "Open a conversation" (`O` then `T`) and "Search chat messages".
- **Keyboard shortcuts.** Press `?` in chat for the full list.

## Stay on top without the noise

- **Per-chat notifications:** All messages, Mentions only, or Off, plus snooze for 1 hour, 8 hours or until tomorrow.
- **Desktop notifications and sound** (Chat settings, the gear in the chat sidebar). Only one browser tab notifies, and clicking a notification opens the message.
- **Unread count in the tab title** and a dot on the tab icon when someone mentions you.
- **Chat in Inbox.** Mentions and direct messages also appear in your Inbox (turn this off in Chat settings).

## Chat while you work

- **Minimized chats.** Keep up to three conversations open on any page as docked windows or chat heads, and reply without leaving your work.
- **Bubbles.** Direct messages use chat bubbles (yours on the right). Chat settings let you use bubbles everywhere or nowhere.

## Work items in chat

- **Link work items** with `/link`, create one with `/workitem`, or paste a work-item link or a key like `MOB-12`. Each gets a card with its state, priority, due date, assignee and sub-items. People who can't see the project see only the key.
- **Share to chat** and **Discuss in chat** from any work item. A work item's page shows the conversations that discuss it.
- **Project chats.** A project's **Chat** item shows that project's group chats.

## Phones and accessibility

- On phones, conversations open full screen with a back button. Swipe a conversation to mute or archive it, and long-press a message for its actions.
- If you go offline, messages wait and send when you reconnect.
- New messages are announced to screen readers, and animations respect "reduce motion".

## Every language

Chat is fully translated into all 19 languages the platform supports. Dates and times follow your chosen language.

## For admins

- No new settings are required. New optional rate limits: `CHAT_REACT_RATE` (default 60/minute), `CHAT_SEARCH_RATE` (30/minute), `CHAT_PIN_RATE` (20/minute).
- Upgrade steps: [`DEPLOYMENT.md`](./DEPLOYMENT.md).
