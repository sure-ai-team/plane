/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TParsedWorkbook } from "@plane/types";
import type { TSpreadsheetKind } from "../helpers/constants";
import type { TColumnType } from "../helpers/detect";
import type { TSpreadsheetErrorShape } from "../helpers/errors";
import type { TSpreadsheetPreview } from "../helpers/preview";
import type { TSelectionBounds } from "../grid/selection";
import type { TCacheScope } from "../helpers/cache";
import type { TSpreadsheetFilter, TSpreadsheetSort } from "../helpers/query";
import type { TColumnStats, TSelectionStats } from "../helpers/stats";

/**
 * Messages between the main thread and `spreadsheet.worker.ts`.
 *
 * The worker keeps every opened workbook in memory under its cache key
 * (`${assetId}:${updated_at}`), so view queries only send the query and get
 * back typed arrays of row indexes (transferred, not copied).
 */

export type TViewQuery = {
  key: string;
  sheet: number;
  headerRow: boolean;
  filters: TSpreadsheetFilter[];
  sort: TSpreadsheetSort;
};

export type TLoadedWorkbook = {
  workbook: TParsedWorkbook;
  /** detected column types per sheet (header row excluded from sampling) */
  columnTypes: TColumnType[][];
  /** whether each sheet's first row looks like a header */
  headerGuess: boolean[];
  preview: TSpreadsheetPreview;
};

export type TWorkerRequestMap = {
  /** look the workbook up (memory, then IndexedDB); null on a miss */
  open: {
    input: { scope: TCacheScope; key: string; assetId: string; version: string };
    output: TLoadedWorkbook | null;
  };
  /**
   * Parse raw bytes and cache the result. Parses run one at a time and
   * concurrent parses of the same key share one run.
   */
  parse: {
    input: {
      scope: TCacheScope;
      key: string;
      assetId: string;
      version: string;
      kind: TSpreadsheetKind;
      buffer: ArrayBuffer;
      retain: boolean;
    };
    output: TLoadedWorkbook | { preview: TSpreadsheetPreview; workbook: null };
  };
  query: { input: TViewQuery; output: { view: Uint32Array } };
  search: { input: TViewQuery & { term: string }; output: { matches: Uint32Array; truncated: boolean } };
  "column-stats": { input: TViewQuery & { column: number }; output: TColumnStats };
  export: { input: TViewQuery; output: { csv: string } };
  /** stats for a selected range (used for large selections) */
  "selection-stats": { input: TViewQuery & { bounds: TSelectionBounds }; output: TSelectionStats };
  /** tab-separated text of a selected range, for the clipboard */
  "selection-text": { input: TViewQuery & { bounds: TSelectionBounds }; output: { text: string } };
  /** after a rename: move the document and its cache entry to the new version key */
  rekey: { input: { scope: TCacheScope; from: string; to: string }; output: null };
  release: { input: { key: string }; output: null };
};

export type TWorkerRequestType = keyof TWorkerRequestMap;

export type TWorkerRequest = {
  [K in TWorkerRequestType]: { id: number; type: K; payload: TWorkerRequestMap[K]["input"] };
}[TWorkerRequestType];

export type TWorkerResponse =
  /** the worker began working on the request (timeouts count from here) */
  | { id: number; started: true }
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: TSpreadsheetErrorShape };
