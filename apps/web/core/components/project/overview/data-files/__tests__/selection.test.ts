/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { estimateColumnWidths, clampColumnWidth, MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from "../grid/layout";
import { getSelectionBounds, moveFocus, readSelection } from "../grid/selection";

const options = { rowCount: 100, columnCount: 10, jump: false, pageSize: 20 };

describe("grid selection", () => {
  it("normalizes bounds for any drag direction", () => {
    expect(getSelectionBounds({ anchor: { row: 5, column: 4 }, focus: { row: 2, column: 1 } })).toEqual({
      top: 2,
      bottom: 5,
      left: 1,
      right: 4,
    });
  });

  it("moves with arrows, clamps at edges and jumps with modifiers", () => {
    const origin = { row: 0, column: 0 };
    expect(moveFocus(origin, "ArrowUp", options)).toEqual(origin);
    expect(moveFocus(origin, "ArrowDown", options)).toEqual({ row: 1, column: 0 });
    expect(moveFocus(origin, "ArrowRight", { ...options, jump: true })).toEqual({ row: 0, column: 9 });
    expect(moveFocus({ row: 50, column: 5 }, "End", { ...options, jump: true })).toEqual({ row: 99, column: 9 });
    expect(moveFocus({ row: 50, column: 5 }, "Home", options)).toEqual({ row: 50, column: 0 });
    expect(moveFocus({ row: 90, column: 5 }, "PageDown", options)).toEqual({ row: 99, column: 5 });
    expect(moveFocus({ row: 10, column: 5 }, "PageUp", options)).toEqual({ row: 0, column: 5 });
  });

  it("reads the selected values through the view", () => {
    const rows = [
      ["h1", "h2"],
      [1, "a"],
      [2, "b"],
      [3, "c"],
    ];
    const view = Uint32Array.from([3, 1]);
    expect(readSelection(rows, view, { top: 0, bottom: 1, left: 0, right: 1 })).toEqual([
      [3, "c"],
      [1, "a"],
    ]);
    expect(readSelection(rows, view, { top: 0, bottom: 1, left: 0, right: 1 }, 2)).toHaveLength(1);
  });

  it("estimates and clamps column widths", () => {
    const widths = estimateColumnWidths([["id", "a much longer description column"]], 2);
    expect(widths[0]).toBeGreaterThanOrEqual(MIN_COLUMN_WIDTH);
    expect(widths[1]).toBeGreaterThan(widths[0]);
    expect(clampColumnWidth(5)).toBe(MIN_COLUMN_WIDTH);
    expect(clampColumnWidth(5000)).toBe(MAX_COLUMN_WIDTH);
  });
});
