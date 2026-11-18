/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TChatConversation } from "@plane/types";
import { snoozeUntil } from "@/components/chat/common/helpers";
import { titleWithCount } from "@/components/chat/hooks/use-chat-tab-title";
import {
  ChatNotifyStore,
  LEADER_TIMEOUT_MS,
  TabLeader,
  notificationContent,
  shouldNotify,
  shouldPlaySound,
} from "./notify.store";
import type { TDesktopNotifier, TNotifyContext } from "./notify.store";
import { ChatRootStore } from "./root.store";
import { DEFAULT_TEST_PREFERENCES, ME, OTHER, makeConversation, makeMessage, makeService } from "./test-utils";

const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);

const context = (overrides: Partial<TNotifyContext> = {}): TNotifyContext => ({
  me: ME.id,
  conversation: makeConversation({ notify_level: "all" }),
  preferences: { ...DEFAULT_TEST_PREFERENCES },
  isConversationOnScreen: false,
  now: Date.parse("2026-11-04T10:00:00Z"),
  permission: "granted",
  ...overrides,
});

describe("shouldNotify (decision table, docs/chat/phase-2/03-realtime.md)", () => {
  const message = makeMessage(5, { sender: OTHER });

  it("notifies for a message from someone else in an 'all' conversation", () => {
    expect(shouldNotify(message, context())).toBe(true);
  });

  it.each([
    ["my own message", makeMessage(5, { sender: ME }), {}],
    ["a system line", makeMessage(5, { kind: "system", sender: null }), {}],
    ["the conversation is on screen", message, { isConversationOnScreen: true }],
    ["permission not granted", message, { permission: "default" as const }],
    [
      "desktop notifications switched off",
      message,
      { preferences: { ...DEFAULT_TEST_PREFERENCES, desktop_notifications: false } },
    ],
    ["level off", message, { conversation: makeConversation({ notify_level: "off" }) }],
    [
      "snoozed",
      message,
      { conversation: makeConversation({ notify_level: "all", snoozed_until: "2026-11-04T11:00:00Z" }) },
    ],
    ["unknown conversation", message, { conversation: undefined }],
  ])("stays quiet for %s", (_label, item, overrides) => {
    expect(shouldNotify(item, context(overrides as Partial<TNotifyContext>))).toBe(false);
  });

  it("notifies after a snooze has ended", () => {
    const conversation = makeConversation({ notify_level: "all", snoozed_until: "2026-11-04T09:00:00Z" });
    expect(shouldNotify(message, context({ conversation }))).toBe(true);
  });

  it("with 'mentions' only notifies for mentions and replies to me", () => {
    const conversation = makeConversation({ notify_level: "mentions" });
    expect(shouldNotify(message, context({ conversation }))).toBe(false);
    expect(shouldNotify(makeMessage(6, { sender: OTHER, mentions: [ME.id] }), context({ conversation }))).toBe(true);
    const reply = makeMessage(7, {
      sender: OTHER,
      reply_to: { id: "m1", seq: 1, sender: ME, kind: "text", body_stripped: "x" },
    });
    expect(shouldNotify(reply, context({ conversation }))).toBe(true);
  });
});

describe("notificationContent", () => {
  const group: TChatConversation = makeConversation({ name: "Release" });

  it("names sender and group, and hides the text when previews are off", () => {
    const message = makeMessage(1, { sender: OTHER, body_stripped: "ship it" });
    expect(notificationContent(message, group, { ...DEFAULT_TEST_PREFERENCES }, t)).toEqual({
      title: "other · Release",
      body: "ship it",
    });
    expect(notificationContent(message, group, { ...DEFAULT_TEST_PREFERENCES, show_preview: false }, t).body).toBe(
      "chat.notify.new_message"
    );
  });

  it("describes attachments and voice notes", () => {
    const voice = makeMessage(1, { sender: OTHER, kind: "voice", body_stripped: "" });
    expect(notificationContent(voice, group, null, t).body).toBe("chat.notify.sent_voice");
    const direct = makeConversation({ type: "direct", direct_user: OTHER });
    expect(notificationContent(voice, direct, null, t).title).toBe("other");
  });
});

describe("TabLeader", () => {
  it("leads alone, defers to a smaller id, and takes over when it goes quiet", () => {
    let now = 0;
    const listeners: Array<(event: MessageEvent) => void> = [];
    const channel = {
      postMessage: vi.fn(),
      close: vi.fn(),
      addEventListener: (_type: "message", listener: (event: MessageEvent) => void) => listeners.push(listener),
    };
    const deliver = (data: unknown) => listeners.forEach((listener) => listener({ data } as MessageEvent));
    const leader = new TabLeader(channel, "tab-b", () => now);
    expect(leader.isLeader()).toBe(true);
    deliver({ t: "hb", id: "tab-a" });
    expect(leader.isLeader()).toBe(false);
    now = LEADER_TIMEOUT_MS + 1;
    expect(leader.isLeader()).toBe(true);
    expect(new TabLeader(null, "solo").isLeader()).toBe(true);
  });
});

describe("sound is independent of desktop notifications", () => {
  const message = makeMessage(5, { sender: OTHER });

  it("rings without notification permission or the desktop switch", () => {
    expect(shouldNotify(message, context({ permission: "denied" }))).toBe(false);
    expect(shouldPlaySound(message, context({ permission: "denied" }))).toBe(true);
    const off = { ...DEFAULT_TEST_PREFERENCES, desktop_notifications: false };
    expect(shouldPlaySound(message, context({ preferences: off }))).toBe(true);
  });

  it("stays quiet when sound is off, the chat is open, snoozed, muted or your own", () => {
    expect(shouldPlaySound(message, context({ preferences: { ...DEFAULT_TEST_PREFERENCES, sound: false } }))).toBe(
      false
    );
    expect(shouldPlaySound(message, context({ isConversationOnScreen: true }))).toBe(false);
    expect(shouldPlaySound(message, context({ conversation: makeConversation({ notify_level: "off" }) }))).toBe(false);
    expect(shouldPlaySound(makeMessage(6, { sender: ME }), context())).toBe(false);
    const snoozed = makeConversation({ notify_level: "all", snoozed_until: "2026-11-04T11:00:00Z" });
    expect(shouldPlaySound(message, context({ conversation: snoozed }))).toBe(false);
  });

  it("follows the conversation level: mentions-only rings only for mentions", () => {
    const groupConversation = makeConversation({ notify_level: "mentions" });
    expect(shouldPlaySound(message, context({ conversation: groupConversation }))).toBe(false);
    expect(
      shouldPlaySound(
        makeMessage(7, { sender: OTHER, mentions: [ME.id] }),
        context({ conversation: groupConversation })
      )
    ).toBe(true);
  });

  it("the store plays the chosen tone and volume even when notifications are blocked", () => {
    const playSound = vi.fn();
    const show = vi.fn();
    const desktop: TDesktopNotifier = {
      permission: () => "denied",
      requestPermission: async () => "denied",
      show,
      playSound,
    };
    const store = new ChatNotifyStore(makeService(), desktop, null, () => 10_000);
    store.applyPreferences({ ...DEFAULT_TEST_PREFERENCES, sound_tone: "ringtone", sound_volume: 90 });
    const rang = store.onMessage(
      makeMessage(2, { sender: OTHER }),
      { me: ME.id, conversation: makeConversation({ notify_level: "all" }), isConversationOnScreen: false },
      t
    );
    expect(rang).toBe(false);
    expect(show).not.toHaveBeenCalled();
    expect(playSound).toHaveBeenCalledWith("ringtone", 90);
  });

  it("the settings Play and Test buttons use the saved tone", () => {
    const playSound = vi.fn();
    const show = vi.fn();
    const desktop: TDesktopNotifier = {
      permission: () => "granted",
      requestPermission: async () => "granted",
      show,
      playSound,
    };
    const store = new ChatNotifyStore(makeService(), desktop, null);
    store.applyPreferences({ ...DEFAULT_TEST_PREFERENCES, sound_tone: "pop", sound_volume: 30 });
    store.playTone({ sound_tone: "ding" });
    expect(playSound).toHaveBeenLastCalledWith("ding", 30);
    store.sendTest(t);
    expect(show).toHaveBeenCalledTimes(1);
    expect(playSound).toHaveBeenLastCalledWith("pop", 30);
  });
});

describe("ChatNotifyStore", () => {
  let show: ReturnType<typeof vi.fn<TDesktopNotifier["show"]>>;
  let playSound: ReturnType<typeof vi.fn<TDesktopNotifier["playSound"]>>;
  let desktop: TDesktopNotifier;
  let now = 0;

  beforeEach(() => {
    now = 10_000;
    show = vi.fn<TDesktopNotifier["show"]>();
    playSound = vi.fn<TDesktopNotifier["playSound"]>();
    desktop = {
      permission: () => "granted",
      requestPermission: async () => "granted",
      show,
      playSound,
    };
  });

  it("shows one tagged notification per conversation, throttles sound and opens the message", () => {
    const store = new ChatNotifyStore(makeService(), desktop, null, () => now);
    const open = vi.fn();
    store.setOpenHandler(open);
    const conversation = makeConversation({ notify_level: "all" });
    const ctx = { me: ME.id, conversation, isConversationOnScreen: false };
    expect(store.onMessage(makeMessage(2, { sender: OTHER }), ctx, t)).toBe(true);
    now += 1_000;
    store.onMessage(makeMessage(3, { sender: OTHER }), ctx, t);
    expect(show).toHaveBeenCalledTimes(2);
    expect(show.mock.calls[0][0].tag).toBe("chat-conv-1");
    expect(playSound).toHaveBeenCalledTimes(1);
    show.mock.calls[1][0].onClick();
    expect(open).toHaveBeenCalledWith("conv-1", "msg-3");
  });

  it("stays quiet in a tab that isn't the leader", () => {
    const leader = { isLeader: () => false, start: vi.fn(), stop: vi.fn() } as unknown as TabLeader;
    const store = new ChatNotifyStore(makeService(), desktop, leader, () => now);
    const ctx = { me: ME.id, conversation: makeConversation({ notify_level: "all" }), isConversationOnScreen: false };
    expect(store.onMessage(makeMessage(2, { sender: OTHER }), ctx, t)).toBe(false);
  });

  it("rolls back a preference change the server refuses", async () => {
    const service = makeService();
    const store = new ChatNotifyStore(service, desktop, null);
    await store.loadPreferences("acme");
    service.updatePreferences.mockRejectedValueOnce({ error: "no", code: "X" });
    await expect(store.updatePreferences("acme", { sound: false })).rejects.toBeTruthy();
    expect(store.preferences?.sound).toBe(true);
  });
});

describe("root store notifications", () => {
  it("notifies for a message in a conversation that isn't open", async () => {
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
      storage: null,
      desktop,
      isVisible: () => true,
      createSocket: () =>
        ({ connect: vi.fn(), disconnect: vi.fn(), setActiveConversation: vi.fn(), sendTyping: vi.fn() }) as never,
    });
    await root.init("acme");
    root.applyFrame({ t: "message.created", d: { message: makeMessage(2, { sender: OTHER }) }, ts: 0 });
    expect(desktop.show).toHaveBeenCalledTimes(1);
    root.setActiveConversation("conv-1");
    root.applyFrame({ t: "message.created", d: { message: makeMessage(3, { sender: OTHER }) }, ts: 0 });
    expect(desktop.show).toHaveBeenCalledTimes(1);
    root.teardown();
  });
});

describe("small helpers", () => {
  it("puts the unread count in front of the title", () => {
    expect(titleWithCount("Chat · SURE", 3)).toBe("(3) Chat · SURE");
    expect(titleWithCount("(3) Chat · SURE", 120)).toBe("(99+) Chat · SURE");
    expect(titleWithCount("(3) Chat · SURE", 0)).toBe("Chat · SURE");
  });

  it("computes snooze times", () => {
    const now = new Date(2026, 10, 4, 22, 30);
    expect(new Date(snoozeUntil("1h", now)).getHours()).toBe(23);
    const tomorrow = new Date(snoozeUntil("tomorrow", now));
    expect([tomorrow.getDate(), tomorrow.getHours(), tomorrow.getMinutes()]).toEqual([5, 8, 0]);
  });
});
