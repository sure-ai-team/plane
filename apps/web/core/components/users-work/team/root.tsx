/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import type { TReportExportFormat, TTeamWorkFilters, TUserWorkSortField, TUserWorkStatus } from "@plane/types";
import { CustomSelect, Loader } from "@plane/ui";
import { cn } from "@plane/utils";
// components
import { ReportExportMenu } from "@/components/report-charts";
// hooks
import useDebounce from "@/hooks/use-debounce";
// services
import { userWorkService } from "@/services/user-work.service";
// local imports
import { PeriodSelect, ProjectFilter, useUrlFilters } from "../common/filters";
import { LoadError, StatTile } from "../common/primitives";
import {
  ROLES,
  STATUSES,
  TEAM_PAGE_SIZE,
  exportLabels,
  nextSort,
  parseTeamFilters,
  roleLabelKey,
  teamParams,
} from "../helpers";
import { TeamRow } from "./row";

const COLUMNS: { key: TUserWorkSortField | "status" | "cycles"; isNumber?: boolean; isSortable: boolean }[] = [
  { key: "name", isSortable: true },
  { key: "role", isSortable: true },
  { key: "status", isSortable: false },
  { key: "open", isNumber: true, isSortable: true },
  { key: "in_progress", isNumber: true, isSortable: true },
  { key: "overdue", isNumber: true, isSortable: true },
  { key: "done", isNumber: true, isSortable: true },
  { key: "projects", isNumber: true, isSortable: true },
  { key: "cycles", isSortable: false },
  { key: "last_activity_at", isSortable: true },
];

type SearchBoxProps = { value: string; onChange: (value: string) => void };

/** Keeps typing local and writes the URL when the typing pauses. */
function SearchBox({ value, onChange }: SearchBoxProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(value);
  const debounced = useDebounce(query, 400).trim();
  // Last value shared with the URL, to tell typing from a URL that changed on its own.
  const shared = useRef(value);
  const write = useRef(onChange);

  useEffect(() => {
    write.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (debounced === shared.current) return;
    shared.current = debounced;
    write.current(debounced);
  }, [debounced]);

  // Back button or "clear filters".
  useEffect(() => {
    if (value === shared.current) return;
    shared.current = value;
    setQuery(value);
  }, [value]);

  return (
    <label className="flex h-8 min-w-48 flex-1 items-center gap-2 rounded-md border border-subtle px-2 sm:max-w-72">
      <Search className="size-3.5 flex-shrink-0 text-tertiary" aria-hidden="true" />
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("users_work.filters.search")}
        aria-label={t("users_work.filters.search")}
        maxLength={100}
        className="w-full bg-transparent text-13 outline-none placeholder:text-placeholder"
      />
    </label>
  );
}

type Props = { workspaceSlug: string };

export function TeamWorkRoot({ workspaceSlug }: Props) {
  const { t } = useTranslation();
  const { searchParams, setParams } = useUrlFilters();
  const filters = parseTeamFilters(searchParams);
  const params = teamParams(filters);

  const { data, error, isLoading, mutate } = useSWR(
    ["USERS_WORK_TEAM", workspaceSlug, JSON.stringify(params), filters.page],
    () => userWorkService.team(workspaceSlug, { ...params, page: filters.page, per_page: TEAM_PAGE_SIZE }),
    { keepPreviousData: true }
  );

  // Any other filter than the page starts again at the first page.
  const update = (changes: Record<string, string | null>) => setParams({ page: null, ...changes });

  const updateSort = (field: TUserWorkSortField) => {
    const next = nextSort(filters, field);
    update({ sort: next.sort, direction: next.direction });
  };

  const isFiltered =
    Boolean(filters.search) ||
    filters.roles.length > 0 ||
    filters.projects.length > 0 ||
    filters.statuses.join() !== "active";

  const clear = () => update({ search: null, role: null, project: null, status: null });

  const exportTeam = (format: TReportExportFormat) =>
    userWorkService.exportTeam(workspaceSlug, { ...params, format }, exportLabels(t));

  const base = `/${workspaceSlug}/users`;
  const totals = data?.totals;

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-y-auto px-4 py-4 md:px-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t("users_work.totals.members")} value={totals?.members ?? "–"} />
        <StatTile
          label={t("users_work.totals.overdue")}
          value={totals?.overdue ?? "–"}
          isAlert={Boolean(totals?.overdue)}
          href={`${base}?sort=overdue&direction=desc`}
        />
        <StatTile
          label={t("users_work.totals.unassigned")}
          value={totals?.unassigned ?? "–"}
          href={`${base}?view=unassigned`}
        />
        <StatTile
          label={t("users_work.totals.orphaned")}
          value={totals?.orphaned ?? "–"}
          isAlert={Boolean(totals?.orphaned)}
          href={`${base}?view=orphaned`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={filters.search} onChange={(search) => update({ search: search || null })} />
        <CustomSelect
          value={filters.roles[0] ?? "all"}
          onChange={(role: string) => update({ role: role === "all" ? null : role })}
          label={
            filters.roles.length > 0
              ? filters.roles.map((role) => t(roleLabelKey(Number(role)))).join(", ")
              : t("users_work.filters.all_roles")
          }
          buttonClassName="h-8"
          input
        >
          <CustomSelect.Option value="all">{t("users_work.filters.all_roles")}</CustomSelect.Option>
          {ROLES.map((role) => (
            <CustomSelect.Option key={role} value={role}>
              {t(roleLabelKey(Number(role)))}
            </CustomSelect.Option>
          ))}
        </CustomSelect>
        <CustomSelect
          value={filters.statuses[0]}
          onChange={(status: TUserWorkStatus) => update({ status: status === "active" ? null : status })}
          label={filters.statuses.map((status) => t(`users_work.status.${status}`)).join(", ")}
          buttonClassName="h-8"
          input
        >
          {STATUSES.map((status) => (
            <CustomSelect.Option key={status} value={status}>
              {t(`users_work.status.${status}`)}
            </CustomSelect.Option>
          ))}
        </CustomSelect>
        <ProjectFilter value={filters.projects} onChange={(ids) => update({ project: ids.join(",") || null })} />
        <PeriodSelect value={filters.period} onChange={(period) => update({ period: String(period) })} />
        {isFiltered && (
          <Button variant="ghost" onClick={clear}>
            {t("users_work.filters.clear")}
          </Button>
        )}
        <div className="ml-auto">
          <ReportExportMenu onExport={exportTeam} disabled={!data || data.total === 0} />
        </div>
      </div>

      {error && !data ? (
        <LoadError onRetry={() => void mutate()} />
      ) : !data ? (
        <Loader className="space-y-2">
          {Array.from({ length: 8 }, (_, index) => (
            <Loader.Item key={index} height="44px" />
          ))}
        </Loader>
      ) : data.results.length === 0 ? (
        <p className="py-16 text-center text-13 text-tertiary">{t("users_work.list.empty")}</p>
      ) : (
        <TeamTable
          workspaceSlug={workspaceSlug}
          filters={filters}
          rows={data.results}
          isRefreshing={isLoading}
          onSort={updateSort}
        />
      )}

      {data && data.total > data.per_page && (
        <div className="flex items-center justify-end gap-3 text-12 text-tertiary">
          <span className="tabular-nums">
            {t("users_work.list.range", {
              from: (data.page - 1) * data.per_page + 1,
              to: Math.min(data.page * data.per_page, data.total),
              total: data.total,
            })}
          </span>
          <Button
            variant="secondary"
            disabled={data.page <= 1}
            onClick={() => setParams({ page: String(data.page - 1) })}
          >
            {t("users_work.list.previous")}
          </Button>
          <Button
            variant="secondary"
            disabled={!data.has_more}
            onClick={() => setParams({ page: String(data.page + 1) })}
          >
            {t("users_work.list.next")}
          </Button>
        </div>
      )}
    </div>
  );
}

type TableProps = {
  workspaceSlug: string;
  filters: TTeamWorkFilters;
  rows: React.ComponentProps<typeof TeamRow>["row"][];
  isRefreshing: boolean;
  onSort: (field: TUserWorkSortField) => void;
};

function TeamTable({ workspaceSlug, filters, rows, isRefreshing, onSort }: TableProps) {
  const { t } = useTranslation();
  return (
    <div
      className={cn("flex-shrink-0 overflow-x-auto rounded-lg border border-subtle", { "opacity-60": isRefreshing })}
    >
      <table className="w-full min-w-[920px] text-13">
        <thead className="border-b border-subtle bg-layer-1">
          <tr>
            {COLUMNS.map(({ key, isNumber, isSortable }) => {
              const label = t(`users_work.columns.${key}`);
              const isSorted = filters.sort === key;
              return (
                <th
                  key={key}
                  scope="col"
                  aria-sort={isSorted ? (filters.direction === "asc" ? "ascending" : "descending") : undefined}
                  className={cn("px-3 py-2 font-medium whitespace-nowrap text-tertiary", {
                    "text-right": isNumber,
                    "text-left": !isNumber,
                  })}
                >
                  {isSortable ? (
                    <button
                      type="button"
                      onClick={() => onSort(key as TUserWorkSortField)}
                      aria-label={t("users_work.list.sort_by", { column: label })}
                      className={cn("inline-flex items-center gap-1 hover:text-primary", { "text-primary": isSorted })}
                    >
                      {label}
                      {isSorted &&
                        (filters.direction === "asc" ? (
                          <ArrowUp className="size-3" aria-hidden="true" />
                        ) : (
                          <ArrowDown className="size-3" aria-hidden="true" />
                        ))}
                    </button>
                  ) : (
                    label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <TeamRow key={row.id} workspaceSlug={workspaceSlug} row={row} period={filters.period} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
