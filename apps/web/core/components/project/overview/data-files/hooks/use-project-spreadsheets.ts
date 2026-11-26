/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useContext } from "react";
// lib
import { useUser } from "@/hooks/store/user";
import { StoreContext } from "@/lib/store-context";
import { ProjectSpreadsheetService } from "@/services/project/project-spreadsheet.service";
import type {
  ProjectSpreadsheetStore,
  TProjectSpreadsheetStoreOptions,
} from "@/store/project-spreadsheet/project-spreadsheet.store";
// local imports
import {
  deleteCacheDatabase,
  deleteCachedFile,
  getCacheScope,
  getWorkbookCacheKey,
  setCacheScope,
} from "../helpers/cache";
import { SPREADSHEET_PARSE_TIMEOUT_MS } from "../helpers/constants";
import { getSpreadsheetKind } from "../helpers/validation";
import { getSpreadsheetWorkerClient, resetSpreadsheetWorkerClient } from "../worker/client";

let service: ProjectSpreadsheetService | null = null;

export const getProjectSpreadsheetService = (): ProjectSpreadsheetService => {
  if (!service) service = new ProjectSpreadsheetService();
  return service;
};

const uiOptions: TProjectSpreadsheetStoreOptions = {
  // parse the just-uploaded bytes so the card preview and the viewer cache are warm
  processUpload: async (spreadsheet, file) => {
    const kind = getSpreadsheetKind(file.name, file.type);
    if (!kind) return null;
    const buffer = await file.arrayBuffer();
    // cloned, not transferred, so the request can be re-sent if the worker restarts
    const result = await getSpreadsheetWorkerClient().request(
      "parse",
      {
        scope: getCacheScope(),
        key: getWorkbookCacheKey(spreadsheet.id, spreadsheet.updated_at),
        assetId: spreadsheet.id,
        version: spreadsheet.updated_at,
        kind,
        buffer,
        retain: false,
      },
      { timeoutMs: SPREADSHEET_PARSE_TIMEOUT_MS }
    );
    return result.preview;
  },
  onDeleted: (spreadsheetId) => void deleteCachedFile(getCacheScope(), spreadsheetId),
  // a rename bumps updated_at without changing content: keep the parsed cache
  onRenamed: (spreadsheetId, fromVersion, toVersion) =>
    void getSpreadsheetWorkerClient()
      .request("rekey", {
        scope: getCacheScope(),
        from: getWorkbookCacheKey(spreadsheetId, fromVersion),
        to: getWorkbookCacheKey(spreadsheetId, toVersion),
      })
      .catch(() => undefined),
  // sign-out: drop the worker's in-memory documents and this user's cache
  onReset: () => {
    const scope = getCacheScope();
    setCacheScope(null);
    resetSpreadsheetWorkerClient();
    void deleteCacheDatabase(scope);
  },
};

const configuredStores = new WeakSet<ProjectSpreadsheetStore>();

/**
 * The Data files store lives in the root store (so it is reset on sign-out);
 * the worker-backed upload processing is attached here, on the UI side.
 */
export const useProjectSpreadsheets = (): ProjectSpreadsheetStore => {
  const context = useContext(StoreContext);
  const { data: currentUser } = useUser();
  if (context === undefined) throw new Error("useProjectSpreadsheets must be used within StoreProvider");
  // the cache is per user; idempotent, so it's safe to set during render
  setCacheScope(currentUser?.id ?? null);
  const store = context.projectSpreadsheet;
  if (!configuredStores.has(store)) {
    store.setOptions(uiOptions);
    configuredStores.add(store);
  }
  return store;
};
