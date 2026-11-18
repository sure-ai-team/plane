/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it, vi } from "vitest";
import { ChatRedisBridge } from "@/chat/redis-bridge";
import { ChatConnectionRegistry } from "@/chat/registry";
import { CONV, FakeSocket, USER_A, USER_B } from "./fakes";

const envelope = (t: string, ws: string, d: Record<string, unknown> = {}) => JSON.stringify({ t, d, ws, ts: 5 });

function setup() {
  const registry = new ChatConnectionRegistry();
  const onMembershipChange = vi.fn();
  const bridge = new ChatRedisBridge(registry, onMembershipChange);
  const a1 = new FakeSocket();
  const a2 = new FakeSocket();
  const aOther = new FakeSocket();
  const b = new FakeSocket();
  registry.add(a1, USER_A, "acme");
  registry.add(a2, USER_A, "acme");
  registry.add(aOther, USER_A, "other");
  registry.add(b, USER_B, "acme");
  return { registry, bridge, onMembershipChange, a1, a2, aOther, b };
}

describe("ChatRedisBridge", () => {
  it("delivers a user event to all of that user's tabs in the event's workspace only", () => {
    const { bridge, a1, a2, aOther, b } = setup();
    const delivered = bridge.dispatch(
      `chat:user:${USER_A}`,
      envelope("message.created", "acme", { message: { id: "m" } })
    );
    expect(delivered).toBe(2);
    expect(a1.sent[0]).toEqual({ t: "message.created", d: { message: { id: "m" } }, ts: 5 });
    expect(a2.sent).toHaveLength(1);
    expect(aOther.sent).toHaveLength(0);
    expect(b.sent).toHaveLength(0);
  });

  it("strips the workspace field from frames sent to clients", () => {
    const { bridge, a1 } = setup();
    bridge.dispatch(`chat:user:${USER_A}`, envelope("read.updated", "acme"));
    expect(a1.sent[0]).not.toHaveProperty("ws");
  });

  it("delivers workspace events to everyone in that workspace", () => {
    const { bridge, a1, a2, aOther, b } = setup();
    expect(bridge.dispatch("chat:ws:acme", envelope("presence", "acme", { user_id: USER_B, online: true }))).toBe(3);
    expect(aOther.sent).toHaveLength(0);
    expect(a1.sent).toHaveLength(1);
    expect(a2.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
  });

  it("ignores malformed payloads, bad channels and mismatched workspaces", () => {
    const { bridge, a1 } = setup();
    expect(bridge.dispatch(`chat:user:${USER_A}`, "not json")).toBe(0);
    expect(bridge.dispatch(`chat:user:${USER_A}`, JSON.stringify({ t: "x" }))).toBe(0);
    expect(bridge.dispatch("chat:user:not-a-uuid", envelope("x", "acme"))).toBe(0);
    expect(bridge.dispatch("chat:ws:acme", envelope("presence", "other"))).toBe(0);
    expect(bridge.dispatch("something:else", envelope("x", "acme"))).toBe(0);
    expect(a1.sent).toHaveLength(0);
  });

  it("skips closed sockets", () => {
    const { bridge, a1, a2 } = setup();
    a1.readyState = 3;
    expect(bridge.dispatch(`chat:user:${USER_A}`, envelope("x", "acme"))).toBe(1);
    expect(a2.sent).toHaveLength(1);
  });

  it("reports membership changes so the typing cache refreshes", () => {
    const { bridge, onMembershipChange } = setup();
    bridge.dispatch(`chat:user:${USER_A}`, envelope("member.removed", "acme", { conversation_id: CONV }));
    expect(onMembershipChange).toHaveBeenCalledWith("acme", CONV);
  });
});

describe("ChatConnectionRegistry", () => {
  it("reports the last socket on removal", () => {
    const registry = new ChatConnectionRegistry();
    const one = registry.add(new FakeSocket(), USER_A, "acme");
    const two = registry.add(new FakeSocket(), USER_A, "acme");
    expect(registry.remove(one)).toBe(false);
    expect(registry.remove(two)).toBe(true);
    expect(registry.remove(two)).toBe(false);
    expect(registry.stats()).toEqual({ users: 0, sockets: 0 });
  });
});
