/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it, vi } from "vitest";
import { ChatRootStore } from "./root.store";
import { ME, flush, makeConversation, makeMessage, makeService } from "./test-utils";

const makeRoot = () => {
  const service = makeService();
  service.listConversations.mockResolvedValueOnce([makeConversation()]);
  const root = new ChatRootStore({
    service,
    currentUser: () => ME,
    createClientId: (() => {
      let id = 0;
      return () => `client-${++id}`;
    })(),
    storage: null,
    createSocket: () =>
      ({ connect: vi.fn(), disconnect: vi.fn(), setActiveConversation: vi.fn(), sendTyping: vi.fn() }) as never,
  });
  return { root, service };
};

describe("offline sending", () => {
  it("queues sends while offline and sends them in order when back online", async () => {
    const { root, service } = makeRoot();
    await root.init("acme");
    root.setNetworkOnline(false);
    await root.send("conv-1", { body_html: "<p>one</p>", body_stripped: "one" });
    await root.send("conv-1", { body_html: "<p>two</p>", body_stripped: "two" });
    expect(service.sendMessage).not.toHaveBeenCalled();
    expect(Array.from(root.message.pending.values()).map((item) => item.status)).toEqual(["queued", "queued"]);

    service.sendMessage
      .mockResolvedValueOnce(makeMessage(2, { sender: ME, client_id: "client-1" }))
      .mockResolvedValueOnce(makeMessage(3, { sender: ME, client_id: "client-2" }));
    root.setNetworkOnline(true);
    expect(root.realtime.justReconnected).toBe(true);
    await flush();
    expect(service.sendMessage.mock.calls.map((call) => call[2].body_html)).toEqual(["<p>one</p>", "<p>two</p>"]);
    expect(root.message.pending.size).toBe(0);
    root.teardown();
  });

  it("queues instead of failing when the network drops mid-send", async () => {
    const { root, service } = makeRoot();
    await root.init("acme");
    service.sendMessage.mockImplementationOnce(async () => {
      root.setNetworkOnline(false);
      throw { error: "Network", code: "NETWORK" };
    });
    await root.send("conv-1", { body_html: "<p>x</p>", body_stripped: "x" });
    expect(Array.from(root.message.pending.values())[0].status).toBe("queued");
    root.teardown();
  });
});
