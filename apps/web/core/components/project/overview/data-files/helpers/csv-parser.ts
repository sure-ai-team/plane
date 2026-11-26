/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * RFC 4180 CSV reader with delimiter detection, tuned for large files
 * (slices instead of per-character string concatenation).
 *
 * Mirrors the behaviour of `components/pages/transfer/helpers/csv.ts` but is
 * self-contained so it can be bundled into the spreadsheet Web Worker.
 */

const BOM = "﻿";
const CANDIDATE_DELIMITERS = [",", ";", "\t", "|"] as const;

/** Picks the delimiter that splits the first lines most consistently. */
export const detectDelimiter = (text: string): string => {
  const sample = text.slice(0, 64 * 1024);
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < sample.length && lines.length < 10; i++) {
    const char = sample[i];
    if (char === '"') inQuotes = !inQuotes;
    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (current) lines.push(current);
      current = "";
      continue;
    }
    if (!inQuotes) current += char;
  }
  if (current && lines.length < 10) lines.push(current);
  if (lines.length === 0) return ",";

  let best = ",";
  let bestScore = 0;
  for (const delimiter of CANDIDATE_DELIMITERS) {
    const counts = lines.map((line) => line.split(delimiter).length - 1);
    const first = counts[0];
    if (!first) continue;
    const consistent = counts.filter((count) => count === first).length;
    const score = first * consistent;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
};

export type TCsvParseOptions = {
  delimiter?: string;
  /** Called with the running row count; return false to abort parsing. */
  onRow?: (rowCount: number, columnCount: number) => boolean | void;
};

export const parseCsvText = (input: string, options: TCsvParseOptions = {}): string[][] => {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  const length = text.length;

  const pushRow = () => {
    // Skip completely blank lines
    if (!(row.length === 1 && row[0] === "")) {
      rows.push(row);
      if (options.onRow && options.onRow(rows.length, row.length) === false) return false;
    }
    row = [];
    return true;
  };

  while (i < length) {
    let field: string;
    if (text[i] === '"') {
      // quoted field
      let value = "";
      let start = i + 1;
      i = start;
      for (;;) {
        const quote = text.indexOf('"', i);
        if (quote === -1) {
          value += text.slice(start);
          i = length;
          break;
        }
        if (text[quote + 1] === '"') {
          value += text.slice(start, quote + 1);
          i = quote + 2;
          start = i;
          continue;
        }
        value += text.slice(start, quote);
        i = quote + 1;
        break;
      }
      // tolerate garbage between closing quote and delimiter
      while (i < length && text[i] !== delimiter && text[i] !== "\n" && text[i] !== "\r") {
        value += text[i];
        i += 1;
      }
      field = value;
    } else {
      const start = i;
      while (i < length && text[i] !== delimiter && text[i] !== "\n" && text[i] !== "\r") i += 1;
      field = text.slice(start, i);
    }
    row.push(field);

    if (i >= length) break;
    const char = text[i];
    if (char === delimiter) {
      i += 1;
      if (i >= length) row.push("");
      continue;
    }
    // line break
    if (char === "\r" && text[i + 1] === "\n") i += 2;
    else i += 1;
    if (!pushRow()) return rows;
  }
  if (row.length > 0) pushRow();
  return rows;
};
