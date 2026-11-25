/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Request } from "express";
import type { WebSocket } from "ws";
import { Controller, WebSocket as WSDecorator } from "@plane/decorators";
import { logger } from "@plane/logger";
import { CHAT_CLOSE } from "@/chat/types";
import { stickyHub } from "@/stickies";

/** Live updates of project stickies: wss://<host>/live/stickies/?workspace=<slug> */
@Controller("/stickies")
export class StickyController {
  [key: string]: unknown;

  @WSDecorator("/")
  handleConnection(ws: WebSocket, req: Request) {
    const workspace = typeof req.query?.workspace === "string" ? req.query.workspace : undefined;
    stickyHub
      .connect(ws, {
        cookie: req.headers.cookie,
        origin: typeof req.headers.origin === "string" ? req.headers.origin : undefined,
        workspaceSlug: workspace,
      })
      .catch((error) => {
        logger.error("STICKY_CONTROLLER: connection setup failed", error);
        ws.close(CHAT_CLOSE.SERVER_ERROR, "Internal server error");
      });
  }
}
