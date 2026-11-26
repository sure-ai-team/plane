/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TSpreadsheetCellValue } from "@plane/types";
import { cellToText, isEmptyCell, toNumber } from "./cells";

export type TSpreadsheetFilterOperator =
  | "contains"
  | "not_contains"
  | "equals"
  | "not_equals"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "empty"
  | "not_empty";

export const TEXT_FILTER_OPERATORS: TSpreadsheetFilterOperator[] = [
  "contains",
  "not_contains",
  "equals",
  "not_equals",
  "empty",
  "not_empty",
];
export const NUMBER_FILTER_OPERATORS: TSpreadsheetFilterOperator[] = [
  "equals",
  "not_equals",
  "gt",
  "gte",
  "lt",
  "lte",
  "empty",
  "not_empty",
];
export const VALUELESS_OPERATORS: TSpreadsheetFilterOperator[] = ["empty", "not_empty"];

export type TSpreadsheetFilter = {
  id: string;
  column: number;
  operator: TSpreadsheetFilterOperator;
  value: string;
};

export type TSortDirection = "asc" | "desc";

export type TSpreadsheetSort = {
  column: number;
  direction: TSortDirection;
} | null;

export type TSpreadsheetQuery = {
  /** first data row (1 when the first row is a header) */
  startRow: number;
  filters: TSpreadsheetFilter[];
  sort: TSpreadsheetSort;
};

const lower = (text: string) => text.toLocaleLowerCase();

/** Builds a fast predicate for one filter. */
export const createFilterPredicate = (filter: TSpreadsheetFilter): ((value: TSpreadsheetCellValue) => boolean) => {
  const needle = lower(filter.value.trim());
  const numericNeedle = toNumber(filter.value);
  switch (filter.operator) {
    case "empty":
      return (value) => isEmptyCell(value);
    case "not_empty":
      return (value) => !isEmptyCell(value);
    case "contains":
      return (value) => lower(cellToText(value)).includes(needle);
    case "not_contains":
      return (value) => !lower(cellToText(value)).includes(needle);
    case "equals":
      return (value) => {
        if (numericNeedle !== null) {
          const number = toNumber(value);
          if (number !== null) return number === numericNeedle;
        }
        return lower(cellToText(value).trim()) === needle;
      };
    case "not_equals":
      return (value) => {
        if (numericNeedle !== null) {
          const number = toNumber(value);
          if (number !== null) return number !== numericNeedle;
        }
        return lower(cellToText(value).trim()) !== needle;
      };
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (numericNeedle === null) {
        // compare as text (works for ISO dates too)
        return (value) => {
          if (isEmptyCell(value)) return false;
          const text = lower(cellToText(value));
          if (filter.operator === "gt") return text > needle;
          if (filter.operator === "gte") return text >= needle;
          if (filter.operator === "lt") return text < needle;
          return text <= needle;
        };
      }
      return (value) => {
        const number = toNumber(value);
        if (number === null) return false;
        if (filter.operator === "gt") return number > numericNeedle;
        if (filter.operator === "gte") return number >= numericNeedle;
        if (filter.operator === "lt") return number < numericNeedle;
        return number <= numericNeedle;
      };
    }
    default:
      return () => true;
  }
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Compares two cells: numbers numerically, then text with a natural collator;
 * empty cells always go last regardless of direction.
 */
export const compareCells = (a: TSpreadsheetCellValue, b: TSpreadsheetCellValue, direction: TSortDirection): number => {
  const aEmpty = isEmptyCell(a);
  const bEmpty = isEmptyCell(b);
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
  const factor = direction === "asc" ? 1 : -1;
  const aNumber = toNumber(a);
  const bNumber = toNumber(b);
  if (aNumber !== null && bNumber !== null) return (aNumber - bNumber) * factor;
  // numbers before text
  if (aNumber !== null) return -1 * factor;
  if (bNumber !== null) return 1 * factor;
  return collator.compare(cellToText(a), cellToText(b)) * factor;
};

/**
 * Applies filters and sort, returning row indexes (into `rows`) for the view.
 * The sort is stable.
 */
export const computeView = (rows: TSpreadsheetCellValue[][], query: TSpreadsheetQuery): Uint32Array => {
  const predicates = query.filters.map((filter) => ({ column: filter.column, test: createFilterPredicate(filter) }));
  const indexes: number[] = [];
  for (let r = query.startRow; r < rows.length; r++) {
    const row = rows[r] ?? [];
    let keep = true;
    for (const predicate of predicates) {
      if (!predicate.test(row[predicate.column] ?? null)) {
        keep = false;
        break;
      }
    }
    if (keep) indexes.push(r);
  }
  const sort = query.sort;
  if (sort) {
    // decorate once so the comparator doesn't re-parse values
    const keys = indexes.map((index) => rows[index]?.[sort.column] ?? null);
    const order = indexes.map((_, position) => position);
    order.sort((a, b) => compareCells(keys[a], keys[b], sort.direction) || a - b);
    return Uint32Array.from(order, (position) => indexes[position]);
  }
  return Uint32Array.from(indexes);
};

/**
 * Finds cells containing `term` (case-insensitive) in view order.
 * Returns a flat array of [viewPosition, column] pairs.
 */
export const findMatches = (
  rows: TSpreadsheetCellValue[][],
  view: ArrayLike<number>,
  columns: number,
  term: string,
  maxMatches = Number.MAX_SAFE_INTEGER
): Uint32Array => {
  const needle = lower(term.trim());
  if (!needle) return new Uint32Array(0);
  const matches: number[] = [];
  for (let position = 0; position < view.length; position++) {
    const row = rows[view[position]];
    if (!row) continue;
    const width = Math.min(columns, row.length);
    for (let column = 0; column < width; column++) {
      const value = row[column];
      if (value === null || value === undefined) continue;
      if (lower(cellToText(value)).includes(needle)) {
        matches.push(position, column);
        if (matches.length / 2 >= maxMatches) return Uint32Array.from(matches);
      }
    }
  }
  return Uint32Array.from(matches);
};

/** Splits text into plain / matched segments for highlighting (never HTML). */
export const splitByMatch = (text: string, term: string): { text: string; match: boolean }[] => {
  const needle = lower(term.trim());
  if (!needle || !text) return [{ text, match: false }];
  const haystack = lower(text);
  // lowercasing can change length for some scripts; fall back to whole-cell highlight
  if (haystack.length !== text.length) return [{ text, match: haystack.includes(needle) }];
  const parts: { text: string; match: boolean }[] = [];
  let index = 0;
  while (index < text.length) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) {
      parts.push({ text: text.slice(index), match: false });
      break;
    }
    if (found > index) parts.push({ text: text.slice(index, found), match: false });
    parts.push({ text: text.slice(found, found + needle.length), match: true });
    index = found + needle.length;
  }
  return parts;
};
