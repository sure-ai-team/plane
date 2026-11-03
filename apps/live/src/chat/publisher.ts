/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { CHAT_USER_CHANNEL_PREFIX, CHAT_WORKSPACE_CHANNEL_PREFIX } from "./types";
import type { TChatEnvelope } from "./types";

/** The subset of an ioredis client the chat module uses. */
export interface IChatRedis {
  publish(channel: string, message: string): Promise<number>;
  set(key: string, value: string, ...args: (string | number)[]): Promise<unknown>;
  expire(key: string, seconds: number): Promise<number>;
  del(...keys: string[]): Promise<number>;
  pipeline?(): { publish(channel: string, message: string): unknown; exec(): Promise<unknown> };
}

/**
 * Publishes typing and presence through Redis rather than straight to local
 * sockets, so a second live-server instance would receive them too.
 */
export class ChatPublisher {
  constructor(private readonly getRedis: () => IChatRedis | null) {}

  private envelope(t: string, d: Record<string, unknown>, ws: string): string {
    const payload: TChatEnvelope = { t, d, ws, ts: Date.now() };
    return JSON.stringify(payload);
  }

  async toUsers(userIds: string[], t: string, d: Record<string, unknown>, ws: string): Promise<void> {
    const redis = this.getRedis();
    if (!redis || userIds.length === 0) return;
    const message = this.envelope(t, d, ws);
    if (redis.pipeline) {
      const pipe = redis.pipeline();
      for (const userId of userIds) pipe.publish(`${CHAT_USER_CHANNEL_PREFIX}${userId}`, message);
      await pipe.exec();
      return;
    }
    await Promise.all(userIds.map((userId) => redis.publish(`${CHAT_USER_CHANNEL_PREFIX}${userId}`, message)));
  }

  async toWorkspace(workspaceSlug: string, t: string, d: Record<string, unknown>): Promise<void> {
    const redis = this.getRedis();
    if (!redis) return;
    await redis.publish(`${CHAT_WORKSPACE_CHANNEL_PREFIX}${workspaceSlug}`, this.envelope(t, d, workspaceSlug));
  }
}
