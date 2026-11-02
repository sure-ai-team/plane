/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export type TBulkUserRole = "admin" | "member" | "guest";

export type TBulkUserRowStatus = "created" | "existing" | "error";

export type TBulkUserRowResult = {
  line: number;
  email: string;
  status: TBulkUserRowStatus;
  first_name: string;
  last_name: string;
  phone: string;
  /** Temporary password; only set for accounts created by this upload. */
  password: string;
  workspace: string;
  projects: string[];
  messages: string[];
};

export type TBulkUserCreateResponse = {
  dry_run: boolean;
  summary: { created: number; existing: number; failed: number };
  results: TBulkUserRowResult[];
};

export type TBulkUserCreatePayload = {
  file: File;
  dryRun: boolean;
  workspace?: string;
  role?: TBulkUserRole;
};

export type TBulkUserCreateError = { error?: string; code?: string };

export type TInstanceUserCreatePayload = {
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  workspace?: string;
  role?: TBulkUserRole;
};

// ---------------------------------------------------------------------------
// Account management (admin console > Users > All users)

export type TInstanceUser = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  display_name: string;
  phone: string;
  is_active: boolean;
  is_instance_admin: boolean;
  workspace_count: number;
  date_joined: string;
  last_login_time: string | null;
  last_login_medium: string;
  /** False while the account still has the random password it was created with. */
  has_password: boolean;
};

export type TInstanceUserProject = {
  id: string;
  identifier: string;
  name: string;
  /** Null when the user is not a member of the project. */
  role: TBulkUserRole | null;
};

export type TInstanceUserWorkspace = {
  id: string;
  slug: string;
  name: string;
  role: TBulkUserRole;
  /** False when the user was removed from the workspace (shown as Suspended there). */
  is_active: boolean;
  is_owner: boolean;
  projects: TInstanceUserProject[];
};

export type TInstanceUserDetail = TInstanceUser & { workspaces: TInstanceUserWorkspace[] };

export type TInstanceUserStatusFilter = "" | "active" | "deactivated";

export type TInstanceUserListParams = {
  search?: string;
  status?: TInstanceUserStatusFilter;
  workspace?: string;
  cursor?: string;
  per_page?: number;
};

export type TInstanceUserListResponse = {
  results: TInstanceUser[];
  next_cursor: string;
  prev_cursor: string;
  next_page_results: boolean;
  prev_page_results: boolean;
  total_count: number;
};

export type TInstanceUserUpdatePayload = Partial<
  Pick<TInstanceUser, "email" | "first_name" | "last_name" | "display_name" | "phone">
>;

export type TInstanceUserPasswordResult = { email: string; password: string };
