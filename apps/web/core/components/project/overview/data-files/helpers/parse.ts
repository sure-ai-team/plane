/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Turns raw .csv / .xlsx bytes into plain rows. Runs inside the spreadsheet
 * Web Worker (and in unit tests) — keep imports relative and DOM-free.
 */

import ExcelJS from "exceljs";
import type { Worksheet } from "exceljs";
import type { TParsedSheet, TParsedWorkbook, TSpreadsheetCellValue, TSpreadsheetMerge } from "@plane/types";
import { normalizeCsvValue, normalizeExcelValue } from "./cells";
import { SPREADSHEET_MAX_COLUMNS, SPREADSHEET_MAX_ROWS, SPREADSHEET_MAX_SHEETS } from "./constants";
import type { TSpreadsheetKind } from "./constants";
import { parseCsvText } from "./csv-parser";
import { SpreadsheetError } from "./errors";
import { assertSafeXlsx } from "./zip-guard";

export type TParseLimits = {
  maxRows: number;
  maxColumns: number;
  maxSheets: number;
};

export const DEFAULT_PARSE_LIMITS: TParseLimits = {
  maxRows: SPREADSHEET_MAX_ROWS,
  maxColumns: SPREADSHEET_MAX_COLUMNS,
  maxSheets: SPREADSHEET_MAX_SHEETS,
};

/** Drops trailing empty cells so ragged rows stay small. */
const trimRow = (row: TSpreadsheetCellValue[]): TSpreadsheetCellValue[] => {
  let end = row.length;
  while (end > 0 && (row[end - 1] === null || row[end - 1] === undefined)) end -= 1;
  return end === row.length ? row : row.slice(0, end);
};

const decodeText = (bytes: Uint8Array): string => {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  // Many legacy CSV exports are Windows-1252; replacement characters give them away
  if (utf8.includes("�")) {
    try {
      return new TextDecoder("windows-1252").decode(bytes);
    } catch {
      return utf8;
    }
  }
  return utf8;
};

export const parseCsv = (bytes: Uint8Array, limits: TParseLimits = DEFAULT_PARSE_LIMITS): TParsedWorkbook => {
  const text = decodeText(bytes);
  let tooMany: SpreadsheetError | null = null;
  const raw = parseCsvText(text, {
    onRow: (rowCount, columnCount) => {
      if (rowCount > limits.maxRows) tooMany = new SpreadsheetError("too_many_rows", { limit: limits.maxRows });
      else if (columnCount > limits.maxColumns)
        tooMany = new SpreadsheetError("too_many_columns", { limit: limits.maxColumns });
      return tooMany === null;
    },
  });
  if (tooMany) throw tooMany;
  let columns = 0;
  const rows = raw.map((cells) => {
    const row = trimRow(cells.map(normalizeCsvValue));
    if (row.length > columns) columns = row.length;
    return row;
  });
  return { sheets: [{ name: "Sheet1", columns, rows }] };
};

type TExcelMergeMap = Record<string, { model?: { top: number; left: number; bottom: number; right: number } }>;

const readMerges = (worksheet: Worksheet): TSpreadsheetMerge[] => {
  // `_merges` is exceljs' internal map; `model.merges` would serialize every row
  const merges = (worksheet as unknown as { _merges?: TExcelMergeMap })._merges;
  if (!merges || typeof merges !== "object") return [];
  const result: TSpreadsheetMerge[] = [];
  for (const range of Object.values(merges)) {
    const model = range?.model;
    if (!model) continue;
    // 0-based, inclusive
    result.push({ top: model.top - 1, left: model.left - 1, bottom: model.bottom - 1, right: model.right - 1 });
  }
  return result;
};

const readWorksheet = (worksheet: Worksheet, limits: TParseLimits, rowBudget: number): TParsedSheet => {
  const rows: TSpreadsheetCellValue[][] = [];
  let columns = 0;
  const lastRow = worksheet.rowCount;
  if (lastRow > rowBudget) throw new SpreadsheetError("too_many_rows", { limit: limits.maxRows });

  for (let r = 1; r <= lastRow; r++) {
    const row = worksheet.findRow(r);
    if (!row || !row.hasValues) {
      rows.push([]);
      continue;
    }
    // row.values is 1-based and sparse
    const values = row.values as unknown[];
    // holes in the sparse array normalize to null
    const cells: TSpreadsheetCellValue[] = [];
    for (let c = 1; c < values.length; c++) cells.push(normalizeExcelValue(values[c]));
    const trimmed = trimRow(cells);
    if (trimmed.length > limits.maxColumns)
      throw new SpreadsheetError("too_many_columns", { limit: limits.maxColumns });
    if (trimmed.length > columns) columns = trimmed.length;
    rows.push(trimmed);
  }

  // drop trailing empty rows (formatting-only rows inflate rowCount)
  while (rows.length > 0 && rows[rows.length - 1].length === 0) rows.pop();

  const merges = readMerges(worksheet);
  // merged cells keep only the top-left value
  for (const merge of merges) {
    for (let r = merge.top; r <= merge.bottom && r < rows.length; r++) {
      const row = rows[r];
      for (let c = merge.left; c <= merge.right && c < row.length; c++) {
        if (r === merge.top && c === merge.left) continue;
        row[c] = null;
      }
    }
  }

  return { name: worksheet.name, columns, rows, ...(merges.length ? { merges } : {}) };
};

export const parseXlsx = async (
  bytes: Uint8Array,
  limits: TParseLimits = DEFAULT_PARSE_LIMITS
): Promise<TParsedWorkbook> => {
  assertSafeXlsx(bytes);
  const workbook = new ExcelJS.Workbook();
  try {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    await workbook.xlsx.load(buffer);
  } catch {
    throw new SpreadsheetError("corrupt");
  }
  const worksheets = workbook.worksheets;
  if (worksheets.length > limits.maxSheets) throw new SpreadsheetError("too_many_sheets", { limit: limits.maxSheets });

  const sheets: TParsedSheet[] = [];
  let remaining = limits.maxRows;
  for (const worksheet of worksheets) {
    const sheet = readWorksheet(worksheet, limits, remaining);
    remaining -= sheet.rows.length;
    sheets.push(sheet);
  }
  if (sheets.length === 0) throw new SpreadsheetError("corrupt");
  return { sheets };
};

export const parseSpreadsheet = async (
  kind: TSpreadsheetKind,
  bytes: Uint8Array,
  limits: TParseLimits = DEFAULT_PARSE_LIMITS
): Promise<TParsedWorkbook> => {
  if (bytes.byteLength === 0) throw new SpreadsheetError("empty_file");
  return kind === "csv" ? parseCsv(bytes, limits) : parseXlsx(bytes, limits);
};
