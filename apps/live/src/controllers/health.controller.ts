/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Request, Response } from "express";
import { Controller, Get } from "@plane/decorators";
import { chatHub } from "@/chat";
import { env } from "@/env";
import { redisManager } from "@/redis";

@Controller("/health")
export class HealthController {
  @Get("/")
  async healthCheck(_req: Request, res: Response) {
    res.status(200).json({
      status: "OK",
      timestamp: new Date().toISOString(),
      version: env.APP_VERSION,
      chat: {
        ...chatHub.stats(),
        redis: redisManager.isClientConnected() ? "ok" : "unavailable",
      },
    });
  }
}
