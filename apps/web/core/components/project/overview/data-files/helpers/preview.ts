/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TParsedWorkbook } from "@plane/types";
import { cellToText } from "./cells";
import { SPREADSHEET_PREVIEW_COLUMNS, SPREADSHEET_PREVIEW_ROWS } from "./constants";

/** A tiny snapshot of a parsed workbook, rendered on file cards. */
export type TSpreadsheetPreview = {
  assetId: string;
  /** `updated_at` of the file the preview was built from */
  version: string;
  sheetCount: number;
  /** rows in the first sheet */
  rowCount: number;
  columnCount: number;
  /** first few cells of the first sheet, as plain text */
  cells: string[][];
  numericColumns: boolean[];
};

const MAX_PREVIEW_TEXT = 32;

export const buildPreview = (assetId: string, version: string, workbook: TParsedWorkbook): TSpreadsheetPreview => {
  const sheet = workbook.sheets[0];
  const rows = sheet?.rows ?? [];
  const columnCount = Math.min(sheet?.columns ?? 0, SPREADSHEET_PREVIEW_COLUMNS);
  const cells = rows
    .slice(0, SPREADSHEET_PREVIEW_ROWS)
    .map((row) =>
      Array.from({ length: columnCount }, (_, column) => cellToText(row[column] ?? null).slice(0, MAX_PREVIEW_TEXT))
    );
  const numericColumns = Array.from({ length: columnCount }, (_, column) =>
    rows.slice(1, SPREADSHEET_PREVIEW_ROWS).some((row) => typeof row[column] === "number")
  );
  return {
    assetId,
    version,
    sheetCount: workbook.sheets.length,
    rowCount: rows.length,
    columnCount: sheet?.columns ?? 0,
    cells,
    numericColumns,
  };
};
