/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { orderBy, pick } from "lodash-es";
import { observable, action, makeObservable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
import { STICKIES_PER_PAGE } from "@plane/constants";
import type { TLoader, TPaginationInfo, TSticky, TStickyScope, TStickySharing } from "@plane/types";
import { StickyService } from "@/services/sticky.service";
import type { TStickyRequestError } from "@/services/sticky.service";

/** One list of stickies: the personal ones of a workspace, or those of a project. */
export type TStickyList = {
  stickyIds: string[];
  loader: TLoader;
  isCreating: boolean;
  searchQuery: string;
  paginationInfo: TPaginationInfo | undefined;
};

/**
 * Unsaved local changes to a project sticky. Saves of one sticky run one at a
 * time, each based on the version the previous one returned.
 */
type TStickyDraft = {
  /** version the local content is based on */
  baseVersion: number;
  /** the sticky as last confirmed by the server */
  confirmed: TSticky;
  /** changes not sent yet */
  pending: Partial<TSticky>;
  /** the editor has changes that are still being debounced */
  isDirty: boolean;
  running: Promise<void> | undefined;
};

export type TStickyServiceLike = Pick<
  StickyService,
  "createSticky" | "getStickies" | "getSticky" | "updateSticky" | "updateSharing" | "updatePin" | "deleteSticky"
>;

export interface IStickyStore {
  stickies: Record<string, TSticky>; // stickyId -> sticky
  conflicts: Record<string, TSticky>; // stickyId -> the version someone else saved
  revisions: Record<string, number>; // stickyId -> incremented when the editor must reload its content
  // personal stickies
  activeStickyId: string | undefined;
  recentStickyId: string | undefined;
  showAddNewSticky: boolean;
  // computed
  getList: (scope: TStickyScope) => TStickyList;
  getStickyIds: (scope: TStickyScope) => string[];
  // actions
  toggleShowNewSticky: (value: boolean) => void;
  updateActiveStickyId: (id: string | undefined) => void;
  updateSearchQuery: (scope: TStickyScope, query: string) => void;
  fetchRecentSticky: (workspaceSlug: string) => Promise<void>;
  fetchStickies: (scope: TStickyScope) => Promise<void>;
  fetchNextStickies: (scope: TStickyScope) => Promise<void>;
  createSticky: (scope: TStickyScope, sticky: Partial<TSticky>) => Promise<void>;
  markStickyDirty: (scope: TStickyScope, id: string) => void;
  updateSticky: (scope: TStickyScope, id: string, updates: Partial<TSticky>) => Promise<void>;
  resolveConflict: (scope: TStickyScope, id: string, keep: "mine" | "theirs") => Promise<void>;
  fetchSticky: (scope: TStickyScope, id: string) => Promise<void>;
  /** Someone else may have changed the sticky. Resolves to whether unsaved changes were lost with it. */
  handleRemoteChange: (scope: TStickyScope, id: string, updatedAt?: string) => Promise<boolean>;
  updateSharing: (scope: TStickyScope, id: string, sharing: TStickySharing) => Promise<void>;
  updatePin: (scope: TStickyScope, id: string, isPinned: boolean) => Promise<void>;
  deleteSticky: (scope: TStickyScope, id: string) => Promise<void>;
  updateStickyPosition: (
    scope: TStickyScope,
    stickyId: string,
    destinationId: string,
    edge: "left" | "right"
  ) => Promise<void>;
}

// fields the server versions, see ProjectStickyViewSet
const CONTENT_FIELDS: (keyof TSticky)[] = ["name", "description", "description_html"];

// distance between two stickies, as used by the server
const SORT_ORDER_STEP = 10000;

const EMPTY_LIST: TStickyList = Object.freeze({
  stickyIds: [],
  loader: "init-loader",
  isCreating: false,
  searchQuery: "",
  paginationInfo: undefined,
});

const hasContent = (updates: Partial<TSticky>) => CONTENT_FIELDS.some((field) => field in updates);

/** Compares times the API and the live server format differently. */
const toTime = (value: string | undefined) => (value ? new Date(value).getTime() : undefined);

const PINNED_SUFFIX = "/pinned";

const getScopeKey = ({ workspaceSlug, projectId, isPinned }: TStickyScope) =>
  `${projectId ? `${workspaceSlug}/${projectId}` : workspaceSlug}${isPinned ? PINNED_SUFFIX : ""}`;

export class StickyStore implements IStickyStore {
  lists: Record<string, TStickyList> = {};
  stickies: Record<string, TSticky> = {};
  conflicts: Record<string, TSticky> = {};
  revisions: Record<string, number> = {};
  recentStickyId: string | undefined = undefined;
  activeStickyId: string | undefined = undefined;
  showAddNewSticky = false;

  // not observable
  private drafts = new Map<string, TStickyDraft>();
  private latestRequest = new Map<string, number>();
  private stickyService: TStickyServiceLike;

  constructor(stickyService: TStickyServiceLike = new StickyService()) {
    makeObservable(this, {
      // observables
      lists: observable,
      stickies: observable,
      conflicts: observable,
      revisions: observable,
      activeStickyId: observable,
      showAddNewSticky: observable,
      recentStickyId: observable,
      // actions
      updateSearchQuery: action,
      updateSticky: action,
      deleteSticky: action,
      fetchNextStickies: action,
      fetchStickies: action,
      createSticky: action,
      resolveConflict: action,
      fetchSticky: action,
      handleRemoteChange: action,
      updateSharing: action,
      updatePin: action,
      updateActiveStickyId: action,
      toggleShowNewSticky: action,
      fetchRecentSticky: action,
      updateStickyPosition: action,
    });
    this.stickyService = stickyService;
  }

  // computed

  getList = (scope: TStickyScope): TStickyList => this.lists[getScopeKey(scope)] ?? EMPTY_LIST;

  getStickyIds = (scope: TStickyScope) => this.getSortedIds(getScopeKey(scope));

  private getSortedIds = computedFn((scopeKey: string) => {
    const stickies = (this.lists[scopeKey]?.stickyIds ?? []).map((stickyId) => this.stickies[stickyId]).filter(Boolean);
    const sortedStickies = scopeKey.endsWith(PINNED_SUFFIX)
      ? // the last pinned first, without those unpinned since the list was fetched
        orderBy(
          stickies.filter((sticky) => !!sticky.pinned_at),
          ["pinned_at"],
          ["desc"]
        )
      : orderBy(stickies, ["sort_order"], ["desc"]);
    return sortedStickies.map((sticky) => sticky.id);
  });

  // helpers

  /** The observable list of a scope; call from within an action. */
  private ensureList = (scope: TStickyScope): TStickyList => {
    const key = getScopeKey(scope);
    if (!this.lists[key]) this.lists[key] = { ...EMPTY_LIST, stickyIds: [] };
    return this.lists[key];
  };

  private startRequest = (scope: TStickyScope) => {
    const key = getScopeKey(scope);
    const request = (this.latestRequest.get(key) ?? 0) + 1;
    this.latestRequest.set(key, request);
    return () => this.latestRequest.get(key) === request;
  };

  /** Make the editor show the stored content. It only reads its content when it mounts. */
  private reloadEditor = (id: string) => {
    this.revisions[id] = (this.revisions[id] ?? 0) + 1;
  };

  /** Store a sticky received from the server without losing unsaved local changes. */
  private adopt = (sticky: TSticky) => {
    const current = this.stickies[sticky.id];
    const draft = this.drafts.get(sticky.id);
    // a response overtaken by a newer one
    if (current && (toTime(sticky.updated_at) ?? Infinity) < (toTime(current.updated_at) ?? -Infinity)) return;
    if (current && draft) {
      // Keep the local content and the version it is based on, so that saving it
      // is checked against that version and not against one the user never saw.
      this.stickies[sticky.id] = {
        ...sticky,
        ...pick(current, [...CONTENT_FIELDS, "content_version"]),
        ...draft.pending,
      };
      if (this.conflicts[sticky.id]) this.conflicts[sticky.id] = sticky;
      return;
    }
    this.stickies[sticky.id] = sticky;
    if (current && current.content_version !== sticky.content_version) this.reloadEditor(sticky.id);
  };

  private forget = (scope: TStickyScope, id: string) => {
    Object.values(this.lists).forEach((list) => {
      if (list.stickyIds.includes(id)) list.stickyIds = list.stickyIds.filter((stickyId) => stickyId !== id);
    });
    this.drafts.delete(id);
    delete this.conflicts[id];
    delete this.stickies[id];
    if (this.activeStickyId === id) this.activeStickyId = undefined;
    if (this.recentStickyId === id) this.recentStickyId = this.getStickyIds(scope)[0];
  };

  // actions

  toggleShowNewSticky = (value: boolean) => {
    this.showAddNewSticky = value;
  };

  updateSearchQuery = (scope: TStickyScope, query: string) => {
    this.ensureList(scope).searchQuery = query;
  };

  updateActiveStickyId = (id: string | undefined) => {
    this.activeStickyId = id;
  };

  fetchRecentSticky = async (workspaceSlug: string) => {
    const response = await this.stickyService.getStickies({ workspaceSlug }, "1:0:0", undefined, 1);
    const recentSticky = response.results[0];
    runInAction(() => {
      if (recentSticky) this.adopt(recentSticky);
      this.recentStickyId = recentSticky?.id;
    });
  };

  fetchNextStickies = async (scope: TStickyScope) => {
    const { paginationInfo, loader, searchQuery } = this.getList(scope);
    if (!paginationInfo?.next_cursor || !paginationInfo.next_page_results || loader !== "loaded") return;

    const isLatest = this.startRequest(scope);
    this.ensureList(scope).loader = "pagination";
    try {
      const response = await this.stickyService.getStickies(scope, paginationInfo.next_cursor, searchQuery);
      if (!isLatest()) return;
      runInAction(() => {
        const list = this.ensureList(scope);
        const { results, ...nextPaginationInfo } = response;
        results.forEach((sticky) => {
          if (!list.stickyIds.includes(sticky.id)) list.stickyIds.push(sticky.id);
          this.adopt(sticky);
        });
        list.paginationInfo = nextPaginationInfo;
        list.loader = "loaded";
      });
    } catch (e) {
      console.error(e);
      if (!isLatest()) return;
      runInAction(() => {
        this.ensureList(scope).loader = "loaded";
      });
    }
  };

  fetchStickies = async (scope: TStickyScope) => {
    const isLatest = this.startRequest(scope);
    const currentList = this.ensureList(scope);
    currentList.loader = currentList.loader === "init-loader" ? "init-loader" : "mutation";
    try {
      const response = await this.stickyService.getStickies(scope, `${STICKIES_PER_PAGE}:0:0`, currentList.searchQuery);
      // a newer search has been started meanwhile
      if (!isLatest()) return;
      runInAction(() => {
        const list = this.ensureList(scope);
        const { results, ...paginationInfo } = response;
        results.forEach((sticky) => this.adopt(sticky));
        list.stickyIds = results.map((sticky) => sticky.id);
        list.paginationInfo = paginationInfo;
        list.loader = "loaded";
      });
    } catch (e) {
      console.error(e);
      if (!isLatest()) return;
      runInAction(() => {
        this.ensureList(scope).loader = "loaded";
      });
    }
  };

  createSticky = async (scope: TStickyScope, sticky: Partial<TSticky>) => {
    if (scope.projectId) {
      if (this.getList(scope).isCreating) return;
    } else {
      if (!this.showAddNewSticky) return;
      this.showAddNewSticky = false;
    }
    this.ensureList(scope).isCreating = true;
    try {
      const response = await this.stickyService.createSticky(scope, sticky);
      runInAction(() => {
        const list = this.ensureList(scope);
        this.stickies[response.id] = response;
        // it may have arrived through live updates already
        list.stickyIds = [response.id, ...list.stickyIds.filter((stickyId) => stickyId !== response.id)];
        if (!scope.projectId) {
          this.activeStickyId = response.id;
          this.recentStickyId = response.id;
        }
      });
    } finally {
      runInAction(() => {
        this.ensureList(scope).isCreating = false;
      });
    }
  };

  /** The user started changing the content; until it is saved, nothing fetched may replace it. */
  markStickyDirty = (scope: TStickyScope, id: string) => {
    if (!scope.projectId) return;
    const draft = this.getDraft(id);
    if (draft) draft.isDirty = true;
  };

  private getDraft = (id: string): TStickyDraft | undefined => {
    const sticky = this.stickies[id];
    if (!sticky) return undefined;
    let draft = this.drafts.get(id);
    if (!draft) {
      draft = {
        baseVersion: sticky.content_version ?? 1,
        confirmed: { ...sticky },
        pending: {},
        isDirty: false,
        running: undefined,
      };
      this.drafts.set(id, draft);
    }
    return draft;
  };

  updateSticky = async (scope: TStickyScope, id: string, updates: Partial<TSticky>) => {
    const sticky = this.stickies[id];
    if (!sticky) return;

    if (!scope.projectId) {
      const previous = pick(sticky, Object.keys(updates));
      Object.assign(sticky, updates);
      this.recentStickyId = id;
      try {
        await this.stickyService.updateSticky(scope, id, updates);
      } catch (error) {
        console.error("Error in updating sticky:", error);
        runInAction(() => {
          if (this.stickies[id]) Object.assign(this.stickies[id], previous);
        });
        throw error;
      }
      return;
    }

    const draft = this.getDraft(id);
    if (!draft) return;
    Object.assign(sticky, updates);
    Object.assign(draft.pending, updates);
    if (hasContent(updates)) draft.isDirty = false;
    // held back until the user has chosen a version
    if (this.conflicts[id]) return;

    if (!draft.running)
      draft.running = this.saveDraft(scope, id, draft).finally(() => {
        draft.running = undefined;
      });
    await draft.running;
  };

  private saveDraft = async (scope: TStickyScope, id: string, draft: TStickyDraft) => {
    while (Object.keys(draft.pending).length > 0) {
      const changes = draft.pending;
      draft.pending = {};
      const isContent = hasContent(changes);
      try {
        // one save at a time: each is based on the version the previous one returned
        // oxlint-disable-next-line no-await-in-loop
        const saved = await this.stickyService.updateSticky(
          scope,
          id,
          isContent ? { ...changes, content_version: draft.baseVersion } : changes
        );
        draft.confirmed = saved;
        if (isContent) draft.baseVersion = saved.content_version ?? draft.baseVersion;
      } catch (error) {
        this.handleSaveError(scope, id, draft, changes, error as TStickyRequestError);
        return;
      }
    }

    if (!this.stickies[id] || this.drafts.get(id) !== draft) return;
    runInAction(() => {
      // more typing is on its way: it continues from what was just saved
      this.stickies[id].content_version = draft.baseVersion;
      if (draft.isDirty) return;
      this.drafts.delete(id);
      this.adopt(draft.confirmed);
    });
  };

  private handleSaveError = (
    scope: TStickyScope,
    id: string,
    draft: TStickyDraft,
    changes: Partial<TSticky>,
    error: TStickyRequestError
  ) => {
    // deleted meanwhile
    if (!this.stickies[id] || this.drafts.get(id) !== draft) return;

    const conflicting = error?.status === 409 ? error.data?.sticky : undefined;
    if (!conflicting && (error?.status === 403 || error?.status === 404)) {
      // The user may no longer edit the sticky, or no longer see it
      runInAction(() => {
        this.drafts.delete(id);
        this.stickies[id] = draft.confirmed;
        this.reloadEditor(id);
      });
      void this.refreshSticky(scope, id);
      throw error;
    }

    // Keep what the user wrote: for the user to decide about, or to be sent with the next change
    draft.pending = { ...changes, ...draft.pending };
    if (!conflicting) throw error;
    runInAction(() => {
      this.conflicts[id] = conflicting;
    });
  };

  private refreshSticky = async (scope: TStickyScope, id: string) => {
    try {
      const sticky = await this.stickyService.getSticky(scope, id);
      runInAction(() => this.adopt(sticky));
    } catch (error) {
      const status = (error as TStickyRequestError)?.status;
      if (status === 403 || status === 404) runInAction(() => this.forget(scope, id));
    }
  };

  resolveConflict = async (scope: TStickyScope, id: string, keep: "mine" | "theirs") => {
    const theirs = this.conflicts[id];
    const draft = this.drafts.get(id);
    if (!theirs || !draft) return;
    delete this.conflicts[id];

    if (keep === "theirs") {
      this.drafts.delete(id);
      this.stickies[id] = theirs;
      this.reloadEditor(id);
      return;
    }
    draft.confirmed = theirs;
    draft.baseVersion = theirs.content_version ?? draft.baseVersion;
    await this.updateSticky(scope, id, draft.pending);
  };

  /** Make sure a sticky is in the list, e.g. one that was linked to. Rejects when it cannot be seen. */
  fetchSticky = async (scope: TStickyScope, id: string) => {
    const sticky = await this.stickyService.getSticky(scope, id);
    runInAction(() => {
      const list = this.ensureList(scope);
      this.adopt(sticky);
      if (!list.stickyIds.includes(id)) list.stickyIds.push(id);
    });
  };

  handleRemoteChange = async (scope: TStickyScope, id: string, updatedAt?: string) => {
    // it may be the change this tab is saving
    await this.drafts.get(id)?.running?.catch(() => undefined);
    const time = toTime(updatedAt);
    const isOwnChange = [this.stickies[id], this.drafts.get(id)?.confirmed].some(
      (sticky) => time !== undefined && toTime(sticky?.updated_at) === time
    );
    if (isOwnChange) return false;

    try {
      const sticky = await this.stickyService.getSticky(scope, id);
      runInAction(() => {
        this.adopt(sticky);
        const list = this.lists[getScopeKey({ ...scope, isPinned: false })];
        // a search shows its results only
        if (list && list.loader !== "init-loader" && !list.searchQuery && !list.stickyIds.includes(id))
          list.stickyIds.push(id);
        const pinnedList = this.lists[getScopeKey({ ...scope, isPinned: true })];
        if (sticky.pinned_at && pinnedList && !pinnedList.stickyIds.includes(id)) pinnedList.stickyIds.push(id);
      });
      return false;
    } catch (error) {
      const status = (error as TStickyRequestError)?.status;
      if (status !== 403 && status !== 404) return false;
      const hasLostChanges = this.drafts.has(id);
      if (this.stickies[id]) runInAction(() => this.forget(scope, id));
      return hasLostChanges;
    }
  };

  updateSharing = async (scope: TStickyScope, id: string, sharing: TStickySharing) => {
    // a save that is still running would bring back the previous sharing
    await this.drafts.get(id)?.running?.catch(() => undefined);
    try {
      const sticky = await this.stickyService.updateSharing(scope, id, sharing);
      runInAction(() => {
        if (sticky) this.adopt(sticky);
        else this.forget(scope, id);
      });
    } catch (error) {
      const status = (error as TStickyRequestError)?.status;
      if (status === 403 || status === 404) void this.refreshSticky(scope, id);
      throw error;
    }
  };

  updatePin = async (scope: TStickyScope, id: string, isPinned: boolean) => {
    // a save that is still running would bring back the previous state
    await this.drafts.get(id)?.running?.catch(() => undefined);
    try {
      const sticky = await this.stickyService.updatePin(scope, id, isPinned);
      runInAction(() => {
        this.adopt(sticky);
        const pinnedList = this.lists[getScopeKey({ ...scope, isPinned: true })];
        if (isPinned && pinnedList && !pinnedList.stickyIds.includes(id)) pinnedList.stickyIds.push(id);
      });
    } catch (error) {
      const status = (error as TStickyRequestError)?.status;
      if (status === 403 || status === 404) void this.refreshSticky(scope, id);
      throw error;
    }
  };

  deleteSticky = async (scope: TStickyScope, id: string) => {
    if (!this.stickies[id]) return;
    try {
      await this.stickyService.deleteSticky(scope, id);
    } catch (error) {
      // already deleted by someone else
      if ((error as TStickyRequestError)?.status !== 404) throw error;
    }
    runInAction(() => this.forget(scope, id));
  };

  updateStickyPosition = async (
    scope: TStickyScope,
    stickyId: string,
    destinationId: string,
    edge: "left" | "right"
  ) => {
    if (!this.stickies[stickyId]) return;
    const previousSortOrder = this.stickies[stickyId].sort_order;
    try {
      // the neighbours at the new position; the list is in descending order
      const otherIds = this.getStickyIds(scope).filter((id) => id !== stickyId);
      const destinationIndex = otherIds.indexOf(destinationId);
      if (destinationIndex === -1) return;
      const nextIndex = edge === "left" ? destinationIndex : destinationIndex + 1;
      const previous = this.stickies[otherIds[nextIndex - 1]]?.sort_order;
      const next = this.stickies[otherIds[nextIndex]]?.sort_order;

      let resultSequence = SORT_ORDER_STEP;
      if (previous !== undefined && next !== undefined) resultSequence = (previous + next) / 2;
      else if (next !== undefined) resultSequence = next + SORT_ORDER_STEP;
      else if (previous !== undefined) resultSequence = previous - SORT_ORDER_STEP;

      runInAction(() => {
        this.stickies[stickyId].sort_order = resultSequence;
      });

      const moved = await this.stickyService.updateSticky(scope, stickyId, {
        sort_order: resultSequence,
      });
      runInAction(() => {
        // recognises the live update of this change
        if (this.stickies[stickyId]) this.stickies[stickyId].updated_at = moved.updated_at;
      });
    } catch (error) {
      console.error("Failed to move sticky");
      runInAction(() => {
        if (this.stickies[stickyId]) this.stickies[stickyId].sort_order = previousSortOrder;
      });
      throw error;
    }
  };
}
