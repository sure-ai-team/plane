/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { TChatMessage } from "@plane/types";
import { ChatMessageStore, MAX_LIVE_MESSAGES } from "./message.store";
import { ME, OTHER, makeMessage, makeService } from "./test-utils";
import type { TFakeService } from "./test-utils";

const SLUG = "acme";
const CONV = "conv-1";

describe("ChatMessageStore", () => {
  let service: TFakeService;
  let store: ChatMessageStore;
  let ids = 0;

  beforeEach(() => {
    service = makeService();
    ids = 0;
    store = new ChatMessageStore(
      service,
      () => ME,
      () => `client-${++ids}`
    );
  });

  const seqs = () =>
    store.items(CONV).map((item) => (item.type === "message" ? item.message.seq : `pending:${item.pending.status}`));

  it("loads the latest page and pages backwards", async () => {
    service.listMessages
      .mockResolvedValueOnce({
        results: [makeMessage(4), makeMessage(5)],
        has_more: true,
        oldest_seq: 4,
        newest_seq: 5,
      })
      .mockResolvedValueOnce({
        results: [makeMessage(2), makeMessage(3)],
        has_more: false,
        oldest_seq: 2,
        newest_seq: 3,
      });
    await store.open(SLUG, CONV);
    expect(seqs()).toEqual([4, 5]);
    expect(store.thread(CONV)?.hasMoreBefore).toBe(true);

    await store.loadOlder(SLUG, CONV);
    expect(service.listMessages).toHaveBeenLastCalledWith(SLUG, CONV, { before_seq: 4, limit: 50 });
    expect(seqs()).toEqual([2, 3, 4, 5]);
    expect(store.thread(CONV)?.hasMoreBefore).toBe(false);
    expect(await store.loadOlder(SLUG, CONV)).toBe(0);
  });

  it("shows a pending message immediately and replaces it when the server confirms", async () => {
    service.listMessages.mockResolvedValueOnce({
      results: [makeMessage(1)],
      has_more: false,
      oldest_seq: 1,
      newest_seq: 1,
    });
    await store.open(SLUG, CONV);
    let resolve!: (value: TChatMessage) => void;
    service.sendMessage.mockReturnValueOnce(new Promise<TChatMessage>((r) => (resolve = r)));

    const sending = store.send(SLUG, CONV, { body_html: "<p>hi</p>", body_stripped: "hi" });
    expect(seqs()).toEqual([1, "pending:sending"]);
    const pending = store.items(CONV)[1];
    expect(pending.type === "pending" && pending.pending.sender?.id).toBe(ME.id);

    resolve(makeMessage(2, { sender: ME, client_id: "client-1" }));
    await sending;
    expect(seqs()).toEqual([1, 2]);
    expect(service.sendMessage.mock.calls[0][2]).toMatchObject({ client_id: "client-1", attachment_ids: [] });
  });

  it("does not duplicate when the socket event arrives before the HTTP response", async () => {
    service.listMessages.mockResolvedValueOnce({ results: [], has_more: false, oldest_seq: null, newest_seq: null });
    await store.open(SLUG, CONV);
    const confirmed = makeMessage(1, { sender: ME, client_id: "client-1" });
    let resolve!: (value: TChatMessage) => void;
    service.sendMessage.mockReturnValueOnce(new Promise<TChatMessage>((r) => (resolve = r)));
    const sending = store.send(SLUG, CONV, { body_html: "<p>x</p>", body_stripped: "x" });

    expect(store.applyCreated(confirmed)).toBe("applied");
    resolve(confirmed);
    await sending;
    expect(seqs()).toEqual([1]);
  });

  it("keeps a failed send for retry with the same client id", async () => {
    service.listMessages.mockResolvedValueOnce({ results: [], has_more: false, oldest_seq: null, newest_seq: null });
    await store.open(SLUG, CONV);
    service.sendMessage.mockRejectedValueOnce({ error: "Offline", code: "NETWORK" });
    expect(await store.send(SLUG, CONV, { body_html: "<p>x</p>", body_stripped: "x" })).toBeUndefined();
    expect(seqs()).toEqual(["pending:failed"]);

    service.sendMessage.mockResolvedValueOnce(makeMessage(1, { sender: ME, client_id: "client-1" }));
    await store.retry(SLUG, "client-1");
    expect(service.sendMessage.mock.calls[1][2].client_id).toBe("client-1");
    expect(seqs()).toEqual([1]);
  });

  it("ignores duplicates, detects gaps and catches up after a reconnect", async () => {
    service.listMessages.mockResolvedValueOnce({
      results: [makeMessage(1)],
      has_more: false,
      oldest_seq: 1,
      newest_seq: 1,
    });
    await store.open(SLUG, CONV);
    expect(store.applyCreated(makeMessage(2))).toBe("applied");
    expect(store.applyCreated(makeMessage(2))).toBe("duplicate");
    expect(store.applyCreated(makeMessage(5))).toBe("gap");

    service.listMessages
      .mockResolvedValueOnce({
        results: [makeMessage(6), makeMessage(7)],
        has_more: true,
        oldest_seq: 6,
        newest_seq: 7,
      })
      .mockResolvedValueOnce({ results: [makeMessage(8)], has_more: false, oldest_seq: 8, newest_seq: 8 });
    expect(await store.catchUp(SLUG, CONV)).toBe(3);
    expect(service.listMessages).toHaveBeenCalledWith(SLUG, CONV, { after_seq: 5, limit: 100 });
    expect(service.listMessages).toHaveBeenLastCalledWith(SLUG, CONV, { after_seq: 7, limit: 100 });
    expect(seqs()).toEqual([1, 2, 5, 6, 7, 8]);
  });

  it("ignores events for threads that were never opened", () => {
    expect(store.applyCreated(makeMessage(1))).toBe("not-loaded");
    expect(store.items(CONV)).toEqual([]);
  });

  it("applies edits but never an older edit over a newer one", async () => {
    service.listMessages.mockResolvedValueOnce({
      results: [makeMessage(1)],
      has_more: false,
      oldest_seq: 1,
      newest_seq: 1,
    });
    await store.open(SLUG, CONV);
    store.applyUpdated(makeMessage(1, { body_stripped: "new", edited_at: "2026-11-03T12:00:00Z" }));
    store.applyUpdated(makeMessage(1, { body_stripped: "old", edited_at: "2026-11-03T11:00:00Z" }));
    const first = store.items(CONV)[0];
    expect(first.type === "message" && first.message.body_stripped).toBe("new");
  });

  it("deletes a message and clears replies that quoted it", async () => {
    const original = makeMessage(1);
    const reply = makeMessage(2, {
      reply_to: { id: original.id, seq: 1, sender: OTHER, kind: "text", body_stripped: "m1" },
    });
    service.listMessages.mockResolvedValueOnce({
      results: [original, reply],
      has_more: false,
      oldest_seq: 1,
      newest_seq: 2,
    });
    await store.open(SLUG, CONV);
    store.applyDeleted(CONV, 1);
    expect(seqs()).toEqual([2]);
    const item = store.items(CONV)[0];
    expect(item.type === "message" && item.message.reply_to).toBeNull();
  });

  it("bumps Seen by only for my messages a known reader just reached", async () => {
    service.listMessages.mockResolvedValueOnce({
      results: [makeMessage(1, { sender: ME }), makeMessage(2, { sender: ME }), makeMessage(3)],
      has_more: false,
      oldest_seq: 1,
      newest_seq: 3,
    });
    await store.open(SLUG, CONV);
    store.setReadPositions(CONV, [{ userId: OTHER.id, seq: 1 }]);
    store.applyRead(CONV, OTHER.id, 3);
    const counts = store.items(CONV).map((item) => (item.type === "message" ? item.message.seen_by_count : -1));
    expect(counts).toEqual([0, 1, 0]);
    // Unknown reader: no change (we can't tell what they had already seen).
    store.applyRead(CONV, "someone-else", 3);
    expect(store.items(CONV).map((item) => (item.type === "message" ? item.message.seen_by_count : -1))).toEqual([
      0, 1, 0,
    ]);
  });

  it("caps live appends and keeps paging possible", async () => {
    service.listMessages.mockResolvedValueOnce({
      results: [makeMessage(1)],
      has_more: false,
      oldest_seq: 1,
      newest_seq: 1,
    });
    await store.open(SLUG, CONV);
    for (let seq = 2; seq <= MAX_LIVE_MESSAGES + 5; seq += 1) store.applyCreated(makeMessage(seq));
    const thread = store.thread(CONV)!;
    expect(thread.bySeq.size).toBe(MAX_LIVE_MESSAGES);
    expect(thread.oldestSeq).toBe(6);
    expect(thread.hasMoreBefore).toBe(true);
  });
});
