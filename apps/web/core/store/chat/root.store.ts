/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { action, makeObservable, observable, runInAction } from "mobx";
import type { TChatConfig, TChatMessage, TChatServerFrame, TChatUser } from "@plane/types";
import type { ChatSocket, TChatSocketOptions } from "@/services/chat-socket";
import { ChatConversationStore } from "./conversation.store";
import { ChatMessageStore } from "./message.store";
import type { TSendDraft } from "./message.store";
import { ChatRealtimeStore } from "./realtime.store";
import type { IChatServiceLike } from "./types";
import { ChatUploadStore } from "./upload.store";

const PRUNE_INTERVAL_MS = 1_000;

export type TChatRootDeps = {
  service: IChatServiceLike;
  currentUser: () => TChatUser | null;
  /** Builds the socket with the handlers this store provides. */
  createSocket: (handlers: Pick<TChatSocketOptions, "onFrame" | "onStatus" | "onReady">) => ChatSocket;
  createClientId: () => string;
  now?: () => number;
};

/**
 * Entry point for workspace chat state (docs/chat/05-frontend.md § Stores).
 * Owns the socket for the current workspace and routes its events to the stores.
 */
export class ChatRootStore {
  workspaceSlug: string | null = null;
  activeConversationId: string | null = null;
  config: TChatConfig | null = null;
  isInitialized = false;

  readonly conversation: ChatConversationStore;
  readonly message: ChatMessageStore;
  readonly upload: ChatUploadStore;
  readonly realtime: ChatRealtimeStore;
  readonly socket: ChatSocket;

  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  /** Unsent composer text per conversation (kept while switching; not persisted). */
  private drafts = new Map<string, string>();

  constructor(private readonly deps: TChatRootDeps) {
    const currentUserId = () => deps.currentUser()?.id;
    this.conversation = new ChatConversationStore(deps.service, currentUserId);
    this.message = new ChatMessageStore(deps.service, deps.currentUser, deps.createClientId);
    this.upload = new ChatUploadStore(
      deps.service,
      () => this.config,
      () => this.workspaceSlug
    );
    this.realtime = new ChatRealtimeStore(currentUserId, deps.now);
    this.socket = deps.createSocket({
      onFrame: (frame) => this.applyFrame(frame),
      onStatus: (status, closeCode) => this.realtime.setStatus(status, closeCode),
      onReady: (isReconnect) => {
        if (isReconnect) void this.catchUp();
      },
    });

    makeObservable(this, {
      workspaceSlug: observable,
      activeConversationId: observable,
      config: observable.ref,
      isInitialized: observable,
      applyFrame: action,
      setActiveConversation: action,
      teardown: action,
    });
  }

  // ------------------------------------------------------------------ lifecycle

  /** Connect to a workspace's chat. Safe to call repeatedly with the same slug. */
  async init(workspaceSlug: string): Promise<void> {
    if (this.workspaceSlug === workspaceSlug && this.isInitialized) return;
    this.teardown();
    runInAction(() => {
      this.workspaceSlug = workspaceSlug;
    });
    this.socket.connect(workspaceSlug);
    await Promise.all([this.conversation.fetchAll(workspaceSlug), this.loadConfig(), this.loadPresence()]);
    runInAction(() => {
      this.isInitialized = true;
    });
    this.pruneTimer = setInterval(() => {
      if (this.realtime.hasTyping) this.realtime.prune();
    }, PRUNE_INTERVAL_MS);
  }

  teardown() {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.pruneTimer = null;
    this.socket.disconnect();
    this.drafts.clear();
    this.conversation.reset();
    this.message.reset();
    this.realtime.reset();
    if (this.activeConversationId) this.upload.clear(this.activeConversationId);
    this.workspaceSlug = null;
    this.activeConversationId = null;
    this.config = null;
    this.isInitialized = false;
  }

  private async loadConfig() {
    if (!this.workspaceSlug) return;
    try {
      const config = await this.deps.service.config(this.workspaceSlug);
      runInAction(() => {
        this.config = config;
      });
    } catch {
      // Limits are re-checked by the server anyway.
    }
  }

  private async loadPresence() {
    if (!this.workspaceSlug) return;
    try {
      const { online_user_ids: ids } = await this.deps.service.presence(this.workspaceSlug);
      this.realtime.replaceOnline(ids);
    } catch {
      // Presence is best-effort.
    }
  }

  /** After a reconnect: refresh the list, fill gaps in loaded threads, refresh presence. */
  async catchUp(): Promise<void> {
    const slug = this.workspaceSlug;
    if (!slug) return;
    await Promise.all([
      this.conversation.fetchAll(slug),
      this.loadPresence(),
      ...this.message.loadedConversationIds().map((id) => this.message.catchUp(slug, id).catch(() => 0)),
    ]);
  }

  // ------------------------------------------------------------------ drafts

  getDraft(conversationId: string): string | undefined {
    return this.drafts.get(conversationId);
  }

  setDraft(conversationId: string, html: string | null) {
    if (html) this.drafts.set(conversationId, html);
    else this.drafts.delete(conversationId);
  }

  // ------------------------------------------------------------------ threads

  setActiveConversation(conversationId: string | null) {
    this.activeConversationId = conversationId;
    this.socket.setActiveConversation(conversationId);
  }

  /** Open a thread: load messages and member read positions, then mark it read. */
  async openConversation(conversationId: string): Promise<void> {
    const slug = this.workspaceSlug;
    if (!slug) return;
    this.setActiveConversation(conversationId);
    const [, detail] = await Promise.all([
      this.message.open(slug, conversationId),
      this.conversation.fetchOne(slug, conversationId),
    ]);
    if (detail?.members) {
      this.message.setReadPositions(
        conversationId,
        detail.members.map((member) => ({ userId: member.member.id, seq: member.last_read_seq }))
      );
    }
    await this.markRead(conversationId);
  }

  async markRead(conversationId: string): Promise<void> {
    const slug = this.workspaceSlug;
    const newest = this.message.thread(conversationId)?.newestSeq;
    if (!slug || newest === null || newest === undefined) return;
    await this.conversation.markRead(slug, conversationId, newest);
  }

  /** Send the composer contents plus any ready attachments. */
  async send(conversationId: string, draft: Omit<TSendDraft, "attachment_ids" | "attachments">) {
    const slug = this.workspaceSlug;
    if (!slug) return undefined;
    const attachments = this.upload.takeReady(conversationId);
    const message = await this.message.send(slug, conversationId, {
      ...draft,
      attachment_ids: attachments.map((attachment) => attachment.id),
      attachments,
    });
    if (message) runInAction(() => this.conversation.applyMessageCreated(message));
    return message;
  }

  sendTyping(conversationId: string) {
    this.socket.sendTyping(conversationId);
  }

  // ------------------------------------------------------------------ events

  applyFrame(frame: TChatServerFrame) {
    const slug = this.workspaceSlug;
    switch (frame.t) {
      case "message.created":
        this.onMessageCreated(frame.d.message);
        return;
      case "message.updated":
        this.message.applyUpdated(frame.d.message);
        this.conversation.applyMessageUpdated(frame.d.message);
        return;
      case "message.deleted": {
        const wasLatest = this.conversation.isLatest(frame.d.conversation_id, frame.d.seq);
        this.message.applyDeleted(frame.d.conversation_id, frame.d.seq);
        if (wasLatest && slug) void this.conversation.fetchOne(slug, frame.d.conversation_id);
        return;
      }
      case "conversation.created":
        if (slug) void this.conversation.fetchOne(slug, frame.d.conversation_id);
        return;
      case "conversation.updated":
        this.conversation.applySharedUpdate(frame.d.conversation_id, {
          name: frame.d.name,
          logo_props: frame.d.logo_props,
          project: frame.d.project,
        });
        return;
      case "conversation.deleted":
        this.removeConversation(frame.d.conversation_id);
        return;
      case "member.added":
        this.conversation.applyMemberAdded(frame.d.conversation_id, frame.d.member);
        return;
      case "member.updated":
        this.conversation.applyMemberUpdated(frame.d.conversation_id, frame.d.member);
        return;
      case "member.removed":
        if (this.conversation.applyMemberRemoved(frame.d.conversation_id, frame.d.user_id)) {
          this.removeConversation(frame.d.conversation_id);
        }
        return;
      case "read.updated":
        this.conversation.applyRead(frame.d.conversation_id, frame.d.user_id, frame.d.seq);
        this.message.applyRead(frame.d.conversation_id, frame.d.user_id, frame.d.seq);
        return;
      case "typing":
        this.realtime.setTyping(frame.d.conversation_id, frame.d.user_id);
        return;
      case "presence":
        this.realtime.setOnline(frame.d.user_id, frame.d.online);
        return;
      default:
        return;
    }
  }

  private onMessageCreated(message: TChatMessage) {
    const slug = this.workspaceSlug;
    if (message.sender) this.realtime.clearTyping(message.conversation_id, message.sender.id);
    const result = this.message.applyCreated(message);
    if (result === "gap" && slug) void this.message.catchUp(slug, message.conversation_id);
    if (!this.conversation.applyMessageCreated(message) && slug) {
      void this.conversation.fetchOne(slug, message.conversation_id);
    }
  }

  private removeConversation(conversationId: string) {
    this.conversation.removeLocal(conversationId);
    this.message.dropConversation(conversationId);
    this.upload.clear(conversationId);
    if (this.activeConversationId === conversationId) this.activeConversationId = null;
  }
}
