/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TChatServerFrame } from "@plane/types";
import type { ChatSocket, TChatSocketOptions } from "@/services/chat-socket";
import { ChatRootStore } from "./root.store";
import { ME, OTHER, flush, makeAttachment, makeConversation, makeMessage, makeService } from "./test-utils";
import type { TFakeService } from "./test-utils";

type THandlers = Pick<TChatSocketOptions, "onFrame" | "onStatus" | "onReady">;

const frame = (value: Omit<TChatServerFrame, "ts">) => ({ ...value, ts: 1 }) as TChatServerFrame;

describe("ChatRootStore", () => {
  let service: TFakeService;
  let handlers: THandlers;
  let socket: {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    setActiveConversation: ReturnType<typeof vi.fn>;
    sendTyping: ReturnType<typeof vi.fn>;
  };
  let root: ChatRootStore;

  beforeEach(async () => {
    service = makeService();
    service.listConversations.mockResolvedValue([makeConversation({ last_message_seq: 1, last_read_seq: 1 })]);
    service.presence.mockResolvedValue({ online_user_ids: [OTHER.id] });
    socket = { connect: vi.fn(), disconnect: vi.fn(), setActiveConversation: vi.fn(), sendTyping: vi.fn() };
    root = new ChatRootStore({
      service,
      currentUser: () => ME,
      createClientId: () => "client-1",
      createSocket: (provided) => {
        handlers = provided;
        return socket as unknown as ChatSocket;
      },
    });
    await root.init("acme");
  });

  it("connects, loads conversations, limits and presence", () => {
    expect(socket.connect).toHaveBeenCalledWith("acme");
    expect(root.conversation.sorted).toHaveLength(1);
    expect(root.config?.max_files_per_message).toBe(10);
    expect(root.realtime.isOnline(OTHER.id)).toBe(true);
    root.teardown();
  });

  it("opens a thread, records read positions and marks it read", async () => {
    service.listMessages.mockResolvedValueOnce({
      results: [makeMessage(1), makeMessage(2)],
      has_more: false,
      oldest_seq: 1,
      newest_seq: 2,
    });
    service.getConversation.mockResolvedValueOnce(
      makeConversation({
        last_message_seq: 2,
        last_read_seq: 1,
        unread_count: 1,
        members: [
          { id: "m1", member: OTHER, role: 15, is_muted: false, is_active: true, last_read_seq: 2, joined_at: "" },
        ],
      })
    );
    await root.openConversation("conv-1");
    expect(socket.setActiveConversation).toHaveBeenCalledWith("conv-1");
    expect(service.markRead).toHaveBeenCalledWith("acme", "conv-1", 2);
    expect(root.conversation.getById("conv-1")?.unread_count).toBe(0);
    expect(root.message.readPositions.get("conv-1")?.get(OTHER.id)).toBe(2);
    root.teardown();
  });

  it("routes message events to the thread, the list and the typing indicator", async () => {
    service.listMessages.mockResolvedValueOnce({
      results: [makeMessage(1)],
      has_more: false,
      oldest_seq: 1,
      newest_seq: 1,
    });
    await root.message.open("acme", "conv-1");
    handlers.onFrame(frame({ t: "typing", d: { conversation_id: "conv-1", user_id: OTHER.id } }));
    expect(root.realtime.typingUserIds("conv-1")).toEqual([OTHER.id]);

    handlers.onFrame(frame({ t: "message.created", d: { message: makeMessage(2) } }));
    expect(root.message.thread("conv-1")?.newestSeq).toBe(2);
    expect(root.conversation.getById("conv-1")?.unread_count).toBe(1);
    expect(root.realtime.typingUserIds("conv-1")).toEqual([]);
    root.teardown();
  });

  it("fetches conversations it doesn't know about", async () => {
    service.getConversation.mockResolvedValueOnce(makeConversation({ id: "conv-2" }));
    handlers.onFrame(frame({ t: "conversation.created", d: { conversation_id: "conv-2" } }));
    await flush();
    expect(root.conversation.getById("conv-2")).toBeDefined();
    root.teardown();
  });

  it("drops a conversation when I'm removed from it", async () => {
    handlers.onFrame(frame({ t: "member.removed", d: { conversation_id: "conv-1", user_id: ME.id } }));
    expect(root.conversation.getById("conv-1")).toBeUndefined();
    root.teardown();
  });

  it("catches up after a reconnect but not on the first connection", async () => {
    service.listMessages.mockResolvedValueOnce({
      results: [makeMessage(1)],
      has_more: false,
      oldest_seq: 1,
      newest_seq: 1,
    });
    await root.message.open("acme", "conv-1");
    service.listConversations.mockClear();
    handlers.onReady?.(false);
    await flush();
    expect(service.listConversations).not.toHaveBeenCalled();

    handlers.onReady?.(true);
    await flush();
    expect(service.listConversations).toHaveBeenCalledTimes(1);
    expect(service.listMessages).toHaveBeenLastCalledWith("acme", "conv-1", { after_seq: 1, limit: 100 });
    root.teardown();
  });

  it("sends ready attachments with the message", async () => {
    service.listMessages.mockResolvedValueOnce({ results: [], has_more: false, oldest_seq: null, newest_seq: null });
    await root.message.open("acme", "conv-1");
    service.requestUpload.mockResolvedValue({
      asset_id: "asset-1",
      upload_data: { url: "https://s3", fields: {} },
      asset_url: "",
      attachment: makeAttachment("asset-1"),
    });
    service.confirmUpload.mockResolvedValue(makeAttachment("asset-1"));
    root.upload.add("conv-1", [new File(["x"], "a.png", { type: "image/png" })]);
    await flush();
    service.sendMessage.mockResolvedValueOnce(
      makeMessage(2, { sender: ME, client_id: "client-1", attachments: [makeAttachment("asset-1")] })
    );
    await root.send("conv-1", { body_html: "", body_stripped: "" });
    expect(service.sendMessage.mock.calls[0][2]).toMatchObject({ attachment_ids: ["asset-1"] });
    expect(root.upload.forConversation("conv-1")).toEqual([]);
    expect(root.conversation.getById("conv-1")?.last_message_preview.attachment_kinds).toEqual(["image"]);
    root.teardown();
  });

  it("tracks socket status", () => {
    handlers.onStatus?.("blocked", 4404);
    expect(root.realtime.status).toBe("blocked");
    expect(root.realtime.closeCode).toBe(4404);
    root.teardown();
  });
});
