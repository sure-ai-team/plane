/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { ChatConnectionRegistry } from "./registry";
import type { TChatConnection } from "./registry";
import { CHAT_USER_CHANNEL_PREFIX, CHAT_WORKSPACE_CHANNEL_PREFIX, SLUG_RE, UUID_RE } from "./types";
import type { TChatEnvelope, TChatFrame } from "./types";

export interface IChatSubscriber {
  psubscribe(...patterns: string[]): Promise<unknown>;
  on(event: "pmessage", listener: (pattern: string, channel: string, message: string) => void): unknown;
  quit(): Promise<unknown>;
}

const MEMBERSHIP_EVENTS = new Set(["member.added", "member.removed", "conversation.deleted"]);

const parseEnvelope = (message: string): TChatEnvelope | null => {
  try {
    const value = JSON.parse(message) as Partial<TChatEnvelope>;
    if (!value || typeof value.t !== "string" || typeof value.ws !== "string") return null;
    if (value.d === null || typeof value.d !== "object") return null;
    return { t: value.t, d: value.d as Record<string, unknown>, ws: value.ws, ts: Number(value.ts) || Date.now() };
  } catch {
    return null;
  }
};

/**
 * One pattern subscription for the whole instance:
 *   chat:user:<user_id>   events for one person (published by Django and by typing)
 *   chat:ws:<slug>        events for everyone in a workspace (presence)
 * Each event is forwarded to the matching local sockets of the event's workspace.
 */
export class ChatRedisBridge {
  private subscriber: IChatSubscriber | null = null;

  constructor(
    private readonly registry: ChatConnectionRegistry,
    private readonly onMembershipChange?: (workspaceSlug: string, conversationId: string) => void
  ) {}

  async start(subscriber: IChatSubscriber): Promise<void> {
    this.subscriber = subscriber;
    subscriber.on("pmessage", (_pattern, channel, message) => {
      this.dispatch(channel, message);
    });
    await subscriber.psubscribe(`${CHAT_USER_CHANNEL_PREFIX}*`, `${CHAT_WORKSPACE_CHANNEL_PREFIX}*`);
  }

  async stop(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.quit().catch(() => undefined);
      this.subscriber = null;
    }
  }

  /** Deliver one published message. Returns how many sockets received it. */
  dispatch(channel: string, message: string): number {
    const envelope = parseEnvelope(message);
    if (!envelope) return 0;

    let targets: TChatConnection[] = [];
    if (channel.startsWith(CHAT_USER_CHANNEL_PREFIX)) {
      const userId = channel.slice(CHAT_USER_CHANNEL_PREFIX.length);
      if (!UUID_RE.test(userId)) return 0;
      targets = this.registry.connectionsFor(userId, envelope.ws);
    } else if (channel.startsWith(CHAT_WORKSPACE_CHANNEL_PREFIX)) {
      const slug = channel.slice(CHAT_WORKSPACE_CHANNEL_PREFIX.length);
      if (!SLUG_RE.test(slug) || slug !== envelope.ws) return 0;
      targets = this.registry.connectionsInWorkspace(slug);
    } else {
      return 0;
    }

    if (MEMBERSHIP_EVENTS.has(envelope.t) && this.onMembershipChange) {
      const conversationId = envelope.d.conversation_id;
      if (typeof conversationId === "string") this.onMembershipChange(envelope.ws, conversationId);
    }

    if (targets.length === 0) return 0;
    const frame: TChatFrame = { t: envelope.t, d: envelope.d, ts: envelope.ts };
    const serialized = JSON.stringify(frame);
    let delivered = 0;
    for (const connection of targets) {
      if (ChatConnectionRegistry.send(connection, serialized)) delivered += 1;
    }
    return delivered;
  }
}
