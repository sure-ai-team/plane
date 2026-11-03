/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@plane/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ACCESS_RECHECK_MS, ChatHub, HEARTBEAT_MS, MAX_FRAME_BYTES } from "@/chat/hub";
import type { TChatAccess } from "@/chat/api";
import type { TChatHubDeps } from "@/chat/hub";
import { CHAT_CLOSE } from "@/chat/types";
import { CONV, FakeRedis, FakeSocket, USER_A, USER_B, USER_C, flush } from "./fakes";

const COOKIES: Record<string, string> = { "session=a": USER_A, "session=b": USER_B, "session=c": USER_C };

function makeHub(overrides: Partial<TChatHubDeps> = {}) {
  const redis = new FakeRedis();
  let now = 1_000_000;
  const members = vi.fn(async () => [USER_A, USER_B]);
  const checkAccess = vi.fn(async (): Promise<TChatAccess> => "allowed");
  const hub = new ChatHub({
    authenticate: async (cookie) => {
      const user = COOKIES[cookie];
      if (!user) throw new Error("bad session");
      return user;
    },
    checkAccess,
    memberSource: { memberIds: members },
    getRedis: () => redis,
    allowedOrigins: ["https://pm.sure.test"],
    now: () => now,
    ...overrides,
  });
  return {
    hub,
    redis,
    members,
    checkAccess,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

async function connect(hub: ChatHub, cookie: string, workspace = "acme", origin = "https://pm.sure.test") {
  const socket = new FakeSocket();
  const connection = await hub.connect(socket, { cookie, origin, workspaceSlug: workspace });
  return { socket, connection };
}

describe("ChatHub connect", () => {
  it("authenticates, registers and announces readiness", async () => {
    const { hub, redis } = makeHub();
    const { socket, connection } = await connect(hub, "session=a");
    expect(connection?.userId).toBe(USER_A);
    expect(socket.closed).toBeNull();
    expect(socket.framesOfType("ready")[0]?.d).toEqual({ user_id: USER_A });
    expect(redis.store.get(`chat:online:${USER_A}`)).toBe("1");
    expect(hub.stats()).toEqual({ users: 1, sockets: 1 });
  });

  it.each([
    ["bad origin", { origin: "https://evil.test" }, CHAT_CLOSE.FORBIDDEN],
    ["no cookie", { cookie: undefined }, CHAT_CLOSE.UNAUTHORIZED],
    ["invalid session", { cookie: "session=zzz" }, CHAT_CLOSE.UNAUTHORIZED],
    ["missing workspace", { workspaceSlug: undefined }, CHAT_CLOSE.BAD_FRAME],
    ["malformed workspace", { workspaceSlug: "../etc" }, CHAT_CLOSE.BAD_FRAME],
  ])("rejects %s", async (_name, change, code) => {
    const { hub } = makeHub();
    const socket = new FakeSocket();
    const connection = await hub.connect(socket, {
      cookie: "session=a",
      origin: "https://pm.sure.test",
      workspaceSlug: "acme",
      ...change,
    });
    expect(connection).toBeNull();
    expect(socket.closed?.code).toBe(code);
    expect(hub.stats().sockets).toBe(0);
  });

  it("closes with 4403 when the user has no chat access and 4404 when chat is off", async () => {
    const forbidden = makeHub({ checkAccess: async () => "forbidden" });
    expect((await connect(forbidden.hub, "session=a")).socket.closed?.code).toBe(CHAT_CLOSE.FORBIDDEN);
    const disabled = makeHub({ checkAccess: async () => "disabled" });
    expect((await connect(disabled.hub, "session=a")).socket.closed?.code).toBe(CHAT_CLOSE.DISABLED);
  });

  it("allows any origin when none are configured", async () => {
    const { hub } = makeHub({ allowedOrigins: [] });
    const { connection } = await connect(hub, "session=a", "acme", "https://anything.test");
    expect(connection).not.toBeNull();
  });

  it("caps sockets per user by closing the oldest", async () => {
    const { hub } = makeHub({ maxSocketsPerUser: 2 });
    const first = await connect(hub, "session=a");
    await connect(hub, "session=a");
    await connect(hub, "session=a");
    expect(first.socket.closed?.code).toBe(CHAT_CLOSE.REPLACED);
    expect(hub.stats()).toEqual({ users: 1, sockets: 2 });
  });
});

describe("ChatHub frames", () => {
  it("answers ping with pong", async () => {
    const { hub } = makeHub();
    const { socket } = await connect(hub, "session=a");
    socket.receive({ t: "ping", d: {} });
    await flush();
    expect(socket.framesOfType("pong")).toHaveLength(1);
  });

  it("closes on oversized or invalid frames and ignores unknown ones", async () => {
    const { hub } = makeHub();
    const big = await connect(hub, "session=a");
    big.socket.receive("x".repeat(MAX_FRAME_BYTES + 1));
    await flush();
    expect(big.socket.closed?.code).toBe(CHAT_CLOSE.BAD_FRAME);

    const junk = await connect(hub, "session=b");
    junk.socket.receive("{not json");
    await flush();
    expect(junk.socket.closed?.code).toBe(CHAT_CLOSE.BAD_FRAME);

    const unknown = await connect(hub, "session=c");
    unknown.socket.receive({ t: "future-thing", d: {} });
    await flush();
    expect(unknown.socket.closed).toBeNull();
  });
});

describe("ChatHub typing", () => {
  let ctx: ReturnType<typeof makeHub>;
  beforeEach(async () => {
    ctx = makeHub();
    await ctx.hub.start(ctx.redis.subscriber());
  });
  afterEach(async () => {
    await ctx.hub.stop();
  });

  it("sends typing to other members only, through Redis", async () => {
    const a = await connect(ctx.hub, "session=a");
    const b = await connect(ctx.hub, "session=b");
    a.socket.receive({ t: "typing", d: { conversation_id: CONV } });
    await flush();
    expect(b.socket.framesOfType("typing")[0]?.d).toEqual({ conversation_id: CONV, user_id: USER_A });
    expect(a.socket.framesOfType("typing")).toHaveLength(0);
    expect(ctx.redis.published.some((entry) => entry.channel === `chat:user:${USER_B}`)).toBe(true);
  });

  it("throttles to one typing frame per second per conversation", async () => {
    await connect(ctx.hub, "session=b");
    const a = await connect(ctx.hub, "session=a");
    a.socket.receive({ t: "typing", d: { conversation_id: CONV } });
    a.socket.receive({ t: "typing", d: { conversation_id: CONV } });
    await flush();
    expect(ctx.redis.published.filter((entry) => entry.message.t === "typing")).toHaveLength(1);
    ctx.advance(1100);
    a.socket.receive({ t: "typing", d: { conversation_id: CONV } });
    await flush();
    expect(ctx.redis.published.filter((entry) => entry.message.t === "typing")).toHaveLength(2);
  });

  it("drops typing from someone who is not a member", async () => {
    const c = await connect(ctx.hub, "session=c");
    c.socket.receive({ t: "typing", d: { conversation_id: CONV } });
    await flush();
    expect(ctx.redis.published.filter((entry) => entry.message.t === "typing")).toHaveLength(0);
  });

  it("caches member ids and refreshes them after a membership event", async () => {
    await connect(ctx.hub, "session=b");
    const a = await connect(ctx.hub, "session=a");
    a.socket.receive({ t: "typing", d: { conversation_id: CONV } });
    await flush();
    ctx.advance(1100);
    a.socket.receive({ t: "typing", d: { conversation_id: CONV } });
    await flush();
    expect(ctx.members).toHaveBeenCalledTimes(1);

    await ctx.redis.publish(
      `chat:user:${USER_A}`,
      JSON.stringify({ t: "member.added", d: { conversation_id: CONV }, ws: "acme", ts: 1 })
    );
    ctx.advance(1100);
    a.socket.receive({ t: "typing", d: { conversation_id: CONV } });
    await flush();
    expect(ctx.members).toHaveBeenCalledTimes(2);
  });
});

describe("ChatHub presence", () => {
  it("announces online once and offline when the last socket closes", async () => {
    const ctx = makeHub();
    const watcher = await connect(ctx.hub, "session=b");
    await ctx.hub.start(ctx.redis.subscriber());

    const first = await connect(ctx.hub, "session=a");
    const second = await connect(ctx.hub, "session=a");
    await flush();
    const online = watcher.socket.framesOfType("presence").filter((frame) => (frame.d as { online: boolean }).online);
    expect(online).toHaveLength(1);

    first.socket.close();
    await flush();
    expect(ctx.redis.store.has(`chat:online:${USER_A}`)).toBe(true);
    second.socket.close();
    await flush();
    expect(ctx.redis.store.has(`chat:online:${USER_A}`)).toBe(false);
    const offline = watcher.socket.framesOfType("presence").filter((frame) => !(frame.d as { online: boolean }).online);
    expect(offline).toHaveLength(1);
    await ctx.hub.stop();
  });

  it("does not leak presence to another workspace", async () => {
    const ctx = makeHub();
    const elsewhere = await connect(ctx.hub, "session=b", "other");
    await ctx.hub.start(ctx.redis.subscriber());
    await connect(ctx.hub, "session=a", "acme");
    await flush();
    expect(elsewhere.socket.framesOfType("presence")).toHaveLength(0);
    await ctx.hub.stop();
  });
});

describe("ChatHub heartbeat", () => {
  it("terminates sockets that stop answering and re-checks access", async () => {
    const ctx = makeHub();
    const { socket, connection } = await connect(ctx.hub, "session=a");
    await ctx.hub.sweep();
    expect(socket.pings).toBe(1);
    expect(connection?.isAlive).toBe(false);
    await ctx.hub.sweep();
    expect(socket.terminated).toBe(true);

    const fresh = await connect(ctx.hub, "session=b");
    ctx.checkAccess.mockResolvedValue("forbidden");
    ctx.advance(ACCESS_RECHECK_MS + HEARTBEAT_MS);
    await ctx.hub.sweep();
    expect(fresh.socket.closed?.code).toBe(CHAT_CLOSE.FORBIDDEN);
  });

  it("keeps sockets that answer pings", async () => {
    const ctx = makeHub();
    const { socket } = await connect(ctx.hub, "session=a");
    await ctx.hub.sweep();
    socket.emit("pong");
    await ctx.hub.sweep();
    expect(socket.terminated).toBe(false);
  });
});
