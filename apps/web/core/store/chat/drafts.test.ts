/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it, vi } from "vitest";
import type { ChatSocket } from "@/services/chat-socket";
import { ChatRootStore } from "./root.store";
import { ME, makeService } from "./test-utils";

const makeRoot = () =>
  new ChatRootStore({
    service: makeService(),
    currentUser: () => ME,
    createClientId: () => "client",
    createSocket: () =>
      ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        setActiveConversation: vi.fn(),
        sendTyping: vi.fn(),
      }) as unknown as ChatSocket,
  });

describe("composer drafts", () => {
  it("keeps a draft per conversation and clears it on demand or on teardown", () => {
    const root = makeRoot();
    root.setDraft("a", "<p>half written</p>");
    root.setDraft("b", "<p>other</p>");
    expect(root.getDraft("a")).toBe("<p>half written</p>");
    root.setDraft("a", null);
    expect(root.getDraft("a")).toBeUndefined();
    root.teardown();
    expect(root.getDraft("b")).toBeUndefined();
  });

  it("prefills a draft from outside and signals an open composer to reload it", () => {
    const root = makeRoot();
    expect(root.draftPrefills.get("a")).toBeUndefined();
    root.prefillDraft("a", "<p>MOB-1</p>");
    root.prefillDraft("a", "<p>MOB-2</p>");
    expect(root.getDraft("a")).toBe("<p>MOB-2</p>");
    expect(root.draftPrefills.get("a")).toBe(2);
  });
});
