/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/* oxlint-disable unicorn/no-array-sort -- the web app targets ES2022 (no toSorted); every sort here runs on a fresh array copy */

import { action, computed, makeObservable, observable, runInAction } from "mobx";
import type {
  TChatConversation,
  TChatCreateConversationPayload,
  TChatMember,
  TChatMessage,
  TChatPreview,
  TChatProjectLite,
  TChatUpdateConversationPayload,
} from "@plane/types";
import type { IChatServiceLike } from "./types";

export const previewFromMessage = (message: TChatMessage): TChatPreview => ({
  sender_id: message.sender?.id ?? null,
  kind: message.kind,
  event: message.meta?.event,
  text: (message.body_stripped || "").slice(0, 140),
  attachment_kinds: message.attachments.map((attachment) => attachment.kind),
});

const sortKey = (conversation: TChatConversation) => conversation.last_message_at ?? conversation.created_at;

export class ChatConversationStore {
  byId = new Map<string, TChatConversation>();
  isFetched = false;
  isLoading = false;
  error: string | null = null;

  constructor(
    private readonly service: IChatServiceLike,
    private readonly currentUserId: () => string | undefined
  ) {
    makeObservable(this, {
      byId: observable,
      isFetched: observable,
      isLoading: observable,
      error: observable,
      sorted: computed,
      groups: computed,
      directs: computed,
      totalUnread: computed,
      upsert: action,
      removeLocal: action,
      reset: action,
      applyMessageCreated: action,
      applyMessageUpdated: action,
      applyRead: action,
      applySharedUpdate: action,
      applyMemberAdded: action,
      applyMemberUpdated: action,
      applyMemberRemoved: action,
    });
  }

  // ------------------------------------------------------------------ getters

  get sorted(): TChatConversation[] {
    return Array.from(this.byId.values()).sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  }

  get groups(): TChatConversation[] {
    return this.sorted.filter((conversation) => conversation.type === "group");
  }

  get directs(): TChatConversation[] {
    return this.sorted.filter((conversation) => conversation.type === "direct");
  }

  /** Unread across conversations, excluding muted ones (drives the app-rail badge). */
  get totalUnread(): number {
    let total = 0;
    for (const conversation of this.byId.values()) {
      if (!conversation.is_muted) total += conversation.unread_count;
    }
    return total;
  }

  getById = (conversationId: string | null | undefined): TChatConversation | undefined =>
    conversationId ? this.byId.get(conversationId) : undefined;

  /** Display name: the other person for direct chats, the group name otherwise. */
  displayName = (conversation: TChatConversation): string =>
    conversation.type === "direct" ? (conversation.direct_user?.display_name ?? "") : conversation.name;

  // ------------------------------------------------------------------ local mutations

  upsert(conversation: TChatConversation) {
    const previous = this.byId.get(conversation.id);
    // Never move read state backwards when an older response arrives late.
    if (previous && previous.last_read_seq > conversation.last_read_seq) {
      conversation = {
        ...conversation,
        last_read_seq: previous.last_read_seq,
        unread_count: Math.max(0, conversation.last_message_seq - previous.last_read_seq),
      };
    }
    this.byId.set(conversation.id, conversation);
  }

  removeLocal(conversationId: string) {
    this.byId.delete(conversationId);
  }

  reset() {
    this.byId.clear();
    this.isFetched = false;
    this.isLoading = false;
    this.error = null;
  }

  private patch(conversationId: string, changes: Partial<TChatConversation>) {
    const current = this.byId.get(conversationId);
    if (!current) return;
    const next = { ...current, ...changes };
    next.unread_count = Math.max(0, next.last_message_seq - next.last_read_seq);
    this.byId.set(conversationId, next);
  }

  // ------------------------------------------------------------------ server calls

  async fetchAll(workspaceSlug: string): Promise<void> {
    this.isLoading = true;
    try {
      const conversations = await this.service.listConversations(workspaceSlug);
      runInAction(() => {
        const seen = new Set<string>();
        for (const conversation of conversations) {
          seen.add(conversation.id);
          this.upsert(conversation);
        }
        for (const id of Array.from(this.byId.keys())) if (!seen.has(id)) this.byId.delete(id);
        this.isFetched = true;
        this.error = null;
      });
    } catch (error) {
      runInAction(() => {
        this.error = (error as { error?: string })?.error ?? "Couldn't load conversations.";
      });
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  }

  async fetchOne(workspaceSlug: string, conversationId: string): Promise<TChatConversation | undefined> {
    try {
      const conversation = await this.service.getConversation(workspaceSlug, conversationId);
      runInAction(() => this.upsert(conversation));
      return conversation;
    } catch (error) {
      if ((error as { code?: string })?.code === "NOT_FOUND") runInAction(() => this.removeLocal(conversationId));
      return undefined;
    }
  }

  async create(workspaceSlug: string, payload: TChatCreateConversationPayload): Promise<TChatConversation> {
    const conversation = await this.service.createConversation(workspaceSlug, payload);
    runInAction(() => this.upsert(conversation));
    return conversation;
  }

  async update(
    workspaceSlug: string,
    conversationId: string,
    payload: TChatUpdateConversationPayload
  ): Promise<TChatConversation> {
    const conversation = await this.service.updateConversation(workspaceSlug, conversationId, payload);
    runInAction(() => this.upsert(conversation));
    return conversation;
  }

  async remove(workspaceSlug: string, conversationId: string): Promise<void> {
    await this.service.deleteConversation(workspaceSlug, conversationId);
    runInAction(() => this.removeLocal(conversationId));
  }

  async setMuted(workspaceSlug: string, conversationId: string, isMuted: boolean): Promise<void> {
    const userId = this.currentUserId();
    if (!userId) return;
    const before = this.byId.get(conversationId)?.is_muted;
    runInAction(() => this.patch(conversationId, { is_muted: isMuted }));
    try {
      await this.service.updateMember(workspaceSlug, conversationId, userId, { is_muted: isMuted });
    } catch (error) {
      runInAction(() => this.patch(conversationId, { is_muted: !!before }));
      throw error;
    }
  }

  async leave(workspaceSlug: string, conversationId: string): Promise<void> {
    const userId = this.currentUserId();
    if (!userId) return;
    await this.service.removeMember(workspaceSlug, conversationId, userId);
    runInAction(() => this.removeLocal(conversationId));
  }

  /** Optimistically mark read up to `seq`; the server clamps and keeps it monotonic. */
  async markRead(workspaceSlug: string, conversationId: string, seq: number): Promise<void> {
    const conversation = this.byId.get(conversationId);
    if (!conversation) return;
    const target = Math.min(seq, conversation.last_message_seq);
    if (target <= conversation.last_read_seq) return;
    runInAction(() => this.patch(conversationId, { last_read_seq: target }));
    try {
      const result = await this.service.markRead(workspaceSlug, conversationId, target);
      runInAction(() => {
        const current = this.byId.get(conversationId);
        if (current && result.last_read_seq > current.last_read_seq) {
          this.patch(conversationId, { last_read_seq: result.last_read_seq });
        }
      });
    } catch {
      // Harmless: the next markRead (or a reload) sends it again.
    }
  }

  // ------------------------------------------------------------------ socket events

  /** Returns false when the conversation isn't known yet (caller should fetch it). */
  applyMessageCreated(message: TChatMessage): boolean {
    const conversation = this.byId.get(message.conversation_id);
    if (!conversation) return false;
    if (message.seq <= conversation.last_message_seq && conversation.last_message_at) {
      // Older or duplicate event: nothing to change in the list.
      return true;
    }
    const isOwn = !!message.sender && message.sender.id === this.currentUserId();
    this.patch(message.conversation_id, {
      last_message_seq: message.seq,
      last_message_at: message.created_at,
      last_message_preview: previewFromMessage(message),
      last_read_seq: isOwn ? message.seq : conversation.last_read_seq,
    });
    return true;
  }

  applyMessageUpdated(message: TChatMessage) {
    const conversation = this.byId.get(message.conversation_id);
    if (conversation && conversation.last_message_seq === message.seq) {
      this.patch(message.conversation_id, { last_message_preview: previewFromMessage(message) });
    }
  }

  /** True when the deleted message was the latest one (its preview must be re-fetched). */
  isLatest(conversationId: string, seq: number): boolean {
    return this.byId.get(conversationId)?.last_message_seq === seq;
  }

  applyRead(conversationId: string, userId: string, seq: number) {
    if (userId !== this.currentUserId()) {
      this.patchMember(conversationId, userId, (member) => ({
        ...member,
        last_read_seq: Math.max(member.last_read_seq, seq),
      }));
      return;
    }
    const conversation = this.byId.get(conversationId);
    if (conversation && seq > conversation.last_read_seq) this.patch(conversationId, { last_read_seq: seq });
  }

  applySharedUpdate(
    conversationId: string,
    changes: { name: string; logo_props: Record<string, unknown>; project: TChatProjectLite | null }
  ) {
    this.patch(conversationId, changes);
  }

  private patchMember(conversationId: string, userId: string, update: (member: TChatMember) => TChatMember) {
    const conversation = this.byId.get(conversationId);
    if (!conversation?.members) return;
    this.patch(conversationId, {
      members: conversation.members.map((member) => (member.member.id === userId ? update(member) : member)),
    });
  }

  applyMemberAdded(conversationId: string, member: TChatMember) {
    const conversation = this.byId.get(conversationId);
    if (!conversation) return;
    const members = conversation.members ?? [];
    const exists = members.some((item) => item.member.id === member.member.id);
    this.patch(conversationId, {
      member_count: exists ? conversation.member_count : conversation.member_count + 1,
      members: conversation.members ? (exists ? members : [...members, member]) : undefined,
    });
  }

  applyMemberUpdated(conversationId: string, member: TChatMember) {
    if (member.member.id === this.currentUserId()) {
      this.patch(conversationId, { my_role: member.role, is_muted: member.is_muted });
    }
    this.patchMember(conversationId, member.member.id, () => member);
  }

  /** Returns true when the current user was the one removed. */
  applyMemberRemoved(conversationId: string, userId: string): boolean {
    if (userId === this.currentUserId()) {
      this.removeLocal(conversationId);
      return true;
    }
    const conversation = this.byId.get(conversationId);
    if (!conversation) return false;
    this.patch(conversationId, {
      member_count: Math.max(0, conversation.member_count - 1),
      members: conversation.members?.filter((member) => member.member.id !== userId),
    });
    return false;
  }
}
