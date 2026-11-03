/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { logger } from "@plane/logger";
import type { TChatAccess } from "./api";
import { ChatPresence } from "./presence";
import { ChatPublisher } from "./publisher";
import type { IChatRedis } from "./publisher";
import { ChatRedisBridge } from "./redis-bridge";
import type { IChatSubscriber } from "./redis-bridge";
import { ChatConnectionRegistry } from "./registry";
import type { TChatConnection } from "./registry";
import { ChatTyping } from "./typing";
import type { IMemberIdSource } from "./typing";
import { CHAT_CLOSE, SLUG_RE, UUID_RE } from "./types";
import type { IChatSocketLike, TChatClientFrame } from "./types";

export const MAX_FRAME_BYTES = 4096;
export const HEARTBEAT_MS = 30_000;
export const ACCESS_RECHECK_MS = 10 * 60_000;

export type TChatHubDeps = {
  /** Resolve the session cookie to a user id; throw when the session is invalid. */
  authenticate: (cookie: string) => Promise<string>;
  /** May this user chat in this workspace? */
  checkAccess: (workspaceSlug: string, userId: string) => Promise<TChatAccess>;
  memberSource: IMemberIdSource;
  getRedis: () => IChatRedis | null;
  allowedOrigins: string[];
  maxSocketsPerUser?: number;
  now?: () => number;
};

export type TConnectRequest = {
  cookie: string | undefined;
  origin: string | undefined;
  workspaceSlug: string | undefined;
};

type TConnectionState = TChatConnection & { lastAccessCheck: number };

const textOf = (data: unknown): string | null => {
  if (typeof data === "string") return data;
  if (data instanceof Buffer) return data.toString("utf8");
  if (Array.isArray(data) && data.every((part) => part instanceof Buffer)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return null;
};

/** Owns every chat socket on this instance: auth, routing, typing, presence, heartbeats. */
export class ChatHub {
  readonly registry: ChatConnectionRegistry;
  readonly publisher: ChatPublisher;
  readonly presence: ChatPresence;
  readonly typing: ChatTyping;
  readonly bridge: ChatRedisBridge;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: TChatHubDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.registry = new ChatConnectionRegistry(deps.maxSocketsPerUser ?? 10);
    this.publisher = new ChatPublisher(deps.getRedis);
    this.presence = new ChatPresence(deps.getRedis, this.publisher);
    this.typing = new ChatTyping(deps.memberSource, this.publisher, this.now);
    this.bridge = new ChatRedisBridge(this.registry, (slug, conversationId) =>
      this.typing.invalidate(slug, conversationId)
    );
  }

  async start(subscriber: IChatSubscriber | null): Promise<void> {
    if (subscriber) await this.bridge.start(subscriber);
    this.timer = setInterval(() => void this.sweep(), HEARTBEAT_MS);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const connection of this.registry.all()) {
      connection.socket.close(CHAT_CLOSE.GOING_AWAY, "Server shutting down");
    }
    await this.bridge.stop();
  }

  private originAllowed(origin: string | undefined): boolean {
    if (this.deps.allowedOrigins.length === 0) return true;
    return !!origin && this.deps.allowedOrigins.includes(origin);
  }

  /** Authenticate and register a new socket. Returns the connection, or null if it was closed. */
  async connect(socket: IChatSocketLike, request: TConnectRequest): Promise<TChatConnection | null> {
    // Listen for early close while we authenticate.
    let closedEarly = false;
    socket.on("close", () => {
      closedEarly = true;
    });

    if (!this.originAllowed(request.origin)) {
      socket.close(CHAT_CLOSE.FORBIDDEN, "Origin not allowed");
      return null;
    }
    const workspaceSlug = request.workspaceSlug ?? "";
    if (!SLUG_RE.test(workspaceSlug)) {
      socket.close(CHAT_CLOSE.BAD_FRAME, "Missing or invalid workspace");
      return null;
    }
    if (!request.cookie) {
      socket.close(CHAT_CLOSE.UNAUTHORIZED, "Not signed in");
      return null;
    }

    let userId: string;
    try {
      userId = await this.deps.authenticate(request.cookie);
    } catch {
      socket.close(CHAT_CLOSE.UNAUTHORIZED, "Not signed in");
      return null;
    }
    if (!UUID_RE.test(userId)) {
      socket.close(CHAT_CLOSE.UNAUTHORIZED, "Not signed in");
      return null;
    }

    let access: TChatAccess;
    try {
      access = await this.deps.checkAccess(workspaceSlug, userId);
    } catch (error) {
      logger.error("CHAT: access check failed", error);
      socket.close(CHAT_CLOSE.SERVER_ERROR, "Try again shortly");
      return null;
    }
    if (access === "disabled") {
      socket.close(CHAT_CLOSE.DISABLED, "Chat is disabled");
      return null;
    }
    if (access !== "allowed") {
      socket.close(CHAT_CLOSE.FORBIDDEN, "No access to chat in this workspace");
      return null;
    }
    if (closedEarly) return null;

    const connection = this.registry.add(socket, userId, workspaceSlug) as TConnectionState;
    connection.lastAccessCheck = this.now();

    socket.on("pong", () => {
      connection.isAlive = true;
    });
    socket.on("message", (data) => {
      void this.onMessage(connection, data);
    });
    socket.on("close", () => {
      void this.onClose(connection);
    });
    socket.on("error", (error) => {
      logger.warn(`CHAT: socket error for user ${connection.userId}: ${error.message}`);
    });

    ChatConnectionRegistry.send(connection, { t: "ready", d: { user_id: userId }, ts: this.now() });
    await this.presence
      .online(userId, workspaceSlug)
      .catch((error) => logger.warn("CHAT: presence online failed", error));
    return connection;
  }

  private async onMessage(connection: TChatConnection, data: unknown): Promise<void> {
    const text = textOf(data);
    if (text === null || Buffer.byteLength(text, "utf8") > MAX_FRAME_BYTES) {
      connection.socket.close(CHAT_CLOSE.BAD_FRAME, "Frame too large or not text");
      return;
    }
    let frame: TChatClientFrame;
    try {
      frame = JSON.parse(text) as TChatClientFrame;
    } catch {
      connection.socket.close(CHAT_CLOSE.BAD_FRAME, "Invalid JSON");
      return;
    }
    if (!frame || typeof frame !== "object" || typeof frame.t !== "string") return;

    connection.isAlive = true;
    switch (frame.t) {
      case "ping":
        ChatConnectionRegistry.send(connection, { t: "pong", d: {}, ts: this.now() });
        await this.presence.refresh(connection.userId).catch(() => undefined);
        return;
      case "typing": {
        const conversationId = frame.d?.conversation_id;
        if (typeof conversationId === "string" && UUID_RE.test(conversationId)) {
          await this.typing.handle(connection, conversationId);
        }
        return;
      }
      case "subscribe": {
        const conversationId = frame.d?.conversation_id;
        connection.activeConversationId =
          typeof conversationId === "string" && UUID_RE.test(conversationId) ? conversationId : null;
        return;
      }
      default:
        // Unknown frames are ignored so older servers tolerate newer clients.
        return;
    }
  }

  private async onClose(connection: TChatConnection): Promise<void> {
    const wasLast = this.registry.remove(connection);
    if (wasLast) {
      await this.presence
        .offline(connection.userId, [connection.workspaceSlug])
        .catch((error) => logger.warn("CHAT: presence offline failed", error));
    }
  }

  /** Heartbeat: drop dead sockets and periodically re-check chat access. */
  async sweep(): Promise<void> {
    const now = this.now();
    const dueForAccessCheck: TConnectionState[] = [];
    for (const connection of this.registry.all() as TConnectionState[]) {
      if (!connection.isAlive) {
        if (connection.socket.terminate) connection.socket.terminate();
        else connection.socket.close(CHAT_CLOSE.GOING_AWAY, "Heartbeat timeout");
        continue;
      }
      connection.isAlive = false;
      connection.socket.ping?.();
      if (now - connection.lastAccessCheck >= ACCESS_RECHECK_MS) {
        connection.lastAccessCheck = now;
        dueForAccessCheck.push(connection);
      }
    }
    await Promise.all(dueForAccessCheck.map((connection) => this.recheckAccess(connection, now)));
  }

  private async recheckAccess(connection: TConnectionState, now: number): Promise<void> {
    try {
      const access = await this.deps.checkAccess(connection.workspaceSlug, connection.userId);
      if (access === "disabled") connection.socket.close(CHAT_CLOSE.DISABLED, "Chat is disabled");
      else if (access !== "allowed") connection.socket.close(CHAT_CLOSE.FORBIDDEN, "Chat access removed");
    } catch {
      // Keep the socket on transient API errors; try again on the next sweep.
      connection.lastAccessCheck = now - ACCESS_RECHECK_MS + HEARTBEAT_MS;
    }
  }

  stats() {
    return this.registry.stats();
  }
}
