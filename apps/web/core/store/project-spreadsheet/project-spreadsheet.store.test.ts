/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { TProjectSpreadsheet, TProjectSpreadsheetUploadResponse } from "@plane/types";
import { ProjectSpreadsheetStore } from "./project-spreadsheet.store";
import type { TProjectSpreadsheetServiceLike } from "./project-spreadsheet.store";

const WS = "acme";
const PROJECT = "project-1";

const makeSpreadsheet = (overrides: Partial<TProjectSpreadsheet> = {}): TProjectSpreadsheet => ({
  id: "s1",
  name: "budget.xlsx",
  size: 1000,
  type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  project: PROJECT,
  created_by: "u1",
  created_at: "2024-01-01T00:00:00Z",
  updated_by: null,
  updated_at: "2024-01-01T00:00:00Z",
  ...overrides,
});

const signed = (assetId: string): TProjectSpreadsheetUploadResponse => ({
  asset_id: assetId,
  asset_url: `/content/${assetId}`,
  upload_data: {
    url: "https://storage.example",
    fields: {
      "Content-Type": "text/csv",
      key: "k",
      "x-amz-algorithm": "a",
      "x-amz-credential": "c",
      "x-amz-date": "d",
      policy: "p",
      "x-amz-signature": "s",
    },
  },
});

const file = (name = "data.csv", content = "a,b\n1,2", type = "") => new File([content], name, { type });

/**
 * Resolves once the upload chain has settled: the mocked service only uses
 * microtasks, and the whole microtask queue drains before a macrotask runs.
 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

type TMockService = Record<keyof TProjectSpreadsheetServiceLike, Mock>;

let service: TMockService;
let processUpload: Mock;
let onDeleted: Mock;
let onRenamed: Mock;
let onReset: Mock;
let store: ProjectSpreadsheetStore;
let idCounter = 0;

beforeEach(() => {
  service = {
    list: vi.fn(),
    create: vi.fn(),
    replace: vi.fn(),
    uploadToStorage: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };
  processUpload = vi.fn().mockResolvedValue(null);
  onDeleted = vi.fn();
  onRenamed = vi.fn();
  onReset = vi.fn();
  idCounter = 0;
  store = new ProjectSpreadsheetStore(service as unknown as TProjectSpreadsheetServiceLike, {
    processUpload,
    onDeleted,
    onRenamed,
    onReset,
    readyDismissMs: 0,
    generateId: () => `tmp-${++idCounter}`,
  });
});

describe("fetch", () => {
  it("loads and sorts newest first", async () => {
    service.list.mockResolvedValueOnce([
      makeSpreadsheet({ id: "old", created_at: "2024-01-01T00:00:00Z" }),
      makeSpreadsheet({ id: "new", created_at: "2024-02-01T00:00:00Z" }),
    ]);
    const promise = store.fetchSpreadsheets(WS, PROJECT);
    expect(store.loaderMap[PROJECT]).toBe("init-loader");
    await promise;
    expect(store.getProjectSpreadsheets(PROJECT).map((s) => s.id)).toEqual(["new", "old"]);
    expect(store.loaderMap[PROJECT]).toBe("loaded");
  });

  it("marks the first load as failed", async () => {
    service.list.mockRejectedValueOnce({ status: 500 });
    await expect(store.fetchSpreadsheets(WS, PROJECT)).rejects.toEqual({ status: 500 });
    expect(store.loaderMap[PROJECT]).toBe("error");
  });
});

describe("upload", () => {
  it("rejects invalid files without calling the API", () => {
    const result = store.uploadSpreadsheet(WS, PROJECT, file("notes.pdf"));
    expect(result).toEqual({ ok: false, error: { code: "unsupported_type", params: { name: "notes.pdf" } } });
    expect(service.create).not.toHaveBeenCalled();
  });

  it("creates, uploads with progress, finalizes, processes and inserts the file", async () => {
    const created = makeSpreadsheet({ id: "new-id", name: "data.csv", created_at: "2024-03-01T00:00:00Z" });
    service.create.mockResolvedValueOnce(signed("new-id"));
    let reportProgress: ((event: { loaded: number; total?: number }) => void) | undefined;
    let finishUpload: (() => void) | undefined;
    service.uploadToStorage.mockImplementationOnce(
      (_signed, _file, onProgress) =>
        new Promise<void>((resolve) => {
          reportProgress = onProgress;
          finishUpload = resolve;
        })
    );
    service.update.mockResolvedValueOnce(created);
    processUpload.mockResolvedValueOnce({ assetId: "new-id", version: created.updated_at, sheetCount: 1 });

    const csv = file("data.csv", "a,b\n1,2", "application/vnd.ms-excel");
    const result = store.uploadSpreadsheet(WS, PROJECT, csv);
    expect(result).toEqual({ ok: true, tempId: "tmp-1" });
    // optimistic card right away
    expect(store.getPendingUploads(PROJECT)).toHaveLength(1);
    expect(store.uploads["tmp-1"].status).toBe("uploading");

    await flush();
    // the canonical MIME type is sent, never the browser's guess
    expect(service.create).toHaveBeenCalledWith(WS, PROJECT, { name: "data.csv", type: "text/csv", size: csv.size });
    reportProgress?.({ loaded: 50, total: 100 });
    expect(store.uploads["tmp-1"].progress).toBe(50);

    finishUpload?.();
    await flush();
    expect(service.update).toHaveBeenCalledWith(WS, PROJECT, "new-id", { is_uploaded: true });
    expect(processUpload).toHaveBeenCalledWith(created, csv);
    expect(store.getProjectSpreadsheets(PROJECT).map((s) => s.id)).toEqual(["new-id"]);
    expect(store.previews["new-id"]).toMatchObject({ sheetCount: 1 });
    // ready → dismissed (readyDismissMs: 0)
    expect(store.uploads["tmp-1"]).toBeUndefined();
    expect(store.getPendingUploads(PROJECT)).toHaveLength(0);
  });

  it("shows a finalize rejection (PATCH 400) as an error and retries from a fresh presign", async () => {
    service.create.mockResolvedValueOnce(signed("a1")).mockResolvedValueOnce(signed("a2"));
    service.uploadToStorage.mockResolvedValue(undefined);
    service.update
      .mockRejectedValueOnce({ status: 400, error: "File is missing from storage." })
      .mockResolvedValueOnce(makeSpreadsheet({ id: "a2", name: "data.csv" }));

    store.uploadSpreadsheet(WS, PROJECT, file());
    await flush();
    expect(store.uploads["tmp-1"]).toMatchObject({ status: "error", error: { code: "upload_failed" } });
    expect(store.getProjectSpreadsheets(PROJECT)).toHaveLength(0);
    expect(store.getPendingUploads(PROJECT)).toHaveLength(1);

    store.retryUpload("tmp-1");
    expect(store.uploads["tmp-1"].status).toBe("uploading");
    await flush();
    expect(service.create).toHaveBeenCalledTimes(2);
    expect(service.update).toHaveBeenLastCalledWith(WS, PROJECT, "a2", { is_uploaded: true });
    expect(store.getProjectSpreadsheets(PROJECT).map((s) => s.id)).toEqual(["a2"]);
  });

  it("still finishes when processing fails", async () => {
    service.create.mockResolvedValueOnce(signed("p1"));
    service.uploadToStorage.mockResolvedValueOnce(undefined);
    service.update.mockResolvedValueOnce(makeSpreadsheet({ id: "p1" }));
    processUpload.mockRejectedValueOnce(new Error("parse failed"));
    store.uploadSpreadsheet(WS, PROJECT, file());
    await flush();
    expect(store.getProjectSpreadsheets(PROJECT).map((s) => s.id)).toEqual(["p1"]);
    expect(store.uploads["tmp-1"]).toBeUndefined();
  });

  it("dismisses failed uploads", async () => {
    service.create.mockRejectedValueOnce({ status: 503, error: "Storage unavailable" });
    store.uploadSpreadsheet(WS, PROJECT, file());
    await flush();
    expect(store.uploads["tmp-1"].status).toBe("error");
    store.dismissUpload("tmp-1");
    expect(store.getPendingUploads(PROJECT)).toHaveLength(0);
  });
});

describe("replace", () => {
  it("uploads a new version of an existing file and updates it in place", async () => {
    service.list.mockResolvedValueOnce([makeSpreadsheet()]);
    await store.fetchSpreadsheets(WS, PROJECT);
    service.replace.mockResolvedValueOnce(signed("s1"));
    service.uploadToStorage.mockResolvedValueOnce(undefined);
    const updated = makeSpreadsheet({ name: "v2.xlsx", updated_at: "2024-05-01T00:00:00Z" });
    service.update.mockResolvedValueOnce(updated);

    const result = store.replaceSpreadsheet(WS, PROJECT, "s1", file("v2.xlsx", "zip"));
    expect(result.ok).toBe(true);
    // a replacement is tracked on the existing card, not as a new pending card
    expect(store.getPendingUploads(PROJECT)).toHaveLength(0);
    expect(store.getUploadForSpreadsheet("s1")?.isReplace).toBe(true);
    await flush();
    expect(service.replace).toHaveBeenCalledWith(WS, PROJECT, "s1", {
      name: "v2.xlsx",
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: 3,
    });
    expect(store.getProjectSpreadsheets(PROJECT)).toEqual([updated]);
    expect(store.getUploadForSpreadsheet("s1")).toBeUndefined();
  });
});

describe("rename and delete", () => {
  beforeEach(async () => {
    service.list.mockResolvedValueOnce([
      makeSpreadsheet({ id: "a", created_at: "2024-03-01T00:00:00Z" }),
      makeSpreadsheet({ id: "b", created_at: "2024-02-01T00:00:00Z" }),
    ]);
    await store.fetchSpreadsheets(WS, PROJECT);
  });

  it("renames optimistically and keeps the preview linked", async () => {
    store.setPreview({
      assetId: "a",
      version: "2024-01-01T00:00:00Z",
      sheetCount: 1,
      rowCount: 1,
      columnCount: 1,
      cells: [],
      numericColumns: [],
    });
    service.update.mockResolvedValueOnce(
      makeSpreadsheet({ id: "a", name: "new.xlsx", updated_at: "2024-06-01T00:00:00Z" })
    );
    const promise = store.renameSpreadsheet(WS, PROJECT, "a", "new.xlsx");
    expect(store.getSpreadsheetById("a")?.name).toBe("new.xlsx");
    await promise;
    expect(service.update).toHaveBeenCalledWith(WS, PROJECT, "a", { name: "new.xlsx" });
    // the parsed cache follows the new version instead of being re-downloaded
    expect(onRenamed).toHaveBeenCalledWith("a", "2024-01-01T00:00:00Z", "2024-06-01T00:00:00Z");
    expect(store.getPreview(store.getSpreadsheetById("a")!)).toBeDefined();
  });

  it("doesn't re-key when a rename leaves the version unchanged", async () => {
    service.update.mockResolvedValueOnce(makeSpreadsheet({ id: "a", name: "same-version.xlsx" }));
    await store.renameSpreadsheet(WS, PROJECT, "a", "same-version.xlsx");
    expect(onRenamed).not.toHaveBeenCalled();
  });

  it("rolls a failed rename back", async () => {
    service.update.mockRejectedValueOnce({ status: 400 });
    await expect(store.renameSpreadsheet(WS, PROJECT, "a", "bad.xlsx")).rejects.toEqual({ status: 400 });
    expect(store.getSpreadsheetById("a")?.name).toBe("budget.xlsx");
  });

  it("deletes optimistically and clears caches", async () => {
    service.remove.mockResolvedValueOnce(undefined);
    const promise = store.deleteSpreadsheet(WS, PROJECT, "a");
    expect(store.getProjectSpreadsheets(PROJECT).map((s) => s.id)).toEqual(["b"]);
    await promise;
    expect(store.getSpreadsheetById("a")).toBeUndefined();
    expect(onDeleted).toHaveBeenCalledWith("a");
  });

  it("restores a file whose delete failed at its old position", async () => {
    service.remove.mockRejectedValueOnce({ status: 403 });
    await expect(store.deleteSpreadsheet(WS, PROJECT, "a")).rejects.toEqual({ status: 403 });
    expect(store.getProjectSpreadsheets(PROJECT).map((s) => s.id)).toEqual(["a", "b"]);
    expect(onDeleted).not.toHaveBeenCalled();
  });
});

describe("reset", () => {
  it("runs the reset hook (sign-out clears caches)", () => {
    store.reset();
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("never re-keys the cache for a replacement", async () => {
    service.list.mockResolvedValueOnce([makeSpreadsheet()]);
    await store.fetchSpreadsheets(WS, PROJECT);
    service.replace.mockResolvedValueOnce(signed("s1"));
    service.uploadToStorage.mockResolvedValueOnce(undefined);
    service.update.mockResolvedValueOnce(makeSpreadsheet({ updated_at: "2024-09-01T00:00:00Z" }));
    store.replaceSpreadsheet(WS, PROJECT, "s1", file("v2.xlsx", "zip"));
    await flush();
    expect(store.getSpreadsheetById("s1")?.updated_at).toBe("2024-09-01T00:00:00Z");
    expect(onRenamed).not.toHaveBeenCalled();
  });
});
