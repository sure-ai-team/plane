/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useTranslation } from "@plane/i18n";
// local imports
import { columnLetter } from "../helpers/cells";
import { VALUELESS_OPERATORS } from "../helpers/query";
import type { TSpreadsheetFilter, TSpreadsheetSort } from "../helpers/query";

type Props = {
  filters: TSpreadsheetFilter[];
  sort: TSpreadsheetSort;
  getColumnTitle: (column: number) => string | null;
  onRemoveFilter: (id: string) => void;
  onClearSort: () => void;
  onClearAll: () => void;
};

const chipClassName =
  "inline-flex max-w-72 items-center gap-1 rounded-full border border-subtle bg-layer-1 py-0.5 pr-0.5 pl-2.5 text-12 text-secondary animate-fade-in";

const removeClassName =
  "flex size-5 flex-shrink-0 items-center justify-center rounded-full text-tertiary transition-colors duration-150 outline-none hover:bg-layer-1-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-accent-strong";

/** Active sort + filters as removable chips under the toolbar. */
export function SpreadsheetFilterBar({
  filters,
  sort,
  getColumnTitle,
  onRemoveFilter,
  onClearSort,
  onClearAll,
}: Props) {
  const { t } = useTranslation();
  if (filters.length === 0 && !sort) return null;

  const columnName = (column: number) => getColumnTitle(column) || columnLetter(column);

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 border-b border-subtle px-4 py-2"
      aria-label={t("spreadsheet.filter.active")}
    >
      {sort && (
        <span className={chipClassName}>
          {sort.direction === "asc" ? (
            <ArrowUp className="size-3" aria-hidden />
          ) : (
            <ArrowDown className="size-3" aria-hidden />
          )}
          <span className="truncate">
            <span className="font-medium text-primary">{columnName(sort.column)}</span>{" "}
            {t(sort.direction === "asc" ? "spreadsheet.column.sorted_asc" : "spreadsheet.column.sorted_desc")}
          </span>
          <button
            type="button"
            className={removeClassName}
            onClick={onClearSort}
            aria-label={t("spreadsheet.column.clear_sort")}
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      )}
      {filters.map((filter) => (
        <span key={filter.id} className={chipClassName}>
          <span className="truncate">
            <span className="font-medium text-primary">{columnName(filter.column)}</span>{" "}
            {t(`spreadsheet.filter.operators.${filter.operator}`)}
            {!VALUELESS_OPERATORS.includes(filter.operator) && (
              <>
                {" "}
                <span className="font-medium text-primary">{filter.value}</span>
              </>
            )}
          </span>
          <button
            type="button"
            className={removeClassName}
            onClick={() => onRemoveFilter(filter.id)}
            aria-label={t("spreadsheet.filter.remove")}
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      {filters.length + (sort ? 1 : 0) > 1 && (
        <button
          type="button"
          onClick={onClearAll}
          className="rounded-md px-1.5 py-0.5 text-12 text-tertiary transition-colors duration-150 outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-accent-strong"
        >
          {t("spreadsheet.filter.clear_all")}
        </button>
      )}
    </div>
  );
}
