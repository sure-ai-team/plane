/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TFileSignedURLResponse } from "../file";

/** A spreadsheet (.xlsx / .csv) uploaded to a project's "Data files". */
export type TProjectSpreadsheet = {
  id: string;
  name: string;
  /** file size in bytes */
  size: number;
  /** MIME type */
  type: string;
  project: string;
  created_by: string;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
};

/** Body for creating (or replacing) a spreadsheet upload. */
export type TProjectSpreadsheetUploadPayload = {
  name: string;
  type: string;
  size: number;
};

/** Presigned upload returned when creating or replacing a spreadsheet. */
export type TProjectSpreadsheetUploadResponse = TFileSignedURLResponse;

/** Body for PATCH: finalize an upload and/or rename. */
export type TProjectSpreadsheetUpdatePayload = {
  is_uploaded?: true;
  name?: string;
};

/** Value of a single parsed cell. Never HTML. */
export type TSpreadsheetCellValue = string | number | boolean | null;

export type TSpreadsheetMerge = {
  top: number;
  left: number;
  bottom: number;
  right: number;
};

export type TParsedSheet = {
  name: string;
  /** number of columns (widest row) */
  columns: number;
  rows: TSpreadsheetCellValue[][];
  merges?: TSpreadsheetMerge[];
};

export type TParsedWorkbook = {
  sheets: TParsedSheet[];
};
