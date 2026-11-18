/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { TChatReactionSummary } from "@plane/types";
import { firstUnreadIndex, noteToHtml } from "@/components/chat/common/helpers";
import { ChatMessageStore } from "./message.store";
import { applyReaction } from "./reactions";
import { ME, OTHER, makeMessage, makeService } from "./test-utils";
import type { TFakeService } from "./test-utils";

const SLUG = "acme";
const CONV = "conv-1";

describe("applyReaction", () => {
  const base: TChatReactionSummary[] = [{ emoji: "👍", count: 1, reacted: false, user_ids: [OTHER.id] }];

  it("adds a new emoji and increments an existing one", () => {
    const added = applyReaction(base, { emoji: "🎉", userId: ME.id, added: true, isMe: true });
    expect(added[1]).toEqual({ emoji: "🎉", count: 1, reacted: true, user_ids: [ME.id] });
    const plusOne = applyReaction(base, { emoji: "👍", userId: ME.id, added: true, isMe: true });
    expect(plusOne[0]).toEqual({ emoji: "👍", count: 2, reacted: true, user_ids: [OTHER.id, ME.id] });
  });

  it("is idempotent, so an optimistic update plus its socket echo counts once", () => {
    const once = applyReaction(base, { emoji: "👍", userId: ME.id, added: true, isMe: true });
    const echoed = applyReaction(once, { emoji: "👍", userId: ME.id, added: true, isMe: true, count: 2 });
    expect(echoed[0].count).toBe(2);
    expect(applyReaction(base, { emoji: "👍", userId: ME.id, added: false, isMe: true })).toEqual(base);
  });

  it("removes the entry when the count reaches zero and trusts the server count", () => {
    expect(applyReaction(base, { emoji: "👍", userId: OTHER.id, added: false, isMe: false })).toEqual([]);
    const fixed = applyReaction(base, { emoji: "👍", userId: "third", added: true, isMe: false, count: 7 });
    expect(fixed[0].count).toBe(7);
  });
});

describe("ChatMessageStore — phase 2 interactions", () => {
  let service: TFakeService;
  let store: ChatMessageStore;

  beforeEach(async () => {
    service = makeService();
    store = new ChatMessageStore(
      service,
      () => ME,
      () => "client"
    );
    service.listMessages.mockResolvedValueOnce({
      results: [makeMessage(10), makeMessage(11, { reactions: [] })],
      has_more: true,
      oldest_seq: 10,
      newest_seq: 11,
    });
    await store.open(SLUG, CONV);
  });

  const message = (seq: number) => store.thread(CONV)?.bySeq.get(seq);

  it("toggles a reaction optimistically and keeps the server summary", async () => {
    service.addReaction.mockResolvedValueOnce([{ emoji: "🎉", count: 2, reacted: true, user_ids: [OTHER.id, ME.id] }]);
    const pending = store.toggleReaction(SLUG, message(11)!, "🎉");
    expect(message(11)?.reactions?.[0]).toMatchObject({ emoji: "🎉", count: 1, reacted: true });
    await pending;
    expect(message(11)?.reactions?.[0].count).toBe(2);
    expect(service.addReaction).toHaveBeenCalledWith(SLUG, "msg-11", "🎉");
  });

  it("rolls back when the request fails", async () => {
    service.addReaction.mockRejectedValueOnce({ error: "no", code: "INVALID_EMOJI" });
    await expect(store.toggleReaction(SLUG, message(11)!, "🎉")).rejects.toBeTruthy();
    expect(message(11)?.reactions).toEqual([]);
  });

  it("removes my reaction when I already reacted", async () => {
    store.applyReactionEvent({
      conversation_id: CONV,
      message_id: "msg-10",
      emoji: "👍",
      count: 1,
      user_id: ME.id,
      added: true,
    });
    await store.toggleReaction(SLUG, message(10)!, "👍");
    expect(service.removeReaction).toHaveBeenCalledWith(SLUG, "msg-10", "👍");
    expect(message(10)?.reactions).toEqual([]);
  });

  it("keeps local reactions when a socket update omits them", () => {
    store.applyReactionEvent({
      conversation_id: CONV,
      message_id: "msg-11",
      emoji: "👀",
      count: 1,
      user_id: OTHER.id,
      added: true,
    });
    store.applyUpdated(makeMessage(11, { body_stripped: "edited", edited_at: "2026-11-04T10:00:00.000Z" }));
    expect(message(11)?.body_stripped).toBe("edited");
    expect(message(11)?.reactions?.[0].emoji).toBe("👀");
  });

  it("jumps around an older message and stops live appends until back at the latest", async () => {
    service.listMessages.mockResolvedValueOnce({
      results: [makeMessage(2), makeMessage(3), makeMessage(4)],
      has_more: true,
      has_before: true,
      has_after: true,
      oldest_seq: 2,
      newest_seq: 4,
    });
    await store.jumpToMessage(SLUG, CONV, { seq: 3 });
    expect(service.listMessages).toHaveBeenLastCalledWith(SLUG, CONV, { around_seq: 3, limit: 50 });
    expect(store.thread(CONV)?.hasMoreAfter).toBe(true);
    expect(store.focusRequest).toMatchObject({ conversationId: CONV, seq: 3, messageId: "msg-3" });

    expect(store.applyCreated(makeMessage(12))).toBe("not-loaded");
    expect(await store.catchUp(SLUG, CONV)).toBe(0);

    service.listMessages.mockResolvedValueOnce({
      results: [makeMessage(5)],
      has_more: false,
      oldest_seq: 5,
      newest_seq: 5,
    });
    await store.loadNewer(SLUG, CONV);
    expect(service.listMessages).toHaveBeenLastCalledWith(SLUG, CONV, { after_seq: 4, limit: 50 });
    expect(store.thread(CONV)?.hasMoreAfter).toBe(false);
  });

  it("does not reload when the target is already loaded", async () => {
    service.listMessages.mockClear();
    await store.jumpToMessage(SLUG, CONV, { seq: 10 });
    expect(service.listMessages).not.toHaveBeenCalled();
    expect(store.focusRequest?.messageId).toBe("msg-10");
  });

  it("resolves a message link by id and refuses a message from another conversation", async () => {
    service.getMessage.mockResolvedValueOnce(makeMessage(10));
    await store.jumpToMessage(SLUG, CONV, { messageId: "msg-10" });
    expect(store.focusRequest?.seq).toBe(10);

    service.getMessage.mockResolvedValueOnce(makeMessage(10, { conversation_id: "elsewhere" }));
    await expect(store.jumpToMessage(SLUG, CONV, { messageId: "msg-10" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("tracks pins from actions and events", async () => {
    service.listPins.mockResolvedValueOnce([{ ...makeMessage(10), pinned_at: "x", pinned_by: ME.id }]);
    await store.fetchPins(SLUG, CONV);
    expect(store.pinState(CONV)?.items).toHaveLength(1);

    await store.pin(SLUG, message(11)!);
    expect(message(11)?.is_pinned).toBe(true);
    expect(service.listPins).toHaveBeenCalledTimes(2);

    store.applyPinChanged(CONV, "msg-10", false);
    expect(store.pinState(CONV)?.items.map((item) => item.id)).toEqual([]);
  });
});

describe("thread helpers", () => {
  it("finds the first unread message from someone else", () => {
    const items = [9, 10, 11].map((seq) => ({
      type: "message" as const,
      message: makeMessage(seq, { sender: seq === 10 ? ME : OTHER }),
    }));
    expect(firstUnreadIndex(items, 9, ME.id)).toBe(2);
    expect(firstUnreadIndex(items, undefined, ME.id)).toBe(-1);
    expect(firstUnreadIndex(items, 11, ME.id)).toBe(-1);
  });

  it("turns a forward note into escaped paragraphs", () => {
    expect(noteToHtml("hi <b>there</b>\nline two\n\nsecond")).toBe(
      "<p>hi &lt;b&gt;there&lt;/b&gt;<br>line two</p><p>second</p>"
    );
    expect(noteToHtml("   ")).toBe("");
  });
});
