/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/* oxlint-disable unicorn/no-array-sort -- the web app targets ES2022 (no toSorted); every sort here runs on a fresh array copy */

import { action, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
import type {
  TChatApiError,
  TChatAttachment,
  TChatMessage,
  TChatPinnedMessage,
  TChatReplyPreview,
  TChatUser,
} from "@plane/types";
import { applyReaction } from "./reactions";
import type { IChatServiceLike } from "./types";

export const PAGE_SIZE = 50;
/** Live appends beyond this drop the oldest loaded messages (they can be paged back in). */
export const MAX_LIVE_MESSAGES = 500;
const MAX_CATCH_UP_PAGES = 20;

export type TThreadState = {
  bySeq: Map<number, TChatMessage>;
  oldestSeq: number | null;
  newestSeq: number | null;
  hasMoreBefore: boolean;
  /** True after jumping to an older message: newer messages exist that aren't loaded. */
  hasMoreAfter: boolean;
  isLoadingInitial: boolean;
  isLoadingOlder: boolean;
  isLoadingNewer: boolean;
  isLoaded: boolean;
  error: string | null;
};

export type TPinState = {
  items: TChatPinnedMessage[];
  isLoaded: boolean;
  isLoading: boolean;
};

/** Ask the list to scroll to a message and highlight it ("jumped here"). */
export type TFocusRequest = {
  conversationId: string;
  messageId: string;
  seq: number;
  nonce: number;
};

export type TPendingStatus = "sending" | "failed";

/** A message shown immediately while the server confirms it. */
export type TPendingMessage = {
  client_id: string;
  conversation_id: string;
  body_html: string;
  body_json: Record<string, unknown>;
  body_stripped: string;
  reply_to: TChatReplyPreview | null;
  attachment_ids: string[];
  attachments: TChatAttachment[];
  sender: TChatUser | null;
  created_at: string;
  status: TPendingStatus;
  error: TChatApiError | null;
};

export type TThreadItem = { type: "message"; message: TChatMessage } | { type: "pending"; pending: TPendingMessage };

export type TSendDraft = {
  body_html: string;
  body_json?: Record<string, unknown>;
  body_stripped: string;
  reply_to?: TChatReplyPreview | null;
  attachment_ids?: string[];
  attachments?: TChatAttachment[];
};

/** Socket payloads omit `reactions` (they are per viewer): keep the ones already loaded. */
const withLocalReactions = (incoming: TChatMessage, current: TChatMessage): TChatMessage =>
  incoming.reactions === undefined && current.reactions !== undefined
    ? { ...incoming, reactions: current.reactions }
    : incoming;

export type TApplyResult = "applied" | "duplicate" | "gap" | "not-loaded";

const emptyThread = (): TThreadState => ({
  bySeq: new Map(),
  oldestSeq: null,
  newestSeq: null,
  hasMoreBefore: true,
  hasMoreAfter: false,
  isLoadingInitial: false,
  isLoadingOlder: false,
  isLoadingNewer: false,
  isLoaded: false,
  error: null,
});

export class ChatMessageStore {
  threads = new Map<string, TThreadState>();
  pending = new Map<string, TPendingMessage>();
  /** member id -> last read seq, per conversation (for live "Seen by"). */
  readPositions = new Map<string, Map<string, number>>();
  /** Pinned messages per conversation (loaded when the pinned bar or panel needs them). */
  pins = new Map<string, TPinState>();
  /** Last read seq when the conversation was opened: the "New" divider goes after it. */
  unreadMarkers = new Map<string, number>();
  focusRequest: TFocusRequest | null = null;
  private focusNonce = 0;

  constructor(
    private readonly service: IChatServiceLike,
    private readonly currentUser: () => TChatUser | null,
    private readonly createClientId: () => string,
    private readonly now: () => Date = () => new Date()
  ) {
    makeObservable(this, {
      threads: observable,
      pending: observable,
      readPositions: observable,
      pins: observable,
      unreadMarkers: observable,
      focusRequest: observable.ref,
      applyReactionEvent: action,
      applyPinChanged: action,
      setUnreadMarker: action,
      clearFocusRequest: action,
      applyCreated: action,
      applyUpdated: action,
      applyDeleted: action,
      applyRead: action,
      setReadPositions: action,
      dropConversation: action,
      reset: action,
      discardPending: action,
    });
  }

  // ------------------------------------------------------------------ getters

  thread = (conversationId: string): TThreadState | undefined => this.threads.get(conversationId);

  /** Messages in seq order, then this tab's pending sends in the order they were made. */
  items = computedFn((conversationId: string): TThreadItem[] => {
    const thread = this.threads.get(conversationId);
    const confirmed: TThreadItem[] = thread
      ? Array.from(thread.bySeq.values())
          .sort((a, b) => a.seq - b.seq)
          .map((message) => ({ type: "message", message }))
      : [];
    const pending: TThreadItem[] = Array.from(this.pending.values())
      .filter((item) => item.conversation_id === conversationId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((item) => ({ type: "pending", pending: item }));
    return [...confirmed, ...pending];
  });

  private ensureThread(conversationId: string): TThreadState {
    let thread = this.threads.get(conversationId);
    if (!thread) {
      // Make it observable first so the map keeps this exact object (not a copy).
      thread = observable(emptyThread());
      this.threads.set(conversationId, thread);
    }
    return thread;
  }

  private insert(thread: TThreadState, messages: TChatMessage[]) {
    for (const message of messages) {
      thread.bySeq.set(message.seq, message);
      thread.oldestSeq = thread.oldestSeq === null ? message.seq : Math.min(thread.oldestSeq, message.seq);
      thread.newestSeq = thread.newestSeq === null ? message.seq : Math.max(thread.newestSeq, message.seq);
      if (message.client_id) this.pending.delete(message.client_id);
    }
  }

  private trimOldest(thread: TThreadState) {
    if (thread.bySeq.size <= MAX_LIVE_MESSAGES) return;
    const seqs = Array.from(thread.bySeq.keys()).sort((a, b) => a - b);
    const dropCount = seqs.length - MAX_LIVE_MESSAGES;
    for (const seq of seqs.slice(0, dropCount)) thread.bySeq.delete(seq);
    thread.oldestSeq = seqs[dropCount] ?? null;
    thread.hasMoreBefore = true;
  }

  // ------------------------------------------------------------------ loading

  /** First load of a thread; on later calls just catches up on anything new. */
  async open(workspaceSlug: string, conversationId: string): Promise<void> {
    const thread = this.threads.get(conversationId);
    if (thread?.isLoaded) {
      await this.catchUp(workspaceSlug, conversationId);
      return;
    }
    const state = runInAction(() => {
      const created = this.ensureThread(conversationId);
      created.isLoadingInitial = true;
      created.error = null;
      return created;
    });
    try {
      const page = await this.service.listMessages(workspaceSlug, conversationId, { limit: PAGE_SIZE });
      runInAction(() => {
        this.insert(state, page.results);
        state.hasMoreBefore = page.has_more;
        state.isLoaded = true;
      });
    } catch (error) {
      runInAction(() => {
        state.error = (error as TChatApiError)?.error ?? "Couldn't load messages.";
      });
    } finally {
      runInAction(() => {
        state.isLoadingInitial = false;
      });
    }
  }

  async loadOlder(workspaceSlug: string, conversationId: string): Promise<number> {
    const thread = this.threads.get(conversationId);
    if (!thread || !thread.isLoaded || !thread.hasMoreBefore || thread.isLoadingOlder || thread.oldestSeq === null) {
      return 0;
    }
    runInAction(() => {
      thread.isLoadingOlder = true;
    });
    try {
      const page = await this.service.listMessages(workspaceSlug, conversationId, {
        before_seq: thread.oldestSeq,
        limit: PAGE_SIZE,
      });
      runInAction(() => {
        this.insert(thread, page.results);
        thread.hasMoreBefore = page.has_more;
      });
      return page.results.length;
    } catch {
      return 0;
    } finally {
      runInAction(() => {
        thread.isLoadingOlder = false;
      });
    }
  }

  /** Fetch everything after the newest known message (after a reconnect or a detected gap). */
  async catchUp(workspaceSlug: string, conversationId: string): Promise<number> {
    const thread = this.threads.get(conversationId);
    // A window opened around an older message pages forward on demand instead.
    if (!thread?.isLoaded || thread.hasMoreAfter) return 0;
    let fetched = 0;
    for (let page = 0; page < MAX_CATCH_UP_PAGES; page += 1) {
      const after = thread.newestSeq ?? 0;
      // eslint-disable-next-line no-await-in-loop -- pages must be fetched in order
      const result = await this.service.listMessages(workspaceSlug, conversationId, {
        after_seq: after,
        limit: 100,
      });
      runInAction(() => {
        this.insert(thread, result.results);
        this.trimOldest(thread);
      });
      fetched += result.results.length;
      if (!result.has_more) break;
    }
    return fetched;
  }

  /**
   * Load the page around `seq` (reply jumps, pins, search results, message links).
   * Replaces the loaded window when the message isn't in it. Returns whether the
   * message exists.
   */
  async loadAround(workspaceSlug: string, conversationId: string, seq: number): Promise<boolean> {
    const existing = this.threads.get(conversationId);
    if (existing?.isLoaded && existing.bySeq.has(seq)) return true;
    const page = await this.service.listMessages(workspaceSlug, conversationId, { around_seq: seq, limit: PAGE_SIZE });
    runInAction(() => {
      const thread = this.ensureThread(conversationId);
      thread.bySeq.clear();
      thread.oldestSeq = null;
      thread.newestSeq = null;
      this.insert(thread, page.results);
      thread.hasMoreBefore = page.has_before ?? page.has_more;
      thread.hasMoreAfter = page.has_after ?? false;
      thread.isLoaded = true;
      thread.isLoadingInitial = false;
      thread.error = null;
    });
    return page.results.some((message) => message.seq === seq);
  }

  /** Page forward in a window opened around an older message. */
  async loadNewer(workspaceSlug: string, conversationId: string): Promise<number> {
    const thread = this.threads.get(conversationId);
    if (!thread?.isLoaded || !thread.hasMoreAfter || thread.isLoadingNewer || thread.newestSeq === null) return 0;
    runInAction(() => {
      thread.isLoadingNewer = true;
    });
    try {
      const page = await this.service.listMessages(workspaceSlug, conversationId, {
        after_seq: thread.newestSeq,
        limit: PAGE_SIZE,
      });
      runInAction(() => {
        this.insert(thread, page.results);
        thread.hasMoreAfter = page.has_more;
        this.trimOldest(thread);
      });
      return page.results.length;
    } catch {
      return 0;
    } finally {
      runInAction(() => {
        thread.isLoadingNewer = false;
      });
    }
  }

  /** Leave a jumped-to window and load the newest messages again. */
  async jumpToLatest(workspaceSlug: string, conversationId: string): Promise<void> {
    runInAction(() => {
      const thread = this.ensureThread(conversationId);
      Object.assign(thread, { ...emptyThread(), bySeq: thread.bySeq });
      thread.bySeq.clear();
    });
    await this.open(workspaceSlug, conversationId);
  }

  /**
   * Scroll to a message by seq or id, loading its page first if needed.
   * Throws a `NOT_FOUND` error when the message is gone or not accessible.
   */
  async jumpToMessage(
    workspaceSlug: string,
    conversationId: string,
    target: { seq?: number; messageId?: string }
  ): Promise<void> {
    let { seq, messageId } = target;
    if (seq === undefined && messageId) {
      const message = await this.service.getMessage(workspaceSlug, messageId);
      if (message.conversation_id !== conversationId) {
        throw { error: "That message isn't in this conversation.", code: "NOT_FOUND" } satisfies TChatApiError;
      }
      seq = message.seq;
    }
    if (seq === undefined) return;
    const found = await this.loadAround(workspaceSlug, conversationId, seq);
    if (!found) throw { error: "That message no longer exists.", code: "NOT_FOUND" } satisfies TChatApiError;
    const message = this.threads.get(conversationId)?.bySeq.get(seq);
    runInAction(() => {
      this.focusNonce += 1;
      this.focusRequest = {
        conversationId,
        messageId: messageId ?? message?.id ?? "",
        seq: seq as number,
        nonce: this.focusNonce,
      };
    });
  }

  clearFocusRequest() {
    this.focusRequest = null;
  }

  setUnreadMarker(conversationId: string, lastReadSeq: number | null) {
    if (lastReadSeq === null) this.unreadMarkers.delete(conversationId);
    else this.unreadMarkers.set(conversationId, lastReadSeq);
  }

  // ------------------------------------------------------------------ sending

  async send(workspaceSlug: string, conversationId: string, draft: TSendDraft): Promise<TChatMessage | undefined> {
    const pending: TPendingMessage = observable({
      client_id: this.createClientId(),
      conversation_id: conversationId,
      body_html: draft.body_html,
      body_json: draft.body_json ?? {},
      body_stripped: draft.body_stripped,
      reply_to: draft.reply_to ?? null,
      attachment_ids: draft.attachment_ids ?? [],
      attachments: draft.attachments ?? [],
      sender: this.currentUser(),
      created_at: this.now().toISOString(),
      status: "sending",
      error: null,
    } as TPendingMessage);
    runInAction(() => this.pending.set(pending.client_id, pending));
    return this.deliver(workspaceSlug, pending);
  }

  async retry(workspaceSlug: string, clientId: string): Promise<TChatMessage | undefined> {
    const pending = this.pending.get(clientId);
    if (!pending || pending.status !== "failed") return undefined;
    runInAction(() => {
      pending.status = "sending";
      pending.error = null;
    });
    return this.deliver(workspaceSlug, pending);
  }

  discardPending(clientId: string) {
    this.pending.delete(clientId);
  }

  private async deliver(workspaceSlug: string, pending: TPendingMessage): Promise<TChatMessage | undefined> {
    try {
      const message = await this.service.sendMessage(workspaceSlug, pending.conversation_id, {
        body_html: pending.body_html,
        body_json: pending.body_json,
        reply_to_id: pending.reply_to?.id ?? null,
        client_id: pending.client_id,
        attachment_ids: pending.attachment_ids,
      });
      runInAction(() => {
        // The server confirmed it: same path as a socket event (deduplicated by seq / client_id).
        this.applyCreated(message);
        this.pending.delete(pending.client_id);
      });
      return message;
    } catch (error) {
      runInAction(() => {
        const current = this.pending.get(pending.client_id);
        if (current) {
          current.status = "failed";
          current.error = (error as TChatApiError) ?? { error: "Couldn't send.", code: "UNKNOWN" };
        }
      });
      return undefined;
    }
  }

  async edit(workspaceSlug: string, message: TChatMessage, bodyHtml: string, bodyJson?: Record<string, unknown>) {
    const updated = await this.service.editMessage(workspaceSlug, message.id, {
      body_html: bodyHtml,
      body_json: bodyJson,
    });
    runInAction(() => this.applyUpdated(updated));
    return updated;
  }

  async remove(workspaceSlug: string, message: TChatMessage): Promise<void> {
    await this.service.deleteMessage(workspaceSlug, message.id);
    runInAction(() => this.applyDeleted(message.conversation_id, message.seq));
  }

  // ------------------------------------------------------------------ reactions

  private patchMessage(conversationId: string, seq: number, update: (message: TChatMessage) => TChatMessage) {
    const thread = this.threads.get(conversationId);
    const current = thread?.bySeq.get(seq);
    if (thread && current) thread.bySeq.set(seq, update(current));
  }

  private findMessage(conversationId: string, messageId: string): TChatMessage | undefined {
    const thread = this.threads.get(conversationId);
    if (!thread) return undefined;
    for (const message of thread.bySeq.values()) if (message.id === messageId) return message;
    return undefined;
  }

  /** Add or remove my reaction, updating the UI first and rolling back on failure. */
  async toggleReaction(workspaceSlug: string, message: TChatMessage, emoji: string): Promise<void> {
    const me = this.currentUser()?.id;
    if (!me) return;
    const current = this.findMessage(message.conversation_id, message.id) ?? message;
    const before = current.reactions ?? [];
    const added = !before.find((entry) => entry.emoji === emoji)?.reacted;
    runInAction(() =>
      this.patchMessage(message.conversation_id, message.seq, (value) => ({
        ...value,
        reactions: applyReaction(value.reactions ?? [], { emoji, userId: me, added, isMe: true }),
      }))
    );
    try {
      if (added) {
        const summary = await this.service.addReaction(workspaceSlug, message.id, emoji);
        runInAction(() =>
          this.patchMessage(message.conversation_id, message.seq, (value) => ({ ...value, reactions: summary }))
        );
      } else {
        await this.service.removeReaction(workspaceSlug, message.id, emoji);
      }
    } catch (error) {
      runInAction(() =>
        this.patchMessage(message.conversation_id, message.seq, (value) => ({ ...value, reactions: before }))
      );
      throw error;
    }
  }

  applyReactionEvent(event: {
    conversation_id: string;
    message_id: string;
    emoji: string;
    count: number;
    user_id: string;
    added: boolean;
  }) {
    const message = this.findMessage(event.conversation_id, event.message_id);
    if (!message) return;
    const isMe = event.user_id === this.currentUser()?.id;
    this.patchMessage(event.conversation_id, message.seq, (value) => ({
      ...value,
      reactions: applyReaction(value.reactions ?? [], {
        emoji: event.emoji,
        userId: event.user_id,
        added: event.added,
        isMe,
        count: event.count,
      }),
    }));
  }

  // ------------------------------------------------------------------ pins

  pinState = (conversationId: string): TPinState | undefined => this.pins.get(conversationId);

  async fetchPins(workspaceSlug: string, conversationId: string): Promise<void> {
    let state = this.pins.get(conversationId);
    if (!state) {
      state = observable({ items: [], isLoaded: false, isLoading: false } as TPinState);
      runInAction(() => this.pins.set(conversationId, state as TPinState));
    }
    const pinState = state;
    runInAction(() => {
      pinState.isLoading = true;
    });
    try {
      const items = await this.service.listPins(workspaceSlug, conversationId);
      runInAction(() => {
        pinState.items = items;
        pinState.isLoaded = true;
      });
    } finally {
      runInAction(() => {
        pinState.isLoading = false;
      });
    }
  }

  async pin(workspaceSlug: string, message: TChatMessage): Promise<void> {
    await this.service.pinMessage(workspaceSlug, message.id);
    runInAction(() => this.applyPinChanged(message.conversation_id, message.id, true));
    if (this.pins.get(message.conversation_id)?.isLoaded) await this.fetchPins(workspaceSlug, message.conversation_id);
  }

  async unpin(workspaceSlug: string, message: TChatMessage): Promise<void> {
    await this.service.unpinMessage(workspaceSlug, message.id);
    runInAction(() => this.applyPinChanged(message.conversation_id, message.id, false));
    if (this.pins.get(message.conversation_id)?.isLoaded) await this.fetchPins(workspaceSlug, message.conversation_id);
  }

  /** Reflect a pin change on the loaded message and the pinned list. */
  applyPinChanged(conversationId: string, messageId: string, pinned: boolean) {
    const message = this.findMessage(conversationId, messageId);
    if (message) this.patchMessage(conversationId, message.seq, (value) => ({ ...value, is_pinned: pinned }));
    const state = this.pins.get(conversationId);
    if (state && !pinned) state.items = state.items.filter((item) => item.id !== messageId);
  }

  // ------------------------------------------------------------------ forward

  forward(workspaceSlug: string, messageId: string, conversationIds: string[], commentHtml?: string) {
    return this.service.forwardMessage(workspaceSlug, messageId, {
      conversation_ids: conversationIds,
      ...(commentHtml ? { comment_html: commentHtml } : {}),
    });
  }

  // ------------------------------------------------------------------ socket events

  applyCreated(message: TChatMessage): TApplyResult {
    if (message.client_id) this.pending.delete(message.client_id);
    const thread = this.threads.get(message.conversation_id);
    if (!thread?.isLoaded || thread.hasMoreAfter) return "not-loaded";
    const existing = thread.bySeq.get(message.seq);
    if (existing) {
      thread.bySeq.set(message.seq, withLocalReactions(message, existing));
      return "duplicate";
    }
    const isGap = thread.newestSeq !== null && message.seq > thread.newestSeq + 1;
    this.insert(thread, [message]);
    this.trimOldest(thread);
    return isGap ? "gap" : "applied";
  }

  applyUpdated(message: TChatMessage) {
    const thread = this.threads.get(message.conversation_id);
    const current = thread?.bySeq.get(message.seq);
    if (!thread || !current) return;
    // Keep the newer edit if events arrive out of order.
    if (current.edited_at && message.edited_at && current.edited_at > message.edited_at) return;
    thread.bySeq.set(message.seq, withLocalReactions(message, current));
  }

  applyDeleted(conversationId: string, seq: number) {
    const thread = this.threads.get(conversationId);
    if (!thread) return;
    const removed = thread.bySeq.get(seq);
    thread.bySeq.delete(seq);
    if (!removed) return;
    // Replies to the deleted message lose their quote, as on the server.
    for (const [key, message] of thread.bySeq) {
      if (message.reply_to?.id === removed.id) thread.bySeq.set(key, { ...message, reply_to: null });
    }
  }

  setReadPositions(conversationId: string, positions: Array<{ userId: string; seq: number }>) {
    this.readPositions.set(conversationId, new Map(positions.map((position) => [position.userId, position.seq])));
  }

  /** Another member read up to `seq`: bump "Seen by" on my messages they hadn't seen yet. */
  applyRead(conversationId: string, userId: string, seq: number) {
    const me = this.currentUser()?.id;
    if (!me || userId === me) return;
    const positions = this.readPositions.get(conversationId);
    const previous = positions?.get(userId);
    if (positions) positions.set(userId, Math.max(previous ?? 0, seq));
    if (previous === undefined) return; // unknown starting point: avoid double counting
    if (seq <= previous) return;
    const thread = this.threads.get(conversationId);
    if (!thread) return;
    for (const [key, message] of thread.bySeq) {
      if (message.sender?.id === me && message.seq > previous && message.seq <= seq) {
        thread.bySeq.set(key, { ...message, seen_by_count: message.seen_by_count + 1 });
      }
    }
  }

  dropConversation(conversationId: string) {
    this.threads.delete(conversationId);
    this.readPositions.delete(conversationId);
    this.pins.delete(conversationId);
    this.unreadMarkers.delete(conversationId);
    for (const [clientId, pending] of this.pending) {
      if (pending.conversation_id === conversationId) this.pending.delete(clientId);
    }
  }

  /** Threads with loaded history (to catch up after a reconnect). */
  loadedConversationIds(): string[] {
    return Array.from(this.threads.entries())
      .filter(([, thread]) => thread.isLoaded)
      .map(([conversationId]) => conversationId);
  }

  reset() {
    this.threads.clear();
    this.pending.clear();
    this.readPositions.clear();
    this.pins.clear();
    this.unreadMarkers.clear();
    this.focusRequest = null;
  }
}
