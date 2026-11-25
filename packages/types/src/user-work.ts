/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { IIssueActivity } from "./issues/issue";
import type { TIssuePriorities } from "./issues";
import type { TLogoProps } from "./common";
import type { TStateGroups } from "./state";

/** Days counted as "recently done". */
export type TUserWorkPeriod = 7 | 30 | 90;

export type TUserWorkStatus = "active" | "suspended" | "invited";

export type TUserWorkSortField =
  | "name"
  | "role"
  | "projects"
  | "open"
  | "in_progress"
  | "overdue"
  | "done"
  | "last_activity_at";

export type TUserWorkSortDirection = "asc" | "desc";

export type TUserWorkFocus = "overdue" | "due_soon" | "stuck" | "no_due_date";

export type TUserWorkBucket = "unassigned" | "orphaned";

/** Numbers of one person, or of one person in one project. */
export type TUserWorkCounts = {
  open: number;
  in_progress: number;
  overdue: number;
  due_soon: number;
  stuck: number;
  no_due_date: number;
  done: number;
};

export type TUserWorkPage<T> = {
  results: T[];
  total: number;
  page: number;
  per_page: number;
  has_more: boolean;
};

export type TUserWorkPerson = {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string;
  email: string;
  avatar_url: string | null;
  name: string;
  role: number;
  status: TUserWorkStatus;
  joined_at: string;
  last_activity_at: string | null;
};

export type TTeamWorkRow = TUserWorkPerson &
  TUserWorkCounts & {
    projects: number;
    cycles: { id: string; name: string; project_id: string }[];
    /** Cycles of private projects the viewer has not joined. */
    hidden_cycles: number;
  };

export type TTeamWorkTotals = {
  members: number;
  overdue: number;
  unassigned: number;
  orphaned: number;
};

export type TTeamWorkResponse = TUserWorkPage<TTeamWorkRow> & {
  period: TUserWorkPeriod;
  totals: TTeamWorkTotals;
};

/** A private project the viewer has not joined: only the number of its work items is known. */
export type TUserWorkHiddenProject = {
  project_id: string;
  project_name: string;
  count: number;
};

export type TUserWorkItem = {
  id: string;
  name: string;
  sequence_id: number;
  priority: TIssuePriorities;
  start_date: string | null;
  target_date: string | null;
  completed_at: string | null;
  updated_at: string;
  project_id: string;
  project_identifier: string;
  project_name: string;
  state_id: string | null;
  state_name: string | null;
  state_color: string | null;
  state_group: TStateGroups | null;
  assignee_ids: string[];
  is_overdue: boolean;
  is_stuck: boolean;
  /** The viewer is a member of the project. */
  can_open: boolean;
};

export type TUserWorkItemsResponse = TUserWorkPage<TUserWorkItem> & {
  hidden_projects: TUserWorkHiddenProject[];
};

export type TUserWorkProject = TUserWorkCounts & {
  id: string;
  name: string;
  identifier: string;
  logo_props: TLogoProps;
  /** Project role, or null when the person is no longer a member. */
  role: number | null;
  can_read: boolean;
  can_open: boolean;
};

export type TUserWorkSummary = {
  user: TUserWorkPerson & { timezone: string; cover_image_url: string | null };
  period: TUserWorkPeriod;
  stats: TUserWorkCounts & { on_time: number; on_time_total: number };
  state_groups: Record<TStateGroups, number>;
  projects: TUserWorkProject[];
  trend: { week: string; completed: number }[];
  attention: { items: TUserWorkItem[]; total: number; hidden: number };
};

export type TUserWorkCycle = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  days_left: number | null;
  days_to_start: number | null;
  project_id: string;
  project_name: string;
  project_identifier: string;
  project_logo_props: TLogoProps;
  can_open: boolean;
  total: number;
  done: number;
  in_progress: number;
  not_started: number;
  cancelled: number;
  overdue: number;
  points: number;
  points_done: number;
};

export type TUserWorkCycles = {
  active: TUserWorkCycle[];
  upcoming: TUserWorkCycle[];
  hidden: number;
};

export type TUserWorkActivity = IIssueActivity & { can_open: boolean };

export type TUserWorkActivityResponse = Omit<TUserWorkPage<TUserWorkActivity>, "total">;

export type TTeamWorkFilters = {
  search: string;
  roles: string[];
  statuses: TUserWorkStatus[];
  projects: string[];
  period: TUserWorkPeriod;
  sort: TUserWorkSortField;
  direction: TUserWorkSortDirection;
  page: number;
};

export type TUserWorkFilters = {
  projects: string[];
  period: TUserWorkPeriod;
  focus: TUserWorkFocus | null;
  layout: "list" | "board";
  start: string | null;
  end: string | null;
};

export type TUserWorkExportLabels = Record<string, string>;
