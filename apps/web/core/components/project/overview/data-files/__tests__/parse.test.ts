/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import ExcelJS from "exceljs";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { SpreadsheetError } from "../helpers/errors";
import { parseCsv, parseSpreadsheet, parseXlsx } from "../helpers/parse";
import { assertSafeXlsx, inspectZip } from "../helpers/zip-guard";

const buildWorkbook = async (build: (workbook: ExcelJS.Workbook) => void): Promise<Uint8Array> => {
  const workbook = new ExcelJS.Workbook();
  build(workbook);
  return new Uint8Array((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
};

const expectCode = async (promise: Promise<unknown> | (() => unknown), code: string) => {
  try {
    await (typeof promise === "function" ? promise() : promise);
  } catch (error) {
    expect(error).toBeInstanceOf(SpreadsheetError);
    expect((error as SpreadsheetError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
};

describe("zip guard", () => {
  it("reads the central directory without inflating", () => {
    const bytes = zipSync({ "xl/workbook.xml": strToU8("<x/>"), "a.txt": strToU8("hello") });
    expect(inspectZip(bytes)).toEqual({ entries: 2, uncompressedSize: 9, hasWorkbook: true });
  });

  it("rejects archives that inflate past the ratio (zip bombs)", () => {
    const bomb = zipSync({ "xl/workbook.xml": new Uint8Array(2_000_000) }, { level: 9 });
    expect(bomb.byteLength * 25).toBeLessThan(2_000_000);
    expect(() => assertSafeXlsx(bomb)).toThrowError(SpreadsheetError);
    try {
      assertSafeXlsx(bomb);
    } catch (error) {
      expect((error as SpreadsheetError).code).toBe("zip_bomb");
    }
  });

  it("rejects non-zip data and zips without a workbook", async () => {
    await expectCode(() => assertSafeXlsx(strToU8("not a zip at all")), "corrupt");
    await expectCode(() => assertSafeXlsx(zipSync({ "doc.xml": strToU8("<d/>") })), "corrupt");
  });
});

describe("csv parsing", () => {
  it("parses into a single sheet with typed values", () => {
    const workbook = parseCsv(strToU8("Name,Qty,Code\nApple,3,007\nPear,,x\n"));
    expect(workbook.sheets).toHaveLength(1);
    expect(workbook.sheets[0]).toEqual({
      name: "Sheet1",
      columns: 3,
      rows: [
        ["Name", "Qty", "Code"],
        ["Apple", 3, "007"],
        ["Pear", null, "x"],
      ],
    });
  });

  it("falls back to Windows-1252 for legacy files", () => {
    const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // "café" in cp1252
    expect(parseCsv(bytes).sheets[0].rows[0][0]).toBe("café");
  });

  it("enforces row and column limits", async () => {
    const limits = { maxRows: 2, maxColumns: 2, maxSheets: 1 };
    await expectCode(() => parseCsv(strToU8("1\n2\n3"), limits), "too_many_rows");
    await expectCode(() => parseCsv(strToU8("1,2,3"), limits), "too_many_columns");
    await expectCode(parseSpreadsheet("csv", new Uint8Array(0)), "empty_file");
  });
});

describe("xlsx parsing", () => {
  it("normalizes formulas, rich text, hyperlinks, dates and merges", async () => {
    const bytes = await buildWorkbook((workbook) => {
      const sheet = workbook.addWorksheet("Data");
      sheet.addRow(["Item", "Price", "Total", "When", "Link", "Note"]);
      sheet.addRow([
        "Widget",
        2.5,
        { formula: "B2*4", result: 10 },
        new Date(Date.UTC(2024, 4, 6)),
        { text: "Docs", hyperlink: "https://example.com" },
        { richText: [{ text: "<b>bold</b> " }, { text: "and plain" }] },
      ]);
      sheet.addRow(["Merged", null, null, true]);
      sheet.mergeCells("A3:C3");
      workbook.addWorksheet("Empty");
    });
    const workbook = await parseXlsx(bytes);
    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual(["Data", "Empty"]);
    const [data, empty] = workbook.sheets;
    expect(data.columns).toBe(6);
    expect(data.rows[1]).toEqual(["Widget", 2.5, 10, "2024-05-06", "Docs", "<b>bold</b> and plain"]);
    expect(data.rows[2]).toEqual(["Merged", null, null, true]);
    expect(data.merges).toEqual([{ top: 2, left: 0, bottom: 2, right: 2 }]);
    expect(empty.rows).toEqual([]);
  });

  it("enforces sheet and row limits", async () => {
    const bytes = await buildWorkbook((workbook) => {
      workbook.addWorksheet("A").addRows([[1], [2], [3]]);
      workbook.addWorksheet("B").addRows([[1]]);
    });
    await expectCode(parseXlsx(bytes, { maxRows: 100, maxColumns: 10, maxSheets: 1 }), "too_many_sheets");
    await expectCode(parseXlsx(bytes, { maxRows: 3, maxColumns: 10, maxSheets: 5 }), "too_many_rows");
  });

  it("rejects corrupt workbooks", async () => {
    await expectCode(parseXlsx(zipSync({ "xl/workbook.xml": strToU8("garbage") })), "corrupt");
  });
});
