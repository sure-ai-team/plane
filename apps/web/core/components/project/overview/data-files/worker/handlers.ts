/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Worker-side request handling, kept separate from the `self` message wiring
 * so it can be unit tested in Node.
 */

import type { TParsedWorkbook } from "@plane/types";
import { computeRangeStats } from "../grid/selection";
import type { TCacheScope } from "../helpers/cache";
import { getCachedWorkbook, putCachedPreview, putCachedWorkbook, rekeyCachedWorkbook } from "../helpers/cache";
import { cellToText } from "../helpers/cells";
import { SPREADSHEET_MAX_MATCHES } from "../helpers/constants";
import { detectColumnTypes, guessHeaderRow } from "../helpers/detect";
import { SpreadsheetError } from "../helpers/errors";
import { buildCsv } from "../helpers/export";
import { parseSpreadsheet } from "../helpers/parse";
import type { TSpreadsheetPreview } from "../helpers/preview";
import { buildPreview } from "../helpers/preview";
import { computeView, findMatches } from "../helpers/query";
import { computeColumnStats } from "../helpers/stats";
import type { TLoadedWorkbook, TViewQuery, TWorkerRequestMap, TWorkerRequestType } from "./protocol";

type THandlerResult<K extends TWorkerRequestType> = {
  result: TWorkerRequestMap[K]["output"];
  transfer?: Transferable[];
};

export type THandlerContext = {
  /** Signals that work on the request has begun (the client starts its timeout here). */
  onStart: () => void;
};

export type TWorkerHandlers = {
  [K in TWorkerRequestType]: (
    payload: TWorkerRequestMap[K]["input"],
    context: THandlerContext
  ) => Promise<THandlerResult<K>>;
};

export type TCacheAdapter = {
  getWorkbook: (scope: TCacheScope, key: string) => Promise<TParsedWorkbook | null>;
  putWorkbook: (scope: TCacheScope, key: string, workbook: TParsedWorkbook) => Promise<void>;
  putPreview: (scope: TCacheScope, preview: TSpreadsheetPreview) => Promise<void>;
  rekeyWorkbook: (scope: TCacheScope, from: string, to: string) => Promise<void>;
};

const defaultCache: TCacheAdapter = {
  getWorkbook: getCachedWorkbook,
  putWorkbook: putCachedWorkbook,
  putPreview: putCachedPreview,
  rekeyWorkbook: rekeyCachedWorkbook,
};

const MAX_COPY_CELLS = 1_000_000;

const describe = (assetId: string, version: string, workbook: TParsedWorkbook): TLoadedWorkbook => ({
  workbook,
  columnTypes: workbook.sheets.map((sheet) => detectColumnTypes(sheet, 1)),
  headerGuess: workbook.sheets.map((sheet) => guessHeaderRow(sheet)),
  preview: buildPreview(assetId, version, workbook),
});

type TParseRun = {
  started: Promise<void>;
  done: Promise<TParsedWorkbook>;
};

export const createWorkerHandlers = (cache: TCacheAdapter = defaultCache): TWorkerHandlers => {
  const documents = new Map<string, TParsedWorkbook>();
  // the last computed view per document, so search/stats/export reuse it
  const viewMemo = new Map<string, { signature: string; view: Uint32Array }>();
  // bumped on every release, so work that finishes afterwards isn't kept
  const releases = new Map<string, number>();
  // parses run one at a time; concurrent parses of one key share a run
  const inflight = new Map<string, TParseRun>();
  let parseQueue: Promise<unknown> = Promise.resolve();

  const releaseCount = (key: string) => releases.get(key) ?? 0;

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

  const startParse = (payload: TWorkerRequestMap["parse"]["input"]): TParseRun => {
    const existing = inflight.get(payload.key);
    if (existing) return existing;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const done = parseQueue.then(async () => {
      markStarted();
      const workbook = await parseSpreadsheet(payload.kind, new Uint8Array(payload.buffer));
      const preview = buildPreview(payload.assetId, payload.version, workbook);
      await cache.putWorkbook(payload.scope, payload.key, workbook);
      await cache.putPreview(payload.scope, preview);
      return workbook;
    });
    const run: TParseRun = { started, done };
    inflight.set(payload.key, run);
    parseQueue = done.catch(() => undefined);
    void done
      .catch(() => undefined)
      .finally(() => {
        if (inflight.get(payload.key) === run) inflight.delete(payload.key);
      });
    return run;
  };

  return {
    open: async ({ scope, key, assetId, version }, { onStart }) => {
      onStart();
      const inMemory = documents.get(key);
      if (inMemory) return { result: describe(assetId, version, inMemory) };
      const releasedBefore = releaseCount(key);
      const cached = await cache.getWorkbook(scope, key);
      if (!cached) return { result: null };
      // the viewer closed while IndexedDB was answering: don't keep it
      if (releaseCount(key) !== releasedBefore) return { result: null };
      documents.set(key, cached);
      return { result: describe(assetId, version, cached) };
    },
    parse: async (payload, { onStart }) => {
      const { key, assetId, version, retain } = payload;
      const inMemory = documents.get(key);
      if (inMemory) {
        onStart();
        const loaded = describe(assetId, version, inMemory);
        return { result: retain ? loaded : { preview: loaded.preview, workbook: null } };
      }
      const releasedBefore = releaseCount(key);
      const run = startParse(payload);
      await run.started;
      onStart();
      const workbook = await run.done;
      const loaded = describe(assetId, version, workbook);
      if (!retain || releaseCount(key) !== releasedBefore)
        return { result: { preview: loaded.preview, workbook: null } };
      documents.set(key, workbook);
      return { result: loaded };
    },
    query: async (query, { onStart }) => {
      onStart();
      // copy so the memoized view isn't detached by the transfer
      const view = getView(query).slice();
      return { result: { view }, transfer: [view.buffer] };
    },
    search: async ({ term, ...query }, { onStart }) => {
      onStart();
      const sheet = getSheet(query);
      const matches = findMatches(sheet.rows, getView(query), sheet.columns, term, SPREADSHEET_MAX_MATCHES);
      return {
        result: { matches, truncated: matches.length / 2 >= SPREADSHEET_MAX_MATCHES },
        transfer: [matches.buffer],
      };
    },
    "column-stats": async ({ column, ...query }, { onStart }) => {
      onStart();
      const sheet = getSheet(query);
      return { result: computeColumnStats(sheet.rows, column, getView(query)) };
    },
    export: async (query, { onStart }) => {
      onStart();
      const sheet = getSheet(query);
      const header = query.headerRow ? (sheet.rows[0] ?? []) : null;
      return { result: { csv: buildCsv(sheet.rows, getView(query), sheet.columns, header) } };
    },
    "selection-stats": async ({ bounds, ...query }, { onStart }) => {
      onStart();
      return { result: computeRangeStats(getSheet(query).rows, getView(query), bounds) };
    },
    "selection-text": async ({ bounds, ...query }, { onStart }) => {
      onStart();
      const width = bounds.right - bounds.left + 1;
      if ((bounds.bottom - bounds.top + 1) * width > MAX_COPY_CELLS) throw new SpreadsheetError("unknown");
      const rows = getSheet(query).rows;
      const view = getView(query);
      const lines: string[] = [];
      for (let position = bounds.top; position <= bounds.bottom && position < view.length; position++) {
        const row = rows[view[position]] ?? [];
        const cells: string[] = [];
        for (let column = bounds.left; column <= bounds.right; column++)
          cells.push(cellToText(row[column] ?? null).replace(/[\t\r\n]+/g, " "));
        lines.push(cells.join("\t"));
      }
      return { result: { text: lines.join("\n") } };
    },
    rekey: async ({ scope, from, to }, { onStart }) => {
      onStart();
      if (from === to) return { result: null };
      // move the in-memory document synchronously so a following `open` finds it
      const document = documents.get(from);
      if (document) {
        documents.delete(from);
        documents.set(to, document);
      }
      const memo = viewMemo.get(from);
      if (memo) {
        viewMemo.delete(from);
        viewMemo.set(to, memo);
      }
      await cache.rekeyWorkbook(scope, from, to);
      return { result: null };
    },
    release: async ({ key }, { onStart }) => {
      onStart();
      releases.set(key, releaseCount(key) + 1);
      documents.delete(key);
      viewMemo.delete(key);
      return { result: null };
    },
  };
};
