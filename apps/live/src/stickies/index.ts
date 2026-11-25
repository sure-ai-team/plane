/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { logger } from "@plane/logger";
import type { IChatSubscriber } from "@/chat/redis-bridge";
import { env } from "@/env";
import { redisManager } from "@/redis";
import { UserService } from "@/services/user.service";
import { createStickyHub } from "./hub";

export const stickyHub = createStickyHub({
  authenticate: async (cookie) => {
    const user = await new UserService().currentUser(cookie);
    if (!user?.id) throw new Error("No user for this session");
    return user.id;
  },
  allowedOrigins: env.CORS_ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
});

/** Start the Redis subscription and heartbeats. Safe to call when Redis is unavailable. */
export async function startStickies(): Promise<void> {
  const client = redisManager.getClient();
  if (!client) {
    logger.warn("STICKIES: Redis unavailable, changes will not be delivered live");
    await stickyHub.start(null);
    return;
  }
  await stickyHub.start(client.duplicate() as unknown as IChatSubscriber);
  logger.info("STICKIES: subscribed to sticky events");
}

export async function stopStickies(): Promise<void> {
  await stickyHub.stop();
}
