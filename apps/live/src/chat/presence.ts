/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ChatPublisher, IChatRedis } from "./publisher";
import { CHAT_ONLINE_KEY_PREFIX } from "./types";

export const PRESENCE_TTL_SECONDS = 60;

/**
 * Online status: ``chat:online:<user_id>`` with a 60 s TTL, refreshed by every ping.
 * The API's GET /chat/presence/ reads the same keys.
 */
export class ChatPresence {
  constructor(
    private readonly getRedis: () => IChatRedis | null,
    private readonly publisher: ChatPublisher
  ) {}

  private key(userId: string) {
    return `${CHAT_ONLINE_KEY_PREFIX}${userId}`;
  }

  /** Mark online; broadcasts only when the user was not already online. */
  async online(userId: string, workspaceSlug: string): Promise<void> {
    const redis = this.getRedis();
    if (!redis) return;
    const created = await redis.set(this.key(userId), "1", "EX", PRESENCE_TTL_SECONDS, "NX");
    if (created === "OK") {
      await this.publisher.toWorkspace(workspaceSlug, "presence", { user_id: userId, online: true });
    }
  }

  async refresh(userId: string): Promise<void> {
    const redis = this.getRedis();
    if (!redis) return;
    const updated = await redis.expire(this.key(userId), PRESENCE_TTL_SECONDS);
    if (updated === 0) {
      // Key expired between pings (e.g. Redis restart): set it again quietly.
      await redis.set(this.key(userId), "1", "EX", PRESENCE_TTL_SECONDS);
    }
  }

  /** Called when the user's last socket on this instance closes. */
  async offline(userId: string, workspaceSlugs: string[]): Promise<void> {
    const redis = this.getRedis();
    if (!redis) return;
    await redis.del(this.key(userId));
    await Promise.all(
      [...new Set(workspaceSlugs)].map((slug) =>
        this.publisher.toWorkspace(slug, "presence", { user_id: userId, online: false })
      )
    );
  }
}
