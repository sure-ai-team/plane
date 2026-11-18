/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { action, makeObservable, observable, runInAction } from "mobx";
import type { TChatApiError, TChatSearchHas, TChatSearchQuery, TChatSearchResult } from "@plane/types";
import type { IChatServiceLike } from "./types";

export type TChatSearchFilters = {
  conversation_id?: string;
  from?: string;
  has?: TChatSearchHas;
  after?: string;
  before?: string;
};

/** The server needs at least this much text unless a "has" filter is set. */
export const MIN_SEARCH_LENGTH = 2;

export const canSearch = (text: string, filters: TChatSearchFilters) =>
  text.trim().length >= MIN_SEARCH_LENGTH || !!filters.has;

/**
 * Message search state (docs/chat/phase-2/06-search.md). Only the newest
 * request's results are kept, so fast typing never shows stale results.
 */
export class ChatSearchStore {
  text = "";
  filters: TChatSearchFilters = {};
  results: TChatSearchResult[] = [];
  nextCursor: string | null = null;
  totalEstimate: number | null = null;
  isLoading = false;
  isLoadingMore = false;
  error: string | null = null;
  selectedIndex = 0;
  private requestId = 0;

  constructor(private readonly service: IChatServiceLike) {
    makeObservable(this, {
      text: observable,
      filters: observable.ref,
      results: observable.ref,
      nextCursor: observable,
      totalEstimate: observable,
      isLoading: observable,
      isLoadingMore: observable,
      error: observable,
      selectedIndex: observable,
      setText: action,
      setFilters: action,
      select: action,
      moveSelection: action,
      clear: action,
    });
  }

  get selected(): TChatSearchResult | undefined {
    return this.results[this.selectedIndex];
  }

  setText(text: string) {
    this.text = text;
  }

  setFilters(filters: TChatSearchFilters) {
    this.filters = filters;
  }

  select(index: number) {
    this.selectedIndex = Math.max(0, Math.min(index, this.results.length - 1));
  }

  moveSelection(delta: number) {
    this.select(this.selectedIndex + delta);
  }

  clear() {
    this.requestId += 1;
    this.results = [];
    this.nextCursor = null;
    this.totalEstimate = null;
    this.error = null;
    this.isLoading = false;
    this.selectedIndex = 0;
  }

  private query(cursor?: string): TChatSearchQuery {
    const query: TChatSearchQuery = { ...this.filters };
    const text = this.text.trim();
    if (text) query.q = text;
    if (cursor) query.cursor = cursor;
    return query;
  }

  async run(workspaceSlug: string): Promise<void> {
    if (!canSearch(this.text, this.filters)) {
      this.clear();
      return;
    }
    this.requestId += 1;
    const requestId = this.requestId;
    runInAction(() => {
      this.isLoading = true;
      this.error = null;
    });
    try {
      const response = await this.service.searchMessages(workspaceSlug, this.query());
      if (requestId !== this.requestId) return;
      runInAction(() => {
        this.results = response.results;
        this.nextCursor = response.next_cursor;
        this.totalEstimate = response.total_estimate ?? null;
        this.selectedIndex = 0;
      });
    } catch (error) {
      if (requestId !== this.requestId) return;
      runInAction(() => {
        this.results = [];
        this.nextCursor = null;
        this.error = (error as TChatApiError)?.error ?? "Search failed.";
      });
    } finally {
      if (requestId === this.requestId) {
        runInAction(() => {
          this.isLoading = false;
        });
      }
    }
  }

  async loadMore(workspaceSlug: string): Promise<void> {
    if (!this.nextCursor || this.isLoadingMore || this.isLoading) return;
    const requestId = this.requestId;
    runInAction(() => {
      this.isLoadingMore = true;
    });
    try {
      const response = await this.service.searchMessages(workspaceSlug, this.query(this.nextCursor));
      if (requestId !== this.requestId) return;
      runInAction(() => {
        this.results = [...this.results, ...response.results];
        this.nextCursor = response.next_cursor;
      });
    } catch {
      // Keep what we have; the user can scroll again.
    } finally {
      runInAction(() => {
        this.isLoadingMore = false;
      });
    }
  }
}
