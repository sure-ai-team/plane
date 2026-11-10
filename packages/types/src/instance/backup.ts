/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/** Backup & restore, managed from the instance admin panel. */

export type TBackupDestinationKind = "local" | "s3" | "postgres";

export type TBackupFrequency = "every_6_hours" | "every_12_hours" | "daily" | "weekly" | "monthly";

export type TBackupSnapshotStatus = "queued" | "running" | "succeeded" | "partial" | "failed";

export type TBackupCopyStatus = "pending" | "running" | "succeeded" | "failed";

export type TBackupHealth = "good" | "warning" | "critical";

export type TBackupLocalConfig = { folder: string };

export type TBackupS3Config = {
  bucket: string;
  region: string;
  endpoint_url: string;
  prefix: string;
  access_key_id: string;
  force_path_style: boolean;
  server_side_encryption: boolean;
};

export type TBackupPostgresConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  sslmode: "disable" | "allow" | "prefer" | "require" | "verify-ca" | "verify-full";
};

export type TBackupDestinationConfig = Partial<TBackupLocalConfig & TBackupS3Config & TBackupPostgresConfig>;

/** Secrets are write-only: the API only says whether each one is set. */
export type TBackupDestinationSecrets = { secret_access_key?: string; password?: string };

export type TBackupDestination = {
  id: string;
  name: string;
  kind: TBackupDestinationKind;
  config: TBackupDestinationConfig;
  secrets_set: Record<string, boolean>;
  is_enabled: boolean;
  last_checked_at: string | null;
  last_check_ok: boolean | null;
  last_check_message: string;
  created_at: string;
};

export type TBackupDestinationPayload = {
  name?: string;
  kind?: TBackupDestinationKind;
  config?: TBackupDestinationConfig;
  secrets?: TBackupDestinationSecrets;
  is_enabled?: boolean;
};

export type TBackupTestResult = { ok: boolean; message: string };

export type TBackupSchedule = {
  is_enabled: boolean;
  frequency: TBackupFrequency;
  hour: number;
  minute: number;
  /** 0 = Monday ... 6 = Sunday */
  weekday: number;
  /** 1-28 */
  day_of_month: number;
  timezone: string;
  include_files: boolean;
  keep_last: number;
  next_run_at: string | null;
  last_run_at: string | null;
  updated_at: string | null;
};

export type TBackupSchedulePayload = Partial<Omit<TBackupSchedule, "next_run_at" | "last_run_at" | "updated_at">>;

export type TBackupCopy = {
  id: string;
  destination_id: string | null;
  destination_name: string;
  destination_kind: TBackupDestinationKind;
  status: TBackupCopyStatus;
  location: string;
  size: number;
  error: string;
  finished_at: string | null;
};

export type TBackupSnapshot = {
  id: string;
  trigger: "manual" | "scheduled" | "safety";
  status: TBackupSnapshotStatus;
  note: string;
  is_pinned: boolean;
  include_files: boolean;
  folder: string;
  progress: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  created_by: { id: string; name: string; email: string } | null;
  database_size: number;
  files_count: number;
  files_size: number;
  app_version: string;
  postgres_version: string;
  stats: Partial<Record<"workspaces" | "projects" | "work_items" | "pages" | "users", number>>;
  error: string;
  copies: TBackupCopy[];
};

export type TBackupSnapshotList = {
  results: TBackupSnapshot[];
  total: number;
  limit: number;
  offset: number;
};

export type TBackupSnapshotFilter = "" | "kept" | "failed";

export type TBackupOverview = {
  health: TBackupHealth;
  messages: { level: "critical" | "warning" | "info"; text: string }[];
  tools_available: boolean;
  schedule: TBackupSchedule;
  latest: TBackupSnapshot | null;
  last_success: TBackupSnapshot | null;
  running: TBackupSnapshot | null;
  destinations: { enabled: number; total: number };
  totals: { count: number; database_size: number };
  /** An open restore, or a finished one that can still be undone. */
  restore: TBackupRestore | null;
};

// ---------------------------------------------------------------------------
// Restore, upload and download
// ---------------------------------------------------------------------------

export type TBackupRestoreStatus =
  | "inspecting"
  | "ready"
  | "invalid"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "undoing"
  | "undone"
  | "cancelled"
  | "expired";

export type TBackupRestoreCheck = { level: "ok" | "info" | "warning" | "blocker"; text: string };

export type TBackupContentCounts = Partial<
  Record<"workspaces" | "projects" | "work_items" | "pages" | "users", number>
> & { last_activity?: string | null };

export type TBackupRestore = {
  id: string;
  source: "snapshot" | "upload";
  snapshot_id: string | null;
  label: string;
  status: TBackupRestoreStatus;
  progress: string;
  error: string;
  can_restore: boolean;
  checks: TBackupRestoreCheck[];
  comparison: { backup?: TBackupContentCounts; current?: TBackupContentCounts };
  preview: {
    workspaces?: { name: string; slug: string; projects: number }[];
    admins?: string[];
    instance_name?: string | null;
    secret_key_matches?: boolean | null;
  };
  backup: {
    created_at: string | null;
    trigger: string | null;
    note: string;
    app_version: string;
    postgres_version: string;
    database_size: number;
    files: { included?: boolean; count?: number; size?: number };
  };
  safety_snapshot_id: string | null;
  files_restored: number;
  files_failed: number;
  created_at: string;
  inspected_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  undo_until: string | null;
  undo_available: boolean;
  undone_at: string | null;
  created_by: { id: string; name: string; email: string } | null;
  confirmed_by: { id: string; name: string; email: string } | null;
  /** What the admin types to confirm: the instance name. */
  confirm_phrase: string;
};

/** Readable without signing in: a restore signs everyone out. */
export type TBackupRestorePublicStatus = {
  status?: TBackupRestoreStatus;
  progress?: string;
  step?: string;
  error?: string;
  switched?: boolean;
  updated_at?: number;
};

export type TBackupUpload = {
  id: string;
  filename: string;
  size: number;
  received: number;
  status: "uploading" | "complete" | "failed";
  created_at: string;
  chunk_size?: number;
};

export type TBackupExport = {
  id: string;
  snapshot_id: string;
  include_files: boolean;
  status: "queued" | "running" | "ready" | "failed" | "expired";
  progress: string;
  size: number;
  error: string;
  created_at: string;
  finished_at: string | null;
  expires_at: string | null;
  estimated_size?: number;
};
