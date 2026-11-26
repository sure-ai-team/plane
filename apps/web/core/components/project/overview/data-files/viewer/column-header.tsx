/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Calendar, Hash, ListFilter, ToggleLeft, Type, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Popover } from "@plane/propel/popover";
import { cn } from "@plane/utils";
// local imports
import type { TColumnType } from "../helpers/detect";
import { createNumberFormatter } from "../helpers/format";
import type { TSortDirection, TSpreadsheetFilter, TSpreadsheetSort } from "../helpers/query";
import type { TColumnStats } from "../helpers/stats";
import { getSpreadsheetWorkerClient } from "../worker/client";
import type { TViewQuery } from "../worker/protocol";
import { FilterForm } from "./filter-form";

export const COLUMN_TYPE_ICONS: Record<TColumnType, LucideIcon> = {
  text: Type,
  number: Hash,
  date: Calendar,
  boolean: ToggleLeft,
};

type Props = {
  column: number;
  letter: string;
  title: string | null;
  type: TColumnType;
  sort: TSpreadsheetSort;
  hasFilter: boolean;
  query: TViewQuery | null;
  onSort: (direction: TSortDirection | null) => void;
  onAddFilter: (filter: Omit<TSpreadsheetFilter, "id">) => void;
};

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <dt className="text-12 text-tertiary">{label}</dt>
      <dd className="truncate text-12 font-medium text-primary tabular-nums">{value}</dd>
    </div>
  );
}

export function SpreadsheetColumnHeader(props: Props) {
  const { column, letter, title, type, sort, hasFilter, query, onSort, onAddFilter } = props;
  const { t, currentLocale } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [stats, setStats] = useState<TColumnStats | null>(null);
  const [isFiltering, setIsFiltering] = useState(false);

  const TypeIcon = COLUMN_TYPE_ICONS[type];
  const sortDirection = sort && sort.column === column ? sort.direction : null;
  const format = createNumberFormatter(currentLocale, 4);

  useEffect(() => {
    if (!isOpen || !query) return;
    let cancelled = false;
    setStats(null);
    getSpreadsheetWorkerClient()
      .request("column-stats", { ...query, column })
      .then((result) => !cancelled && setStats(result))
      .catch(() => !cancelled && setStats(null));
    return () => {
      cancelled = true;
    };
  }, [isOpen, query, column]);

  useEffect(() => {
    if (!isOpen) setIsFiltering(false);
  }, [isOpen]);

  const label = title ? `${letter} · ${title}` : letter;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Button
        aria-label={t("spreadsheet.column.menu", { column: label })}
        className={cn(
          "flex size-full min-w-0 flex-col justify-center gap-0.5 px-2 text-left transition-colors duration-150 outline-none hover:bg-layer-1-hover focus-visible:bg-layer-1-hover focus-visible:ring-2 focus-visible:ring-accent-strong focus-visible:ring-inset",
          isOpen && "bg-layer-1-active"
        )}
      >
        <span className="flex w-full items-center gap-1 text-11 text-tertiary">
          <TypeIcon className="size-3 flex-shrink-0" aria-hidden />
          <span className="font-medium">{letter}</span>
          <span className="ml-auto flex items-center gap-0.5">
            {hasFilter && <ListFilter className="size-3 text-accent-primary" aria-hidden />}
            {sortDirection === "asc" && <ArrowUp className="size-3 text-accent-primary" aria-hidden />}
            {sortDirection === "desc" && <ArrowDown className="size-3 text-accent-primary" aria-hidden />}
          </span>
        </span>
        {title !== null && (
          <span className="w-full truncate text-12 font-semibold text-primary" title={title}>
            {title || " "}
          </span>
        )}
      </Popover.Button>
      <Popover.Panel
        positionerClassName="z-50"
        side="bottom"
        align="start"
        sideOffset={4}
        className="w-64 rounded-lg border-[0.5px] border-strong bg-surface-1 p-3 shadow-raised-200 outline-none"
      >
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex size-6 flex-shrink-0 items-center justify-center rounded-md bg-layer-1 text-secondary">
            <TypeIcon className="size-3.5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-13 font-semibold text-primary">{title || letter}</p>
            <p className="text-11 text-tertiary">
              {letter} · {t(`spreadsheet.column.types.${type}`)}
            </p>
          </div>
        </div>

        <dl className="mt-3 min-h-[76px] rounded-md bg-layer-1 px-2.5 py-1.5" aria-live="polite">
          {stats ? (
            <>
              <StatRow label={t("spreadsheet.column.stats.count")} value={format(stats.filled)} />
              <StatRow label={t("spreadsheet.column.stats.empty")} value={format(stats.empty)} />
              <StatRow label={t("spreadsheet.column.stats.distinct")} value={format(stats.distinct)} />
              {stats.numeric && (
                <>
                  <div className="my-1 border-t border-subtle" />
                  <StatRow label={t("spreadsheet.column.stats.sum")} value={format(stats.numeric.sum)} />
                  <StatRow label={t("spreadsheet.column.stats.avg")} value={format(stats.numeric.avg)} />
                  <StatRow label={t("spreadsheet.column.stats.min")} value={format(stats.numeric.min)} />
                  <StatRow label={t("spreadsheet.column.stats.max")} value={format(stats.numeric.max)} />
                </>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-1.5 py-1" aria-hidden>
              {[0, 1, 2].map((index) => (
                <div key={index} className="h-3.5 animate-pulse rounded-sm bg-layer-3" />
              ))}
            </div>
          )}
        </dl>

        <div className="mt-3 flex flex-col gap-0.5">
          {(
            [
              { direction: "asc", icon: ArrowUp, label: t("spreadsheet.column.sort_asc") },
              { direction: "desc", icon: ArrowDown, label: t("spreadsheet.column.sort_desc") },
            ] as const
          ).map((item) => (
            <button
              key={item.direction}
              type="button"
              onClick={() => {
                onSort(item.direction);
                setIsOpen(false);
              }}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-13 text-secondary transition-colors duration-150 outline-none hover:bg-layer-transparent-hover focus-visible:bg-layer-transparent-hover",
                sortDirection === item.direction && "font-medium text-accent-primary"
              )}
            >
              <item.icon className="size-3.5" aria-hidden />
              {item.label}
            </button>
          ))}
          {sortDirection && (
            <button
              type="button"
              onClick={() => {
                onSort(null);
                setIsOpen(false);
              }}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-13 text-secondary transition-colors duration-150 outline-none hover:bg-layer-transparent-hover focus-visible:bg-layer-transparent-hover"
            >
              <X className="size-3.5" aria-hidden />
              {t("spreadsheet.column.clear_sort")}
            </button>
          )}
          {isFiltering ? (
            <div className="mt-1 border-t border-subtle pt-2">
              <FilterForm
                type={type}
                onCancel={() => setIsFiltering(false)}
                onSubmit={(operator, value) => {
                  onAddFilter({ column, operator, value });
                  setIsOpen(false);
                }}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsFiltering(true)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-13 text-secondary transition-colors duration-150 outline-none hover:bg-layer-transparent-hover focus-visible:bg-layer-transparent-hover"
            >
              <ListFilter className="size-3.5" aria-hidden />
              {t("spreadsheet.column.add_filter")}
            </button>
          )}
        </div>
      </Popover.Panel>
    </Popover>
  );
}
