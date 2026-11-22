/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { API_BASE_URL } from "@plane/constants";
import type {
  TBackupDestination,
  TBackupDestinationPayload,
  TBackupExport,
  TBackupOverview,
  TBackupRelease,
  TBackupReleaseList,
  TBackupRestore,
  TBackupRestorePublicStatus,
  TBackupSettingsKitInfo,
  TBackupUpload,
  TBackupSchedule,
  TBackupSchedulePayload,
  TBackupSnapshot,
  TBackupSnapshotFilter,
  TBackupSnapshotList,
  TBackupTestResult,
} from "@plane/types";
// api service
import { APIService } from "../api.service";

const BASE = "/api/instances/backups";

/** Backup & restore endpoints for the instance admin panel. Errors reject with the response body. */
export class BackupService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private unwrap<T>(request: Promise<{ data: T }>): Promise<T> {
    return request
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data ?? error;
      });
  }

  overview(): Promise<TBackupOverview> {
    return this.unwrap(this.get(`${BASE}/overview/`));
  }

  getSchedule(): Promise<TBackupSchedule> {
    return this.unwrap(this.get(`${BASE}/schedule/`));
  }

  updateSchedule(data: TBackupSchedulePayload): Promise<TBackupSchedule> {
    return this.unwrap(this.patch(`${BASE}/schedule/`, data));
  }

  listDestinations(): Promise<TBackupDestination[]> {
    return this.unwrap(this.get(`${BASE}/destinations/`));
  }

  createDestination(data: TBackupDestinationPayload): Promise<TBackupDestination> {
    return this.unwrap(this.post(`${BASE}/destinations/`, data));
  }

  updateDestination(id: string, data: TBackupDestinationPayload): Promise<TBackupDestination> {
    return this.unwrap(this.patch(`${BASE}/destinations/${id}/`, data));
  }

  deleteDestination(id: string): Promise<void> {
    return this.unwrap(this.delete(`${BASE}/destinations/${id}/`));
  }

  /** Tests settings typed into the form. Pass `id` when editing so stored secrets can be reused. */
  testDestination(data: TBackupDestinationPayload, id?: string): Promise<TBackupTestResult> {
    return this.unwrap(this.post(id ? `${BASE}/destinations/${id}/test/` : `${BASE}/destinations/test/`, data));
  }

  listSnapshots(params: {
    limit?: number;
    offset?: number;
    status?: TBackupSnapshotFilter;
  }): Promise<TBackupSnapshotList> {
    return this.unwrap(this.get(`${BASE}/snapshots/`, { params: { ...params, status: params.status || undefined } }));
  }

  startBackup(data: { note?: string; include_files?: boolean }): Promise<TBackupSnapshot> {
    return this.unwrap(this.post(`${BASE}/snapshots/`, data));
  }

  updateSnapshot(id: string, data: { note?: string; is_pinned?: boolean }): Promise<TBackupSnapshot> {
    return this.unwrap(this.patch(`${BASE}/snapshots/${id}/`, data));
  }

  deleteSnapshot(id: string, force = false): Promise<void> {
    return this.unwrap(this.delete(`${BASE}/snapshots/${id}/${force ? "?force=true" : ""}`));
  }

  // Restore

  /** Starts checking a saved backup. Nothing changes until the restore is confirmed. */
  inspectSnapshot(snapshotId: string): Promise<TBackupRestore> {
    return this.unwrap(this.post(`${BASE}/restores/`, { snapshot_id: snapshotId }));
  }

  getRestore(id: string): Promise<TBackupRestore> {
    return this.unwrap(this.get(`${BASE}/restores/${id}/`));
  }

  confirmRestore(id: string, data: { password: string; confirm_text: string }): Promise<TBackupRestore> {
    return this.unwrap(this.post(`${BASE}/restores/${id}/confirm/`, data));
  }

  cancelRestore(id: string): Promise<TBackupRestore> {
    return this.unwrap(this.post(`${BASE}/restores/${id}/cancel/`));
  }

  undoRestore(id: string, data: { password: string }): Promise<TBackupRestore> {
    return this.unwrap(this.post(`${BASE}/restores/${id}/undo/`, data));
  }

  /** Works while signed out: a restore replaces every session. */
  restoreStatus(id: string): Promise<TBackupRestorePublicStatus> {
    return this.unwrap(this.get(`${BASE}/restores/${id}/status/`, { validateStatus: null }));
  }

  // Upload a backup file

  createUpload(data: { filename: string; size: number }): Promise<TBackupUpload> {
    return this.unwrap(this.post(`${BASE}/uploads/`, data));
  }

  getUpload(id: string): Promise<TBackupUpload> {
    return this.unwrap(this.get(`${BASE}/uploads/${id}/`));
  }

  uploadChunk(id: string, offset: number, chunk: Blob): Promise<TBackupUpload> {
    return this.unwrap(
      this.put(`${BASE}/uploads/${id}/chunk/`, chunk, {
        params: { offset },
        headers: { "Content-Type": "application/octet-stream" },
      })
    );
  }

  inspectUpload(id: string): Promise<TBackupRestore> {
    return this.unwrap(this.post(`${BASE}/uploads/${id}/restore/`));
  }

  // Download as one file

  prepareDownload(snapshotId: string, includeFiles: boolean): Promise<TBackupExport> {
    return this.unwrap(this.post(`${BASE}/snapshots/${snapshotId}/exports/`, { include_files: includeFiles }));
  }

  getDownload(id: string): Promise<TBackupExport> {
    return this.unwrap(this.get(`${BASE}/exports/${id}/`));
  }

  downloadUrl(id: string): string {
    return `${API_BASE_URL}${BASE}/exports/${id}/download/`;
  }

  // Server recovery

  settingsKitInfo(): Promise<TBackupSettingsKitInfo> {
    return this.unwrap(this.get(`${BASE}/settings-kit/`));
  }

  /** The encrypted kit as a file. Errors reject with the JSON body, like the other calls. */
  async downloadSettingsKit(data: { password: string; passphrase: string }): Promise<Blob> {
    try {
      const response = await this.post(`${BASE}/settings-kit/`, data, { responseType: "blob" });
      return response.data as Blob;
    } catch (error) {
      const body = (error as { response?: { data?: unknown } })?.response?.data;
      if (body instanceof Blob) {
        try {
          throw JSON.parse(await body.text());
        } catch (parsed) {
          throw parsed instanceof SyntaxError ? { error: "Couldn't create the settings kit." } : parsed;
        }
      }
      throw body ?? error;
    }
  }

  listReleases(): Promise<TBackupReleaseList> {
    return this.unwrap(this.get(`${BASE}/releases/`));
  }

  copyRelease(version: string): Promise<TBackupRelease> {
    return this.unwrap(this.post(`${BASE}/releases/${encodeURIComponent(version)}/copy/`));
  }

  deleteRelease(version: string): Promise<void> {
    return this.unwrap(this.delete(`${BASE}/releases/${encodeURIComponent(version)}/`));
  }

  releaseDownloadUrl(version: string, file: "images" | "compose"): string {
    return `${API_BASE_URL}${BASE}/releases/${encodeURIComponent(version)}/download/?file=${file}`;
  }
}
