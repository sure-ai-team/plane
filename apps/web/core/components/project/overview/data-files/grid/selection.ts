/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TSpreadsheetCellValue } from "@plane/types";

/** A cell address in view coordinates (row = position in the current view). */
export type TCellAddress = { row: number; column: number };

export type TGridSelection = { anchor: TCellAddress; focus: TCellAddress } | null;

export type TSelectionBounds = { top: number; bottom: number; left: number; right: number };

export const getSelectionBounds = (selection: NonNullable<TGridSelection>): TSelectionBounds => ({
  top: Math.min(selection.anchor.row, selection.focus.row),
  bottom: Math.max(selection.anchor.row, selection.focus.row),
  left: Math.min(selection.anchor.column, selection.focus.column),
  right: Math.max(selection.anchor.column, selection.focus.column),
});

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export type TNavigationKey =
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "Home"
  | "End"
  | "PageUp"
  | "PageDown";

/**
 * Moves the focus cell for a navigation key. `jump` (Ctrl/Cmd) goes to the
 * edge; `pageSize` is used by PageUp/PageDown.
 */
export const moveFocus = (
  focus: TCellAddress,
  key: TNavigationKey,
  options: { rowCount: number; columnCount: number; jump: boolean; pageSize: number }
): TCellAddress => {
  const lastRow = Math.max(0, options.rowCount - 1);
  const lastColumn = Math.max(0, options.columnCount - 1);
  let { row, column } = focus;
  switch (key) {
    case "ArrowUp":
      row = options.jump ? 0 : row - 1;
      break;
    case "ArrowDown":
      row = options.jump ? lastRow : row + 1;
      break;
    case "ArrowLeft":
      column = options.jump ? 0 : column - 1;
      break;
    case "ArrowRight":
      column = options.jump ? lastColumn : column + 1;
      break;
    case "Home":
      column = 0;
      if (options.jump) row = 0;
      break;
    case "End":
      column = lastColumn;
      if (options.jump) row = lastRow;
      break;
    case "PageUp":
      row -= options.pageSize;
      break;
    case "PageDown":
      row += options.pageSize;
      break;
  }
  return { row: clamp(row, 0, lastRow), column: clamp(column, 0, lastColumn) };
};

/** Reads the selected values (row-major), capped to keep copy/stats bounded. */
export const readSelection = (
  rows: TSpreadsheetCellValue[][],
  view: ArrayLike<number>,
  bounds: TSelectionBounds,
  maxCells = 2_000_000
): TSpreadsheetCellValue[][] => {
  const result: TSpreadsheetCellValue[][] = [];
  const width = bounds.right - bounds.left + 1;
  let budget = maxCells;
  for (let position = bounds.top; position <= bounds.bottom && position < view.length && budget > 0; position++) {
    const row = rows[view[position]] ?? [];
    const cells: TSpreadsheetCellValue[] = [];
    for (let column = 0; column < width; column++) cells.push(row[bounds.left + column] ?? null);
    result.push(cells);
    budget -= width;
  }
  return result;
};
