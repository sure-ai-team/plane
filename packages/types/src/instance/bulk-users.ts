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
