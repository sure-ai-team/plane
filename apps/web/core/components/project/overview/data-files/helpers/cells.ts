/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TSpreadsheetCellValue } from "@plane/types";

/** 0 → A, 25 → Z, 26 → AA … */
export const columnLetter = (index: number): string => {
  let n = Math.floor(index);
  if (n < 0) return "";
  let letters = "";
  while (n >= 0) {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  }
  return letters;
};

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

/**
 * Excel stores dates as serial numbers that exceljs exposes as UTC Dates.
 * Dates without a time part become `YYYY-MM-DD`, others `YYYY-MM-DD HH:mm[:ss]`.
 */
export const formatDateValue = (date: Date): string | null => {
  const time = date.getTime();
  if (Number.isNaN(time)) return null;
  const day = `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = date.getUTCSeconds();
  if (hours === 0 && minutes === 0 && seconds === 0) return day;
  return `${day} ${pad(hours)}:${pad(minutes)}${seconds ? `:${pad(seconds)}` : ""}`;
};

const richTextToPlain = (value: unknown): string | null => {
  if (!value || typeof value !== "object" || !("richText" in value)) return null;
  const parts = (value as { richText: unknown }).richText;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part: unknown) => (part && typeof part === "object" && "text" in part ? String(part.text ?? "") : ""))
    .join("");
};

/**
 * Converts any exceljs cell value to a plain primitive:
 * formulas use their cached result, rich text and hyperlinks become their text,
 * dates become ISO-like strings and error values become their code (e.g. `#N/A`).
 */
export const normalizeExcelValue = (value: unknown, depth = 0): TSpreadsheetCellValue => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value === "" ? null : value;
  if (typeof value === "boolean") return value;
  if (value instanceof Date) return formatDateValue(value);
  if (typeof value !== "object" || depth > 3) return null;

  const record = value as Record<string, unknown>;
  // formula / shared formula → cached result
  if ("formula" in record || "sharedFormula" in record) return normalizeExcelValue(record.result, depth + 1);
  if ("richText" in record) {
    const text = richTextToPlain(record);
    return text ? text : null;
  }
  // hyperlink: { text, hyperlink } where text may itself be rich text
  if ("hyperlink" in record) {
    const text = record.text;
    if (text && typeof text === "object") return normalizeExcelValue(text, depth + 1);
    if (text !== undefined && text !== null && text !== "") return String(text);
    return typeof record.hyperlink === "string" && record.hyperlink ? record.hyperlink : null;
  }
  if ("error" in record) return typeof record.error === "string" ? record.error : "#ERROR";
  if ("text" in record && typeof record.text === "string") return record.text || null;
  return null;
};

const NUMERIC_PATTERN = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const GROUPED_NUMERIC_PATTERN = /^[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
const LEADING_ZERO_PATTERN = /^[-+]?0\d/;

/**
 * CSV cells arrive as text. Plain numbers become numbers so they sort and sum
 * correctly; anything that would lose information (leading zeros, > 15 digits)
 * stays text. Empty cells become null.
 */
export const normalizeCsvValue = (raw: string): TSpreadsheetCellValue => {
  if (raw === "") return null;
  const text = raw.trim();
  if (text === "") return raw;
  if (text.length <= 16 && NUMERIC_PATTERN.test(text) && !LEADING_ZERO_PATTERN.test(text)) {
    const digits = text.replace(/[^0-9]/g, "").replace(/^0+/, "");
    if (digits.length <= 15) {
      const parsed = Number(text);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return raw;
};

/** Reads a numeric value out of a cell, accepting numeric text such as "1,234.5". */
export const toNumber = (value: TSpreadsheetCellValue): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  if (NUMERIC_PATTERN.test(text)) {
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (GROUPED_NUMERIC_PATTERN.test(text)) {
    const parsed = Number(text.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

/** Plain-text representation used for search, filters, copy and export. */
export const cellToText = (value: TSpreadsheetCellValue): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return formatNumber(value);
  return value;
};

/** Removes floating point noise (0.1 + 0.2) without rounding real precision. */
export const formatNumber = (value: number): string => {
  if (!Number.isFinite(value)) return "";
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(15)));
};

export const isEmptyCell = (value: TSpreadsheetCellValue | undefined): boolean =>
  value === null || value === undefined || (typeof value === "string" && value.trim() === "");
