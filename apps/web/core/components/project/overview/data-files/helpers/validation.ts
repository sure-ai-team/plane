/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { SPREADSHEET_MAX_FILE_SIZE, SPREADSHEET_MIME_TYPES } from "./constants";
import type { TSpreadsheetKind } from "./constants";
import type { TSpreadsheetErrorShape } from "./errors";

/** Works out the spreadsheet kind from a file name (and MIME type as a fallback). */
export const getSpreadsheetKind = (name: string, type?: string): TSpreadsheetKind | null => {
  const extension = name.toLowerCase().split(".").pop();
  if (extension === "csv") return "csv";
  if (extension === "xlsx") return "xlsx";
  if (!name.includes(".") && type) {
    if (type === SPREADSHEET_MIME_TYPES.csv) return "csv";
    if (type === SPREADSHEET_MIME_TYPES.xlsx) return "xlsx";
  }
  return null;
};

export const getSpreadsheetMimeType = (kind: TSpreadsheetKind): string => SPREADSHEET_MIME_TYPES[kind];

/** Client-side checks before anything is sent to the server. Returns null when the file is fine. */
export const validateSpreadsheetFile = (file: {
  name: string;
  size: number;
  type?: string;
}): TSpreadsheetErrorShape | null => {
  const kind = getSpreadsheetKind(file.name, file.type);
  if (!kind) return { code: "unsupported_type", params: { name: file.name } };
  if (file.size <= 0) return { code: "empty_file", params: { name: file.name } };
  if (file.size > SPREADSHEET_MAX_FILE_SIZE)
    return { code: "file_too_large", params: { name: file.name, limit: SPREADSHEET_MAX_FILE_SIZE / (1024 * 1024) } };
  return null;
};

/** Keeps the original extension when a file is renamed without one. */
export const normalizeSpreadsheetName = (nextName: string, currentName: string): string => {
  const trimmed = nextName.trim();
  if (!trimmed) return currentName;
  const currentKind = getSpreadsheetKind(currentName);
  if (currentKind && !getSpreadsheetKind(trimmed)) return `${trimmed}.${currentKind}`;
  return trimmed;
};

export const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
