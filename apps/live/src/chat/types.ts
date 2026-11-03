/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/** Wire format for the chat socket (docs/chat/03-realtime-protocol.md). */
export type TChatFrame = {
  t: string;
  d: Record<string, unknown>;
  ts: number;
};

/** What Django (and this server) publish on Redis: a frame plus the workspace it belongs to. */
export type TChatEnvelope = TChatFrame & { ws: string };

export type TChatClientFrame =
  | { t: "ping"; d?: Record<string, never> }
  | { t: "typing"; d: { conversation_id: string } }
  | { t: "subscribe"; d: { conversation_id: string | null } };

/** Minimal socket surface the chat module needs; satisfied by `ws` WebSocket and by test fakes. */
export interface IChatSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate?(): void;
  ping?(): void;
  on(event: "message", listener: (data: unknown) => void): unknown;
  on(event: "close", listener: () => void): unknown;
  on(event: "pong", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

/** Close codes (4xxx are application-defined). */
export const CHAT_CLOSE = {
  BAD_FRAME: 4400,
  UNAUTHORIZED: 4401,
  FORBIDDEN: 4403,
  DISABLED: 4404,
  REPLACED: 4408,
  SERVER_ERROR: 1011,
  GOING_AWAY: 1001,
} as const;

export const CHAT_USER_CHANNEL_PREFIX = "chat:user:";
export const CHAT_WORKSPACE_CHANNEL_PREFIX = "chat:ws:";
export const CHAT_ONLINE_KEY_PREFIX = "chat:online:";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/i;
