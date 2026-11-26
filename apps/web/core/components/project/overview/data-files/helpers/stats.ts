/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TSpreadsheetCellValue } from "@plane/types";
import { cellToText, isEmptyCell, toNumber } from "./cells";

export type TNumericStats = {
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
};

export type TColumnStats = {
  /** rows considered */
  count: number;
  empty: number;
  filled: number;
  distinct: number;
  numeric: TNumericStats | null;
};

const finalizeNumeric = (count: number, sum: number, min: number, max: number): TNumericStats | null =>
  count === 0 ? null : { count, sum, avg: sum / count, min, max };

/** Column statistics over the rows of the current view. */
export const computeColumnStats = (
  rows: TSpreadsheetCellValue[][],
  column: number,
  rowIndexes: ArrayLike<number>
): TColumnStats => {
  const distinct = new Set<string>();
  let empty = 0;
  let numericCount = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < rowIndexes.length; i++) {
    const value = rows[rowIndexes[i]]?.[column] ?? null;
    if (isEmptyCell(value)) {
      empty += 1;
      continue;
    }
    distinct.add(cellToText(value));
    const number = toNumber(value);
    if (number !== null) {
      numericCount += 1;
      sum += number;
      if (number < min) min = number;
      if (number > max) max = number;
    }
  }
  const filled = rowIndexes.length - empty;
  // only report numeric stats when the column is (mostly) numeric
  const numeric =
    numericCount > 0 && numericCount >= filled * 0.5 ? finalizeNumeric(numericCount, sum, min, max) : null;
  return { count: rowIndexes.length, empty, filled, distinct: distinct.size, numeric };
};

export type TSelectionStats = {
  /** non-empty cells */
  count: number;
  numericCount: number;
  sum: number;
  avg: number | null;
};

/** Count/Sum/Avg like the Excel status bar. */
export const computeSelectionStats = (values: Iterable<TSpreadsheetCellValue>): TSelectionStats => {
  let count = 0;
  let numericCount = 0;
  let sum = 0;
  for (const value of values) {
    if (isEmptyCell(value)) continue;
    count += 1;
    if (typeof value === "number" && Number.isFinite(value)) {
      numericCount += 1;
      sum += value;
    }
  }
  return { count, numericCount, sum, avg: numericCount ? sum / numericCount : null };
};
