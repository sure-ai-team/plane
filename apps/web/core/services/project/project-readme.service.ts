/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
// services
import { APIService } from "@/services/api.service";

/** Starting content the server seeds a new project README with. */
export type TProjectReadmeTemplate = "blank" | "product" | "architecture" | "onboarding";

/** The project page that serves as the README, if one has been created. */
export type TProjectReadme = {
  page_id: string | null;
};

export class ProjectReadmeService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async getReadme(workspaceSlug: string, projectId: string): Promise<TProjectReadme> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/readme/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Creates the README page from a template. Returns the existing one if it already exists. */
  async createReadme(
    workspaceSlug: string,
    projectId: string,
    template: TProjectReadmeTemplate
  ): Promise<TProjectReadme> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/readme/`, { template })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
