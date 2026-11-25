/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type {
  TStateGroups,
  TTeamWorkFilters,
  TUserWorkExportLabels,
  TUserWorkFilters,
  TUserWorkFocus,
  TUserWorkPeriod,
  TUserWorkSortField,
  TUserWorkStatus,
} from "@plane/types";

type TTranslate = (key: string, params?: Record<string, unknown>) => string;
type TParamReader = { get: (name: string) => string | null };

export const PERIODS: TUserWorkPeriod[] = [7, 30, 90];
export const DEFAULT_PERIOD: TUserWorkPeriod = 30;
export const STATUSES: TUserWorkStatus[] = ["active", "suspended", "invited"];
export const ROLES = ["20", "15", "5"];
export const FOCUSES: TUserWorkFocus[] = ["overdue", "due_soon", "stuck", "no_due_date"];
export const TEAM_PAGE_SIZE = 50;

/** Order in which work is listed: what is being done now comes first. */
export const STATE_GROUP_ORDER: TStateGroups[] = ["started", "unstarted", "backlog", "completed", "cancelled"];
export const OPEN_STATE_GROUPS: TStateGroups[] = ["started", "unstarted", "backlog"];

const SORT_FIELDS: TUserWorkSortField[] = [
  "name",
  "role",
  "projects",
  "open",
  "in_progress",
  "overdue",
  "done",
  "last_activity_at",
];

const ROLE_KEYS: Record<number, string> = {
  20: "users_work.role.admin",
  15: "users_work.role.member",
  5: "users_work.role.guest",
};

export const roleLabelKey = (role: number): string => ROLE_KEYS[role] ?? "users_work.role.member";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// The URL can be edited by hand, so unknown values fall back to the defaults instead of failing.
const readList = <T extends string>(value: string | null, allowed: readonly T[]): T[] =>
  (value ?? "").split(",").filter((entry): entry is T => (allowed as readonly string[]).includes(entry));

const readChoice = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T =>
  allowed.find((entry) => entry === value) ?? fallback;

const readProjects = (value: string | null) => (value ?? "").split(",").filter((entry) => UUID.test(entry));

const readPeriod = (value: string | null): TUserWorkPeriod =>
  PERIODS.find((period) => String(period) === value) ?? DEFAULT_PERIOD;

const readDate = (value: string | null) =>
  value && DATE.test(value) && !Number.isNaN(Date.parse(value)) ? value : null;

export const parseTeamFilters = (params: TParamReader): TTeamWorkFilters => {
  const page = Number(params.get("page"));
  const statuses = readList(params.get("status"), STATUSES);
  return {
    search: params.get("search") ?? "",
    roles: readList(params.get("role"), ROLES),
    statuses: statuses.length > 0 ? statuses : ["active"],
    projects: readProjects(params.get("project")),
    period: readPeriod(params.get("period")),
    sort: readChoice(params.get("sort"), SORT_FIELDS, "name"),
    direction: readChoice(params.get("direction"), ["asc", "desc"], "asc"),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
};

export const parseUserFilters = (params: TParamReader): TUserWorkFilters => {
  const focus = params.get("focus");
  return {
    projects: readProjects(params.get("project")),
    period: readPeriod(params.get("period")),
    focus: FOCUSES.find((entry) => entry === focus) ?? null,
    layout: readChoice(params.get("layout"), ["list", "board"], "list"),
    start: readDate(params.get("start")),
    end: readDate(params.get("end")),
  };
};

/** Query parameters of the API. Defaults are left out, so the URL stays short. */
export const teamParams = (filters: TTeamWorkFilters): Record<string, string | number> => ({
  ...(filters.search.trim() ? { search: filters.search.trim() } : {}),
  ...(filters.roles.length > 0 ? { role: filters.roles.join(",") } : {}),
  status: filters.statuses.join(","),
  ...(filters.projects.length > 0 ? { project: filters.projects.join(",") } : {}),
  period: filters.period,
  sort: filters.sort,
  direction: filters.direction,
});

export const userParams = (filters: TUserWorkFilters): Record<string, string | number> => ({
  ...(filters.projects.length > 0 ? { project: filters.projects.join(",") } : {}),
  period: filters.period,
});

/** Next direction when a column header is clicked: numbers start with the highest, names with A. */
export const nextSort = (
  filters: Pick<TTeamWorkFilters, "sort" | "direction">,
  field: TUserWorkSortField
): Pick<TTeamWorkFilters, "sort" | "direction"> => {
  if (filters.sort === field) return { sort: field, direction: filters.direction === "asc" ? "desc" : "asc" };
  return { sort: field, direction: field === "name" ? "asc" : "desc" };
};

export const percentage = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** Plain text of a comment: shown as text, never as HTML. */
export const commentText = (html: string | null | undefined): string => {
  if (!html) return "";
  const text = new DOMParser().parseFromString(html.replace(/<\/(p|li|h\d|div)>|<br\s*\/?>/gi, " $&"), "text/html").body
    .textContent;
  return (text ?? "").replace(/\s+/g, " ").trim();
};

const EXPORT_COLUMNS = [
  "name",
  "email",
  "role",
  "status",
  "projects",
  "open",
  "in_progress",
  "overdue",
  "due_soon",
  "stuck",
  "no_due_date",
  "done",
  "cycles",
  "last_activity_at",
  "key",
  "project",
  "state",
  "priority",
  "start_date",
  "target_date",
  "completed_at",
  "updated_at",
  "is_overdue",
  "created_at",
  "item",
  "action",
  "field",
  "old_value",
  "new_value",
  "yes",
];

/** Translated headers and values for exported files. */
export const exportLabels = (t: TTranslate): TUserWorkExportLabels => ({
  ...Object.fromEntries(EXPORT_COLUMNS.map((column) => [column, t(`users_work.columns.${column}`)])),
  ...Object.fromEntries(ROLES.map((role) => [`role_${role}`, t(roleLabelKey(Number(role)))])),
  ...Object.fromEntries(STATUSES.map((status) => [`status_${status}`, t(`users_work.status.${status}`)])),
  ...Object.fromEntries(
    ["urgent", "high", "medium", "low", "none"].map((value) => [`priority_${value}`, t(`reports.values.${value}`)])
  ),
});
