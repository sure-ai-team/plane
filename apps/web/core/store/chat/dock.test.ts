/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it, vi } from "vitest";
import { messageLayoutFor } from "@/components/chat/common/helpers";
import { ChatDockStore, MAX_DOCKED, MAX_EXPANDED } from "./dock.store";
import { ChatRootStore } from "./root.store";
import { ME, OTHER, makeConversation, makeMessage, makeService } from "./test-utils";

const memoryStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
    data,
  };
};

describe("ChatDockStore", () => {
  it("keeps at most three windows expanded, newest first", () => {
    const dock = new ChatDockStore(() => null);
    for (const id of ["a", "b", "c", "d"]) dock.open(id);
    expect(dock.expandedIds).toEqual(["d", "c", "b"]);
    expect(dock.minimizedIds).toEqual(["a"]);
    dock.expand("a");
    expect(dock.expandedIds).toEqual(["a", "d", "c"]);
    expect(dock.minimizedIds).toEqual(["b"]);
    expect(MAX_EXPANDED).toBe(3);
  });

  it("minimizes, closes and caps the dock", () => {
    const dock = new ChatDockStore(() => null);
    dock.open("a");
    dock.minimize("a");
    expect(dock.minimizedIds).toEqual(["a"]);
    dock.close("a");
    expect(dock.entries).toEqual([]);
    for (let index = 0; index < 20; index += 1) dock.open(`c${index}`);
    expect(dock.entries).toHaveLength(MAX_EXPANDED + MAX_DOCKED);
  });

  it("is only 'on screen' while shown and expanded", () => {
    const dock = new ChatDockStore(() => null);
    dock.open("a");
    expect(dock.isOnScreen("a")).toBe(false);
    dock.setShown(true);
    expect(dock.isOnScreen("a")).toBe(true);
    dock.minimize("a");
    expect(dock.isOnScreen("a")).toBe(false);
  });

  it("persists per key and drops conversations that no longer exist", () => {
    const storage = memoryStorage();
    const first = new ChatDockStore(() => storage);
    first.load("chat:dock:me:acme");
    first.open("a");
    first.open("b");
    first.minimize("a");

    const reloaded = new ChatDockStore(() => storage);
    reloaded.load("chat:dock:me:acme");
    expect(reloaded.entries).toEqual([
      { id: "b", minimized: false },
      { id: "a", minimized: true },
    ]);
    reloaded.retain((id) => id === "b");
    expect(reloaded.entries.map((entry) => entry.id)).toEqual(["b"]);

    const otherUser = new ChatDockStore(() => storage);
    otherUser.load("chat:dock:other:acme");
    expect(otherUser.entries).toEqual([]);
  });
});

describe("messageLayoutFor", () => {
  it("uses bubbles in direct chats by default and respects the setting", () => {
    expect(messageLayoutFor({ type: "direct" }, null)).toBe("bubbles");
    expect(messageLayoutFor({ type: "group" }, null)).toBe("compact");
    expect(messageLayoutFor({ type: "group" }, { message_layout: "bubbles", bubbles_direct_only: false })).toBe(
      "bubbles"
    );
    expect(messageLayoutFor({ type: "direct" }, { message_layout: "compact", bubbles_direct_only: true })).toBe(
      "compact"
    );
  });
});

describe("root store with the dock", () => {
  it("restores the dock on init and doesn't notify for a conversation open in a window", async () => {
    const storage = memoryStorage();
    storage.setItem(
      `chat:dock:${ME.id}:acme`,
      JSON.stringify([
        { id: "conv-1", minimized: false },
        { id: "gone", minimized: true },
      ])
    );
    const desktop = {
      permission: () => "granted" as const,
      requestPermission: async () => "granted" as const,
      show: vi.fn(),
      playSound: vi.fn(),
    };
    const service = makeService();
    service.listConversations.mockResolvedValueOnce([makeConversation({ notify_level: "all" })]);
    const root = new ChatRootStore({
      service,
      currentUser: () => ME,
      createClientId: () => "c",
      storage,
      desktop,
      isVisible: () => true,
      createSocket: () =>
        ({ connect: vi.fn(), disconnect: vi.fn(), setActiveConversation: vi.fn(), sendTyping: vi.fn() }) as never,
    });
    await root.init("acme");
    expect(root.dock.entries.map((entry) => entry.id)).toEqual(["conv-1"]);

    root.dock.setShown(true);
    root.applyFrame({ t: "message.created", d: { message: makeMessage(2, { sender: OTHER }) }, ts: 0 });
    expect(desktop.show).not.toHaveBeenCalled();

    root.dock.minimize("conv-1");
    root.applyFrame({ t: "message.created", d: { message: makeMessage(3, { sender: OTHER }) }, ts: 0 });
    expect(desktop.show).toHaveBeenCalledTimes(1);

    root.applyFrame({ t: "conversation.deleted", d: { conversation_id: "conv-1" }, ts: 0 });
    expect(root.dock.entries).toEqual([]);
    root.teardown();
  });
});
