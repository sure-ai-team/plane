/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { action, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
import type { TProjectSpreadsheet, TProjectSpreadsheetUploadResponse } from "@plane/types";
// data files helpers
import type { TSpreadsheetErrorShape } from "@/components/project/overview/data-files/helpers/errors";
import { toSpreadsheetErrorShape } from "@/components/project/overview/data-files/helpers/errors";
import type { TSpreadsheetPreview } from "@/components/project/overview/data-files/helpers/preview";
import {
  getSpreadsheetKind,
  getSpreadsheetMimeType,
  validateSpreadsheetFile,
} from "@/components/project/overview/data-files/helpers/validation";
import type { ProjectSpreadsheetService } from "@/services/project/project-spreadsheet.service";

export type TProjectSpreadsheetServiceLike = Pick<
  ProjectSpreadsheetService,
  "list" | "create" | "replace" | "uploadToStorage" | "update" | "remove"
>;

export type TSpreadsheetUploadStatus = "uploading" | "processing" | "ready" | "error";

export type TSpreadsheetUpload = {
  tempId: string;
  workspaceSlug: string;
  projectId: string;
  file: File;
  name: string;
  size: number;
  status: TSpreadsheetUploadStatus;
  /** 0–100 */
  progress: number;
  error: TSpreadsheetErrorShape | null;
  /** set for replacements from the start, and for new files once finalized */
  spreadsheetId: string | null;
  isReplace: boolean;
};

export type TSpreadsheetLoader = "init-loader" | "loaded" | "error";

export type TProjectSpreadsheetStoreOptions = {
  /** Runs after an upload is finalized (e.g. parse to warm the preview cache). Failures are ignored. */
  processUpload?: (spreadsheet: TProjectSpreadsheet, file: File) => Promise<TSpreadsheetPreview | null | void>;
  /** Called when a file is deleted (e.g. to clear caches). */
  onDeleted?: (spreadsheetId: string) => void;
  /** How long a finished upload keeps its "ready" badge. */
  readyDismissMs?: number;
  generateId?: () => string;
};

export type TUploadResult = { ok: true; tempId: string } | { ok: false; error: TSpreadsheetErrorShape };

let uploadCounter = 0;
const defaultGenerateId = () => `upload-${Date.now().toString(36)}-${(uploadCounter++).toString(36)}`;

const sortNewestFirst = (a: TProjectSpreadsheet, b: TProjectSpreadsheet) =>
  new Date(b.created_at).getTime() - new Date(a.created_at).getTime();

export class ProjectSpreadsheetStore {
  spreadsheetMap: Record<string, TProjectSpreadsheet> = {};
  projectSpreadsheetIds: Record<string, string[]> = {};
  loaderMap: Record<string, TSpreadsheetLoader> = {};
  uploads: Record<string, TSpreadsheetUpload> = {};
  previews: Record<string, TSpreadsheetPreview> = {};

  private service: TProjectSpreadsheetServiceLike;
  private options: TProjectSpreadsheetStoreOptions;

  constructor(service: TProjectSpreadsheetServiceLike, options: TProjectSpreadsheetStoreOptions = {}) {
    this.service = service;
    this.options = options;
    makeObservable<ProjectSpreadsheetStore, "runUpload">(this, {
      spreadsheetMap: observable,
      projectSpreadsheetIds: observable,
      loaderMap: observable,
      uploads: observable,
      previews: observable,
      fetchSpreadsheets: action,
      uploadSpreadsheet: action,
      replaceSpreadsheet: action,
      retryUpload: action,
      dismissUpload: action,
      renameSpreadsheet: action,
      deleteSpreadsheet: action,
      setPreview: action,
      setPreviews: action,
      upsertSpreadsheet: action,
      runUpload: action,
    });
  }

  /** Attach UI-side hooks (worker parsing, cache cleanup) after construction by the root store. */
  setOptions = (options: TProjectSpreadsheetStoreOptions) => {
    this.options = { ...this.options, ...options };
  };

  // ---------- getters ----------

  getProjectSpreadsheets = computedFn((projectId: string): TProjectSpreadsheet[] =>
    (this.projectSpreadsheetIds[projectId] ?? [])
      .map((id) => this.spreadsheetMap[id])
      .filter((item): item is TProjectSpreadsheet => !!item)
  );

  /** New files still on their way (not yet in the list). */
  getPendingUploads = computedFn((projectId: string): TSpreadsheetUpload[] =>
    Object.values(this.uploads).filter(
      (upload) =>
        upload.projectId === projectId &&
        !upload.isReplace &&
        !(upload.spreadsheetId && this.spreadsheetMap[upload.spreadsheetId])
    )
  );

  /** In-flight replacement or post-upload processing of a listed file. */
  getUploadForSpreadsheet = computedFn((spreadsheetId: string): TSpreadsheetUpload | undefined =>
    Object.values(this.uploads).find((upload) => upload.spreadsheetId === spreadsheetId)
  );

  getSpreadsheetById = (id: string): TProjectSpreadsheet | undefined => this.spreadsheetMap[id];

  getPreview = (spreadsheet: TProjectSpreadsheet): TSpreadsheetPreview | undefined => {
    const preview = this.previews[spreadsheet.id];
    return preview && preview.version === spreadsheet.updated_at ? preview : undefined;
  };

  // ---------- actions ----------

  setPreview = (preview: TSpreadsheetPreview) => {
    this.previews[preview.assetId] = preview;
  };

  setPreviews = (previews: TSpreadsheetPreview[]) => {
    for (const preview of previews) this.previews[preview.assetId] = preview;
  };

  upsertSpreadsheet = (spreadsheet: TProjectSpreadsheet) => {
    this.spreadsheetMap[spreadsheet.id] = spreadsheet;
    const ids = this.projectSpreadsheetIds[spreadsheet.project] ?? [];
    if (!ids.includes(spreadsheet.id)) this.projectSpreadsheetIds[spreadsheet.project] = [spreadsheet.id, ...ids];
  };

  fetchSpreadsheets = async (workspaceSlug: string, projectId: string): Promise<TProjectSpreadsheet[]> => {
    if (!this.projectSpreadsheetIds[projectId]) this.loaderMap[projectId] = "init-loader";
    try {
      const spreadsheets = await this.service.list(workspaceSlug, projectId);
      runInAction(() => {
        const sorted = [...spreadsheets];
        sorted.sort(sortNewestFirst);
        for (const spreadsheet of sorted) this.spreadsheetMap[spreadsheet.id] = spreadsheet;
        this.projectSpreadsheetIds[projectId] = sorted.map((spreadsheet) => spreadsheet.id);
        this.loaderMap[projectId] = "loaded";
      });
      return spreadsheets;
    } catch (error) {
      runInAction(() => {
        this.loaderMap[projectId] = this.projectSpreadsheetIds[projectId] ? "loaded" : "error";
      });
      throw error;
    }
  };

  uploadSpreadsheet = (workspaceSlug: string, projectId: string, file: File): TUploadResult =>
    this.startUpload(workspaceSlug, projectId, file, null);

  replaceSpreadsheet = (workspaceSlug: string, projectId: string, spreadsheetId: string, file: File): TUploadResult =>
    this.startUpload(workspaceSlug, projectId, file, spreadsheetId);

  private startUpload(
    workspaceSlug: string,
    projectId: string,
    file: File,
    spreadsheetId: string | null
  ): TUploadResult {
    const error = validateSpreadsheetFile(file);
    if (error) return { ok: false, error };
    if (spreadsheetId && this.getUploadForSpreadsheet(spreadsheetId)?.status === "uploading")
      return { ok: false, error: { code: "upload_failed" } };
    const tempId = (this.options.generateId ?? defaultGenerateId)();
    this.uploads[tempId] = {
      tempId,
      workspaceSlug,
      projectId,
      file,
      name: file.name,
      size: file.size,
      status: "uploading",
      progress: 0,
      error: null,
      spreadsheetId,
      isReplace: !!spreadsheetId,
    };
    void this.runUpload(tempId);
    return { ok: true, tempId };
  }

  retryUpload = (tempId: string) => {
    const upload = this.uploads[tempId];
    if (!upload || upload.status !== "error") return;
    upload.status = "uploading";
    upload.progress = 0;
    upload.error = null;
    if (!upload.isReplace) upload.spreadsheetId = null;
    void this.runUpload(tempId);
  };

  dismissUpload = (tempId: string) => {
    delete this.uploads[tempId];
  };

  /** Resolves once the upload settles (success or error); never throws. */
  private runUpload = async (tempId: string): Promise<void> => {
    const upload = this.uploads[tempId];
    if (!upload) return;
    const { workspaceSlug, projectId, file } = upload;
    const kind = getSpreadsheetKind(file.name, file.type) ?? "csv";
    const payload = { name: file.name, type: getSpreadsheetMimeType(kind), size: file.size };
    try {
      const signed: TProjectSpreadsheetUploadResponse = upload.isReplace
        ? await this.service.replace(workspaceSlug, projectId, upload.spreadsheetId as string, payload)
        : await this.service.create(workspaceSlug, projectId, payload);

      await this.service.uploadToStorage(signed, file, (event) => {
        const total = event.total ?? file.size;
        if (!total) return;
        runInAction(() => {
          const current = this.uploads[tempId];
          if (current) current.progress = Math.min(100, Math.round((event.loaded / total) * 100));
        });
      });

      runInAction(() => {
        const current = this.uploads[tempId];
        if (!current) return;
        current.progress = 100;
        current.status = "processing";
      });

      const spreadsheet = await this.service.update(workspaceSlug, projectId, signed.asset_id, { is_uploaded: true });
      runInAction(() => {
        this.upsertSpreadsheet(spreadsheet);
        const current = this.uploads[tempId];
        if (current) current.spreadsheetId = spreadsheet.id;
      });

      try {
        const preview = await this.options.processUpload?.(spreadsheet, file);
        if (preview) this.setPreview(preview);
      } catch {
        // previews are a nicety; the file itself is saved
      }

      runInAction(() => {
        const current = this.uploads[tempId];
        if (current) current.status = "ready";
      });
      const dismissAfter = this.options.readyDismissMs ?? 1500;
      if (dismissAfter <= 0) this.dismissUpload(tempId);
      else setTimeout(() => this.dismissUpload(tempId), dismissAfter);
    } catch (error) {
      runInAction(() => {
        const current = this.uploads[tempId];
        if (!current) return;
        current.status = "error";
        current.error = toSpreadsheetErrorShape(error, "upload_failed");
      });
    }
  };

  renameSpreadsheet = async (workspaceSlug: string, projectId: string, spreadsheetId: string, name: string) => {
    const existing = this.spreadsheetMap[spreadsheetId];
    if (!existing || existing.name === name) return;
    this.spreadsheetMap[spreadsheetId] = { ...existing, name };
    try {
      const updated = await this.service.update(workspaceSlug, projectId, spreadsheetId, { name });
      runInAction(() => {
        // keep the preview linked: a rename doesn't change the content
        const preview = this.previews[spreadsheetId];
        if (preview && preview.version === existing.updated_at)
          this.previews[spreadsheetId] = { ...preview, version: updated.updated_at };
        this.spreadsheetMap[spreadsheetId] = updated;
      });
    } catch (error) {
      runInAction(() => {
        this.spreadsheetMap[spreadsheetId] = existing;
      });
      throw error;
    }
  };

  deleteSpreadsheet = async (workspaceSlug: string, projectId: string, spreadsheetId: string) => {
    const existing = this.spreadsheetMap[spreadsheetId];
    const ids = this.projectSpreadsheetIds[projectId] ?? [];
    const index = ids.indexOf(spreadsheetId);
    this.projectSpreadsheetIds[projectId] = ids.filter((id) => id !== spreadsheetId);
    try {
      await this.service.remove(workspaceSlug, projectId, spreadsheetId);
      runInAction(() => {
        delete this.spreadsheetMap[spreadsheetId];
        delete this.previews[spreadsheetId];
      });
      this.options.onDeleted?.(spreadsheetId);
    } catch (error) {
      runInAction(() => {
        const current = this.projectSpreadsheetIds[projectId] ?? [];
        if (existing && !current.includes(spreadsheetId)) {
          const next = [...current];
          next.splice(index < 0 ? 0 : Math.min(index, next.length), 0, spreadsheetId);
          this.projectSpreadsheetIds[projectId] = next;
        }
      });
      throw error;
    }
  };
}
