# Phase 2 decisions

Format as in `docs/chat/DECISIONS.md`. All decisions below were locked on 2026-11-03 (the user accepted the proposed defaults).

## P2-D0 — 2026-11-03 — Scope and notification reach — Locked

**Decision:** phase 2 covers themes A–G plus minimized chat and the bubbles layout. Notifications are in-app + desktop while a tab is open. Mockups first, then specs.
**Why:** user decisions on 2026-11-03.

## P2-D1 — Reactions use any emoji — Locked

**Decision:** any single Unicode emoji from the picker, four quick reactions on hover, max 20 distinct emoji per message, one reaction per (user, emoji).
**Why:** a fixed set feels limiting; the cap stops abuse.

## P2-D2 — Any member can pin; 50 pins per conversation — Locked

**Decision:** active members (not only group admins) pin and unpin. Each change posts a system line, so it's visible.
**Why:** small teams; the system line keeps it accountable.

## P2-D3 — Search is Postgres full-text with the `simple` config — Locked

**Decision:** GIN index on `to_tsvector('simple', body_stripped)`, prefix matching, active-membership filter. No external search engine.
**Why:** no new services (phase 1 principle); `simple` treats Arabic and English the same; volume (<500 users) fits Postgres.
**Consequences:** no stemming ("deploy" won't match "deployment" unless typed as a prefix).

## P2-D4 — Notification levels replace mute — Locked

**Decision:** `notify_level` (all / mentions / off) + `snoozed_until` per member. Defaults: all for direct messages, mentions for groups. Phase 1 mute maps to `off`.
**Why:** mute-or-nothing is too coarse once desktop notifications exist.

## P2-D5 — Chat uses the existing Inbox model — Locked

**Decision:** `Notification` rows with `entity_name = "chat_message"`. One unread row per direct conversation; one row per mention. Reading in chat marks them read.
**Why:** one place for "things that need me"; avoids flooding the Inbox with every DM.

## P2-D6 — Forward copies; source name only for members — Locked

**Decision:** forwarding creates new messages with copied attachments (server-side). The "Forwarded from" header shows the original sender. The source conversation's name and link only appear for viewers who are members of it.
**Why:** hard delete stays per copy; no leaking private group names.

## P2-D7 — Message links use `?m=<id>` and `around_seq` — Locked

**Decision:** `/<slug>/chat/<conversationId>?m=<messageId>`; the client resolves the seq via the message endpoint and loads a window around it.

## P2-D8 — Archive is sticky — Locked

**Decision:** archived conversations stay archived when new messages arrive. Mentions still show under the Mentions filter and in the Inbox. The Archived link shows its unread count.
**Why:** archive is for quiet conversations; auto-unarchive defeats it.

## P2-D9 — Drafts stay client-side, now persisted — Locked

**Decision:** drafts are saved in `localStorage`, keyed by user + workspace + conversation, and cleared on send and on sign-out. No server sync.
**Why:** cheap; cross-device drafts aren't needed now.

## P2-D10 — Minimized chat: docked tabs by default, chat heads optional — Locked

**Decision:** up to 3 expanded dock windows, older ones collapse to tabs. A preference switches to chat heads. Desktop only (≥ 768 px). Hidden on chat routes. State persists per user + workspace.
**Why:** docked tabs suit a work tool. Chat heads were asked for, so they're kept as an option.

## P2-D11 — Bubbles layout, per-user setting — Locked

**Decision:** preference `message_layout` (default `bubbles`) with `bubbles_direct_only` (default true), so groups stay compact unless changed. Dock windows always use bubbles.
**Why:** bubbles read well in 1:1; dense group discussions scan better compact.

## P2-D12 — Emoji data loaded lazily — Locked

**Decision:** emoji metadata (names, keywords, categories) as a static JSON chunk loaded on first picker open; native emoji glyphs (no image sprite).
**Why:** keeps the chat bundle small; native glyphs match the OS.

## P2-D13 — Structured work-item references — Locked

**Decision:** on send/edit, extract work-item embeds/links (same workspace) into `MessageWorkItem`. Cards fetch details through existing issue APIs, so project permissions apply. "Discussed in chat" lists only the viewer's conversations.
**Why:** enables rich cards, the details tab and reverse lookup without leaking private projects.

## P2-D14 — Deferred to a later phase — Locked

Web push without an open tab, email digests, link previews, video conversion, custom status, `/remind`, side threads.
