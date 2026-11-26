/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { action, makeObservable, observable, runInAction } from "mobx";
// services
import { ProjectReadmeService } from "@/services/project/project-readme.service";
import type { TProjectReadmeTemplate } from "@/services/project/project-readme.service";

export type TProjectReadmeServiceLike = Pick<ProjectReadmeService, "getReadme" | "createReadme">;

export type TProjectReadmeLoader = "init-loader" | "loaded" | "error";

export interface IProjectReadmeStore {
  /** projectId -> README page id (null when the project has none yet) */
  pageIds: Record<string, string | null>;
  /** projectId -> state of the last fetch */
  loaders: Record<string, TProjectReadmeLoader>;
  /** projectId -> template being created */
  creating: Record<string, TProjectReadmeTemplate>;
  // helpers
  getReadmePageId: (projectId: string) => string | null | undefined;
  getLoader: (projectId: string) => TProjectReadmeLoader | undefined;
  getCreatingTemplate: (projectId: string) => TProjectReadmeTemplate | undefined;
  // actions
  fetchReadme: (workspaceSlug: string, projectId: string) => Promise<string | null>;
  createReadme: (workspaceSlug: string, projectId: string, template: TProjectReadmeTemplate) => Promise<string | null>;
}

export class ProjectReadmeStore implements IProjectReadmeStore {
  pageIds: Record<string, string | null> = {};
  loaders: Record<string, TProjectReadmeLoader> = {};
  creating: Record<string, TProjectReadmeTemplate> = {};

  // not observable
  private service: TProjectReadmeServiceLike;
  private pendingCreates = new Map<string, Promise<string | null>>();
  /** projectId -> bumped whenever a create settles, so older fetch answers can be told apart */
  private writeVersions = new Map<string, number>();

  constructor(service: TProjectReadmeServiceLike = new ProjectReadmeService()) {
    makeObservable(this, {
      pageIds: observable,
      loaders: observable,
      creating: observable,
      fetchReadme: action,
      createReadme: action,
    });
    this.service = service;
  }

  getReadmePageId = (projectId: string) => this.pageIds[projectId];

  getLoader = (projectId: string) => this.loaders[projectId];

  getCreatingTemplate = (projectId: string) => this.creating[projectId];

  fetchReadme = async (workspaceSlug: string, projectId: string): Promise<string | null> => {
    // keep showing the known README while it is revalidated
    if (!(projectId in this.pageIds)) this.loaders[projectId] = "init-loader";
    const version = this.writeVersions.get(projectId) ?? 0;
    try {
      const response = await this.service.getReadme(workspaceSlug, projectId);
      const pageId = response?.page_id ?? null;
      runInAction(() => {
        // a README created while this request was in flight wins over its (older) answer;
        // otherwise the server is right, including null after the page was archived or deleted
        const isStale = version !== (this.writeVersions.get(projectId) ?? 0) || this.pendingCreates.has(projectId);
        if (!isStale) this.pageIds[projectId] = pageId;
        this.loaders[projectId] = "loaded";
      });
      return this.pageIds[projectId] ?? null;
    } catch (error) {
      runInAction(() => {
        this.loaders[projectId] = projectId in this.pageIds ? "loaded" : "error";
      });
      throw error;
    }
  };

  createReadme = (workspaceSlug: string, projectId: string, template: TProjectReadmeTemplate) => {
    // one README per project: a second click while the first is in flight reuses it
    const pending = this.pendingCreates.get(projectId);
    if (pending) return pending;

    this.creating[projectId] = template;
    const request = this.service
      .createReadme(workspaceSlug, projectId, template)
      .then((response) => {
        const pageId = response?.page_id ?? null;
        this.writeVersions.set(projectId, (this.writeVersions.get(projectId) ?? 0) + 1);
        runInAction(() => {
          this.pageIds[projectId] = pageId;
          this.loaders[projectId] = "loaded";
        });
        return pageId;
      })
      .finally(() => {
        this.pendingCreates.delete(projectId);
        runInAction(() => {
          delete this.creating[projectId];
        });
      });
    this.pendingCreates.set(projectId, request);
    return request;
  };
}
