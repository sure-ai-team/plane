/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { cn } from "@plane/utils";
import type { TSpreadsheetPreview } from "./helpers/preview";
import { getSpreadsheetKind } from "./helpers/validation";

type Props = {
  preview: TSpreadsheetPreview | undefined;
  name: string;
  type?: string;
};

const PLACEHOLDER_WIDTHS = [
  [70, 45, 60, 35],
  [55, 70, 40, 50],
  [80, 35, 55, 65],
  [45, 60, 70, 40],
  [65, 50, 45, 55],
];

/** A miniature of the first cells, or a file-type placeholder until the file has been read once. */
export function SpreadsheetFilePreview({ preview, name, type }: Props) {
  const kind = getSpreadsheetKind(name, type);
  const accent = kind === "csv" ? "bg-accent-primary" : "bg-success-primary";

  if (!preview || preview.cells.length === 0) {
    return (
      <div className="relative h-full overflow-hidden bg-layer-1 p-3" aria-hidden>
        <div className="grid grid-cols-4 gap-x-2 gap-y-2.5 opacity-70">
          {PLACEHOLDER_WIDTHS.map((row, rowIndex) =>
            row.map((width, column) => (
              <div
                // oxlint-disable-next-line react/no-array-index-key
                key={`${rowIndex}-${column}`}
                className={cn("h-1.5 rounded-full", rowIndex === 0 ? `${accent} opacity-40` : "bg-layer-3")}
                style={{ width: `${width}%` }}
              />
            ))
          )}
        </div>
        <span className="absolute right-2.5 bottom-2 rounded-sm bg-surface-1 px-1.5 py-0.5 text-10 font-semibold tracking-wide text-tertiary uppercase shadow-raised-100">
          {kind ?? "file"}
        </span>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-hidden bg-surface-1" aria-hidden>
      <table className="w-full table-fixed border-collapse text-[10px] leading-4">
        <tbody>
          {preview.cells.map((row, rowIndex) => (
            // oxlint-disable-next-line react/no-array-index-key
            <tr key={rowIndex} className={rowIndex === 0 ? "bg-layer-1 font-semibold text-secondary" : "text-tertiary"}>
              {row.map((cell, column) => (
                <td
                  // oxlint-disable-next-line react/no-array-index-key
                  key={column}
                  className={cn(
                    "truncate border-r border-b border-subtle px-1.5 py-0.5",
                    rowIndex > 0 && preview.numericColumns[column] && "text-right tabular-nums"
                  )}
                >
                  {cell || " "}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface-1 to-transparent" />
    </div>
  );
}
