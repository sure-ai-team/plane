/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWR, { mutate } from "swr";
// plane imports
import { BackupService } from "@plane/services";
import type { TBackupSnapshotFilter } from "@plane/types";

export const backupService = new BackupService();

const KEYS = {
  overview: "BACKUP_OVERVIEW",
  schedule: "BACKUP_SCHEDULE",
  destinations: "BACKUP_DESTINATIONS",
  snapshots: "BACKUP_SNAPSHOTS",
  releases: "BACKUP_RELEASES",
};

const ACTIVE_POLL_MS = 3000;
const IDLE_POLL_MS = 60000;

export function useBackupOverview() {
  return useSWR(KEYS.overview, () => backupService.overview(), {
    refreshInterval: (data) => (data?.running ? ACTIVE_POLL_MS : IDLE_POLL_MS),
  });
}

export function useBackupSchedule() {
  return useSWR(KEYS.schedule, () => backupService.getSchedule(), { revalidateOnFocus: false });
}

export function useBackupReleases() {
  return useSWR(KEYS.releases, () => backupService.listReleases(), {
    refreshInterval: (data) =>
      data?.releases.some((r) => Object.values(r.copies).some((c) => c.status === "queued" || c.status === "copying"))
        ? ACTIVE_POLL_MS
        : IDLE_POLL_MS,
  });
}

export function useBackupDestinations() {
  return useSWR(KEYS.destinations, () => backupService.listDestinations());
}

export function useBackupSnapshots(params: { limit: number; offset: number; status: TBackupSnapshotFilter }) {
  return useSWR(
    [KEYS.snapshots, params.limit, params.offset, params.status],
    () => backupService.listSnapshots(params),
    {
      keepPreviousData: true,
      refreshInterval: (data) =>
        data?.results.some((s) => s.status === "queued" || s.status === "running") ? ACTIVE_POLL_MS : IDLE_POLL_MS,
    }
  );
}

/** Refresh every backup view after a change (start, delete, schedule or destination edits). */
export function refreshBackupData(): Promise<unknown> {
  return mutate(
    (key) =>
      (typeof key === "string" && Object.values(KEYS).includes(key)) ||
      (Array.isArray(key) && key[0] === KEYS.snapshots)
  );
}
