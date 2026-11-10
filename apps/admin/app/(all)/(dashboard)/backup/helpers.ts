/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type {
  TBackupCopyStatus,
  TBackupDestinationKind,
  TBackupFrequency,
  TBackupSchedule,
  TBackupSnapshotStatus,
} from "@plane/types";

type TBadgeVariant = "neutral" | "brand" | "warning" | "success" | "danger";

export const FREQUENCY_OPTIONS: { key: TBackupFrequency; label: string; hint: string }[] = [
  { key: "every_6_hours", label: "Every 6 hours", hint: "For teams that change a lot of work every day." },
  { key: "every_12_hours", label: "Every 12 hours", hint: "Twice a day." },
  { key: "daily", label: "Every day", hint: "Recommended for most teams." },
  { key: "weekly", label: "Every week", hint: "For instances that change slowly." },
  { key: "monthly", label: "Every month", hint: "Only as an extra, long-term copy." },
];

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const KEEP_LAST_OPTIONS = [3, 7, 14, 30, 60, 90, 180, 365];

export const SNAPSHOT_STATUS: Record<TBackupSnapshotStatus, { label: string; variant: TBadgeVariant }> = {
  queued: { label: "Waiting to start", variant: "neutral" },
  running: { label: "In progress", variant: "brand" },
  succeeded: { label: "Complete", variant: "success" },
  partial: { label: "Partly saved", variant: "warning" },
  failed: { label: "Failed", variant: "danger" },
};

export const COPY_STATUS: Record<TBackupCopyStatus, { label: string; variant: TBadgeVariant }> = {
  pending: { label: "Waiting", variant: "neutral" },
  running: { label: "Saving", variant: "brand" },
  succeeded: { label: "Saved", variant: "success" },
  failed: { label: "Failed", variant: "danger" },
};

export const DESTINATION_KINDS: Record<TBackupDestinationKind, { label: string; description: string }> = {
  s3: {
    label: "Cloud storage (S3-compatible)",
    description:
      "Amazon S3, MinIO, Cloudflare R2, Wasabi, DigitalOcean Spaces, Oracle and other S3-compatible services.",
  },
  local: {
    label: "Folder on the server",
    description: "A folder in the server's backup area. Best on a separate disk or network share.",
  },
  postgres: {
    label: "Standby database",
    description:
      "Keeps a ready-to-use copy of the database on another PostgreSQL server. Holds the database only, not uploaded files.",
  },
};

export function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatBytes(size: number): string {
  if (!size) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** "3 hours ago", "in 20 minutes" */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "never";
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return seconds >= 0 ? "in less than a minute" : "just now";
}

export function formatDuration(startIso: string | null, endIso: string | null): string {
  if (!startIso || !endIso) return "";
  const seconds = Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function ordinal(day: number): string {
  if (day % 10 === 1 && day !== 11) return `${day}st`;
  if (day % 10 === 2 && day !== 12) return `${day}nd`;
  if (day % 10 === 3 && day !== 13) return `${day}rd`;
  return `${day}th`;
}

/** A plain-language sentence, e.g. "Every Friday at 23:30 (Asia/Riyadh time)". */
export function describeSchedule(
  schedule: Pick<TBackupSchedule, "frequency" | "hour" | "minute" | "weekday" | "day_of_month" | "timezone">
): string {
  const time = `${pad(schedule.hour)}:${pad(schedule.minute)}`;
  const zone = `(${schedule.timezone} time)`;
  switch (schedule.frequency) {
    case "every_6_hours":
    case "every_12_hours": {
      const step = schedule.frequency === "every_6_hours" ? 6 : 12;
      const times = Array.from({ length: 24 / step }, (_, index) => (schedule.hour + index * step) % 24)
        // A fresh array; the admin app targets ES2022, so no toSorted.
        // oxlint-disable-next-line unicorn/no-array-sort
        .sort((a, b) => a - b)
        .map((hour) => `${pad(hour)}:${pad(schedule.minute)}`);
      return `Every ${step} hours, at ${times.join(", ")} ${zone}`;
    }
    case "weekly":
      return `Every ${WEEKDAYS[schedule.weekday] ?? "week"} at ${time} ${zone}`;
    case "monthly":
      return `On the ${ordinal(schedule.day_of_month)} of every month at ${time} ${zone}`;
    default:
      return `Every day at ${time} ${zone}`;
  }
}

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Timezones the browser knows, with the given ones guaranteed to be present. */
export function timezoneOptions(...include: string[]): string[] {
  let zones: string[] = [];
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    zones = intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  // A fresh array; the admin app targets ES2022, so no toSorted.
  // oxlint-disable-next-line unicorn/no-array-sort
  return Array.from(new Set(["UTC", ...include.filter(Boolean), ...zones])).sort((a, b) =>
    a === "UTC" ? -1 : b === "UTC" ? 1 : a.localeCompare(b)
  );
}

type TApiError = { error?: string; fields?: Record<string, string> } | undefined;

export function getErrorMessage(error: unknown, fallback = "Something went wrong. Try again."): string {
  const body = error as TApiError;
  return body?.error || fallback;
}

export function getFieldErrors(error: unknown): Record<string, string> {
  return (error as TApiError)?.fields ?? {};
}
