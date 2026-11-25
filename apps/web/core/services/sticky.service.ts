/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// helpers
import { STICKIES_PER_PAGE, API_BASE_URL } from "@plane/constants";
import type { TPaginationInfo, TSticky, TStickyScope, TStickySharing } from "@plane/types";
// services
import { APIService } from "@/services/api.service";

export type TStickyListResponse = TPaginationInfo & { results: TSticky[] };

/** What every method of the service rejects with. `status` is undefined when there was no response. */
export type TStickyRequestError = {
  status: number | undefined;
  data: { error?: string; sticky?: TSticky } | undefined;
};

const toRequestError = (err: {
  response?: { status?: number; data?: TStickyRequestError["data"] };
}): TStickyRequestError => ({
  status: err?.response?.status,
  data: err?.response?.data,
});

export class StickyService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private getBasePath({ workspaceSlug, projectId }: TStickyScope) {
    return projectId
      ? `/api/workspaces/${workspaceSlug}/projects/${projectId}/stickies/`
      : `/api/workspaces/${workspaceSlug}/stickies/`;
  }

  async createSticky(scope: TStickyScope, payload: Partial<TSticky>): Promise<TSticky> {
    return this.post(this.getBasePath(scope), payload)
      .then((res) => res?.data)
      .catch((err) => {
        throw toRequestError(err);
      });
  }

  async getStickies(
    scope: TStickyScope,
    cursor: string,
    query?: string,
    per_page?: number
  ): Promise<TStickyListResponse> {
    return this.get(this.getBasePath(scope), {
      params: {
        cursor,
        per_page: per_page || STICKIES_PER_PAGE,
        query,
        pinned: scope.isPinned ? "true" : undefined,
      },
    })
      .then((res) => res?.data)
      .catch((err) => {
        throw toRequestError(err);
      });
  }

  async getSticky(scope: TStickyScope, id: string): Promise<TSticky> {
    return this.get(`${this.getBasePath(scope)}${id}/`)
      .then((res) => res?.data)
      .catch((err) => {
        throw toRequestError(err);
      });
  }

  async updateSticky(scope: TStickyScope, id: string, data: Partial<TSticky>): Promise<TSticky> {
    return this.patch(`${this.getBasePath(scope)}${id}/`, data)
      .then((res) => res?.data)
      .catch((err) => {
        throw toRequestError(err);
      });
  }

  /** Resolves to undefined when the user can no longer see the sticky afterwards. */
  async updateSharing(scope: TStickyScope, id: string, sharing: TStickySharing): Promise<TSticky | undefined> {
    return this.put(`${this.getBasePath(scope)}${id}/shares/`, sharing)
      .then((res) => (res?.status === 204 ? undefined : res?.data))
      .catch((err) => {
        throw toRequestError(err);
      });
  }

  async updatePin(scope: TStickyScope, id: string, isPinned: boolean): Promise<TSticky> {
    const url = `${this.getBasePath(scope)}${id}/pin/`;
    return (isPinned ? this.post(url) : this.delete(url))
      .then((res) => res?.data)
      .catch((err) => {
        throw toRequestError(err);
      });
  }

  async deleteSticky(scope: TStickyScope, id: string): Promise<void> {
    return this.delete(`${this.getBasePath(scope)}${id}/`)
      .then((res) => res?.data)
      .catch((err) => {
        throw toRequestError(err);
      });
  }
}
