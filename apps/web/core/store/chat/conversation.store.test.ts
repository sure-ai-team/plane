/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { ChatConversationStore } from "./conversation.store";
import { ME, OTHER, makeConversation, makeMessage, makeService } from "./test-utils";
import type { TFakeService } from "./test-utils";

describe("ChatConversationStore", () => {
  let service: TFakeService;
  let store: ChatConversationStore;

  beforeEach(() => {
    service = makeService();
    store = new ChatConversationStore(service, () => ME.id);
  });

  it("sorts by latest activity and splits groups from direct chats", async () => {
    service.listConversations.mockResolvedValueOnce([
      makeConversation({ id: "a", last_message_at: "2026-11-03T08:00:00Z" }),
      makeConversation({ id: "b", type: "direct", last_message_at: "2026-11-03T12:00:00Z" }),
      makeConversation({ id: "c", last_message_at: null, created_at: "2026-11-03T10:00:00Z" }),
    ]);
    await store.fetchAll("acme");
    expect(store.sorted.map((conversation) => conversation.id)).toEqual(["b", "c", "a"]);
    expect(store.groups.map((conversation) => conversation.id)).toEqual(["c", "a"]);
    expect(store.directs.map((conversation) => conversation.id)).toEqual(["b"]);
  });

  it("drops conversations the server no longer returns", async () => {
    store.upsert(makeConversation({ id: "gone" }));
    service.listConversations.mockResolvedValueOnce([makeConversation({ id: "kept" })]);
    await store.fetchAll("acme");
    expect(Array.from(store.byId.keys())).toEqual(["kept"]);
  });

  it("counts unread across conversations but not muted ones", () => {
    store.upsert(makeConversation({ id: "a", last_message_seq: 5, last_read_seq: 2, unread_count: 3 }));
    store.upsert(makeConversation({ id: "b", last_message_seq: 4, last_read_seq: 0, unread_count: 4, is_muted: true }));
    expect(store.totalUnread).toBe(3);
  });

  it("updates preview and unread from new messages, and treats my own as read", () => {
    store.upsert(makeConversation({ last_message_seq: 1, last_read_seq: 1 }));
    store.applyMessageCreated(
      makeMessage(2, { attachments: [], body_stripped: "hello", created_at: "2026-11-03T11:00:00Z" })
    );
    let conversation = store.getById("conv-1")!;
    expect(conversation.unread_count).toBe(1);
    expect(conversation.last_message_preview).toMatchObject({ sender_id: OTHER.id, text: "hello", kind: "text" });

    store.applyMessageCreated(makeMessage(3, { sender: ME }));
    conversation = store.getById("conv-1")!;
    expect(conversation.last_read_seq).toBe(3);
    expect(conversation.unread_count).toBe(0);
  });

  it("reports unknown conversations so the caller can fetch them", () => {
    expect(store.applyMessageCreated(makeMessage(1, { conversation_id: "new" }))).toBe(false);
  });

  it("marks read optimistically and never moves backwards", async () => {
    store.upsert(makeConversation({ last_message_seq: 10, last_read_seq: 4, unread_count: 6 }));
    await store.markRead("acme", "conv-1", 8);
    expect(store.getById("conv-1")?.unread_count).toBe(2);
    expect(service.markRead).toHaveBeenCalledWith("acme", "conv-1", 8);

    await store.markRead("acme", "conv-1", 6);
    expect(service.markRead).toHaveBeenCalledTimes(1);

    // A late list response with older read state must not undo it.
    store.upsert(makeConversation({ last_message_seq: 10, last_read_seq: 4, unread_count: 6 }));
    expect(store.getById("conv-1")?.last_read_seq).toBe(8);
  });

  it("removes the conversation when I am removed, and adjusts counts otherwise", () => {
    store.upsert(makeConversation({ member_count: 3 }));
    expect(store.applyMemberRemoved("conv-1", OTHER.id)).toBe(false);
    expect(store.getById("conv-1")?.member_count).toBe(2);
    expect(store.applyMemberRemoved("conv-1", ME.id)).toBe(true);
    expect(store.getById("conv-1")).toBeUndefined();
  });

  it("rolls back mute when the server refuses", async () => {
    store.upsert(makeConversation());
    // Phase 2: mute is notify level "off", saved through conversations/<id>/me/.
    service.updateMembership.mockRejectedValueOnce({ error: "x", code: "X" });
    await expect(store.setMuted("acme", "conv-1", true)).rejects.toBeTruthy();
    expect(store.getById("conv-1")?.is_muted).toBe(false);
    expect(service.updateMembership).toHaveBeenCalledWith("acme", "conv-1", { notify_level: "off" });
  });

  it("uses the other person's name for direct chats", () => {
    const direct = makeConversation({ type: "direct", name: "", direct_user: OTHER });
    expect(store.displayName(direct)).toBe(OTHER.display_name);
    expect(store.displayName(makeConversation())).toBe("Release");
  });
});
