/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_PING_INTERVAL_MS, CHAT_PONG_TIMEOUT_MS, CHAT_TYPING_INTERVAL_MS, ChatSocket } from "./chat-socket";
import type { IChatTransport } from "./chat-socket";

class FakeTransport implements IChatTransport {
  readyState = 1;
  sent: Array<Record<string, unknown>> = [];
  closed: { code?: number } | null = null;
  reconnects = 0;
  private listeners: Record<string, Array<(event: never) => void>> = {};

  constructor(public url: string) {}

  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(code?: number) {
    this.closed = { code };
  }

  reconnect() {
    this.reconnects += 1;
  }

  addEventListener(type: string, listener: (event: never) => void) {
    (this.listeners[type] ??= []).push(listener);
  }

  emit(type: string, event: unknown = {}) {
    for (const listener of this.listeners[type] ?? []) listener(event as never);
  }

  serverSends(frame: Record<string, unknown>) {
    this.emit("message", { data: JSON.stringify({ ts: 1, d: {}, ...frame }) });
  }
}

describe("ChatSocket", () => {
  let transports: FakeTransport[];
  let now: number;
  let frames: string[];
  let statuses: string[];
  let readies: boolean[];
  let socket: ChatSocket;

  beforeEach(() => {
    transports = [];
    now = 0;
    frames = [];
    statuses = [];
    readies = [];
    socket = new ChatSocket({
      url: (slug) => `wss://pm.test/live/chat/?workspace=${slug}`,
      createTransport: (url) => {
        const transport = new FakeTransport(url);
        transports.push(transport);
        return transport;
      },
      onFrame: (frame) => frames.push(frame.t),
      onStatus: (status) => statuses.push(status),
      onReady: (isReconnect) => readies.push(isReconnect),
      now: () => now,
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
    });
  });

  it("connects per workspace and becomes open on ready", () => {
    socket.connect("acme");
    expect(transports[0].url).toBe("wss://pm.test/live/chat/?workspace=acme");
    expect(socket.currentStatus).toBe("connecting");
    transports[0].serverSends({ t: "ready", d: { user_id: "u" } });
    expect(socket.currentStatus).toBe("open");
    expect(readies).toEqual([false]);
    expect(frames).toEqual(["ready"]);
  });

  it("reports reconnects so the app can catch up", () => {
    socket.connect("acme");
    transports[0].serverSends({ t: "ready" });
    transports[0].emit("close", { code: 1006 });
    expect(socket.currentStatus).toBe("reconnecting");
    transports[0].serverSends({ t: "ready" });
    expect(readies).toEqual([false, true]);
  });

  it("stops for good on auth, access or disabled close codes", () => {
    socket.connect("acme");
    transports[0].emit("close", { code: 4404 });
    expect(socket.currentStatus).toBe("blocked");
    expect(transports[0].closed).not.toBeNull();
  });

  it("pings while open and reconnects when a ping goes unanswered", () => {
    socket.connect("acme");
    transports[0].serverSends({ t: "ready" });
    now += CHAT_PING_INTERVAL_MS;
    socket.heartbeat();
    expect(transports[0].sent).toEqual([{ t: "ping", d: {} }]);

    transports[0].serverSends({ t: "pong" });
    expect(frames).not.toContain("pong");
    now += CHAT_PING_INTERVAL_MS;
    socket.heartbeat();
    expect(transports[0].reconnects).toBe(0);

    now += CHAT_PONG_TIMEOUT_MS;
    socket.heartbeat();
    expect(transports[0].reconnects).toBe(1);
  });

  it("throttles typing per conversation and only sends while open", () => {
    socket.connect("acme");
    expect(socket.sendTyping("c1")).toBe(false);
    transports[0].serverSends({ t: "ready" });
    expect(socket.sendTyping("c1")).toBe(true);
    expect(socket.sendTyping("c1")).toBe(false);
    expect(socket.sendTyping("c2")).toBe(true);
    now += CHAT_TYPING_INTERVAL_MS;
    expect(socket.sendTyping("c1")).toBe(true);
  });

  it("switching workspace closes the old connection", () => {
    socket.connect("acme");
    socket.connect("other");
    expect(transports[0].closed?.code).toBe(1000);
    expect(transports[1].url).toContain("workspace=other");
    // Events from the old transport are ignored.
    transports[0].serverSends({ t: "ready" });
    expect(frames).toEqual([]);
  });

  it("ignores junk frames", () => {
    socket.connect("acme");
    transports[0].emit("message", { data: "not json" });
    transports[0].emit("message", { data: 42 });
    expect(frames).toEqual([]);
  });
});
