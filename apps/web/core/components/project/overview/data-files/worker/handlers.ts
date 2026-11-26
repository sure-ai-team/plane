/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Worker-side request handling, kept separate from the `self.onmessage`
 * wiring so it can be unit tested in Node.
 */

import type { TParsedWorkbook } from "@plane/types";
import { getCachedWorkbook, putCachedPreview, putCachedWorkbook } from "../helpers/cache";
import { SPREADSHEET_MAX_MATCHES } from "../helpers/constants";
import { detectColumnTypes, guessHeaderRow } from "../helpers/detect";
import { SpreadsheetError } from "../helpers/errors";
import { buildCsv } from "../helpers/export";
import { parseSpreadsheet } from "../helpers/parse";
import { buildPreview } from "../helpers/preview";
import { computeView, findMatches } from "../helpers/query";
import { computeColumnStats } from "../helpers/stats";
import type { TLoadedWorkbook, TViewQuery, TWorkerRequestMap, TWorkerRequestType } from "./protocol";

type THandlerResult<K extends TWorkerRequestType> = {
  result: TWorkerRequestMap[K]["output"];
  transfer?: Transferable[];
};

export type TWorkerHandlers = {
  [K in TWorkerRequestType]: (payload: TWorkerRequestMap[K]["input"]) => Promise<THandlerResult<K>>;
};

type TCacheAdapter = {
  getWorkbook: (key: string) => Promise<TParsedWorkbook | null>;
  putWorkbook: (key: string, workbook: TParsedWorkbook) => Promise<void>;
  putPreview: typeof putCachedPreview;
};

const defaultCache: TCacheAdapter = {
  getWorkbook: getCachedWorkbook,
  putWorkbook: putCachedWorkbook,
  putPreview: putCachedPreview,
};

const describe = (assetId: string, version: string, workbook: TParsedWorkbook): TLoadedWorkbook => ({
  workbook,
  columnTypes: workbook.sheets.map((sheet) => detectColumnTypes(sheet, 1)),
  headerGuess: workbook.sheets.map((sheet) => guessHeaderRow(sheet)),
  preview: buildPreview(assetId, version, workbook),
});

export const createWorkerHandlers = (cache: TCacheAdapter = defaultCache): TWorkerHandlers => {
  const documents = new Map<string, TParsedWorkbook>();
  // the last computed view per document, so search/stats/export reuse it
  const viewMemo = new Map<string, { signature: string; view: Uint32Array }>();

  const getSheet = (query: TViewQuery) => {
    const workbook = documents.get(query.key);
    const sheet = workbook?.sheets[query.sheet];
    if (!sheet) throw new SpreadsheetError("unknown");
    return sheet;
  };

  const getView = (query: TViewQuery): Uint32Array => {
    const sheet = getSheet(query);
    const signature = JSON.stringify([query.sheet, query.headerRow, query.filters, query.sort]);
    const memo = viewMemo.get(query.key);
    if (memo && memo.signature === signature) return memo.view;
    const view = computeView(sheet.rows, {
      startRow: query.headerRow ? 1 : 0,
      filters: query.filters,
      sort: query.sort,
    });
    viewMemo.set(query.key, { signature, view });
    return view;
  };

  return {
    open: async ({ key, assetId, version }) => {
      const cached = documents.get(key) ?? (await cache.getWorkbook(key));
      if (!cached) return { result: null };
      documents.set(key, cached);
      return { result: describe(assetId, version, cached) };
    },
    parse: async ({ key, assetId, version, kind, buffer, retain }) => {
      const workbook = await parseSpreadsheet(kind, new Uint8Array(buffer));
      const loaded = describe(assetId, version, workbook);
      await cache.putWorkbook(key, workbook);
      await cache.putPreview(loaded.preview);
      if (!retain) return { result: { preview: loaded.preview, workbook: null } };
      documents.set(key, workbook);
      return { result: loaded };
    },
    query: async (query) => {
      // copy so the memoized view isn't detached by the transfer
      const view = getView(query).slice();
      return { result: { view }, transfer: [view.buffer] };
    },
    search: async ({ term, ...query }) => {
      const sheet = getSheet(query);
      const matches = findMatches(sheet.rows, getView(query), sheet.columns, term, SPREADSHEET_MAX_MATCHES);
      return {
        result: { matches, truncated: matches.length / 2 >= SPREADSHEET_MAX_MATCHES },
        transfer: [matches.buffer],
      };
    },
    "column-stats": async ({ column, ...query }) => {
      const sheet = getSheet(query);
      return { result: computeColumnStats(sheet.rows, column, getView(query)) };
    },
    export: async (query) => {
      const sheet = getSheet(query);
      const header = query.headerRow ? (sheet.rows[0] ?? []) : null;
      return { result: { csv: buildCsv(sheet.rows, getView(query), sheet.columns, header) } };
    },
    release: async ({ key }) => {
      documents.delete(key);
      viewMemo.delete(key);
      return { result: null };
    },
  };
};
