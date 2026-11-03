/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Request } from "express";
import type { WebSocket } from "ws";
import { Controller, WebSocket as WSDecorator } from "@plane/decorators";
import { logger } from "@plane/logger";
import { chatHub } from "@/chat";
import { CHAT_CLOSE } from "@/chat/types";

/** Workspace chat socket: wss://<host>/live/chat/?workspace=<slug> */
@Controller("/chat")
export class ChatController {
  [key: string]: unknown;

  @WSDecorator("/")
  handleConnection(ws: WebSocket, req: Request) {
    const workspace = typeof req.query?.workspace === "string" ? req.query.workspace : undefined;
    chatHub
      .connect(ws, {
        cookie: req.headers.cookie,
        origin: typeof req.headers.origin === "string" ? req.headers.origin : undefined,
        workspaceSlug: workspace,
      })
      .catch((error) => {
        logger.error("CHAT_CONTROLLER: connection setup failed", error);
        ws.close(CHAT_CLOSE.SERVER_ERROR, "Internal server error");
      });
  }
}
