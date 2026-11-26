/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef } from "react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";

type Props = {
  sheets: { name: string }[];
  activeSheet: number;
  onChange: (index: number) => void;
};

/** Excel-style sheet tabs along the bottom edge. */
export function SpreadsheetSheetTabs({ sheets, activeSheet, onChange }: Props) {
  const { t } = useTranslation();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const focusTab = (index: number) => {
    const next = (index + sheets.length) % sheets.length;
    onChange(next);
    tabRefs.current[next]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowRight") focusTab(index + 1);
    else if (event.key === "ArrowLeft") focusTab(index - 1);
    else if (event.key === "Home") focusTab(0);
    else if (event.key === "End") focusTab(sheets.length - 1);
    else return;
    event.preventDefault();
  };

  return (
    <div
      role="tablist"
      aria-label={t("spreadsheet.viewer.sheets")}
      className="horizontal-scrollbar flex scrollbar-xs min-w-0 flex-1 items-end gap-0.5 overflow-x-auto"
    >
      {sheets.map((sheet, index) => {
        const isActive = index === activeSheet;
        return (
          <button
            // workbook sheet names are unique
            key={sheet.name}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(index)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "relative max-w-48 flex-shrink-0 truncate rounded-b-md border border-t-0 px-3 py-1.5 text-12 transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-accent-strong focus-visible:ring-inset",
              isActive
                ? "-mt-px border-subtle bg-surface-1 font-semibold text-primary"
                : "border-transparent text-tertiary hover:bg-layer-1-hover hover:text-secondary"
            )}
            title={sheet.name}
          >
            {isActive && (
              <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent-primary" aria-hidden />
            )}
            {sheet.name}
          </button>
        );
      })}
    </div>
  );
}
