/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Minimal RFC 4180 CSV reader/writer.
 *
 * Handles quoted fields, escaped quotes (""), embedded commas and line
 * breaks, CRLF/LF line endings and a leading UTF-8 byte order mark.
 */

const BOM = "﻿";

export const parseCSV = (input: string): string[][] => {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"' && field === "") {
      inQuotes = true;
    } else if (char === ",") {
      endField();
    } else if (char === "\r") {
      if (text[i + 1] === "\n") i += 1;
      endRow();
    } else if (char === "\n") {
      endRow();
    } else {
      field += char;
    }
    i += 1;
  }

  // Last row, unless the file ended with a line break
  if (field !== "" || row.length > 0) endRow();

  // Drop rows that are completely empty (e.g. trailing blank lines)
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
};

const escapeCell = (value: string): string => {
  if (/[",\r\n]/.test(value) || /^\s|\s$/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

/**
 * Serializes rows to CSV. A byte order mark is prepended so spreadsheet
 * apps (notably Excel) read non-Latin text such as Arabic correctly.
 */
export const toCSV = (rows: string[][]): string =>
  BOM + rows.map((cells) => cells.map((cell) => escapeCell(cell ?? "")).join(",")).join("\r\n") + "\r\n";
