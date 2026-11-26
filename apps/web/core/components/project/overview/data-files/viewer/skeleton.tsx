/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

const WIDTHS = [72, 54, 88, 40, 64, 80, 48, 70];

/** Grid-shaped loading placeholder. */
export function SpreadsheetGridSkeleton({ label }: { label: string }) {
  return (
    <div className="relative size-full overflow-hidden" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="flex h-[30px] border-b border-subtle bg-layer-1" aria-hidden>
        <div className="w-11 flex-shrink-0 border-r border-subtle" />
        {Array.from({ length: 8 }, (_header, column) => (
          <div key={column} className="flex w-36 flex-shrink-0 items-center border-r border-subtle px-2">
            <div className="h-2.5 w-6 animate-pulse rounded-sm bg-layer-3" />
          </div>
        ))}
      </div>
      {Array.from({ length: 18 }, (_row, row) => (
        <div key={row} className="flex h-[26px] border-b border-subtle" aria-hidden>
          <div className="flex w-11 flex-shrink-0 items-center justify-end border-r border-subtle bg-layer-1 pr-2">
            <div className="h-2 w-3 animate-pulse rounded-sm bg-layer-3" />
          </div>
          {Array.from({ length: 8 }, (_cell, column) => (
            <div key={column} className="flex w-36 flex-shrink-0 items-center border-r border-subtle px-2">
              <div
                className="h-2.5 animate-pulse rounded-sm bg-layer-2"
                style={{
                  width: `${WIDTHS[(row + column * 3) % WIDTHS.length]}%`,
                  animationDelay: `${(row % 6) * 80}ms`,
                }}
              />
            </div>
          ))}
        </div>
      ))}
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-surface-1 to-transparent" aria-hidden />
    </div>
  );
}
