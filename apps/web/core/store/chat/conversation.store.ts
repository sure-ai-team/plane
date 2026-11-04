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
  TChatMembershipSettings,
  TChatMembershipSettingsPayload,
  TChatMessage,
  TChatNotifyLevel,
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
const bySortKey = (a: TChatConversation, b: TChatConversation) => sortKey(b).localeCompare(sortKey(a));

export type TChatListFilter = "all" | "unread" | "mentions";

/** Default level for a conversation (P2-D4): everything for direct chats, mentions for groups. */
export const defaultNotifyLevel = (conversation: Pick<TChatConversation, "type">): TChatNotifyLevel =>
  conversation.type === "direct" ? "all" : "mentions";

export const isQuiet = (conversation: TChatConversation) =>
  conversation.notify_level === "off" || (conversation.notify_level === undefined && conversation.is_muted);

export class ChatConversationStore {
  byId = new Map<string, TChatConversation>();
  /** Archived conversations (P2-D8): kept apart and loaded on demand. */
  archivedById = new Map<string, TChatConversation>();
  isArchivedFetched = false;
  filter: TChatListFilter = "all";
  isFetched = false;
  isLoading = false;
  error: string | null = null;

  constructor(
    private readonly service: IChatServiceLike,
    private readonly currentUserId: () => string | undefined
  ) {
    makeObservable(this, {
      byId: observable,
      archivedById: observable,
      isArchivedFetched: observable,
      filter: observable,
      visible: computed,
      starred: computed,
      archived: computed,
      archivedUnread: computed,
      unreadConversationCount: computed,
      mentionConversationCount: computed,
      setFilter: action,
      applyMembershipUpdate: action,
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

  /** Every non-archived conversation, newest activity first. */
  get sorted(): TChatConversation[] {
    return Array.from(this.byId.values()).sort(bySortKey);
  }

  /** `sorted` narrowed by the sidebar filter (All / Unread / Mentions). */
  get visible(): TChatConversation[] {
    if (this.filter === "unread") return this.sorted.filter((conversation) => conversation.unread_count > 0);
    if (this.filter === "mentions") {
      return this.sorted.filter((conversation) => (conversation.unread_mention_count ?? 0) > 0);
    }
    return this.sorted;
  }

  get starred(): TChatConversation[] {
    return this.visible.filter((conversation) => conversation.is_starred);
  }

  get groups(): TChatConversation[] {
    return this.visible.filter((conversation) => conversation.type === "group" && !conversation.is_starred);
  }

  get directs(): TChatConversation[] {
    return this.visible.filter((conversation) => conversation.type === "direct" && !conversation.is_starred);
  }

  get archived(): TChatConversation[] {
    return Array.from(this.archivedById.values()).sort(bySortKey);
  }

  get archivedUnread(): number {
    let total = 0;
    for (const conversation of this.archivedById.values()) total += conversation.unread_count;
    return total;
  }

  get unreadConversationCount(): number {
    return this.sorted.filter((conversation) => conversation.unread_count > 0).length;
  }

  get mentionConversationCount(): number {
    return this.sorted.filter((conversation) => (conversation.unread_mention_count ?? 0) > 0).length;
  }

  /** Unread across non-archived conversations that aren't set to "off" (app badge, tab title). */
  get totalUnread(): number {
    let total = 0;
    for (const conversation of this.byId.values()) {
      if (!isQuiet(conversation)) total += conversation.unread_count;
    }
    return total;
  }

  getById = (conversationId: string | null | undefined): TChatConversation | undefined =>
    conversationId ? (this.byId.get(conversationId) ?? this.archivedById.get(conversationId)) : undefined;

  setFilter(filter: TChatListFilter) {
    this.filter = filter;
  }

  /** Display name: the other person for direct chats, the group name otherwise. */
  displayName = (conversation: TChatConversation): string =>
    conversation.type === "direct" ? (conversation.direct_user?.display_name ?? "") : conversation.name;

  // ------------------------------------------------------------------ local mutations

  upsert(conversation: TChatConversation) {
    // Archived conversations live in their own list (P2-D8).
    const target = conversation.archived_at ? this.archivedById : this.byId;
    const other = conversation.archived_at ? this.byId : this.archivedById;
    const previous = target.get(conversation.id) ?? other.get(conversation.id);
    other.delete(conversation.id);
    // Never move read state backwards when an older response arrives late.
    if (previous && previous.last_read_seq > conversation.last_read_seq) {
      conversation = {
        ...conversation,
        last_read_seq: previous.last_read_seq,
        unread_count: Math.max(0, conversation.last_message_seq - previous.last_read_seq),
      };
    }
    target.set(conversation.id, conversation);
  }

  removeLocal(conversationId: string) {
    this.byId.delete(conversationId);
    this.archivedById.delete(conversationId);
  }

  reset() {
    this.byId.clear();
    this.archivedById.clear();
    this.isArchivedFetched = false;
    this.filter = "all";
    this.isFetched = false;
    this.isLoading = false;
    this.error = null;
  }

  private patch(conversationId: string, changes: Partial<TChatConversation>) {
    const current = this.getById(conversationId);
    if (!current) return;
    const next = { ...current, ...changes };
    next.unread_count = Math.max(0, next.last_message_seq - next.last_read_seq);
    if (next.unread_count === 0) next.unread_mention_count = 0;
    this.upsertRaw(next);
  }

  /** Store without the read-state guard, moving between the main and archived lists. */
  private upsertRaw(conversation: TChatConversation) {
    if (conversation.archived_at) {
      this.byId.delete(conversation.id);
      this.archivedById.set(conversation.id, conversation);
    } else {
      this.archivedById.delete(conversation.id);
      this.byId.set(conversation.id, conversation);
    }
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

  async fetchArchived(workspaceSlug: string): Promise<void> {
    const conversations = await this.service.listConversations(workspaceSlug, { archived: true });
    runInAction(() => {
      this.archivedById.clear();
      for (const conversation of conversations) this.upsert(conversation);
      this.isArchivedFetched = true;
    });
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

  /**
   * Change my settings for one conversation (notify level, snooze, star, archive).
   * Optimistic; rolled back if the server refuses.
   */
  async updateMySettings(
    workspaceSlug: string,
    conversationId: string,
    payload: TChatMembershipSettingsPayload
  ): Promise<void> {
    const before = this.getById(conversationId);
    if (!before) return;
    const optimistic: Partial<TChatConversation> = {};
    if (payload.notify_level !== undefined) {
      optimistic.notify_level = payload.notify_level;
      optimistic.is_muted = payload.notify_level === "off";
    }
    if (payload.snoozed_until !== undefined) optimistic.snoozed_until = payload.snoozed_until;
    if (payload.is_starred !== undefined) optimistic.is_starred = payload.is_starred;
    if (payload.archived !== undefined) {
      optimistic.archived_at = payload.archived ? (before.archived_at ?? new Date().toISOString()) : null;
    }
    runInAction(() => this.patch(conversationId, optimistic));
    try {
      const settings = await this.service.updateMembership(workspaceSlug, conversationId, payload);
      runInAction(() => this.applyMembershipUpdate({ ...settings, conversation_id: conversationId }));
    } catch (error) {
      runInAction(() => this.upsertRaw(before));
      throw error;
    }
  }

  /** Phase 1 mute toggle: "off", or back to the conversation's default level. */
  setMuted(workspaceSlug: string, conversationId: string, isMuted: boolean): Promise<void> {
    const conversation = this.getById(conversationId);
    if (!conversation) return Promise.resolve();
    return this.updateMySettings(workspaceSlug, conversationId, {
      notify_level: isMuted ? "off" : defaultNotifyLevel(conversation),
    });
  }

  /** My settings changed (this tab or another device). */
  applyMembershipUpdate(settings: TChatMembershipSettings & { conversation_id: string }) {
    const { conversation_id: conversationId, ...changes } = settings;
    this.patch(conversationId, changes);
  }

  async leave(workspaceSlug: string, conversationId: string): Promise<void> {
    const userId = this.currentUserId();
    if (!userId) return;
    await this.service.removeMember(workspaceSlug, conversationId, userId);
    runInAction(() => this.removeLocal(conversationId));
  }

  /** Optimistically mark read up to `seq`; the server clamps and keeps it monotonic. */
  async markRead(workspaceSlug: string, conversationId: string, seq: number): Promise<void> {
    const conversation = this.getById(conversationId);
    if (!conversation) return;
    const target = Math.min(seq, conversation.last_message_seq);
    if (target <= conversation.last_read_seq) return;
    runInAction(() => this.patch(conversationId, { last_read_seq: target }));
    try {
      const result = await this.service.markRead(workspaceSlug, conversationId, target);
      runInAction(() => {
        const current = this.getById(conversationId);
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
    const conversation = this.getById(message.conversation_id);
    if (!conversation) return false;
    if (message.seq <= conversation.last_message_seq && conversation.last_message_at) {
      // Older or duplicate event: nothing to change in the list.
      return true;
    }
    const me = this.currentUserId();
    const isOwn = !!message.sender && message.sender.id === me;
    const mentionsMe = !isOwn && !!me && message.mentions.includes(me);
    // Archived conversations stay archived when new messages arrive (P2-D8).
    this.patch(message.conversation_id, {
      last_message_seq: message.seq,
      last_message_at: message.created_at,
      last_message_preview: previewFromMessage(message),
      last_read_seq: isOwn ? message.seq : conversation.last_read_seq,
      unread_mention_count: (conversation.unread_mention_count ?? 0) + (mentionsMe ? 1 : 0),
    });
    return true;
  }

  applyMessageUpdated(message: TChatMessage) {
    const conversation = this.getById(message.conversation_id);
    if (conversation && conversation.last_message_seq === message.seq) {
      this.patch(message.conversation_id, { last_message_preview: previewFromMessage(message) });
    }
  }

  /** True when the deleted message was the latest one (its preview must be re-fetched). */
  isLatest(conversationId: string, seq: number): boolean {
    return this.getById(conversationId)?.last_message_seq === seq;
  }

  applyRead(conversationId: string, userId: string, seq: number) {
    if (userId !== this.currentUserId()) {
      this.patchMember(conversationId, userId, (member) => ({
        ...member,
        last_read_seq: Math.max(member.last_read_seq, seq),
      }));
      return;
    }
    const conversation = this.getById(conversationId);
    if (conversation && seq > conversation.last_read_seq) this.patch(conversationId, { last_read_seq: seq });
  }

  applySharedUpdate(
    conversationId: string,
    changes: {
      name: string;
      description?: string;
      logo_props: Record<string, unknown>;
      project: TChatProjectLite | null;
    }
  ) {
    this.patch(conversationId, changes);
  }

  private patchMember(conversationId: string, userId: string, update: (member: TChatMember) => TChatMember) {
    const conversation = this.getById(conversationId);
    if (!conversation?.members) return;
    this.patch(conversationId, {
      members: conversation.members.map((member) => (member.member.id === userId ? update(member) : member)),
    });
  }

  applyMemberAdded(conversationId: string, member: TChatMember) {
    const conversation = this.getById(conversationId);
    if (!conversation) return;
    const members = conversation.members ?? [];
    const exists = members.some((item) => item.member.id === member.member.id);
    this.patch(conversationId, {
      member_count: exists ? conversation.member_count : conversation.member_count + 1,
      members: conversation.members ? (exists ? members : [...members, member]) : undefined,
    });
  }

  applyMemberUpdated(conversationId: string, member: TChatMember) {
    if (member.member.id === this.currentUserId()) this.patch(conversationId, { my_role: member.role });
    this.patchMember(conversationId, member.member.id, () => member);
  }

  /** Returns true when the current user was the one removed. */
  applyMemberRemoved(conversationId: string, userId: string): boolean {
    if (userId === this.currentUserId()) {
      this.removeLocal(conversationId);
      return true;
    }
    const conversation = this.getById(conversationId);
    if (!conversation) return false;
    this.patch(conversationId, {
      member_count: Math.max(0, conversation.member_count - 1),
      members: conversation.members?.filter((member) => member.member.id !== userId),
    });
    return false;
  }
}
