/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { logger } from "@plane/logger";
import { env } from "@/env";
import { redisManager } from "@/redis";
import { UserService } from "@/services/user.service";
import { ChatApiService } from "./api";
import { ChatHub } from "./hub";
import type { IChatRedis } from "./publisher";
import type { IChatSubscriber } from "./redis-bridge";

const chatApi = new ChatApiService();

const allowedOrigins = env.CORS_ALLOWED_ORIGINS.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

/** The live server's single chat hub (docs/chat/03-realtime-protocol.md). */
export const chatHub = new ChatHub({
  authenticate: async (cookie) => {
    const user = await new UserService().currentUser(cookie);
    if (!user?.id) throw new Error("No user for this session");
    return user.id;
  },
  checkAccess: (workspaceSlug, userId) => chatApi.checkAccess(workspaceSlug, userId),
  memberSource: chatApi,
  getRedis: () => redisManager.getClient() as unknown as IChatRedis | null,
  allowedOrigins,
});

/** Start the Redis subscription and heartbeats. Safe to call when Redis is unavailable. */
export async function startChat(): Promise<void> {
  const client = redisManager.getClient();
  if (!client) {
    logger.warn("CHAT: Redis unavailable, chat events will not be delivered");
    await chatHub.start(null);
    return;
  }
  const subscriber = client.duplicate() as unknown as IChatSubscriber;
  await chatHub.start(subscriber);
  logger.info("CHAT: subscribed to chat events");
}

export async function stopChat(): Promise<void> {
  await chatHub.stop();
}
