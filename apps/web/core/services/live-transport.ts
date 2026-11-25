/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import ReconnectingWebSocket from "partysocket/ws";
import type { IChatTransport } from "./chat-socket";

/** A WebSocket to the live server that reconnects with backoff. */
export const createLiveTransport = (url: string): IChatTransport =>
  new ReconnectingWebSocket(url, [], {
    minReconnectionDelay: 1_000,
    maxReconnectionDelay: 30_000,
    reconnectionDelayGrowFactor: 1.6,
    connectionTimeout: 10_000,
    maxRetries: Infinity,
    maxEnqueuedMessages: 0,
  }) as unknown as IChatTransport;
