/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { selectEvictions, getWorkbookCacheKey } from "../helpers/cache";
import {
  cellToText,
  columnLetter,
  formatDateValue,
  formatNumber,
  normalizeCsvValue,
  normalizeExcelValue,
  toNumber,
} from "../helpers/cells";
import { SPREADSHEET_MAX_FILE_SIZE } from "../helpers/constants";
import { detectDelimiter, parseCsvText } from "../helpers/csv-parser";
import { classifyValue, detectColumnType, guessHeaderRow } from "../helpers/detect";
import { toSpreadsheetErrorShape, SpreadsheetError } from "../helpers/errors";
import { buildCsv, buildTsv, escapeCsvInjection, toExportFileName } from "../helpers/export";
import { formatRelativeTime, toIntlLocale } from "../helpers/format";
import { buildPreview } from "../helpers/preview";
import { compareCells, computeView, createFilterPredicate, findMatches, splitByMatch } from "../helpers/query";
import type { TSpreadsheetFilter } from "../helpers/query";
import { computeColumnStats, computeSelectionStats } from "../helpers/stats";
import {
  formatFileSize,
  getSpreadsheetKind,
  normalizeSpreadsheetName,
  validateSpreadsheetFile,
} from "../helpers/validation";

describe("cells", () => {
  it("converts indexes to column letters", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnLetter)).toEqual([
      "A",
      "B",
      "Z",
      "AA",
      "AB",
      "AZ",
      "BA",
      "ZZ",
      "AAA",
    ]);
  });

  it("formats Excel dates as ISO strings", () => {
    expect(formatDateValue(new Date(Date.UTC(2024, 0, 31)))).toBe("2024-01-31");
    expect(formatDateValue(new Date(Date.UTC(2024, 0, 31, 9, 5)))).toBe("2024-01-31 09:05");
    expect(formatDateValue(new Date(Date.UTC(2024, 0, 31, 9, 5, 7)))).toBe("2024-01-31 09:05:07");
    expect(formatDateValue(new Date("nope"))).toBeNull();
  });

  it("normalizes exceljs cell values to primitives", () => {
    expect(normalizeExcelValue(undefined)).toBeNull();
    expect(normalizeExcelValue("")).toBeNull();
    expect(normalizeExcelValue(42)).toBe(42);
    expect(normalizeExcelValue(Number.NaN)).toBeNull();
    expect(normalizeExcelValue(true)).toBe(true);
    expect(normalizeExcelValue({ formula: "A1*2", result: 84 })).toBe(84);
    expect(normalizeExcelValue({ sharedFormula: "A1", result: "x" })).toBe("x");
    expect(normalizeExcelValue({ formula: "1/0", result: { error: "#DIV/0!" } })).toBe("#DIV/0!");
    expect(normalizeExcelValue({ formula: "NOW()" })).toBeNull();
    expect(normalizeExcelValue({ richText: [{ text: "Hello " }, { font: {}, text: "<b>world</b>" }] })).toBe(
      "Hello <b>world</b>"
    );
    expect(normalizeExcelValue({ text: "Plane", hyperlink: "https://plane.so" })).toBe("Plane");
    expect(normalizeExcelValue({ text: { richText: [{ text: "rich" }] }, hyperlink: "https://x" })).toBe("rich");
    expect(normalizeExcelValue({ text: "", hyperlink: "https://x.y" })).toBe("https://x.y");
    expect(normalizeExcelValue({ error: "#N/A" })).toBe("#N/A");
    expect(normalizeExcelValue(new Date(Date.UTC(2020, 1, 2)))).toBe("2020-02-02");
  });

  it("keeps CSV text that would lose information", () => {
    expect(normalizeCsvValue("")).toBeNull();
    expect(normalizeCsvValue("12")).toBe(12);
    expect(normalizeCsvValue("-3.5")).toBe(-3.5);
    expect(normalizeCsvValue("1e3")).toBe(1000);
    expect(normalizeCsvValue("007")).toBe("007");
    expect(normalizeCsvValue("0.5")).toBe(0.5);
    expect(normalizeCsvValue("12345678901234567890")).toBe("12345678901234567890");
    expect(normalizeCsvValue("abc")).toBe("abc");
    expect(normalizeCsvValue("  ")).toBe("  ");
    expect(normalizeCsvValue("1,234")).toBe("1,234");
  });

  it("reads numbers from cells", () => {
    expect(toNumber(5)).toBe(5);
    expect(toNumber("1,234.5")).toBe(1234.5);
    expect(toNumber(" 7 ")).toBe(7);
    expect(toNumber("1,23")).toBeNull();
    expect(toNumber("abc")).toBeNull();
    expect(toNumber(true)).toBeNull();
    expect(toNumber(null)).toBeNull();
  });

  it("renders cells as plain text", () => {
    expect(cellToText(null)).toBe("");
    expect(cellToText(true)).toBe("TRUE");
    expect(cellToText(0.1 + 0.2)).toBe("0.3");
    expect(cellToText("<script>")).toBe("<script>");
    expect(formatNumber(Infinity)).toBe("");
  });
});

describe("csv parser", () => {
  it("handles quotes, escaped quotes, embedded line breaks and CRLF", () => {
    const rows = parseCsvText('name,note\r\n"Doe, Jane","said ""hi""\nthere"\r\nBob,\r\n');
    expect(rows).toEqual([
      ["name", "note"],
      ["Doe, Jane", 'said "hi"\nthere'],
      ["Bob", ""],
    ]);
  });

  it("strips the BOM and skips blank lines", () => {
    expect(parseCsvText("﻿a,b\n\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("detects semicolon, tab and comma delimiters", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\n1\t2")).toBe("\t");
    expect(detectDelimiter('"x;y",b\n1,2')).toBe(",");
    expect(parseCsvText("a;b\n1,5;2")).toEqual([
      ["a", "b"],
      ["1,5", "2"],
    ]);
  });

  it("stops when the row callback returns false", () => {
    const rows = parseCsvText("1\n2\n3\n4", { onRow: (count) => count < 2 });
    expect(rows).toHaveLength(2);
  });
});

describe("type detection", () => {
  it("classifies values", () => {
    expect(classifyValue(null)).toBeNull();
    expect(classifyValue(3)).toBe("number");
    expect(classifyValue("3.5")).toBe("number");
    expect(classifyValue(false)).toBe("boolean");
    expect(classifyValue("TRUE")).toBe("boolean");
    expect(classifyValue("2024-03-01")).toBe("date");
    expect(classifyValue("2024-03-01 10:00")).toBe("date");
    expect(classifyValue("2024-13-45")).toBe("text");
    expect(classifyValue("hello")).toBe("text");
  });

  it("picks a type covering at least 90% of the sample, skipping the header", () => {
    const rows = [["Amount"], [1], [2], [null], ["3"], [4]];
    expect(detectColumnType(rows, 0)).toBe("number");
    expect(detectColumnType([["h"], [1], ["x"]], 0)).toBe("text");
    expect(detectColumnType([["h"], [null]], 0)).toBe("text");
  });

  it("guesses header rows", () => {
    expect(
      guessHeaderRow({
        name: "s",
        columns: 2,
        rows: [
          ["Name", "Age"],
          ["a", 1],
        ],
      })
    ).toBe(true);
    expect(
      guessHeaderRow({
        name: "s",
        columns: 2,
        rows: [
          ["a", 1],
          ["b", 2],
        ],
      })
    ).toBe(false);
    expect(guessHeaderRow({ name: "s", columns: 1, rows: [["2020"], ["x"]] })).toBe(false);
    expect(guessHeaderRow({ name: "s", columns: 1, rows: [["only"]] })).toBe(false);
  });
});

describe("stats", () => {
  const rows = [["h"], [10], ["20"], [null], ["x"], [10]];
  it("computes column stats over the view", () => {
    const stats = computeColumnStats(rows, 0, [1, 2, 3, 4, 5]);
    expect(stats).toMatchObject({ count: 5, empty: 1, filled: 4, distinct: 3 });
    expect(stats.numeric).toEqual({ count: 3, sum: 40, avg: 40 / 3, min: 10, max: 20 });
  });

  it("omits numeric stats for text columns", () => {
    expect(computeColumnStats([["a"], ["b"], [1]], 0, [0, 1, 2]).numeric).toBeNull();
  });

  it("computes selection stats like a status bar", () => {
    expect(computeSelectionStats([1, 2, "x", null, 3])).toEqual({ count: 4, numericCount: 3, sum: 6, avg: 2 });
    expect(computeSelectionStats(["a"]).avg).toBeNull();
  });
});

const filter = (column: number, operator: TSpreadsheetFilter["operator"], value = ""): TSpreadsheetFilter => ({
  id: "f",
  column,
  operator,
  value,
});

describe("query", () => {
  const rows = [
    ["Name", "Score", "City"],
    ["alice", 30, "Paris"],
    ["Bob", 5, null],
    ["carol", "100", "paris"],
    ["dave", null, "Rome"],
    ["Eve", 5, "Oslo"],
  ];
  it("filters with text and numeric operators", () => {
    const view = (f: TSpreadsheetFilter) => Array.from(computeView(rows, { startRow: 1, filters: [f], sort: null }));
    expect(view(filter(2, "contains", "PAR"))).toEqual([1, 3]);
    expect(view(filter(2, "not_contains", "par"))).toEqual([2, 4, 5]);
    expect(view(filter(1, "equals", "5"))).toEqual([2, 5]);
    expect(view(filter(1, "not_equals", "5"))).toEqual([1, 3, 4]);
    expect(view(filter(1, "gt", "10"))).toEqual([1, 3]);
    expect(view(filter(1, "gte", "30"))).toEqual([1, 3]);
    expect(view(filter(1, "lt", "30"))).toEqual([2, 5]);
    expect(view(filter(1, "lte", "5"))).toEqual([2, 5]);
    expect(view(filter(2, "empty"))).toEqual([2]);
    expect(view(filter(1, "not_empty"))).toEqual([1, 2, 3, 5]);
    expect(view(filter(0, "equals", "BOB"))).toEqual([2]);
  });

  it("compares as text when the filter value isn't numeric", () => {
    const predicate = createFilterPredicate(filter(0, "gt", "2024-01-01"));
    expect(predicate("2024-05-01")).toBe(true);
    expect(predicate("2023-05-01")).toBe(false);
    expect(predicate(null)).toBe(false);
  });

  it("sorts stably with empties last in both directions", () => {
    const asc = computeView(rows, { startRow: 1, filters: [], sort: { column: 1, direction: "asc" } });
    expect(Array.from(asc)).toEqual([2, 5, 1, 3, 4]);
    const desc = computeView(rows, { startRow: 1, filters: [], sort: { column: 1, direction: "desc" } });
    expect(Array.from(desc)).toEqual([3, 1, 2, 5, 4]);
    const byName = computeView(rows, { startRow: 1, filters: [], sort: { column: 0, direction: "asc" } });
    expect(Array.from(byName)).toEqual([1, 2, 3, 4, 5]);
  });

  it("orders numbers before text and uses natural ordering", () => {
    expect(compareCells(2, "a", "asc")).toBeLessThan(0);
    expect(compareCells("file10", "file9", "asc")).toBeGreaterThan(0);
    expect(compareCells(null, 1, "desc")).toBeGreaterThan(0);
  });

  it("includes the header row when the first row isn't a header", () => {
    expect(computeView(rows, { startRow: 0, filters: [], sort: null })).toHaveLength(6);
  });

  it("finds matches in view order, case-insensitively, with a cap", () => {
    const view = computeView(rows, { startRow: 1, filters: [], sort: { column: 0, direction: "desc" } });
    const matches = Array.from(findMatches(rows, view, 3, "PAR"));
    // view: Eve(5), dave(4), carol(3), Bob(2), alice(1)
    expect(matches).toEqual([2, 2, 4, 2]);
    expect(findMatches(rows, view, 3, "a", 2)).toHaveLength(4);
    expect(findMatches(rows, view, 3, "   ")).toHaveLength(0);
  });

  it("splits text for highlighting without HTML", () => {
    expect(splitByMatch("Paris and paris", "PAR")).toEqual([
      { text: "Par", match: true },
      { text: "is and ", match: false },
      { text: "par", match: true },
      { text: "is", match: false },
    ]);
    expect(splitByMatch("abc", "")).toEqual([{ text: "abc", match: false }]);
  });
});

describe("export", () => {
  it("escapes formula injection in text but not real numbers", () => {
    expect(escapeCsvInjection("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(escapeCsvInjection("+1")).toBe("'+1");
    expect(escapeCsvInjection("-cmd")).toBe("'-cmd");
    expect(escapeCsvInjection("@foo")).toBe("'@foo");
    expect(escapeCsvInjection("\tx")).toBe("'\tx");
    expect(escapeCsvInjection("\rx")).toBe("'\rx");
    expect(escapeCsvInjection(-5)).toBe("-5");
    expect(escapeCsvInjection("safe")).toBe("safe");
    expect(escapeCsvInjection(null)).toBe("");
  });

  it("builds a CSV of the current view with header and quoting", () => {
    const rows = [
      ["Name", "Note"],
      ["a", "=1+1"],
      ["b", 'say "hi", ok'],
    ];
    const csv = buildCsv(rows, [2, 1], 2, rows[0]);
    expect(csv).toBe('﻿Name,Note\r\nb,"say ""hi"", ok"\r\na,\'=1+1\r\n');
  });

  it("quotes cells that become multiline after escaping", () => {
    expect(buildCsv([["\rboom"]], [0], 1, null)).toBe('﻿"\'\rboom"\r\n');
  });

  it("builds TSV for the clipboard", () => {
    expect(
      buildTsv([
        [1, "a\tb"],
        [null, true],
      ])
    ).toBe("1\ta b\n\tTRUE");
  });

  it("names exported files", () => {
    expect(toExportFileName("Budget.xlsx", "Q1", true)).toBe("Budget-Q1-view.csv");
    expect(toExportFileName("a/b.csv", "Sheet1", false)).toBe("a_b-view.csv");
  });
});

describe("validation", () => {
  it("accepts xlsx and csv only", () => {
    expect(getSpreadsheetKind("A.XLSX")).toBe("xlsx");
    expect(getSpreadsheetKind("a.csv")).toBe("csv");
    expect(getSpreadsheetKind("a.xls")).toBeNull();
    expect(getSpreadsheetKind("noext", "text/csv")).toBe("csv");
  });

  it("returns friendly error codes", () => {
    expect(validateSpreadsheetFile({ name: "a.csv", size: 10 })).toBeNull();
    expect(validateSpreadsheetFile({ name: "a.pdf", size: 10 })?.code).toBe("unsupported_type");
    expect(validateSpreadsheetFile({ name: "a.csv", size: 0 })?.code).toBe("empty_file");
    expect(validateSpreadsheetFile({ name: "a.xlsx", size: SPREADSHEET_MAX_FILE_SIZE + 1 })).toEqual({
      code: "file_too_large",
      params: { name: "a.xlsx", limit: 20 },
    });
  });

  it("keeps the extension on rename", () => {
    expect(normalizeSpreadsheetName("Budget", "old.xlsx")).toBe("Budget.xlsx");
    expect(normalizeSpreadsheetName(" new.csv ", "old.xlsx")).toBe("new.csv");
    expect(normalizeSpreadsheetName("   ", "old.xlsx")).toBe("old.xlsx");
  });

  it("formats sizes", () => {
    expect(formatFileSize(500)).toBe("500 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("errors, cache, preview, format", () => {
  it("normalizes errors", () => {
    expect(toSpreadsheetErrorShape(new SpreadsheetError("zip_bomb", { ratio: 25 }))).toEqual({
      code: "zip_bomb",
      params: { ratio: 25 },
    });
    expect(toSpreadsheetErrorShape({ code: "timeout" })).toEqual({ code: "timeout", params: undefined });
    expect(toSpreadsheetErrorShape({ error: "missing" }, "upload_failed")).toEqual({ code: "upload_failed" });
  });

  it("evicts the least recently used cache entries", () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({ key: `k${i}`, lastAccess: 100 - i }));
    expect(selectEvictions(entries, 10)).toEqual(["k11", "k10"]);
    expect(selectEvictions(entries.slice(0, 3), 10)).toEqual([]);
    expect(getWorkbookCacheKey("a", "2024")).toBe("a:2024");
  });

  it("builds a small preview", () => {
    const preview = buildPreview("id", "v1", {
      sheets: [
        {
          name: "S",
          columns: 6,
          rows: [
            ["A", "B", "C", "D", "E", "F"],
            [1, "x", 3, 4, 5, 6],
          ],
        },
        { name: "T", columns: 0, rows: [] },
      ],
    });
    expect(preview).toMatchObject({ assetId: "id", version: "v1", sheetCount: 2, rowCount: 2, columnCount: 6 });
    expect(preview.cells[0]).toEqual(["A", "B", "C", "D"]);
    expect(preview.numericColumns).toEqual([true, false, true, true]);
  });

  it("formats relative times with Intl", () => {
    const now = Date.UTC(2024, 0, 10, 12);
    expect(formatRelativeTime(new Date(now - 3 * 3600 * 1000), "en", now)).toBe("3 hours ago");
    expect(formatRelativeTime(new Date(now - 10 * 1000), "en", now)).toBe("now");
    expect(formatRelativeTime("invalid", "en", now)).toBe("");
    expect(toIntlLocale("ua")).toBe("uk");
  });
});
