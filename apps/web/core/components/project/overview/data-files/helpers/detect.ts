/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TParsedSheet, TSpreadsheetCellValue } from "@plane/types";
import { isEmptyCell, toNumber } from "./cells";

export type TColumnType = "text" | "number" | "date" | "boolean";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const BOOLEAN_TEXT = new Set(["true", "false"]);

export const classifyValue = (value: TSpreadsheetCellValue): TColumnType | null => {
  if (isEmptyCell(value)) return null;
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  const text = String(value).trim();
  if (BOOLEAN_TEXT.has(text.toLowerCase())) return "boolean";
  if (DATE_PATTERN.test(text) && !Number.isNaN(Date.parse(text.replace(" ", "T")))) return "date";
  if (toNumber(text) !== null) return "number";
  return "text";
};

/**
 * Detects a column's type from up to `sampleSize` non-empty values starting at
 * `startRow`. A type wins when it covers at least 90% of the sample.
 */
export const detectColumnType = (
  rows: TSpreadsheetCellValue[][],
  column: number,
  startRow = 1,
  sampleSize = 1000
): TColumnType => {
  const counts: Record<TColumnType, number> = { text: 0, number: 0, date: 0, boolean: 0 };
  let total = 0;
  for (let r = startRow; r < rows.length && total < sampleSize; r++) {
    const type = classifyValue(rows[r]?.[column] ?? null);
    if (!type) continue;
    counts[type] += 1;
    total += 1;
  }
  if (total === 0) return "text";
  const winner = (Object.keys(counts) as TColumnType[]).reduce((best, type) =>
    counts[type] > counts[best] ? type : best
  );
  return counts[winner] / total >= 0.9 ? winner : "text";
};

export const detectColumnTypes = (sheet: TParsedSheet, startRow = 1): TColumnType[] =>
  Array.from({ length: sheet.columns }, (_, column) => detectColumnType(sheet.rows, column, startRow));

/**
 * Guesses whether the first row is a header: it must contain at least one
 * value and every value must be non-numeric text.
 */
export const guessHeaderRow = (sheet: TParsedSheet): boolean => {
  if (sheet.rows.length < 2) return false;
  const first = sheet.rows[0] ?? [];
  let filled = 0;
  for (const value of first) {
    if (isEmptyCell(value)) continue;
    if (typeof value !== "string" || toNumber(value) !== null) return false;
    filled += 1;
  }
  return filled > 0;
};
