/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it, vi } from "vitest";
import type { TChatWorkItemRef, TIssue } from "@plane/types";
import { orderForProject } from "@/components/chat/common/helpers";
import { ChatWorkItemStore, WORK_ITEM_BATCH_MS, WORK_ITEM_STALE_MS } from "./work-items.store";
import { makeConversation } from "./test-utils";

const ref = (id: string, projectId = "p1", sequence = 1): TChatWorkItemRef => ({
  id,
  project_id: projectId,
  project_identifier: projectId === "p1" ? "MOB" : "WEB",
  sequence_id: sequence,
});

const issue = (id: string, overrides: Partial<TIssue> = {}) =>
  ({
    id,
    name: `Issue ${id}`,
    sequence_id: 7,
    state_id: "s1",
    priority: "high",
    assignee_ids: ["u1"],
    target_date: "2026-11-06",
    sub_issues_count: 3,
    ...overrides,
  }) as TIssue;

describe("ChatWorkItemStore", () => {
  it("batches requests per project and marks invisible items missing", async () => {
    vi.useFakeTimers();
    const fetchItems = vi.fn(async (_slug: string, projectId: string, ids: string[]) =>
      projectId === "p1" ? ids.filter((id) => id !== "hidden").map((id) => issue(id)) : Promise.reject(new Error("403"))
    );
    const store = new ChatWorkItemStore(fetchItems);
    store.request("acme", ref("a"));
    store.request("acme", ref("b"));
    store.request("acme", ref("hidden"));
    store.request("acme", ref("a"));
    store.request("acme", ref("w", "p2"));
    await vi.advanceTimersByTimeAsync(WORK_ITEM_BATCH_MS);
    expect(fetchItems).toHaveBeenCalledTimes(2);
    expect(fetchItems).toHaveBeenCalledWith("acme", "p1", ["a", "b", "hidden"]);
    expect(store.get("a")).toMatchObject({ identifier: "MOB", name: "Issue a", priority: "high", subIssuesCount: 3 });
    expect(store.get("hidden")).toBe("missing");
    expect(store.get("w")).toBe("missing");
    vi.useRealTimers();
  });

  it("refreshes stale cards and keeps the old card when a refresh fails", async () => {
    vi.useFakeTimers();
    let now = 0;
    const fetchItems = vi
      .fn<(slug: string, projectId: string, ids: string[]) => Promise<TIssue[]>>()
      .mockResolvedValueOnce([issue("a", { archived_at: "2026-11-01" })])
      .mockRejectedValueOnce(new Error("offline"));
    const store = new ChatWorkItemStore(fetchItems, () => now);
    store.request("acme", ref("a"));
    await vi.advanceTimersByTimeAsync(WORK_ITEM_BATCH_MS);
    expect(store.get("a")).toMatchObject({ isArchived: true });
    store.request("acme", ref("a"));
    expect(fetchItems).toHaveBeenCalledTimes(1);
    now = WORK_ITEM_STALE_MS;
    store.request("acme", ref("a"));
    await vi.advanceTimersByTimeAsync(WORK_ITEM_BATCH_MS);
    expect(fetchItems).toHaveBeenCalledTimes(2);
    expect(store.get("a")).toMatchObject({ name: "Issue a" });
    vi.useRealTimers();
  });

  it("does nothing without a fetcher", () => {
    const store = new ChatWorkItemStore(null);
    store.request("acme", ref("a"));
    expect(store.get("a")).toBeUndefined();
  });
});

describe("orderForProject", () => {
  it("puts this project's groups first", () => {
    const linked = makeConversation({
      id: "linked",
      project: { id: "p1", identifier: "MOB", name: "Mobile", logo_props: {} },
    });
    const other = makeConversation({ id: "other" });
    expect(orderForProject([other, linked], "p1").map((conversation) => conversation.id)).toEqual(["linked", "other"]);
  });
});
