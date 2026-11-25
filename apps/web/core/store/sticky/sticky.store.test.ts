/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { EStickyAccess } from "@plane/types";
import type { TSticky, TStickyScope, TStickySharing } from "@plane/types";
import type { TStickyListResponse, TStickyRequestError } from "@/services/sticky.service";
import { StickyStore } from "./sticky.store";
import type { TStickyServiceLike } from "./sticky.store";

const PERSONAL: TStickyScope = { workspaceSlug: "acme" };
const PROJECT: TStickyScope = { workspaceSlug: "acme", projectId: "project-1" };
const OTHER_PROJECT: TStickyScope = { workspaceSlug: "acme", projectId: "project-2" };

const makeSticky = (overrides: Partial<TSticky> = {}): TSticky => ({
  id: "s1",
  logo_props: undefined,
  workspace: "workspace-1",
  sort_order: 100,
  description_html: "<p>one</p>",
  project: "project-1",
  owner: "me",
  my_permission: "manage",
  content_version: 1,
  ...overrides,
});

const page = (results: TSticky[], overrides: Partial<TStickyListResponse> = {}): TStickyListResponse => ({
  results,
  count: results.length,
  extra_stats: null,
  next_cursor: "30:1:0",
  next_page_results: false,
  prev_cursor: "30:-1:1",
  prev_page_results: false,
  total_pages: 1,
  total_results: results.length,
  ...overrides,
});

const requestError = (status: number | undefined, sticky?: TSticky): TStickyRequestError => ({
  status,
  data: { sticky },
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

type TMockService = Record<keyof TStickyServiceLike, Mock>;

let service: TMockService;
let store: StickyStore;

const loadProject = async (...stickies: TSticky[]) => {
  service.getStickies.mockResolvedValueOnce(page(stickies));
  await store.fetchStickies(PROJECT);
};

beforeEach(() => {
  service = {
    createSticky: vi.fn(),
    getStickies: vi.fn(),
    getSticky: vi.fn(),
    updateSticky: vi.fn(),
    updateSharing: vi.fn(),
    updatePin: vi.fn(),
    deleteSticky: vi.fn(),
  };
  store = new StickyStore(service as unknown as TStickyServiceLike);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("lists", () => {
  it("keeps personal and project stickies, searches and loaders apart", async () => {
    await loadProject(makeSticky());
    service.getStickies.mockResolvedValueOnce(page([makeSticky({ id: "p1", project: null })]));
    await store.fetchStickies(PERSONAL);
    store.updateSearchQuery(PROJECT, "budget");

    expect(store.getStickyIds(PROJECT)).toEqual(["s1"]);
    expect(store.getStickyIds(PERSONAL)).toEqual(["p1"]);
    expect(store.getStickyIds(OTHER_PROJECT)).toEqual([]);
    expect(store.getList(PERSONAL).searchQuery).toBe("");
    expect(store.getList(OTHER_PROJECT).loader).toBe("init-loader");
  });

  it("ignores the response of a search that a newer one replaced", async () => {
    const slow = deferred<TStickyListResponse>();
    service.getStickies.mockReturnValueOnce(slow.promise);
    const first = store.fetchStickies(PROJECT);
    await loadProject(makeSticky({ id: "new" }));
    slow.resolve(page([makeSticky({ id: "old" })]));
    await first;

    expect(store.getStickyIds(PROJECT)).toEqual(["new"]);
    expect(store.getList(PROJECT).loader).toBe("loaded");
  });

  it("appends the next page", async () => {
    service.getStickies.mockResolvedValueOnce(page([makeSticky()], { next_page_results: true }));
    await store.fetchStickies(PROJECT);
    service.getStickies.mockResolvedValueOnce(page([makeSticky(), makeSticky({ id: "s2", sort_order: 50 })]));
    await store.fetchNextStickies(PROJECT);

    expect(store.getStickyIds(PROJECT)).toEqual(["s1", "s2"]);
    await store.fetchNextStickies(PROJECT); // no more pages
    expect(service.getStickies).toHaveBeenCalledTimes(2);
  });

  it("does not load the next page while the list itself is loading", async () => {
    service.getStickies.mockResolvedValueOnce(page([makeSticky()], { next_page_results: true }));
    await store.fetchStickies(PROJECT);
    const reload = deferred<TStickyListResponse>();
    service.getStickies.mockReturnValueOnce(reload.promise);
    const reloading = store.fetchStickies(PROJECT);
    await store.fetchNextStickies(PROJECT);
    reload.resolve(page([makeSticky({ id: "reloaded" })]));
    await reloading;

    expect(store.getStickyIds(PROJECT)).toEqual(["reloaded"]);
  });

  it("copes with a workspace that has no stickies", async () => {
    service.getStickies.mockResolvedValueOnce(page([]));
    await store.fetchRecentSticky("acme");

    expect(store.recentStickyId).toBeUndefined();
    expect(Object.keys(store.stickies)).toEqual([]);
  });
});

describe("creating", () => {
  it("adds a project sticky without touching the personal ones", async () => {
    await loadProject(makeSticky());
    service.createSticky.mockResolvedValueOnce(makeSticky({ id: "s2", sort_order: 200 }));
    await store.createSticky(PROJECT, {});

    expect(store.getStickyIds(PROJECT)).toEqual(["s2", "s1"]);
    expect(store.recentStickyId).toBeUndefined();
    expect(store.activeStickyId).toBeUndefined();
  });

  it("can be tried again after a failure", async () => {
    service.createSticky.mockRejectedValueOnce(requestError(500));
    await expect(store.createSticky(PROJECT, {})).rejects.toMatchObject({ status: 500 });

    expect(store.getList(PROJECT).isCreating).toBe(false);
  });
});

describe("personal stickies", () => {
  const personal = makeSticky({ id: "p1", project: null, content_version: 1 });

  beforeEach(async () => {
    service.getStickies.mockResolvedValueOnce(page([personal]));
    await store.fetchStickies(PERSONAL);
  });

  it("are saved without a version", async () => {
    service.updateSticky.mockResolvedValueOnce(personal);
    await store.updateSticky(PERSONAL, "p1", { description_html: "<p>two</p>" });

    expect(service.updateSticky).toHaveBeenCalledWith(PERSONAL, "p1", { description_html: "<p>two</p>" });
    expect(store.recentStickyId).toBe("p1");
  });

  it("are restored when a save fails", async () => {
    service.updateSticky.mockRejectedValueOnce(requestError(500));
    await expect(store.updateSticky(PERSONAL, "p1", { description_html: "<p>two</p>" })).rejects.toBeDefined();

    expect(store.stickies.p1.description_html).toBe("<p>one</p>");
  });
});

describe("saving a project sticky", () => {
  beforeEach(() => loadProject(makeSticky()));

  it("sends the version the change is based on and keeps the new one", async () => {
    service.updateSticky.mockResolvedValueOnce(makeSticky({ description_html: "<p>two</p>", content_version: 2 }));
    await store.updateSticky(PROJECT, "s1", { description_html: "<p>two</p>" });

    expect(service.updateSticky).toHaveBeenCalledWith(PROJECT, "s1", {
      description_html: "<p>two</p>",
      content_version: 1,
    });
    expect(store.stickies.s1.content_version).toBe(2);
    // the user's own save must not reload the editor under the cursor
    expect(store.revisions.s1).toBeUndefined();
    expect(store.recentStickyId).toBeUndefined();
  });

  it("sends colour without a version", async () => {
    service.updateSticky.mockResolvedValueOnce(makeSticky({ background_color: "gray" }));
    await store.updateSticky(PROJECT, "s1", { background_color: "gray" });

    expect(service.updateSticky).toHaveBeenCalledWith(PROJECT, "s1", { background_color: "gray" });
  });

  it("runs one save at a time, so quick typing never conflicts with itself", async () => {
    const first = deferred<TSticky>();
    service.updateSticky.mockReturnValueOnce(first.promise);
    const saves = [
      store.updateSticky(PROJECT, "s1", { description_html: "<p>a</p>" }),
      store.updateSticky(PROJECT, "s1", { description_html: "<p>ab</p>" }),
      store.updateSticky(PROJECT, "s1", { description_html: "<p>abc</p>" }),
    ];
    expect(service.updateSticky).toHaveBeenCalledTimes(1);

    service.updateSticky.mockResolvedValueOnce(makeSticky({ description_html: "<p>abc</p>", content_version: 3 }));
    first.resolve(makeSticky({ description_html: "<p>a</p>", content_version: 2 }));
    await Promise.all(saves);

    expect(service.updateSticky).toHaveBeenCalledTimes(2);
    expect(service.updateSticky).toHaveBeenLastCalledWith(PROJECT, "s1", {
      description_html: "<p>abc</p>",
      content_version: 2,
    });
    expect(store.stickies.s1).toMatchObject({ description_html: "<p>abc</p>", content_version: 3 });
  });

  it("keeps typing that continues during a save", async () => {
    const first = deferred<TSticky>();
    service.updateSticky.mockReturnValueOnce(first.promise);
    const save = store.updateSticky(PROJECT, "s1", { description_html: "<p>a</p>" });
    store.markStickyDirty(PROJECT, "s1"); // typed, still debounced
    first.resolve(makeSticky({ description_html: "<p>a</p>", content_version: 2 }));
    await save;
    // a list reload brings someone else's newer content meanwhile
    await loadProject(makeSticky({ description_html: "<p>theirs</p>", content_version: 3 }));

    service.updateSticky.mockRejectedValueOnce(
      requestError(409, makeSticky({ description_html: "<p>theirs</p>", content_version: 3 }))
    );
    await store.updateSticky(PROJECT, "s1", { description_html: "<p>ab</p>" });
    expect(service.updateSticky).toHaveBeenLastCalledWith(PROJECT, "s1", {
      description_html: "<p>ab</p>",
      content_version: 2,
    });
    expect(store.conflicts.s1.content_version).toBe(3);
  });

  it("keeps the text after a network error and sends it with the next change", async () => {
    service.updateSticky.mockRejectedValueOnce(requestError(undefined));
    await expect(store.updateSticky(PROJECT, "s1", { description_html: "<p>two</p>" })).rejects.toBeDefined();
    expect(store.stickies.s1.description_html).toBe("<p>two</p>");
    expect(store.revisions.s1).toBeUndefined();

    service.updateSticky.mockResolvedValueOnce(makeSticky({ description_html: "<p>two</p>", content_version: 2 }));
    await store.updateSticky(PROJECT, "s1", { background_color: "gray" });
    expect(service.updateSticky).toHaveBeenLastCalledWith(PROJECT, "s1", {
      description_html: "<p>two</p>",
      background_color: "gray",
      content_version: 1,
    });
  });

  it("shows the saved content again when edit permission was taken away", async () => {
    service.updateSticky.mockRejectedValueOnce(requestError(403));
    service.getSticky.mockResolvedValueOnce(makeSticky({ my_permission: "view" }));
    await expect(store.updateSticky(PROJECT, "s1", { description_html: "<p>two</p>" })).rejects.toBeDefined();
    await vi.waitFor(() => expect(store.stickies.s1.my_permission).toBe("view"));

    expect(store.stickies.s1.description_html).toBe("<p>one</p>");
    expect(store.revisions.s1).toBe(1);
  });

  it("drops a sticky the user can no longer see", async () => {
    service.updateSticky.mockRejectedValueOnce(requestError(404));
    service.getSticky.mockRejectedValueOnce(requestError(404));
    await expect(store.updateSticky(PROJECT, "s1", { description_html: "<p>two</p>" })).rejects.toBeDefined();
    await vi.waitFor(() => expect(store.getStickyIds(PROJECT)).toEqual([]));

    expect(store.stickies.s1).toBeUndefined();
  });
});

describe("fetched changes of a project sticky", () => {
  beforeEach(() => loadProject(makeSticky()));

  it("reload the editor when the content is newer", async () => {
    await loadProject(makeSticky({ description_html: "<p>theirs</p>", content_version: 2 }));

    expect(store.stickies.s1.description_html).toBe("<p>theirs</p>");
    expect(store.revisions.s1).toBe(1);
  });

  it("leave the editor alone when only other fields changed", async () => {
    await loadProject(makeSticky({ background_color: "gray" }));

    expect(store.stickies.s1.background_color).toBe("gray");
    expect(store.revisions.s1).toBeUndefined();
  });

  it("do not replace what the user is typing, nor the version it is based on", async () => {
    store.markStickyDirty(PROJECT, "s1");
    await loadProject(makeSticky({ description_html: "<p>theirs</p>", content_version: 2, background_color: "gray" }));

    expect(store.stickies.s1).toMatchObject({
      description_html: "<p>one</p>",
      content_version: 1,
      background_color: "gray",
    });
    expect(store.revisions.s1).toBeUndefined();
  });

  it("are shown after a colour change reveals newer content", async () => {
    service.updateSticky.mockResolvedValueOnce(
      makeSticky({ background_color: "gray", description_html: "<p>theirs</p>", content_version: 2 })
    );
    await store.updateSticky(PROJECT, "s1", { background_color: "gray" });

    expect(store.stickies.s1).toMatchObject({ description_html: "<p>theirs</p>", content_version: 2 });
    expect(store.revisions.s1).toBe(1);
  });
});

describe("conflicts", () => {
  const theirs = makeSticky({ description_html: "<p>theirs</p>", content_version: 5 });

  beforeEach(async () => {
    await loadProject(makeSticky());
    service.updateSticky.mockRejectedValueOnce(requestError(409, theirs));
    await store.updateSticky(PROJECT, "s1", { description_html: "<p>mine</p>" });
  });

  it("keep the user's text and stop saving until the user decides", async () => {
    expect(store.conflicts.s1).toEqual(theirs);
    expect(store.stickies.s1.description_html).toBe("<p>mine</p>");

    await store.updateSticky(PROJECT, "s1", { description_html: "<p>mine, longer</p>" });
    expect(service.updateSticky).toHaveBeenCalledTimes(1);
  });

  it("use theirs", async () => {
    await store.resolveConflict(PROJECT, "s1", "theirs");

    expect(store.stickies.s1).toEqual(theirs);
    expect(store.conflicts.s1).toBeUndefined();
    expect(store.revisions.s1).toBe(1);
    expect(service.updateSticky).toHaveBeenCalledTimes(1);
  });

  it("keep mine saves the latest text on top of their version", async () => {
    await store.updateSticky(PROJECT, "s1", { description_html: "<p>mine, longer</p>" });
    service.updateSticky.mockResolvedValueOnce(
      makeSticky({ description_html: "<p>mine, longer</p>", content_version: 6 })
    );
    await store.resolveConflict(PROJECT, "s1", "mine");

    expect(service.updateSticky).toHaveBeenLastCalledWith(PROJECT, "s1", {
      description_html: "<p>mine, longer</p>",
      content_version: 5,
    });
    expect(store.stickies.s1.content_version).toBe(6);
    expect(store.conflicts.s1).toBeUndefined();
  });

  it("can happen again while being resolved", async () => {
    const newer = makeSticky({ description_html: "<p>newer</p>", content_version: 6 });
    service.updateSticky.mockRejectedValueOnce(requestError(409, newer));
    await store.resolveConflict(PROJECT, "s1", "mine");

    expect(store.conflicts.s1).toEqual(newer);
    expect(store.stickies.s1.description_html).toBe("<p>mine</p>");
  });
});

describe("deleting", () => {
  beforeEach(() => loadProject(makeSticky(), makeSticky({ id: "s2", sort_order: 50 })));

  it("removes the sticky", async () => {
    service.deleteSticky.mockResolvedValueOnce(undefined);
    await store.deleteSticky(PROJECT, "s1");
    expect(store.getStickyIds(PROJECT)).toEqual(["s2"]);
  });

  it("keeps the sticky and reports the error when it fails", async () => {
    service.deleteSticky.mockRejectedValueOnce(requestError(403));
    await expect(store.deleteSticky(PROJECT, "s1")).rejects.toMatchObject({ status: 403 });
    expect(store.getStickyIds(PROJECT)).toEqual(["s1", "s2"]);
  });

  it("accepts that someone else deleted it first", async () => {
    service.deleteSticky.mockRejectedValueOnce(requestError(404));
    await store.deleteSticky(PROJECT, "s1");
    expect(store.getStickyIds(PROJECT)).toEqual(["s2"]);
  });

  it("is not undone by a save that was still running", async () => {
    const save = deferred<TSticky>();
    service.updateSticky.mockReturnValueOnce(save.promise);
    const saving = store.updateSticky(PROJECT, "s1", { description_html: "<p>two</p>" });
    service.deleteSticky.mockResolvedValueOnce(undefined);
    await store.deleteSticky(PROJECT, "s1");
    save.resolve(makeSticky({ content_version: 2 }));
    await saving;

    expect(store.stickies.s1).toBeUndefined();
  });
});

describe("sharing", () => {
  const sharing: TStickySharing = { access: EStickyAccess.PROJECT, project_permission: "edit", members: [] };

  beforeEach(() => loadProject(makeSticky()));

  it("shows the saved sharing", async () => {
    service.updateSharing.mockResolvedValueOnce(makeSticky({ access: EStickyAccess.PROJECT }));
    await store.updateSharing(PROJECT, "s1", sharing);

    expect(service.updateSharing).toHaveBeenCalledWith(PROJECT, "s1", sharing);
    expect(store.stickies.s1.access).toBe(EStickyAccess.PROJECT);
    expect(store.revisions.s1).toBeUndefined();
  });

  it("keeps what is being typed", async () => {
    store.markStickyDirty(PROJECT, "s1");
    service.updateSharing.mockResolvedValueOnce(
      makeSticky({ access: EStickyAccess.PROJECT, description_html: "<p>theirs</p>", content_version: 2 })
    );
    await store.updateSharing(PROJECT, "s1", sharing);

    expect(store.stickies.s1).toMatchObject({
      access: EStickyAccess.PROJECT,
      description_html: "<p>one</p>",
      content_version: 1,
    });
  });

  it("waits for a running save, whose response has the previous sharing", async () => {
    const save = deferred<TSticky>();
    service.updateSticky.mockReturnValueOnce(save.promise);
    const saving = store.updateSticky(PROJECT, "s1", { description_html: "<p>two</p>" });
    service.updateSharing.mockResolvedValueOnce(
      makeSticky({ access: EStickyAccess.PROJECT, description_html: "<p>two</p>", content_version: 2 })
    );
    const sharingSaved = store.updateSharing(PROJECT, "s1", sharing);
    expect(service.updateSharing).not.toHaveBeenCalled();
    save.resolve(makeSticky({ access: EStickyAccess.PRIVATE, description_html: "<p>two</p>", content_version: 2 }));
    await Promise.all([saving, sharingSaved]);

    expect(store.stickies.s1.access).toBe(EStickyAccess.PROJECT);
  });

  it("removes the sticky when the user can no longer see it", async () => {
    service.updateSharing.mockResolvedValueOnce(undefined);
    await store.updateSharing(PROJECT, "s1", { ...sharing, access: EStickyAccess.PRIVATE });

    expect(store.getStickyIds(PROJECT)).toEqual([]);
  });

  it("changes nothing when it is refused", async () => {
    service.updateSharing.mockRejectedValueOnce(requestError(400));
    await expect(store.updateSharing(PROJECT, "s1", sharing)).rejects.toMatchObject({ status: 400 });

    expect(store.stickies.s1).toEqual(makeSticky());
  });
});

describe("pinning", () => {
  const PINNED: TStickyScope = { ...PROJECT, isPinned: true };
  const pinned = (id: string, pinned_at: string | null, overrides: Partial<TSticky> = {}) =>
    makeSticky({ id, pinned_at, access: EStickyAccess.PROJECT, ...overrides });

  const loadPinned = async (...stickies: TSticky[]) => {
    service.getStickies.mockResolvedValueOnce(page(stickies));
    await store.fetchStickies(PINNED);
  };

  it("lists the last pinned first, apart from the project's stickies", async () => {
    await loadProject(makeSticky());
    await loadPinned(pinned("a", "2026-01-01", { sort_order: 9 }), pinned("b", "2026-01-02", { sort_order: 1 }));

    expect(store.getStickyIds(PINNED)).toEqual(["b", "a"]);
    expect(store.getStickyIds(PROJECT)).toEqual(["s1"]);
  });

  it("adds a sticky pinned elsewhere and drops an unpinned one", async () => {
    await loadProject(pinned("s1", null));
    await loadPinned(pinned("a", "2026-01-01"));
    service.updatePin.mockResolvedValueOnce(pinned("s1", "2026-01-03"));
    await store.updatePin(PROJECT, "s1", true);
    expect(store.getStickyIds(PINNED)).toEqual(["s1", "a"]);

    service.updatePin.mockResolvedValueOnce(pinned("a", null));
    await store.updatePin(PROJECT, "a", false);
    expect(store.getStickyIds(PINNED)).toEqual(["s1"]);
    expect(service.updatePin).toHaveBeenLastCalledWith(PROJECT, "a", false);

    // and back
    service.updatePin.mockResolvedValueOnce(pinned("a", "2026-01-04"));
    await store.updatePin(PROJECT, "a", true);
    expect(store.getStickyIds(PINNED)).toEqual(["a", "s1"]);
  });

  it("drops a sticky that is no longer shared with the whole project", async () => {
    await loadPinned(pinned("a", "2026-01-01"));
    service.updateSharing.mockResolvedValueOnce(pinned("a", null, { access: EStickyAccess.PRIVATE }));
    await store.updateSharing(PROJECT, "a", {
      access: EStickyAccess.PRIVATE,
      project_permission: "view",
      members: [],
    });

    expect(store.getStickyIds(PINNED)).toEqual([]);
  });

  it("a deleted sticky leaves every list", async () => {
    await loadProject(pinned("a", "2026-01-01"));
    await loadPinned(pinned("a", "2026-01-01"));
    service.deleteSticky.mockResolvedValueOnce(undefined);
    await store.deleteSticky(PROJECT, "a");

    expect(store.getStickyIds(PINNED)).toEqual([]);
    expect(store.getStickyIds(PROJECT)).toEqual([]);
  });

  it("changes nothing when it is refused", async () => {
    await loadProject(pinned("s1", null));
    service.updatePin.mockRejectedValueOnce(requestError(400));
    await expect(store.updatePin(PROJECT, "s1", true)).rejects.toMatchObject({ status: 400 });

    expect(store.stickies.s1.pinned_at).toBeNull();
  });
});

describe("a linked sticky", () => {
  beforeEach(() => loadProject(makeSticky()));

  it("is added to the list once", async () => {
    service.getSticky.mockResolvedValue(makeSticky({ id: "old", sort_order: 1 }));
    await store.fetchSticky(PROJECT, "old");
    await store.fetchSticky(PROJECT, "old");

    expect(store.getStickyIds(PROJECT)).toEqual(["s1", "old"]);
  });

  it("that cannot be seen is not added", async () => {
    service.getSticky.mockRejectedValueOnce(requestError(404));
    await expect(store.fetchSticky(PROJECT, "old")).rejects.toMatchObject({ status: 404 });

    expect(store.getStickyIds(PROJECT)).toEqual(["s1"]);
  });
});

describe("moving", () => {
  const move = async (id: string, destination: string, edge: "left" | "right") => {
    service.updateSticky.mockResolvedValueOnce(makeSticky());
    await store.updateStickyPosition(PROJECT, id, destination, edge);
    return store.getStickyIds(PROJECT).join(" ");
  };

  it.each([
    ["a", "c", "left", "b a c d"],
    ["a", "c", "right", "b c a d"],
    ["a", "d", "right", "b c d a"],
    ["d", "a", "left", "d a b c"],
    ["d", "a", "right", "a d b c"],
    ["b", "c", "left", "a b c d"],
    ["c", "b", "right", "a b c d"],
    ["b", "a", "left", "b a c d"],
  ] as const)("%s next to %s (%s) gives %s", async (id, destination, edge, expected) => {
    // the last sort order is 0, which is a position like any other
    await loadProject(
      ...["a", "b", "c", "d"].map((name, i) => makeSticky({ id: name, sort_order: 30000 - i * 10000 }))
    );
    expect(await move(id, destination, edge)).toBe(expected);
  });

  beforeEach(() => loadProject(makeSticky(), makeSticky({ id: "s2", sort_order: 50 })));

  it("sends only the new position", async () => {
    service.updateSticky.mockResolvedValueOnce(makeSticky());
    await store.updateStickyPosition(PROJECT, "s2", "s1", "left");

    expect(service.updateSticky).toHaveBeenCalledWith(PROJECT, "s2", { sort_order: 10100 });
    expect(store.getStickyIds(PROJECT)).toEqual(["s2", "s1"]);
  });

  it("is undone when it fails", async () => {
    service.updateSticky.mockRejectedValueOnce(requestError(403));
    await expect(store.updateStickyPosition(PROJECT, "s2", "s1", "left")).rejects.toBeDefined();

    expect(store.getStickyIds(PROJECT)).toEqual(["s1", "s2"]);
  });
});
