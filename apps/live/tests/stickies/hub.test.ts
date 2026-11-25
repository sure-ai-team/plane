/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@plane/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ChatHub, HEARTBEAT_MS } from "@/chat/hub";
import { CHAT_CLOSE } from "@/chat/types";
import { createStickyHub } from "@/stickies/hub";
import { CONV, FakeRedis, FakeSocket, USER_A, USER_B, flush } from "../chat/fakes";

const COOKIES: Record<string, string> = { "session=a": USER_A, "session=b": USER_B };
const ORIGIN = "https://pm.sure.test";

let redis: FakeRedis;
let hub: ChatHub;

const connect = async (cookie: string | undefined, workspaceSlug = "acme", origin = ORIGIN) => {
  const socket = new FakeSocket();
  await hub.connect(socket, { cookie, origin, workspaceSlug });
  return socket;
};

const publish = (channel: string, ws = "acme", t = "sticky.changed") =>
  redis.publish(channel, JSON.stringify({ t, d: { sticky_id: "s1", project_id: "p1" }, ws, ts: 1 }));

beforeEach(async () => {
  redis = new FakeRedis();
  hub = createStickyHub({
    authenticate: async (cookie) => {
      if (!COOKIES[cookie]) throw new Error("bad session");
      return COOKIES[cookie];
    },
    allowedOrigins: [ORIGIN],
  });
  await hub.start(redis.subscriber());
});

describe("sticky hub", () => {
  it("delivers an event only to the person it is addressed to", async () => {
    const [a, otherTab, b] = [await connect("session=a"), await connect("session=a"), await connect("session=b")];
    await publish(`sticky:user:${USER_A}`);

    for (const socket of [a, otherTab])
      expect(socket.framesOfType("sticky.changed")).toEqual([
        { t: "sticky.changed", d: { sticky_id: "s1", project_id: "p1" }, ts: 1 },
      ]);
    expect(b.framesOfType("sticky.changed")).toEqual([]);
  });

  it("delivers only to the workspace of the event", async () => {
    const socket = await connect("session=a", "other");
    await publish(`sticky:user:${USER_A}`);

    expect(socket.framesOfType("sticky.changed")).toEqual([]);
  });

  it("does not see chat events, nor does chat see sticky events", async () => {
    const sticky = await connect("session=a");
    const chatHub = new ChatHub({
      authenticate: async (cookie) => COOKIES[cookie],
      checkAccess: async () => "allowed",
      memberSource: { memberIds: async () => [] },
      getRedis: () => redis,
      allowedOrigins: [ORIGIN],
    });
    await chatHub.start(redis.subscriber());
    const chat = new FakeSocket();
    await chatHub.connect(chat, { cookie: "session=a", origin: ORIGIN, workspaceSlug: "acme" });

    await publish(`chat:user:${USER_A}`, "acme", "message.created");
    await publish("chat:ws:acme", "acme", "presence");
    await publish(`sticky:user:${USER_A}`);
    expect(sticky.sent.map((frame) => frame.t)).toEqual(["ready", "sticky.changed"]);
    expect(chat.sent.map((frame) => frame.t)).not.toContain("sticky.changed");
    expect(chat.framesOfType("message.created")).toHaveLength(1);
  });

  it.each([
    ["signed out", undefined, ORIGIN, "acme", CHAT_CLOSE.UNAUTHORIZED],
    ["invalid session", "session=zzz", ORIGIN, "acme", CHAT_CLOSE.UNAUTHORIZED],
    ["foreign origin", "session=a", "https://evil.test", "acme", CHAT_CLOSE.FORBIDDEN],
    ["no workspace", "session=a", ORIGIN, "", CHAT_CLOSE.BAD_FRAME],
  ])("refuses: %s", async (_name, cookie, origin, workspace, code) => {
    const socket = await connect(cookie, workspace, origin);
    expect(socket.closed?.code).toBe(code);
    expect(hub.stats().sockets).toBe(0);
  });

  it("answers pings, and neither shows presence nor relays typing", async () => {
    const socket = await connect("session=a");
    socket.receive({ t: "ping", d: {} });
    socket.receive({ t: "typing", d: { conversation_id: CONV } });
    await flush();

    expect(socket.framesOfType("pong")).toHaveLength(1);
    expect(redis.store.size).toBe(0);
    expect(redis.published).toEqual([]);
  });

  it("drops dead sockets", async () => {
    const socket = await connect("session=a");
    await hub.sweep();
    expect(socket.pings).toBe(1);
    await hub.sweep();
    expect(socket.terminated).toBe(true);
    expect(hub.stats().sockets).toBe(0);
    expect(HEARTBEAT_MS).toBeGreaterThan(0);
  });
});
