/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { forwardRef } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Tooltip } from "@plane/propel/tooltip";
import { cn } from "@plane/utils";
// local imports
import { createNumberFormatter } from "../helpers/format";

type Props = {
  value: string;
  onChange: (value: string) => void;
  matchCount: number;
  activeIndex: number;
  isSearching: boolean;
  truncated: boolean;
  onNext: () => void;
  onPrevious: () => void;
  onEscape: () => void;
};

const navButtonClassName =
  "flex size-6 items-center justify-center rounded-md text-tertiary transition-colors duration-150 outline-none hover:bg-layer-transparent-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-accent-strong disabled:pointer-events-none disabled:opacity-40";

/** Find-in-sheet box: Enter / Shift+Enter cycle through matches. */
export const SpreadsheetSearchBox = forwardRef<HTMLInputElement, Props>(function SpreadsheetSearchBox(props, ref) {
  const { value, onChange, matchCount, activeIndex, isSearching, truncated, onNext, onPrevious, onEscape } = props;
  const { t, currentLocale } = useTranslation();
  const format = createNumberFormatter(currentLocale, 0);
  const hasTerm = value.trim().length > 0;

  return (
    <div
      className={cn(
        "flex h-7 w-full max-w-80 min-w-0 items-center gap-1 rounded-md border border-subtle bg-surface-1 pr-0.5 pl-2 transition-colors duration-150 focus-within:border-accent-strong"
      )}
      role="search"
    >
      <Search className="size-3.5 flex-shrink-0 text-placeholder" aria-hidden />
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) onPrevious();
            else onNext();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onEscape();
          }
        }}
        placeholder={t("spreadsheet.viewer.search_placeholder")}
        aria-label={t("spreadsheet.viewer.search_placeholder")}
        className="h-full min-w-0 flex-1 bg-transparent text-13 text-primary outline-none placeholder:text-placeholder"
      />
      {hasTerm && (
        <span
          className={cn(
            "flex-shrink-0 text-11 whitespace-nowrap text-tertiary tabular-nums",
            isSearching && "opacity-60"
          )}
          aria-live="polite"
          title={truncated ? t("spreadsheet.viewer.matches_truncated", { limit: format(matchCount) }) : undefined}
        >
          {matchCount > 0
            ? t("spreadsheet.viewer.match_count", {
                current: format(activeIndex + 1),
                total: `${format(matchCount)}${truncated ? "+" : ""}`,
              })
            : isSearching
              ? "…"
              : t("spreadsheet.viewer.no_matches")}
        </span>
      )}
      {hasTerm && (
        <>
          <Tooltip tooltipContent={t("spreadsheet.viewer.previous_match")}>
            <button
              type="button"
              className={navButtonClassName}
              onClick={onPrevious}
              disabled={matchCount === 0}
              aria-label={t("spreadsheet.viewer.previous_match")}
            >
              <ChevronUp className="size-3.5" aria-hidden />
            </button>
          </Tooltip>
          <Tooltip tooltipContent={t("spreadsheet.viewer.next_match")}>
            <button
              type="button"
              className={navButtonClassName}
              onClick={onNext}
              disabled={matchCount === 0}
              aria-label={t("spreadsheet.viewer.next_match")}
            >
              <ChevronDown className="size-3.5" aria-hidden />
            </button>
          </Tooltip>
          <button
            type="button"
            className={navButtonClassName}
            onClick={() => onChange("")}
            aria-label={t("spreadsheet.viewer.clear_search")}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </>
      )}
    </div>
  );
});
