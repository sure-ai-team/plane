/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export type TSpreadsheetErrorCode =
  | "unsupported_type"
  | "file_too_large"
  | "empty_file"
  | "too_many_rows"
  | "too_many_columns"
  | "too_many_sheets"
  | "zip_bomb"
  | "corrupt"
  | "timeout"
  | "download_failed"
  | "upload_failed"
  | "unknown";

export type TSpreadsheetErrorParams = Record<string, string | number>;

export type TSpreadsheetErrorShape = {
  code: TSpreadsheetErrorCode;
  params?: TSpreadsheetErrorParams;
};

/** An error with a stable code that maps to `spreadsheet.errors.<code>`. */
export class SpreadsheetError extends Error {
  code: TSpreadsheetErrorCode;
  params?: TSpreadsheetErrorParams;

  constructor(code: TSpreadsheetErrorCode, params?: TSpreadsheetErrorParams, message?: string) {
    super(message ?? code);
    this.name = "SpreadsheetError";
    this.code = code;
    this.params = params;
  }
}

/** Normalizes anything thrown (including worker payloads) into a code + params. */
export const toSpreadsheetErrorShape = (
  error: unknown,
  fallback: TSpreadsheetErrorCode = "unknown"
): TSpreadsheetErrorShape => {
  if (error instanceof SpreadsheetError) return { code: error.code, params: error.params };
  if (error && typeof error === "object" && "code" in error && typeof (error as { code: unknown }).code === "string") {
    const shape = error as TSpreadsheetErrorShape;
    if (SPREADSHEET_ERROR_CODES.includes(shape.code)) return { code: shape.code, params: shape.params };
  }
  return { code: fallback };
};

export const SPREADSHEET_ERROR_CODES: TSpreadsheetErrorCode[] = [
  "unsupported_type",
  "file_too_large",
  "empty_file",
  "too_many_rows",
  "too_many_columns",
  "too_many_sheets",
  "zip_bomb",
  "corrupt",
  "timeout",
  "download_failed",
  "upload_failed",
  "unknown",
];
