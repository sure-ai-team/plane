/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TSpreadsheetCellValue } from "@plane/types";
import { cellToText } from "../helpers/cells";

export type TGridDensity = "compact" | "comfortable";

export const MIN_COLUMN_WIDTH = 56;
export const MAX_COLUMN_WIDTH = 640;
const MAX_AUTO_WIDTH = 320;
const CHAR_WIDTH = 7.2;
const CELL_PADDING = 28;

export const ROW_HEIGHT: Record<TGridDensity, number> = { compact: 26, comfortable: 36 };

export const getHeaderHeight = (headerRow: boolean) => (headerRow ? 48 : 30);

export const getRowNumberWidth = (maxRowNumber: number) => Math.max(44, String(maxRowNumber).length * 8 + 20);

export const clampColumnWidth = (width: number) =>
  Math.round(Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, width)));

/** Sizes columns from the header and a sample of rows. */
export const estimateColumnWidths = (rows: TSpreadsheetCellValue[][], columns: number, sampleRows = 60): number[] => {
  const widths = Array.from({ length: columns }, () => 0);
  const limit = Math.min(rows.length, sampleRows);
  for (let r = 0; r < limit; r++) {
    const row = rows[r];
    if (!row) continue;
    for (let c = 0; c < Math.min(columns, row.length); c++) {
      const length = cellToText(row[c] ?? null).length;
      if (length > widths[c]) widths[c] = length;
    }
  }
  return widths.map((chars) =>
    Math.round(Math.max(MIN_COLUMN_WIDTH + 24, Math.min(MAX_AUTO_WIDTH, chars * CHAR_WIDTH + CELL_PADDING)))
  );
};
