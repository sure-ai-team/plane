/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/* oxlint-disable unicorn/no-array-sort -- the web app targets ES2022 (no toSorted); every sort here runs on a fresh array copy */

import { action, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
import type { TChatApiError, TChatAttachment, TChatMessage, TChatReplyPreview, TChatUser } from "@plane/types";
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
  isLoadingInitial: boolean;
  isLoadingOlder: boolean;
  isLoaded: boolean;
  error: string | null;
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

export type TApplyResult = "applied" | "duplicate" | "gap" | "not-loaded";

const emptyThread = (): TThreadState => ({
  bySeq: new Map(),
  oldestSeq: null,
  newestSeq: null,
  hasMoreBefore: true,
  isLoadingInitial: false,
  isLoadingOlder: false,
  isLoaded: false,
  error: null,
});

export class ChatMessageStore {
  threads = new Map<string, TThreadState>();
  pending = new Map<string, TPendingMessage>();
  /** member id -> last read seq, per conversation (for live "Seen by"). */
  readPositions = new Map<string, Map<string, number>>();

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
    if (!thread?.isLoaded) return 0;
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

  // ------------------------------------------------------------------ socket events

  applyCreated(message: TChatMessage): TApplyResult {
    if (message.client_id) this.pending.delete(message.client_id);
    const thread = this.threads.get(message.conversation_id);
    if (!thread?.isLoaded) return "not-loaded";
    if (thread.bySeq.has(message.seq)) {
      thread.bySeq.set(message.seq, message);
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
    thread.bySeq.set(message.seq, message);
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
  }
}
