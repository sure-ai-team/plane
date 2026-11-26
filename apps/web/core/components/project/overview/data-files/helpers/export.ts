/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TSpreadsheetCellValue } from "@plane/types";
import { cellToText } from "./cells";

const BOM = "﻿";
const INJECTION_PATTERN = /^[=+\-@\t\r]/;

/**
 * Neutralizes spreadsheet formula injection: text starting with
 * = + - @ tab or CR is prefixed with a single quote. Real numbers are left as is.
 */
export const escapeCsvInjection = (value: TSpreadsheetCellValue): string => {
  const text = cellToText(value);
  if (typeof value === "number") return text;
  return INJECTION_PATTERN.test(text) ? `'${text}` : text;
};

export const quoteCsvField = (text: string): string =>
  /[",\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;

/**
 * Serializes the current view (header row + rows in view order) to CSV with a
 * BOM so Excel reads non-Latin text correctly.
 */
export const buildCsv = (
  rows: TSpreadsheetCellValue[][],
  view: ArrayLike<number>,
  columns: number,
  headerRow: TSpreadsheetCellValue[] | null
): string => {
  const lines: string[] = [];
  const serialize = (row: TSpreadsheetCellValue[] | undefined) => {
    // push into a growing array: as fast as preallocating in V8, and keeps the array packed
    const cells: string[] = [];
    for (let column = 0; column < columns; column++)
      cells.push(quoteCsvField(escapeCsvInjection(row?.[column] ?? null)));
    return cells.join(",");
  };
  if (headerRow) lines.push(serialize(headerRow));
  for (let i = 0; i < view.length; i++) lines.push(serialize(rows[view[i]]));
  return BOM + lines.join("\r\n") + "\r\n";
};

/** Tab-separated text for the clipboard (tabs/newlines inside cells are flattened). */
export const buildTsv = (grid: TSpreadsheetCellValue[][]): string =>
  grid.map((row) => row.map((value) => cellToText(value).replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");

export const toExportFileName = (name: string, sheetName: string, multipleSheets: boolean): string => {
  const base =
    name
      .replace(/\.(xlsx|csv)$/i, "")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .trim() || "data";
  const sheet = multipleSheets ? `-${sheetName.replace(/[\\/:*?"<>|]+/g, "_").trim()}` : "";
  return `${base}${sheet}-view.csv`;
};
