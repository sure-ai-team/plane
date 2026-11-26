/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export const SPREADSHEET_MAX_FILE_SIZE = 20 * 1024 * 1024;
/** Total rows across every sheet of a workbook. */
export const SPREADSHEET_MAX_ROWS = 200_000;
export const SPREADSHEET_MAX_COLUMNS = 500;
export const SPREADSHEET_MAX_SHEETS = 50;
/** Reject xlsx archives that would inflate beyond this multiple of the file size. */
export const SPREADSHEET_MAX_COMPRESSION_RATIO = 25;
export const SPREADSHEET_PARSE_TIMEOUT_MS = 20_000;
export const SPREADSHEET_QUERY_TIMEOUT_MS = 30_000;
export const SPREADSHEET_CACHE_MAX_ENTRIES = 10;
export const SPREADSHEET_PREVIEW_MAX_ENTRIES = 200;
export const SPREADSHEET_SEARCH_DEBOUNCE_MS = 150;
/** Search stops collecting matches past this many. */
export const SPREADSHEET_MAX_MATCHES = 100_000;
/** Number of rows / columns kept for the small card preview. */
export const SPREADSHEET_PREVIEW_ROWS = 6;
export const SPREADSHEET_PREVIEW_COLUMNS = 4;
/** Show the file search box once a project has more files than this. */
export const SPREADSHEET_SEARCH_THRESHOLD = 6;

export const SPREADSHEET_MIME_TYPES = {
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

export type TSpreadsheetKind = keyof typeof SPREADSHEET_MIME_TYPES;

export const SPREADSHEET_ACCEPT =
  ".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** URL search param holding the id of the open file. */
export const SPREADSHEET_FILE_SEARCH_PARAM = "file";
