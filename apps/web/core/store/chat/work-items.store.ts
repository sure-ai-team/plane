/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { action, makeObservable, observable } from "mobx";
import type { TChatWorkItemRef, TIssue } from "@plane/types";

/** What a chat card shows for a work item (docs/chat/phase-2/04-frontend.md § Work-item integration). */
export type TChatWorkItemCard = {
  id: string;
  projectId: string;
  identifier: string;
  sequenceId: number;
  name: string;
  stateId: string | null;
  priority: TIssue["priority"];
  assigneeIds: string[];
  targetDate: string | null;
  subIssuesCount: number;
  isArchived: boolean;
};

/** Loads work items through the existing work-item API, which applies project permissions. */
export type TWorkItemFetcher = (workspaceSlug: string, projectId: string, ids: string[]) => Promise<TIssue[]>;

/** "missing": not found or not visible to me — the card falls back to a plain chip (P2-S4). */
export type TWorkItemEntry = TChatWorkItemCard | "missing";

export const WORK_ITEM_BATCH_MS = 50;
/** A card older than this is fetched again the next time it is shown (state, assignee and name change). */
export const WORK_ITEM_STALE_MS = 60_000;

/** Batches card lookups per project so a thread full of links makes one request per project. */
export class ChatWorkItemStore {
  items = new Map<string, TWorkItemEntry>();
  private queue = new Map<string, { slug: string; refs: Map<string, TChatWorkItemRef> }>();
  /** When each item was last requested, so stale cards refresh. */
  private requested = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly fetchItems: TWorkItemFetcher | null,
    private readonly now: () => number = Date.now
  ) {
    makeObservable(this, { items: observable, apply: action, reset: action });
  }

  get = (id: string): TWorkItemEntry | undefined => this.items.get(id);

  request(workspaceSlug: string, ref: TChatWorkItemRef) {
    if (!this.fetchItems) return;
    const last = this.requested.get(ref.id);
    if (last !== undefined && this.now() - last < WORK_ITEM_STALE_MS) return;
    this.requested.set(ref.id, this.now());
    const batch = this.queue.get(ref.project_id) ?? { slug: workspaceSlug, refs: new Map() };
    batch.refs.set(ref.id, ref);
    this.queue.set(ref.project_id, batch);
    if (!this.timer) this.timer = setTimeout(() => void this.flush(), WORK_ITEM_BATCH_MS);
  }

  async flush(): Promise<void> {
    this.timer = null;
    const batches = Array.from(this.queue.entries());
    this.queue.clear();
    await Promise.all(
      batches.map(async ([projectId, batch]) => {
        const refs = Array.from(batch.refs.values());
        try {
          const issues = await this.fetchItems!(
            batch.slug,
            projectId,
            refs.map((ref) => ref.id)
          );
          this.apply(refs, issues);
        } catch {
          // A failed refresh keeps the card already shown; only first loads fall back to the chip.
          this.apply(
            refs.filter((ref) => !this.items.has(ref.id)),
            []
          );
        }
      })
    );
  }

  apply(refs: TChatWorkItemRef[], issues: TIssue[]) {
    const byId = new Map(issues.map((issue) => [issue.id, issue]));
    for (const ref of refs) {
      const issue = byId.get(ref.id);
      this.items.set(
        ref.id,
        issue
          ? {
              id: issue.id,
              projectId: ref.project_id,
              identifier: ref.project_identifier,
              sequenceId: issue.sequence_id ?? ref.sequence_id,
              name: issue.name,
              stateId: issue.state_id ?? null,
              priority: issue.priority,
              assigneeIds: issue.assignee_ids ?? [],
              targetDate: issue.target_date ?? null,
              subIssuesCount: issue.sub_issues_count ?? 0,
              isArchived: !!issue.archived_at,
            }
          : "missing"
      );
    }
  }

  reset() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.items.clear();
    this.queue.clear();
    this.requested.clear();
  }
}
