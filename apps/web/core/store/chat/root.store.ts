/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { action, makeObservable, observable, runInAction } from "mobx";
import type { TChatConfig, TChatMessage, TChatServerFrame, TChatUser } from "@plane/types";
import type { ChatSocket, TChatSocketOptions } from "@/services/chat-socket";
import { ChatConversationStore } from "./conversation.store";
import { ChatDockStore } from "./dock.store";
import { ChatMessageStore } from "./message.store";
import { ChatNotifyStore } from "./notify.store";
import type { TDesktopNotifier, TabLeader } from "./notify.store";
import type { TSendDraft } from "./message.store";
import { ChatRealtimeStore } from "./realtime.store";
import { ChatSearchStore } from "./search.store";
import type { IChatServiceLike } from "./types";
import { ChatUploadStore } from "./upload.store";

const PRUNE_INTERVAL_MS = 1_000;
/** Every key chat keeps in the browser starts with this (cleared on sign-out). */
export const CHAT_STORAGE_PREFIX = "chat:";

export type TChatStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

const browserStorage = (): TChatStorage | null => {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
};

/** Plain-text start of a draft for the sidebar ("Draft: …"). */
export const draftPreview = (html: string, length = 60): string =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, length)
    .trimEnd();

export type TChatRootDeps = {
  service: IChatServiceLike;
  currentUser: () => TChatUser | null;
  /** Builds the socket with the handlers this store provides. */
  createSocket: (handlers: Pick<TChatSocketOptions, "onFrame" | "onStatus" | "onReady">) => ChatSocket;
  createClientId: () => string;
  now?: () => number;
  /** Where drafts are kept (P2-D9); `localStorage` in the browser, none in tests by default. */
  storage?: TChatStorage | null;
  /** Desktop notifications (P2-D4); absent in tests unless a fake is passed. */
  desktop?: TDesktopNotifier | null;
  leader?: TabLeader | null;
  /** Whether this tab is visible (document.visibilityState in the browser). */
  isVisible?: () => boolean;
};

type TTranslate = (key: string, params?: Record<string, unknown>) => string;

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
  readonly search: ChatSearchStore;
  readonly notify: ChatNotifyStore;
  readonly dock: ChatDockStore;
  private translate: TTranslate = (key) => key;
  readonly socket: ChatSocket;

  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  /** Unsent composer text per conversation, persisted per user and workspace (P2-D9). */
  drafts = new Map<string, string>();
  /** UI requests raised by keyboard shortcuts (consumed by the thread components). */
  editLastRequest: { conversationId: string; nonce: number } | null = null;
  jumpUnreadNonce = 0;
  isShortcutsOpen = false;
  private requestNonce = 0;

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
    this.search = new ChatSearchStore(deps.service);
    this.dock = new ChatDockStore(() => this.storage);
    this.notify = new ChatNotifyStore(deps.service, deps.desktop ?? null, deps.leader ?? null, deps.now);
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
      drafts: observable,
      editLastRequest: observable.ref,
      jumpUnreadNonce: observable,
      isShortcutsOpen: observable,
      setDraft: action,
      requestEditLast: action,
      clearEditLastRequest: action,
      requestJumpToUnread: action,
      setShortcutsOpen: action,
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
      this.loadDrafts();
      const userId = this.deps.currentUser()?.id;
      this.dock.load(userId ? `${CHAT_STORAGE_PREFIX}dock:${userId}:${workspaceSlug}` : null);
    });
    this.socket.connect(workspaceSlug);
    await Promise.all([
      this.conversation.fetchAll(workspaceSlug),
      // Archived chats stay out of the list but their unread count shows on the "Archived" link.
      this.conversation.fetchArchived(workspaceSlug).catch(() => undefined),
      this.loadConfig(),
      this.loadPresence(),
      this.notify.loadPreferences(workspaceSlug),
    ]);
    this.notify.start();
    runInAction(() => this.dock.retain((id) => !!this.conversation.getById(id)));
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
    this.search.clear();
    this.notify.reset();
    this.dock.reset();
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

  private get storage(): TChatStorage | null {
    return this.deps.storage === undefined ? browserStorage() : this.deps.storage;
  }

  private get draftsKey(): string | null {
    const userId = this.deps.currentUser()?.id;
    return userId && this.workspaceSlug ? `${CHAT_STORAGE_PREFIX}drafts:${userId}:${this.workspaceSlug}` : null;
  }

  private loadDrafts() {
    this.drafts.clear();
    const key = this.draftsKey;
    const raw = key ? this.storage?.getItem(key) : null;
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as Record<string, string>;
      for (const [conversationId, html] of Object.entries(saved)) {
        if (typeof html === "string" && html) this.drafts.set(conversationId, html);
      }
    } catch {
      // A corrupt entry just means no drafts.
    }
  }

  private saveDrafts() {
    const key = this.draftsKey;
    const storage = this.storage;
    if (!key || !storage) return;
    try {
      if (this.drafts.size === 0) storage.removeItem(key);
      else storage.setItem(key, JSON.stringify(Object.fromEntries(this.drafts)));
    } catch {
      // Storage full or blocked: drafts still work for this session.
    }
  }

  getDraft(conversationId: string): string | undefined {
    return this.drafts.get(conversationId);
  }

  /** Plain-text draft for the sidebar, or "" when there is none. */
  draftText(conversationId: string): string {
    const html = this.drafts.get(conversationId);
    return html ? draftPreview(html) : "";
  }

  setDraft(conversationId: string, html: string | null) {
    const text = html ? draftPreview(html) : "";
    if (html && text) this.drafts.set(conversationId, html);
    else this.drafts.delete(conversationId);
    this.saveDrafts();
  }

  /** Remove everything chat stored in this browser (drafts, dock state). Called on sign-out (P2-S11/S12). */
  clearLocalData() {
    this.drafts.clear();
    const storage = this.storage;
    if (!storage) return;
    try {
      const keys: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(CHAT_STORAGE_PREFIX)) keys.push(key);
      }
      for (const key of keys) storage.removeItem(key);
    } catch {
      // Nothing more we can do.
    }
  }

  /** Lets non-React code (desktop notifications) use the app's translations. */
  setTranslator(translate: TTranslate) {
    this.translate = translate;
  }

  // ------------------------------------------------------------------ shortcut requests

  requestEditLast(conversationId: string) {
    this.requestNonce += 1;
    this.editLastRequest = { conversationId, nonce: this.requestNonce };
  }

  clearEditLastRequest() {
    this.editLastRequest = null;
  }

  requestJumpToUnread() {
    this.jumpUnreadNonce += 1;
  }

  setShortcutsOpen(isOpen: boolean) {
    this.isShortcutsOpen = isOpen;
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
    // Where the "New" divider goes: captured before this open marks everything read.
    const known = this.conversation.getById(conversationId);
    runInAction(() =>
      this.message.setUnreadMarker(conversationId, known && known.unread_count > 0 ? known.last_read_seq : null)
    );
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
          ...(frame.d.description !== undefined ? { description: frame.d.description } : {}),
          logo_props: frame.d.logo_props,
          project: frame.d.project,
        });
        return;
      case "membership.updated":
        this.conversation.applyMembershipUpdate(frame.d);
        return;
      case "preferences.updated":
        this.notify.applyPreferences(frame.d);
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
      case "reaction.updated":
        this.message.applyReactionEvent(frame.d);
        return;
      case "pin.added":
      case "pin.removed": {
        this.message.applyPinChanged(frame.d.conversation_id, frame.d.message_id, frame.t === "pin.added");
        if (slug && this.message.pinState(frame.d.conversation_id)?.isLoaded) {
          void this.message.fetchPins(slug, frame.d.conversation_id).catch(() => undefined);
        }
        return;
      }
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
    const isVisible = this.deps.isVisible ? this.deps.isVisible() : true;
    this.notify.onMessage(
      message,
      {
        me: this.deps.currentUser()?.id,
        conversation: this.conversation.getById(message.conversation_id),
        isConversationOnScreen:
          isVisible &&
          (this.activeConversationId === message.conversation_id || this.dock.isOnScreen(message.conversation_id)),
      },
      this.translate
    );
  }

  private removeConversation(conversationId: string) {
    this.dock.close(conversationId);
    this.conversation.removeLocal(conversationId);
    this.message.dropConversation(conversationId);
    this.upload.clear(conversationId);
    if (this.activeConversationId === conversationId) this.activeConversationId = null;
  }
}
