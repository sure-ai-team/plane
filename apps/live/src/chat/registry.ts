/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { CHAT_CLOSE } from "./types";
import type { IChatSocketLike, TChatFrame } from "./types";

const OPEN = 1;

export type TChatConnection = {
  id: number;
  socket: IChatSocketLike;
  userId: string;
  workspaceSlug: string;
  connectedAt: number;
  /** Conversation the tab has open, if any (typing hint only). */
  activeConversationId: string | null;
  /** Last typing frame accepted per conversation, for server-side throttling. */
  lastTypingAt: Map<string, number>;
  isAlive: boolean;
};

/** In-memory index of open chat sockets on this live-server instance. */
export class ChatConnectionRegistry {
  private nextId = 1;
  private byUser = new Map<string, Set<TChatConnection>>();

  constructor(private readonly maxSocketsPerUser = 10) {}

  add(socket: IChatSocketLike, userId: string, workspaceSlug: string): TChatConnection {
    const connection: TChatConnection = {
      id: this.nextId++,
      socket,
      userId,
      workspaceSlug,
      connectedAt: Date.now(),
      activeConversationId: null,
      lastTypingAt: new Map(),
      isAlive: true,
    };
    let sockets = this.byUser.get(userId);
    if (!sockets) {
      sockets = new Set();
      this.byUser.set(userId, sockets);
    }
    sockets.add(connection);

    // Cap sockets per user: close the oldest ones (a Set iterates in insertion order).
    const excess = sockets.size - this.maxSocketsPerUser;
    if (excess > 0) {
      const oldest = Array.from(sockets).slice(0, excess);
      for (const extra of oldest) {
        this.remove(extra);
        extra.socket.close(CHAT_CLOSE.REPLACED, "Too many open chat connections");
      }
    }
    return connection;
  }

  /** Remove a connection. Returns true when it was the user's last socket on this instance. */
  remove(connection: TChatConnection): boolean {
    const sockets = this.byUser.get(connection.userId);
    if (!sockets || !sockets.delete(connection)) return false;
    if (sockets.size === 0) {
      this.byUser.delete(connection.userId);
      return true;
    }
    return false;
  }

  connectionsFor(userId: string, workspaceSlug?: string): TChatConnection[] {
    const sockets = this.byUser.get(userId);
    if (!sockets) return [];
    const all = [...sockets];
    return workspaceSlug ? all.filter((connection) => connection.workspaceSlug === workspaceSlug) : all;
  }

  connectionsInWorkspace(workspaceSlug: string): TChatConnection[] {
    const result: TChatConnection[] = [];
    for (const sockets of this.byUser.values()) {
      for (const connection of sockets) {
        if (connection.workspaceSlug === workspaceSlug) result.push(connection);
      }
    }
    return result;
  }

  hasUser(userId: string): boolean {
    return this.byUser.has(userId);
  }

  all(): TChatConnection[] {
    const result: TChatConnection[] = [];
    for (const sockets of this.byUser.values()) {
      for (const connection of sockets) result.push(connection);
    }
    return result;
  }

  stats() {
    let sockets = 0;
    for (const set of this.byUser.values()) sockets += set.size;
    return { users: this.byUser.size, sockets };
  }

  static send(connection: TChatConnection, frame: TChatFrame | string): boolean {
    if (connection.socket.readyState !== OPEN) return false;
    try {
      connection.socket.send(typeof frame === "string" ? frame : JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
  }
}
