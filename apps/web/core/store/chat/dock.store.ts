/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { action, computed, makeObservable, observable } from "mobx";

/** At most this many windows are expanded; opening another minimizes the oldest (P2-D10). */
export const MAX_EXPANDED = 3;
/** Minimized tabs / heads kept beyond the expanded ones. */
export const MAX_DOCKED = 8;

export type TDockEntry = { id: string; minimized: boolean };

type TStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Minimized chat: conversations docked at the bottom of other pages
 * (docs/chat/phase-2/04-frontend.md § Minimized chat). Newest first.
 * Persisted per user and workspace so it survives navigation and reloads.
 */
export class ChatDockStore {
  entries: TDockEntry[] = [];
  isLauncherOpen = false;
  /** Set by the dock component: false on chat pages and narrow screens, where it is hidden. */
  isShown = false;
  private storageKey: string | null = null;

  constructor(private readonly storage: () => TStorage | null) {
    makeObservable(this, {
      entries: observable,
      isLauncherOpen: observable,
      isShown: observable,
      expandedIds: computed,
      minimizedIds: computed,
      open: action,
      minimize: action,
      expand: action,
      close: action,
      toggleLauncher: action,
      setShown: action,
      load: action,
      reset: action,
    });
  }

  get expandedIds(): string[] {
    return this.entries.filter((entry) => !entry.minimized).map((entry) => entry.id);
  }

  get minimizedIds(): string[] {
    return this.entries.filter((entry) => entry.minimized).map((entry) => entry.id);
  }

  has(id: string): boolean {
    return this.entries.some((entry) => entry.id === id);
  }

  /** The conversation is visible in an expanded window (suppresses desktop notifications for it). */
  isOnScreen(id: string): boolean {
    return this.isShown && this.expandedIds.includes(id);
  }

  /** Open (or bring forward) a conversation in an expanded window. */
  open(id: string) {
    this.entries = [{ id, minimized: false }, ...this.entries.filter((entry) => entry.id !== id)];
    this.isLauncherOpen = false;
    this.enforce();
  }

  expand(id: string) {
    this.open(id);
  }

  minimize(id: string) {
    this.entries = this.entries.map((entry) => (entry.id === id ? { ...entry, minimized: true } : entry));
    this.save();
  }

  close(id: string) {
    this.entries = this.entries.filter((entry) => entry.id !== id);
    this.save();
  }

  /** Drop conversations that no longer exist (left, deleted). */
  retain(isKnown: (id: string) => boolean) {
    const next = this.entries.filter((entry) => isKnown(entry.id));
    if (next.length !== this.entries.length) {
      this.entries = next;
      this.save();
    }
  }

  toggleLauncher(open?: boolean) {
    this.isLauncherOpen = open ?? !this.isLauncherOpen;
  }

  setShown(isShown: boolean) {
    this.isShown = isShown;
  }

  private enforce() {
    let expanded = 0;
    this.entries = this.entries
      .map((entry) => {
        if (entry.minimized) return entry;
        expanded += 1;
        return expanded > MAX_EXPANDED ? { ...entry, minimized: true } : entry;
      })
      .slice(0, MAX_EXPANDED + MAX_DOCKED);
    this.save();
  }

  // ------------------------------------------------------------------ persistence

  load(storageKey: string | null) {
    this.storageKey = storageKey;
    this.entries = [];
    this.isLauncherOpen = false;
    const raw = storageKey ? this.storage()?.getItem(storageKey) : null;
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as TDockEntry[];
      if (Array.isArray(saved)) {
        this.entries = saved
          .filter((entry) => typeof entry?.id === "string")
          .map((entry) => ({ id: entry.id, minimized: !!entry.minimized }));
        this.enforce();
      }
    } catch {
      // Corrupt state just means an empty dock.
    }
  }

  private save() {
    const storage = this.storage();
    if (!this.storageKey || !storage) return;
    try {
      if (this.entries.length === 0) storage.removeItem(this.storageKey);
      else storage.setItem(this.storageKey, JSON.stringify(this.entries));
    } catch {
      // Storage blocked or full: the dock still works for this page.
    }
  }

  reset() {
    this.entries = [];
    this.isLauncherOpen = false;
    this.storageKey = null;
  }
}
