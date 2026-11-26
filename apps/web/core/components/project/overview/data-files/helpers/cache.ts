/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * IndexedDB cache for parsed workbooks and card previews.
 *
 * - One database per signed-in user (`plane-data-files:<userId>`), deleted on
 *   sign-out, so cached data is never shared between accounts on a machine.
 * - Every call takes the cache scope (the user id). A null scope disables the
 *   cache; every access is also wrapped so the feature keeps working when
 *   IndexedDB is unavailable (private mode, blocked storage, older browsers).
 * - Used by the worker (workbooks) and the main thread (previews). The two run
 *   in separate module instances, so the worker always receives the scope in
 *   its request payloads.
 */

import type { TParsedWorkbook } from "@plane/types";
import { SPREADSHEET_CACHE_MAX_ENTRIES, SPREADSHEET_PREVIEW_MAX_ENTRIES } from "./constants";
import type { TSpreadsheetPreview } from "./preview";

const DB_PREFIX = "plane-data-files";
const DB_VERSION = 1;
const WORKBOOK_STORE = "workbooks";
const PREVIEW_STORE = "previews";

export type TCacheScope = string | null;

type TWorkbookRecord = { key: string; workbook: TParsedWorkbook; lastAccess: number };
type TPreviewRecord = TSpreadsheetPreview & { lastAccess: number };

/** Database name for a user; null when there is no signed-in user (cache off). */
export const getCacheDatabaseName = (scope: TCacheScope): string | null => (scope ? `${DB_PREFIX}:${scope}` : null);

export const getWorkbookCacheKey = (assetId: string, updatedAt: string) => `${assetId}:${updatedAt}`;

/** Splits `${assetId}:${version}` (versions are ISO dates, which contain colons). */
export const parseWorkbookCacheKey = (key: string): { assetId: string; version: string } => {
  const index = key.indexOf(":");
  return index === -1 ? { assetId: key, version: "" } : { assetId: key.slice(0, index), version: key.slice(index + 1) };
};

/** Keys to evict so that at most `max` entries remain, oldest access first. */
export const selectEvictions = (entries: { key: string; lastAccess: number }[], max: number): string[] => {
  if (entries.length <= max) return [];
  const byAccess = [...entries];
  byAccess.sort((a, b) => a.lastAccess - b.lastAccess);
  return byAccess.slice(0, entries.length - max).map((entry) => entry.key);
};

// ---------- main-thread scope ----------

let activeScope: TCacheScope = null;

/** The main thread's current user; set by the Data files hook. */
export const setCacheScope = (scope: TCacheScope) => {
  activeScope = scope;
};

export const getCacheScope = (): TCacheScope => activeScope;

// ---------- database access ----------

const databases = new Map<string, Promise<IDBDatabase | null>>();

const promisify = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });

const openDatabase = (scope: TCacheScope): Promise<IDBDatabase | null> => {
  const name = getCacheDatabaseName(scope);
  if (!name) return Promise.resolve(null);
  const existing = databases.get(name);
  if (existing) return existing;
  const opening = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(name, DB_VERSION);
      request.addEventListener("upgradeneeded", () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(WORKBOOK_STORE)) db.createObjectStore(WORKBOOK_STORE, { keyPath: "key" });
        if (!db.objectStoreNames.contains(PREVIEW_STORE)) db.createObjectStore(PREVIEW_STORE, { keyPath: "assetId" });
      });
      request.addEventListener("success", () => {
        const db = request.result;
        // another context is deleting this database (sign-out): let it go
        db.addEventListener("versionchange", () => {
          db.close();
          databases.delete(name);
        });
        resolve(db);
      });
      request.addEventListener("error", () => resolve(null));
      request.addEventListener("blocked", () => resolve(null));
    } catch {
      resolve(null);
    }
  });
  databases.set(name, opening);
  return opening;
};

const withStore = async <T>(
  scope: TCacheScope,
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>
): Promise<T | null> => {
  try {
    const db = await openDatabase(scope);
    if (!db) return null;
    const transaction = db.transaction(storeName, mode);
    return await run(transaction.objectStore(storeName));
  } catch {
    return null;
  }
};

const evict = async (scope: TCacheScope, storeName: string, keyField: "key" | "assetId", max: number) => {
  await withStore(scope, storeName, "readwrite", async (store) => {
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

// ---------- workbooks ----------

export const getCachedWorkbook = async (scope: TCacheScope, key: string): Promise<TParsedWorkbook | null> => {
  const record = await withStore(scope, WORKBOOK_STORE, "readwrite", async (store) => {
    const found = (await promisify(store.get(key))) as TWorkbookRecord | undefined;
    if (found) store.put({ ...found, lastAccess: Date.now() });
    return found ?? null;
  });
  return record?.workbook ?? null;
};

export const putCachedWorkbook = async (scope: TCacheScope, key: string, workbook: TParsedWorkbook): Promise<void> => {
  const { assetId } = parseWorkbookCacheKey(key);
  const stored = await withStore(scope, WORKBOOK_STORE, "readwrite", async (store) => {
    // drop older versions of the same file
    const keys = (await promisify(store.getAllKeys())) as string[];
    for (const existing of keys) if (existing !== key && existing.startsWith(`${assetId}:`)) store.delete(existing);
    await promisify(store.put({ key, workbook, lastAccess: Date.now() } satisfies TWorkbookRecord));
    return true;
  });
  if (stored) await evict(scope, WORKBOOK_STORE, "key", SPREADSHEET_CACHE_MAX_ENTRIES);
};

/**
 * Moves a cached workbook (and its preview) to a new version key. Used after a
 * rename, which bumps `updated_at` without changing the content.
 */
export const rekeyCachedWorkbook = async (scope: TCacheScope, fromKey: string, toKey: string): Promise<void> => {
  if (fromKey === toKey) return;
  const from = parseWorkbookCacheKey(fromKey);
  const to = parseWorkbookCacheKey(toKey);
  await withStore(scope, WORKBOOK_STORE, "readwrite", async (store) => {
    const found = (await promisify(store.get(fromKey))) as TWorkbookRecord | undefined;
    if (!found) return;
    store.delete(fromKey);
    await promisify(store.put({ ...found, key: toKey, lastAccess: Date.now() } satisfies TWorkbookRecord));
  });
  await withStore(scope, PREVIEW_STORE, "readwrite", async (store) => {
    const preview = (await promisify(store.get(from.assetId))) as TPreviewRecord | undefined;
    if (preview && preview.version === from.version) await promisify(store.put({ ...preview, version: to.version }));
  });
};

export const deleteCachedFile = async (scope: TCacheScope, assetId: string): Promise<void> => {
  await withStore(scope, WORKBOOK_STORE, "readwrite", async (store) => {
    const keys = (await promisify(store.getAllKeys())) as string[];
    for (const existing of keys) if (existing.startsWith(`${assetId}:`)) store.delete(existing);
  });
  await withStore(scope, PREVIEW_STORE, "readwrite", async (store) => {
    store.delete(assetId);
  });
};

// ---------- previews ----------

/** Previews for the given files only (e.g. the current project's). */
export const getCachedPreviews = async (scope: TCacheScope, assetIds: string[]): Promise<TSpreadsheetPreview[]> => {
  if (assetIds.length === 0) return [];
  const records = await withStore(scope, PREVIEW_STORE, "readonly", async (store) =>
    Promise.all(assetIds.map((id) => promisify(store.get(id)) as Promise<TPreviewRecord | undefined>))
  );
  return (records ?? [])
    .filter((record): record is TPreviewRecord => !!record)
    .map(({ lastAccess: _lastAccess, ...preview }) => preview);
};

export const putCachedPreview = async (scope: TCacheScope, preview: TSpreadsheetPreview): Promise<void> => {
  const stored = await withStore(scope, PREVIEW_STORE, "readwrite", async (store) => {
    await promisify(store.put({ ...preview, lastAccess: Date.now() } satisfies TPreviewRecord));
    return true;
  });
  if (stored) await evict(scope, PREVIEW_STORE, "assetId", SPREADSHEET_PREVIEW_MAX_ENTRIES);
};

/** Removes a user's whole cache (sign-out). */
export const deleteCacheDatabase = async (scope: TCacheScope): Promise<void> => {
  const name = getCacheDatabaseName(scope);
  if (!name) return;
  try {
    const open = databases.get(name);
    databases.delete(name);
    const db = open ? await open : null;
    db?.close();
    if (typeof indexedDB === "undefined") return;
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.addEventListener("success", () => resolve());
      request.addEventListener("error", () => resolve());
      // another tab still has it open; it closes on `versionchange`
      request.addEventListener("blocked", () => resolve());
    });
  } catch {
    // nothing else to do: the cache is best-effort
  }
};
