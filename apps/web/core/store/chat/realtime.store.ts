/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { action, makeObservable, observable } from "mobx";
import { computedFn } from "mobx-utils";
import type { TChatSocketStatus } from "@/services/chat-socket";

/** How long a typing indicator stays visible without a new typing frame. */
export const TYPING_VISIBLE_MS = 5_000;

export class ChatRealtimeStore {
  /** conversation id -> (user id -> expires at, ms) */
  typing = new Map<string, Map<string, number>>();
  online = new Set<string>();
  status: TChatSocketStatus = "idle";
  closeCode: number | null = null;

  constructor(
    private readonly currentUserId: () => string | undefined,
    private readonly now: () => number = () => Date.now()
  ) {
    makeObservable(this, {
      typing: observable,
      online: observable,
      status: observable,
      closeCode: observable,
      setStatus: action,
      setTyping: action,
      clearTyping: action,
      setOnline: action,
      replaceOnline: action,
      prune: action,
      reset: action,
    });
  }

  /** Other people currently typing in a conversation. */
  typingUserIds = computedFn((conversationId: string): string[] => {
    const users = this.typing.get(conversationId);
    if (!users) return [];
    const me = this.currentUserId();
    return Array.from(users.keys()).filter((userId) => userId !== me);
  });

  isOnline = (userId: string | null | undefined): boolean => !!userId && this.online.has(userId);

  setStatus(status: TChatSocketStatus, closeCode?: number) {
    this.status = status;
    this.closeCode = closeCode ?? null;
  }

  setTyping(conversationId: string, userId: string) {
    let users = this.typing.get(conversationId);
    if (!users) {
      users = observable.map<string, number>();
      this.typing.set(conversationId, users);
    }
    users.set(userId, this.now() + TYPING_VISIBLE_MS);
  }

  /** A message from someone ends their typing indicator immediately. */
  clearTyping(conversationId: string, userId: string) {
    const users = this.typing.get(conversationId);
    if (!users) return;
    users.delete(userId);
    if (users.size === 0) this.typing.delete(conversationId);
  }

  setOnline(userId: string, online: boolean) {
    if (online) this.online.add(userId);
    else this.online.delete(userId);
  }

  replaceOnline(userIds: string[]) {
    this.online.clear();
    for (const userId of userIds) this.online.add(userId);
  }

  /** Drop expired typing indicators. Returns true if anything changed. */
  prune(): boolean {
    const now = this.now();
    let changed = false;
    for (const [conversationId, users] of this.typing) {
      for (const [userId, expiresAt] of users) {
        if (expiresAt <= now) {
          users.delete(userId);
          changed = true;
        }
      }
      if (users.size === 0) this.typing.delete(conversationId);
    }
    return changed;
  }

  get hasTyping(): boolean {
    return this.typing.size > 0;
  }

  reset() {
    this.typing.clear();
    this.online.clear();
    this.status = "idle";
    this.closeCode = null;
  }
}
