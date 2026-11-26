/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useContext } from "react";
// lib
import { StoreContext } from "@/lib/store-context";
import { ProjectSpreadsheetService } from "@/services/project/project-spreadsheet.service";
import type {
  ProjectSpreadsheetStore,
  TProjectSpreadsheetStoreOptions,
} from "@/store/project-spreadsheet/project-spreadsheet.store";
// local imports
import { deleteCachedFile, getWorkbookCacheKey } from "../helpers/cache";
import { SPREADSHEET_PARSE_TIMEOUT_MS } from "../helpers/constants";
import { getSpreadsheetKind } from "../helpers/validation";
import { getSpreadsheetWorkerClient } from "../worker/client";

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
    const result = await getSpreadsheetWorkerClient().request(
      "parse",
      {
        key: getWorkbookCacheKey(spreadsheet.id, spreadsheet.updated_at),
        assetId: spreadsheet.id,
        version: spreadsheet.updated_at,
        kind,
        buffer,
        retain: false,
      },
      { transfer: [buffer], timeoutMs: SPREADSHEET_PARSE_TIMEOUT_MS }
    );
    return result.preview;
  },
  onDeleted: (spreadsheetId) => void deleteCachedFile(spreadsheetId),
};

const configuredStores = new WeakSet<ProjectSpreadsheetStore>();

/**
 * The Data files store lives in the root store (so it is reset on sign-out);
 * the worker-backed upload processing is attached here, on the UI side.
 */
export const useProjectSpreadsheets = (): ProjectSpreadsheetStore => {
  const context = useContext(StoreContext);
  if (context === undefined) throw new Error("useProjectSpreadsheets must be used within StoreProvider");
  const store = context.projectSpreadsheet;
  if (!configuredStores.has(store)) {
    store.setOptions(uiOptions);
    configuredStores.add(store);
  }
  return store;
};
