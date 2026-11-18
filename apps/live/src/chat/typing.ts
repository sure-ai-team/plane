/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ChatPublisher } from "./publisher";
import type { TChatConnection } from "./registry";

export const TYPING_MIN_INTERVAL_MS = 1000;
export const MEMBER_CACHE_TTL_MS = 60_000;

export interface IMemberIdSource {
  memberIds(workspaceSlug: string, conversationId: string): Promise<string[]>;
}

type TCacheEntry = { ids: string[]; at: number };

/**
 * Typing indicators: never stored. The sender must be a member of the
 * conversation (checked against the cached member list), and frames above
 * one per second per conversation are dropped.
 */
export class ChatTyping {
  private cache = new Map<string, TCacheEntry>();

  constructor(
    private readonly source: IMemberIdSource,
    private readonly publisher: ChatPublisher,
    private readonly now: () => number = () => Date.now()
  ) {}

  private async members(workspaceSlug: string, conversationId: string): Promise<string[]> {
    const key = `${workspaceSlug}:${conversationId}`;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < MEMBER_CACHE_TTL_MS) return hit.ids;
    const ids = await this.source.memberIds(workspaceSlug, conversationId);
    // Delete first so the refreshed entry moves to the end (a Map iterates in insertion order).
    this.cache.delete(key);
    this.cache.set(key, { ids, at: this.now() });
    if (this.cache.size > 5000) {
      // Bounded cache: drop the 1000 least recently refreshed entries.
      let dropped = 0;
      for (const staleKey of this.cache.keys()) {
        if (dropped >= 1000) break;
        this.cache.delete(staleKey);
        dropped += 1;
      }
    }
    return ids;
  }

  /** Forget a conversation's cached members (e.g. after member.added / member.removed). */
  invalidate(workspaceSlug: string, conversationId: string) {
    this.cache.delete(`${workspaceSlug}:${conversationId}`);
  }

  /** Returns true when the typing frame was forwarded. */
  async handle(connection: TChatConnection, conversationId: string): Promise<boolean> {
    const last = connection.lastTypingAt.get(conversationId) ?? 0;
    const now = this.now();
    if (now - last < TYPING_MIN_INTERVAL_MS) return false;
    connection.lastTypingAt.set(conversationId, now);

    let ids: string[];
    try {
      ids = await this.members(connection.workspaceSlug, conversationId);
    } catch {
      return false;
    }
    if (!ids.includes(connection.userId)) return false;
    const recipients = ids.filter((id) => id !== connection.userId);
    await this.publisher.toUsers(
      recipients,
      "typing",
      { conversation_id: conversationId, user_id: connection.userId },
      connection.workspaceSlug
    );
    return true;
  }
}
