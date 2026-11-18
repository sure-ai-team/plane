/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TChatClientFrame, TChatServerFrame } from "@plane/types";

/** Close codes after which reconnecting is pointless (docs/chat/03-realtime-protocol.md). */
export const CHAT_TERMINAL_CLOSE_CODES = new Set([4400, 4401, 4403, 4404]);

export const CHAT_PING_INTERVAL_MS = 30_000;
export const CHAT_PONG_TIMEOUT_MS = 10_000;
export const CHAT_TYPING_INTERVAL_MS = 3_000;

export type TChatSocketStatus = "idle" | "connecting" | "open" | "reconnecting" | "blocked";

/** The subset of a WebSocket that ChatSocket uses; satisfied by partysocket. */
export interface IChatTransport {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  reconnect(code?: number, reason?: string): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "close", listener: (event: { code: number; reason?: string }) => void): void;
}

export type TChatSocketOptions = {
  /** Full ws(s):// URL for a workspace. */
  url: (workspaceSlug: string) => string;
  createTransport: (url: string) => IChatTransport;
  onFrame: (frame: TChatServerFrame) => void;
  onStatus?: (status: TChatSocketStatus, closeCode?: number) => void;
  /** Called after every successful (re)connection, once the server sent `ready`. */
  onReady?: (isReconnect: boolean) => void;
  now?: () => number;
  setInterval?: (handler: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
};

const OPEN = 1;

/** Builds the chat socket URL the same way the editor builds its collaboration URL. */
export const buildChatSocketUrl = (liveBaseUrl: string, liveBasePath: string, workspaceSlug: string): string => {
  const origin = liveBaseUrl.trim() || window.location.origin;
  const base = new URL(`${liveBasePath.replace(/\/$/, "")}/chat/`, origin);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.searchParams.set("workspace", workspaceSlug);
  return base.toString();
};

/**
 * One chat connection per tab. Reconnects with backoff (partysocket), keeps a
 * ping/pong heartbeat, throttles typing frames and stops for good on auth or
 * access errors.
 */
export class ChatSocket {
  private transport: IChatTransport | null = null;
  private workspaceSlug: string | null = null;
  private status: TChatSocketStatus = "idle";
  private hasBeenReady = false;
  private pingTimer: unknown = null;
  private lastPongAt = 0;
  private lastPingAt = 0;
  private typingSentAt = new Map<string, number>();
  private readonly now: () => number;
  private readonly startTimer: (handler: () => void, ms: number) => unknown;
  private readonly stopTimer: (handle: unknown) => void;

  constructor(private readonly options: TChatSocketOptions) {
    this.now = options.now ?? (() => Date.now());
    this.startTimer = options.setInterval ?? ((handler, ms) => globalThis.setInterval(handler, ms));
    this.stopTimer = options.clearInterval ?? ((handle) => globalThis.clearInterval(handle as number));
  }

  get currentStatus(): TChatSocketStatus {
    return this.status;
  }

  get connectedWorkspace(): string | null {
    return this.workspaceSlug;
  }

  private setStatus(status: TChatSocketStatus, closeCode?: number) {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatus?.(status, closeCode);
  }

  connect(workspaceSlug: string): void {
    if (this.transport && this.workspaceSlug === workspaceSlug && this.status !== "blocked") return;
    this.disconnect();
    this.workspaceSlug = workspaceSlug;
    this.hasBeenReady = false;
    this.setStatus("connecting");

    const transport = this.options.createTransport(this.options.url(workspaceSlug));
    this.transport = transport;

    transport.addEventListener("message", (event) => {
      if (this.transport !== transport) return;
      this.handleMessage(event.data);
    });
    transport.addEventListener("close", (event) => {
      if (this.transport !== transport) return;
      this.stopHeartbeat();
      if (CHAT_TERMINAL_CLOSE_CODES.has(event.code)) {
        // Signed out, no access or chat disabled: retrying would loop forever.
        transport.close();
        this.setStatus("blocked", event.code);
        return;
      }
      this.setStatus("reconnecting", event.code);
    });
  }

  disconnect(): void {
    this.stopHeartbeat();
    if (this.transport) {
      const transport = this.transport;
      this.transport = null;
      transport.close(1000, "Client closed");
    }
    this.workspaceSlug = null;
    this.typingSentAt.clear();
    this.setStatus("idle");
  }

  private handleMessage(data: unknown) {
    if (typeof data !== "string") return;
    let frame: TChatServerFrame;
    try {
      frame = JSON.parse(data) as TChatServerFrame;
    } catch {
      return;
    }
    if (!frame || typeof frame.t !== "string") return;

    if (frame.t === "ready") {
      const isReconnect = this.hasBeenReady;
      this.hasBeenReady = true;
      this.lastPongAt = this.now();
      this.setStatus("open");
      this.startHeartbeat();
      this.options.onReady?.(isReconnect);
    } else if (frame.t === "pong") {
      this.lastPongAt = this.now();
      return;
    }
    this.options.onFrame(frame);
  }

  private send(frame: TChatClientFrame): boolean {
    if (!this.transport || this.transport.readyState !== OPEN || this.status !== "open") return false;
    this.transport.send(JSON.stringify(frame));
    return true;
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.pingTimer = this.startTimer(() => this.heartbeat(), CHAT_PING_INTERVAL_MS);
  }

  private stopHeartbeat() {
    if (this.pingTimer !== null) this.stopTimer(this.pingTimer);
    this.pingTimer = null;
  }

  /** Runs every CHAT_PING_INTERVAL_MS while open. Exposed for tests. */
  heartbeat(): void {
    if (!this.transport || this.status !== "open") return;
    const now = this.now();
    if (this.lastPingAt > this.lastPongAt && now - this.lastPingAt >= CHAT_PONG_TIMEOUT_MS) {
      // The previous ping got no answer: the connection is dead even if the browser hasn't noticed.
      this.setStatus("reconnecting");
      this.transport.reconnect(4000, "Heartbeat timeout");
      return;
    }
    if (this.send({ t: "ping", d: {} })) this.lastPingAt = now;
  }

  /** Throttled to one frame per conversation every 3 s. Returns true when sent. */
  sendTyping(conversationId: string): boolean {
    const now = this.now();
    const last = this.typingSentAt.get(conversationId);
    if (last !== undefined && now - last < CHAT_TYPING_INTERVAL_MS) return false;
    if (!this.send({ t: "typing", d: { conversation_id: conversationId } })) return false;
    this.typingSentAt.set(conversationId, now);
    return true;
  }

  setActiveConversation(conversationId: string | null): void {
    this.send({ t: "subscribe", d: { conversation_id: conversationId } });
  }
}
