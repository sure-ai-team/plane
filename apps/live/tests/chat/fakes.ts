/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { EventEmitter } from "events";
import type { IChatRedis } from "@/chat/publisher";
import type { IChatSubscriber } from "@/chat/redis-bridge";

export const USER_A = "11111111-1111-4111-8111-111111111111";
export const USER_B = "22222222-2222-4222-8222-222222222222";
export const USER_C = "33333333-3333-4333-8333-333333333333";
export const CONV = "44444444-4444-4444-8444-444444444444";

/** A WebSocket stand-in that records what was sent and how it was closed. */
export class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: Array<Record<string, unknown>> = [];
  closed: { code?: number; reason?: string } | null = null;
  pings = 0;
  terminated = false;

  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(code?: number, reason?: string) {
    if (this.closed) return;
    this.closed = { code, reason };
    this.readyState = 3;
    this.emit("close");
  }

  terminate() {
    this.terminated = true;
    this.close(1006, "terminated");
  }

  ping() {
    this.pings += 1;
  }

  receive(frame: unknown) {
    this.emit("message", Buffer.from(typeof frame === "string" ? frame : JSON.stringify(frame)));
  }

  framesOfType(t: string) {
    return this.sent.filter((frame) => frame.t === t);
  }
}

/** An in-memory Redis that also acts as its own pub/sub broker. */
export class FakeRedis implements IChatRedis {
  store = new Map<string, string>();
  published: Array<{ channel: string; message: Record<string, unknown> }> = [];
  subscribers: FakeSubscriber[] = [];

  async publish(channel: string, message: string) {
    this.published.push({ channel, message: JSON.parse(message) as Record<string, unknown> });
    for (const subscriber of this.subscribers) subscriber.deliver(channel, message);
    return 1;
  }

  async set(key: string, value: string, ...args: (string | number)[]) {
    if (args.includes("NX") && this.store.has(key)) return null;
    this.store.set(key, value);
    return "OK";
  }

  async expire(key: string) {
    return this.store.has(key) ? 1 : 0;
  }

  async del(...keys: string[]) {
    let removed = 0;
    for (const key of keys) if (this.store.delete(key)) removed += 1;
    return removed;
  }

  subscriber(): FakeSubscriber {
    const subscriber = new FakeSubscriber();
    this.subscribers.push(subscriber);
    return subscriber;
  }
}

export class FakeSubscriber extends EventEmitter implements IChatSubscriber {
  patterns: string[] = [];

  async psubscribe(...patterns: string[]) {
    this.patterns.push(...patterns);
    return patterns.length;
  }

  async quit() {
    this.patterns = [];
    return "OK";
  }

  deliver(channel: string, message: string) {
    const match = this.patterns.find((pattern) => channel.startsWith(pattern.replace(/\*$/, "")));
    if (match) this.emit("pmessage", match, channel, message);
  }
}

export const flush = () => new Promise((resolve) => setImmediate(resolve));
