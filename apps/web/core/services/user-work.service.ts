/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type {
  TReportExportFormat,
  TTeamWorkResponse,
  TUserWorkActivityResponse,
  TUserWorkBucket,
  TUserWorkCycles,
  TUserWorkExportLabels,
  TUserWorkItemsResponse,
  TUserWorkSummary,
} from "@plane/types";
// services
import { APIService } from "@/services/api.service";
import { downloadBlobResponse } from "@/services/workspace-report.service";

export type TUserWorkParams = Record<string, string | number>;

/** Workload of workspace members: the Users list and the User Work pages. Everything here is read only. */
export class UserWorkService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private base(workspaceSlug: string) {
    return `/api/workspaces/${workspaceSlug}/users-work`;
  }

  /** Errors carry the status, so that pages can tell "not allowed" from "not loaded". */
  private async fetch<T>(url: string, params: TUserWorkParams = {}): Promise<T> {
    return this.get(url, { params })
      .then((response) => response?.data)
      .catch((error) => {
        throw { ...error?.response?.data, status: error?.response?.status };
      });
  }

  private async export(url: string, payload: Record<string, unknown>, fallbackName: string): Promise<void> {
    return this.post(url, payload, { responseType: "blob" })
      .then((response) => downloadBlobResponse(response.data, response.headers?.["content-disposition"], fallbackName))
      .catch((error) => {
        throw { status: error?.response?.status };
      });
  }

  async team(workspaceSlug: string, params: TUserWorkParams): Promise<TTeamWorkResponse> {
    return this.fetch(`${this.base(workspaceSlug)}/`, params);
  }

  async neglectedItems(
    workspaceSlug: string,
    bucket: TUserWorkBucket,
    params: TUserWorkParams
  ): Promise<TUserWorkItemsResponse> {
    return this.fetch(`${this.base(workspaceSlug)}/items/`, { ...params, bucket });
  }

  async summary(workspaceSlug: string, userId: string, params: TUserWorkParams): Promise<TUserWorkSummary> {
    return this.fetch(`${this.base(workspaceSlug)}/${userId}/summary/`, params);
  }

  async items(workspaceSlug: string, userId: string, params: TUserWorkParams): Promise<TUserWorkItemsResponse> {
    return this.fetch(`${this.base(workspaceSlug)}/${userId}/items/`, params);
  }

  async cycles(workspaceSlug: string, userId: string, params: TUserWorkParams): Promise<TUserWorkCycles> {
    return this.fetch(`${this.base(workspaceSlug)}/${userId}/cycles/`, params);
  }

  async activity(workspaceSlug: string, userId: string, params: TUserWorkParams): Promise<TUserWorkActivityResponse> {
    return this.fetch(`${this.base(workspaceSlug)}/${userId}/activity/`, params);
  }

  async exportTeam(
    workspaceSlug: string,
    payload: TUserWorkParams & { format: TReportExportFormat },
    labels: TUserWorkExportLabels
  ): Promise<void> {
    return this.export(`${this.base(workspaceSlug)}/export/`, { ...payload, labels }, "users");
  }

  async exportPerson(
    workspaceSlug: string,
    userId: string,
    payload: TUserWorkParams & { format: TReportExportFormat; type: "items" | "activity" },
    labels: TUserWorkExportLabels
  ): Promise<void> {
    return this.export(`${this.base(workspaceSlug)}/${userId}/export/`, { ...payload, labels }, "user-work");
  }
}

export const userWorkService = new UserWorkService();
