/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { AxiosRequestConfig } from "axios";
import { API_BASE_URL } from "@plane/constants";
import { generateFileUploadPayload } from "@plane/services";
import type {
  TProjectSpreadsheet,
  TProjectSpreadsheetUpdatePayload,
  TProjectSpreadsheetUploadPayload,
  TProjectSpreadsheetUploadResponse,
} from "@plane/types";
// services
import { APIService } from "@/services/api.service";
import { FileUploadService } from "@/services/file-upload.service";

const throwResponseData = (error: unknown): never => {
  const response = (error as { response?: { status?: number; data?: unknown } })?.response;
  throw { status: response?.status, ...(typeof response?.data === "object" && response?.data ? response.data : {}) };
};

/** Project "Data files": spreadsheets uploaded to a project. */
export class ProjectSpreadsheetService extends APIService {
  private fileUploadService: FileUploadService;

  constructor() {
    super(API_BASE_URL);
    this.fileUploadService = new FileUploadService();
  }

  private basePath(workspaceSlug: string, projectId: string) {
    return `/api/workspaces/${workspaceSlug}/projects/${projectId}/spreadsheets/`;
  }

  async list(workspaceSlug: string, projectId: string): Promise<TProjectSpreadsheet[]> {
    return this.get(this.basePath(workspaceSlug, projectId))
      .then((response) => response?.data)
      .catch(throwResponseData);
  }

  /** Creates the asset and returns a presigned upload. */
  async create(
    workspaceSlug: string,
    projectId: string,
    data: TProjectSpreadsheetUploadPayload
  ): Promise<TProjectSpreadsheetUploadResponse> {
    return this.post(this.basePath(workspaceSlug, projectId), data)
      .then((response) => response?.data)
      .catch(throwResponseData);
  }

  /** Starts replacing the file behind an existing spreadsheet (same id). */
  async replace(
    workspaceSlug: string,
    projectId: string,
    spreadsheetId: string,
    data: TProjectSpreadsheetUploadPayload
  ): Promise<TProjectSpreadsheetUploadResponse> {
    return this.post(`${this.basePath(workspaceSlug, projectId)}${spreadsheetId}/replace/`, data)
      .then((response) => response?.data)
      .catch(throwResponseData);
  }

  /** Sends the file to storage using the presigned POST. */
  async uploadToStorage(
    upload: TProjectSpreadsheetUploadResponse,
    file: File,
    onProgress?: AxiosRequestConfig["onUploadProgress"]
  ): Promise<void> {
    const payload = generateFileUploadPayload(upload, file);
    await this.fileUploadService.uploadFile(upload.upload_data.url, payload, onProgress);
  }

  /** Finalizes an upload (`is_uploaded`) and/or renames. */
  async update(
    workspaceSlug: string,
    projectId: string,
    spreadsheetId: string,
    data: TProjectSpreadsheetUpdatePayload
  ): Promise<TProjectSpreadsheet> {
    return this.patch(`${this.basePath(workspaceSlug, projectId)}${spreadsheetId}/`, data)
      .then((response) => response?.data)
      .catch(throwResponseData);
  }

  async remove(workspaceSlug: string, projectId: string, spreadsheetId: string): Promise<void> {
    return this.delete(`${this.basePath(workspaceSlug, projectId)}${spreadsheetId}/`)
      .then(() => undefined)
      .catch(throwResponseData);
  }

  /** Raw file bytes (same-origin, cookie auth). */
  async getContent(workspaceSlug: string, projectId: string, spreadsheetId: string): Promise<ArrayBuffer> {
    return this.get(
      `${this.basePath(workspaceSlug, projectId)}${spreadsheetId}/content/`,
      {},
      { responseType: "arraybuffer" }
    )
      .then((response) => response?.data as ArrayBuffer)
      .catch(throwResponseData);
  }

  /** Link that redirects to the original file as an attachment. */
  getDownloadUrl(workspaceSlug: string, projectId: string, spreadsheetId: string): string {
    return `${API_BASE_URL}${this.basePath(workspaceSlug, projectId)}${spreadsheetId}/download/`;
  }
}
