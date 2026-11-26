/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { TProjectReadme } from "@/services/project/project-readme.service";
import { ProjectReadmeStore } from "./project-readme.store";
import type { TProjectReadmeServiceLike } from "./project-readme.store";

const WS = "acme";
const PROJECT = "project-1";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

type TMockService = Record<keyof TProjectReadmeServiceLike, Mock>;

let service: TMockService;
let store: ProjectReadmeStore;

beforeEach(() => {
  service = { getReadme: vi.fn(), createReadme: vi.fn() };
  store = new ProjectReadmeStore(service as unknown as TProjectReadmeServiceLike);
});

describe("fetchReadme", () => {
  it("is unknown before the first fetch", () => {
    expect(store.getReadmePageId(PROJECT)).toBeUndefined();
    expect(store.getLoader(PROJECT)).toBeUndefined();
  });

  it("shows the init loader while the first fetch runs", async () => {
    const request = deferred<TProjectReadme>();
    service.getReadme.mockReturnValueOnce(request.promise);
    const fetching = store.fetchReadme(WS, PROJECT);
    expect(store.getLoader(PROJECT)).toBe("init-loader");
    request.resolve({ page_id: "page-1" });
    await fetching;
    expect(store.getLoader(PROJECT)).toBe("loaded");
  });

  it("stores the README page id", async () => {
    service.getReadme.mockResolvedValueOnce({ page_id: "page-1" });
    await expect(store.fetchReadme(WS, PROJECT)).resolves.toBe("page-1");
    expect(service.getReadme).toHaveBeenCalledWith(WS, PROJECT);
    expect(store.getReadmePageId(PROJECT)).toBe("page-1");
  });

  it("stores null when the project has no README", async () => {
    service.getReadme.mockResolvedValueOnce({ page_id: null });
    await expect(store.fetchReadme(WS, PROJECT)).resolves.toBeNull();
    expect(store.getReadmePageId(PROJECT)).toBeNull();
    expect(store.getLoader(PROJECT)).toBe("loaded");
  });

  it("does not flash the loader when revalidating", async () => {
    service.getReadme.mockResolvedValueOnce({ page_id: "page-1" });
    await store.fetchReadme(WS, PROJECT);
    const request = deferred<TProjectReadme>();
    service.getReadme.mockReturnValueOnce(request.promise);
    const fetching = store.fetchReadme(WS, PROJECT);
    expect(store.getLoader(PROJECT)).toBe("loaded");
    request.resolve({ page_id: "page-1" });
    await fetching;
  });

  it("marks the first fetch as failed and rethrows", async () => {
    service.getReadme.mockRejectedValueOnce({ error: "boom" });
    await expect(store.fetchReadme(WS, PROJECT)).rejects.toEqual({ error: "boom" });
    expect(store.getLoader(PROJECT)).toBe("error");
    expect(store.getReadmePageId(PROJECT)).toBeUndefined();
  });

  it("keeps the known README when a revalidation fails", async () => {
    service.getReadme.mockResolvedValueOnce({ page_id: "page-1" });
    await store.fetchReadme(WS, PROJECT);
    service.getReadme.mockRejectedValueOnce(new Error("offline"));
    await expect(store.fetchReadme(WS, PROJECT)).rejects.toThrow("offline");
    expect(store.getLoader(PROJECT)).toBe("loaded");
    expect(store.getReadmePageId(PROJECT)).toBe("page-1");
  });

  it("clears the README when the server no longer has one (page archived or deleted)", async () => {
    service.getReadme.mockResolvedValueOnce({ page_id: "page-1" }).mockResolvedValueOnce({ page_id: null });
    await store.fetchReadme(WS, PROJECT);
    await expect(store.fetchReadme(WS, PROJECT)).resolves.toBeNull();
    expect(store.getReadmePageId(PROJECT)).toBeNull();
  });

  it("keeps projects apart", async () => {
    service.getReadme.mockResolvedValueOnce({ page_id: "page-1" }).mockResolvedValueOnce({ page_id: null });
    await store.fetchReadme(WS, PROJECT);
    await store.fetchReadme(WS, "project-2");
    expect(store.getReadmePageId(PROJECT)).toBe("page-1");
    expect(store.getReadmePageId("project-2")).toBeNull();
  });

  it("does not let a stale empty answer hide a README created meanwhile", async () => {
    const request = deferred<TProjectReadme>();
    service.getReadme.mockReturnValueOnce(request.promise);
    service.createReadme.mockResolvedValueOnce({ page_id: "page-new" });
    const fetching = store.fetchReadme(WS, PROJECT);
    await store.createReadme(WS, PROJECT, "blank");
    request.resolve({ page_id: null });
    await expect(fetching).resolves.toBe("page-new");
    expect(store.getReadmePageId(PROJECT)).toBe("page-new");
  });
});

describe("createReadme", () => {
  it("creates the README from the template and stores its page", async () => {
    service.createReadme.mockResolvedValueOnce({ page_id: "page-9" });
    await expect(store.createReadme(WS, PROJECT, "architecture")).resolves.toBe("page-9");
    expect(service.createReadme).toHaveBeenCalledWith(WS, PROJECT, "architecture");
    expect(store.getReadmePageId(PROJECT)).toBe("page-9");
    expect(store.getLoader(PROJECT)).toBe("loaded");
  });

  it("tracks the template being created", async () => {
    const request = deferred<TProjectReadme>();
    service.createReadme.mockReturnValueOnce(request.promise);
    const creating = store.createReadme(WS, PROJECT, "onboarding");
    expect(store.getCreatingTemplate(PROJECT)).toBe("onboarding");
    request.resolve({ page_id: "page-1" });
    await creating;
    expect(store.getCreatingTemplate(PROJECT)).toBeUndefined();
  });

  it("sends one request when clicked twice", async () => {
    const request = deferred<TProjectReadme>();
    service.createReadme.mockReturnValueOnce(request.promise);
    const first = store.createReadme(WS, PROJECT, "product");
    const second = store.createReadme(WS, PROJECT, "blank");
    expect(second).toBe(first);
    request.resolve({ page_id: "page-1" });
    await expect(second).resolves.toBe("page-1");
    expect(service.createReadme).toHaveBeenCalledTimes(1);
  });

  it("allows a retry after a failure", async () => {
    service.createReadme.mockRejectedValueOnce({ error: "forbidden" });
    await expect(store.createReadme(WS, PROJECT, "blank")).rejects.toEqual({ error: "forbidden" });
    expect(store.getCreatingTemplate(PROJECT)).toBeUndefined();
    expect(store.getReadmePageId(PROJECT)).toBeUndefined();

    service.createReadme.mockResolvedValueOnce({ page_id: "page-2" });
    await expect(store.createReadme(WS, PROJECT, "blank")).resolves.toBe("page-2");
  });
});
