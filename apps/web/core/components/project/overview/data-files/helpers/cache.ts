/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * IndexedDB cache for parsed workbooks and card previews. Every access is
 * wrapped so the feature keeps working when IndexedDB is unavailable
 * (private mode, blocked storage, older browsers). Used by the worker (for
 * workbooks) and the main thread (for previews).
 */

import type { TParsedWorkbook } from "@plane/types";
import { SPREADSHEET_CACHE_MAX_ENTRIES, SPREADSHEET_PREVIEW_MAX_ENTRIES } from "./constants";
import type { TSpreadsheetPreview } from "./preview";

const DB_NAME = "plane-data-files";
const DB_VERSION = 1;
const WORKBOOK_STORE = "workbooks";
const PREVIEW_STORE = "previews";

type TWorkbookRecord = { key: string; workbook: TParsedWorkbook; lastAccess: number };
type TPreviewRecord = TSpreadsheetPreview & { lastAccess: number };

/** Keys to evict so that at most `max` entries remain, oldest access first. */
export const selectEvictions = (entries: { key: string; lastAccess: number }[], max: number): string[] => {
  if (entries.length <= max) return [];
  const byAccess = [...entries];
  byAccess.sort((a, b) => a.lastAccess - b.lastAccess);
  return byAccess.slice(0, entries.length - max).map((entry) => entry.key);
};

export const getWorkbookCacheKey = (assetId: string, updatedAt: string) => `${assetId}:${updatedAt}`;

let dbPromise: Promise<IDBDatabase | null> | null = null;

const promisify = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });

const openDatabase = (): Promise<IDBDatabase | null> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.addEventListener("upgradeneeded", () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(WORKBOOK_STORE)) db.createObjectStore(WORKBOOK_STORE, { keyPath: "key" });
        if (!db.objectStoreNames.contains(PREVIEW_STORE)) db.createObjectStore(PREVIEW_STORE, { keyPath: "assetId" });
      });
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => resolve(null));
      request.addEventListener("blocked", () => resolve(null));
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
};

const withStore = async <T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>
): Promise<T | null> => {
  try {
    const db = await openDatabase();
    if (!db) return null;
    const transaction = db.transaction(storeName, mode);
    return await run(transaction.objectStore(storeName));
  } catch {
    return null;
  }
};

const evict = async (storeName: string, keyField: "key" | "assetId", max: number) => {
  await withStore(storeName, "readwrite", async (store) => {
    // read only keys + lastAccess via a cursor to avoid loading whole workbooks
    const entries: { key: string; lastAccess: number }[] = [];
    await new Promise<void>((resolve, reject) => {
      const request = store.openCursor();
      request.addEventListener("success", () => {
        const cursor = request.result;
        if (!cursor) return resolve();
        const value = cursor.value as { lastAccess?: number } & Record<string, unknown>;
        entries.push({ key: String(value[keyField]), lastAccess: value.lastAccess ?? 0 });
        cursor.continue();
      });
      request.addEventListener("error", () => reject(request.error));
    });
    for (const key of selectEvictions(entries, max)) store.delete(key);
  });
};

export const getCachedWorkbook = async (key: string): Promise<TParsedWorkbook | null> => {
  const record = await withStore(WORKBOOK_STORE, "readwrite", async (store) => {
    const found = (await promisify(store.get(key))) as TWorkbookRecord | undefined;
    if (found) store.put({ ...found, lastAccess: Date.now() });
    return found ?? null;
  });
  return record?.workbook ?? null;
};

export const putCachedWorkbook = async (key: string, workbook: TParsedWorkbook): Promise<void> => {
  const assetId = key.split(":")[0];
  await withStore(WORKBOOK_STORE, "readwrite", async (store) => {
    // drop older versions of the same file
    const keys = (await promisify(store.getAllKeys())) as string[];
    for (const existing of keys) if (existing !== key && existing.startsWith(`${assetId}:`)) store.delete(existing);
    await promisify(store.put({ key, workbook, lastAccess: Date.now() } satisfies TWorkbookRecord));
  });
  await evict(WORKBOOK_STORE, "key", SPREADSHEET_CACHE_MAX_ENTRIES);
};

export const deleteCachedFile = async (assetId: string): Promise<void> => {
  await withStore(WORKBOOK_STORE, "readwrite", async (store) => {
    const keys = (await promisify(store.getAllKeys())) as string[];
    for (const existing of keys) if (existing.startsWith(`${assetId}:`)) store.delete(existing);
  });
  await withStore(PREVIEW_STORE, "readwrite", async (store) => {
    store.delete(assetId);
  });
};

export const getCachedPreviews = async (): Promise<TSpreadsheetPreview[]> => {
  const records = await withStore(
    PREVIEW_STORE,
    "readonly",
    async (store) => (await promisify(store.getAll())) as TPreviewRecord[]
  );
  return (records ?? []).map(({ lastAccess: _lastAccess, ...preview }) => preview);
};

export const putCachedPreview = async (preview: TSpreadsheetPreview): Promise<void> => {
  await withStore(PREVIEW_STORE, "readwrite", async (store) => {
    await promisify(store.put({ ...preview, lastAccess: Date.now() } satisfies TPreviewRecord));
  });
  await evict(PREVIEW_STORE, "assetId", SPREADSHEET_PREVIEW_MAX_ENTRIES);
};
