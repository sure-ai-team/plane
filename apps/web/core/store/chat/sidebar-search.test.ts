/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { TChatSearchResponse, TChatSearchResult } from "@plane/types";
import { groupResults, neighbourConversation } from "@/components/chat/common/helpers";
import { ChatConversationStore, defaultNotifyLevel, isQuiet } from "./conversation.store";
import { ChatRootStore, draftPreview } from "./root.store";
import type { TChatStorage } from "./root.store";
import { ChatSearchStore, canSearch } from "./search.store";
import { ME, OTHER, makeConversation, makeMessage, makeService } from "./test-utils";
import type { TFakeService } from "./test-utils";

const SLUG = "acme";

class MemoryStorage implements TChatStorage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  key(index: number) {
    return Array.from(this.data.keys())[index] ?? null;
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

describe("ChatConversationStore — sidebar", () => {
  let service: TFakeService;
  let store: ChatConversationStore;

  beforeEach(async () => {
    service = makeService();
    store = new ChatConversationStore(service, () => ME.id);
    service.listConversations.mockResolvedValueOnce([
      makeConversation({ id: "g1", type: "group", notify_level: "mentions", last_message_at: "2026-11-04T10:00:00Z" }),
      makeConversation({
        id: "d1",
        type: "direct",
        notify_level: "all",
        is_starred: true,
        last_message_seq: 5,
        last_read_seq: 3,
        unread_count: 2,
        last_message_at: "2026-11-04T11:00:00Z",
      }),
      makeConversation({
        id: "g2",
        type: "group",
        notify_level: "off",
        last_message_seq: 4,
        last_read_seq: 1,
        unread_count: 3,
        unread_mention_count: 1,
        last_message_at: "2026-11-04T09:00:00Z",
      }),
    ]);
    await store.fetchAll(SLUG);
  });

  it("splits starred, groups and directs, and filters", () => {
    expect(store.starred.map((c) => c.id)).toEqual(["d1"]);
    expect(store.groups.map((c) => c.id)).toEqual(["g1", "g2"]);
    expect(store.directs).toEqual([]);
    store.setFilter("unread");
    expect(store.visible.map((c) => c.id)).toEqual(["d1", "g2"]);
    store.setFilter("mentions");
    expect(store.visible.map((c) => c.id)).toEqual(["g2"]);
    expect(store.unreadConversationCount).toBe(2);
    expect(store.mentionConversationCount).toBe(1);
  });

  it("leaves conversations set to off out of the total", () => {
    expect(store.totalUnread).toBe(2);
    expect(isQuiet(store.getById("g2")!)).toBe(true);
    expect(defaultNotifyLevel({ type: "group" })).toBe("mentions");
  });

  it("archives optimistically into the archived list and stays there on new messages", async () => {
    service.updateMembership.mockResolvedValueOnce({
      notify_level: "mentions",
      snoozed_until: null,
      is_starred: false,
      archived_at: "2026-11-04T12:00:00Z",
      is_muted: false,
    });
    const pending = store.updateMySettings(SLUG, "g1", { archived: true });
    expect(store.sorted.map((c) => c.id)).not.toContain("g1");
    expect(store.archived.map((c) => c.id)).toEqual(["g1"]);
    await pending;
    store.applyMessageCreated(makeMessage(2, { conversation_id: "g1", sender: OTHER }));
    expect(store.archived[0].unread_count).toBe(1);
    expect(store.archivedUnread).toBe(1);
    expect(store.getById("g1")?.archived_at).toBeTruthy();
  });

  it("rolls back a failed settings change", async () => {
    service.updateMembership.mockRejectedValueOnce({ error: "no", code: "X" });
    await expect(store.updateMySettings(SLUG, "d1", { is_starred: false })).rejects.toBeTruthy();
    expect(store.getById("d1")?.is_starred).toBe(true);
  });

  it("applies settings changed on another device", () => {
    store.applyMembershipUpdate({
      conversation_id: "g1",
      notify_level: "all",
      snoozed_until: null,
      is_starred: true,
      archived_at: null,
      is_muted: false,
    });
    expect(store.starred.map((c) => c.id)).toEqual(["d1", "g1"]);
  });

  it("counts new mentions and clears them when read", async () => {
    store.applyMessageCreated(makeMessage(2, { conversation_id: "g1", sender: OTHER, mentions: [ME.id] }));
    expect(store.getById("g1")?.unread_mention_count).toBe(1);
    await store.markRead(SLUG, "g1", 2);
    expect(store.getById("g1")?.unread_mention_count).toBe(0);
  });

  it("moves between conversations in sidebar order", () => {
    const ordered = [...store.starred, ...store.groups, ...store.directs];
    expect(neighbourConversation(ordered, "d1", 1)?.id).toBe("g1");
    expect(neighbourConversation(ordered, "d1", -1)?.id).toBe("g2");
    expect(neighbourConversation(ordered, "d1", 1, true)?.id).toBe("g2");
    expect(neighbourConversation([], undefined, 1)).toBeUndefined();
  });
});

describe("drafts", () => {
  const makeRoot = (storage: TChatStorage | null, service: TFakeService = makeService()) =>
    new ChatRootStore({
      service,
      currentUser: () => ME,
      createClientId: () => "c",
      storage,
      createSocket: () =>
        ({
          connect: () => undefined,
          disconnect: () => undefined,
          setActiveConversation: () => undefined,
          sendTyping: () => undefined,
        }) as never,
    });

  it("persist per user and workspace, survive a reload, and clear on sign-out", async () => {
    const storage = new MemoryStorage();
    const first = makeRoot(storage);
    await first.init(SLUG);
    first.setDraft("conv-1", "<p>I'll push the fix after <strong>lunch</strong></p>");
    first.setDraft("conv-2", "<p></p>");
    expect(first.draftText("conv-1")).toBe("I'll push the fix after lunch");
    expect(first.getDraft("conv-2")).toBeUndefined();
    first.teardown();

    const reloaded = makeRoot(storage);
    await reloaded.init(SLUG);
    expect(reloaded.getDraft("conv-1")).toContain("lunch");

    storage.setItem("unrelated", "keep");
    reloaded.clearLocalData();
    expect(storage.length).toBe(1);
    expect(reloaded.getDraft("conv-1")).toBeUndefined();
    reloaded.teardown();
  });

  it("previews html as short plain text", () => {
    expect(draftPreview("<p>a&nbsp;b</p><p>c</p>", 4)).toBe("a b");
  });
});

describe("ChatSearchStore", () => {
  const result = (id: string, conversationId: string): TChatSearchResult => ({
    conversation: { id: conversationId, type: "group", name: conversationId, logo_props: {}, direct_user: null },
    message: { id, seq: 1, kind: "text", sender: OTHER, created_at: "2026-11-04T10:00:00Z" },
    snippet_html: "<mark>x</mark>",
    attachment_names: [],
  });

  it("needs two characters or a has filter", () => {
    expect(canSearch("a", {})).toBe(false);
    expect(canSearch("ab", {})).toBe(true);
    expect(canSearch("", { has: "image" })).toBe(true);
  });

  it("keeps only the newest request's results", async () => {
    const service = makeService();
    let resolveSlow: ((value: TChatSearchResponse) => void) | undefined;
    service.searchMessages
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSlow = resolve)))
      .mockResolvedValueOnce({ results: [result("fast", "c1")], next_cursor: "n", total_estimate: 30 });
    const search = new ChatSearchStore(service);
    search.setText("slo");
    const slow = search.run(SLUG);
    search.setText("fast");
    await search.run(SLUG);
    resolveSlow?.({ results: [result("slow", "c1")], next_cursor: null, total_estimate: 1 });
    await slow;
    expect(search.results.map((item) => item.message.id)).toEqual(["fast"]);
    expect(search.totalEstimate).toBe(30);

    service.searchMessages.mockResolvedValueOnce({ results: [result("more", "c2")], next_cursor: null });
    await search.loadMore(SLUG);
    expect(service.searchMessages).toHaveBeenLastCalledWith(SLUG, { q: "fast", cursor: "n" });
    expect(search.results).toHaveLength(2);
    search.moveSelection(5);
    expect(search.selectedIndex).toBe(1);
  });

  it("groups consecutive results by conversation", () => {
    const groups = groupResults([result("a", "c1"), result("b", "c1"), result("c", "c2"), result("d", "c1")]);
    expect(groups.map((group) => [group.conversationId, group.items.length])).toEqual([
      ["c1", 2],
      ["c2", 1],
      ["c1", 1],
    ]);
  });
});
