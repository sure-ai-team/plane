/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ChatSocket, TChatSocketStatus } from "./chat-socket";

/** Changes of one sticky within this time are fetched once. */
export const STICKY_CHANGE_DELAY_MS = 300;

/** What the live server sends; see plane/utils/sticky_events.py. */
export type TStickyChangedFrame = {
  t: "sticky.changed";
  d: { project_id: string; sticky_id: string; updated_at?: string };
};

export type TStickySocketListeners = {
  onFrame: (frame: { t: string; d: unknown }) => void;
  onReady: (isReconnect: boolean) => void;
  onStatus: (status: TChatSocketStatus) => void;
};

export type TStickyLiveUpdatesOptions = {
  workspaceSlug: string;
  projectId: string;
  createSocket: (listeners: TStickySocketListeners) => Pick<ChatSocket, "connect" | "disconnect">;
  /** A sticky changed, or the user gained or lost access to it. */
  onChange: (stickyId: string, updatedAt: string | undefined) => void;
  /** Changes may have been missed. */
  onMissed: () => void;
  isHidden: () => boolean;
};

const isStickyChanged = (frame: { t: string; d: unknown }): frame is TStickyChangedFrame => {
  const d = frame.d as Partial<TStickyChangedFrame["d"]> | null | undefined;
  return frame.t === "sticky.changed" && typeof d?.project_id === "string" && typeof d?.sticky_id === "string";
};

/**
 * Changes other people make to the stickies of one project. Nothing is fetched
 * for a tab in the background; it catches up when it is shown again. Without a
 * connection, showing the tab fetches the list instead.
 */
export class StickyLiveUpdates {
  private readonly socket: Pick<ChatSocket, "connect" | "disconnect">;
  private status: TChatSocketStatus = "idle";
  private changes = new Map<string, string | undefined>(); // stickyId -> updated_at
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: TStickyLiveUpdatesOptions) {
    this.socket = options.createSocket({
      onFrame: this.handleFrame,
      onReady: (isReconnect) => {
        if (isReconnect) this.options.onMissed();
      },
      onStatus: (status) => {
        this.status = status;
      },
    });
  }

  start() {
    this.socket.connect(this.options.workspaceSlug);
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.changes.clear();
    this.socket.disconnect();
  }

  /** To be called when the tab is shown or hidden. */
  handleVisibility = () => {
    if (this.options.isHidden()) return;
    if (this.status === "open" || this.status === "idle") this.schedule();
    else this.options.onMissed();
  };

  private handleFrame = (frame: { t: string; d: unknown }) => {
    if (!isStickyChanged(frame) || frame.d.project_id !== this.options.projectId) return;
    this.changes.set(frame.d.sticky_id, frame.d.updated_at);
    this.schedule();
  };

  private schedule() {
    if (this.timer !== undefined || this.changes.size === 0 || this.options.isHidden()) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.options.isHidden()) return;
      const changes = Array.from(this.changes);
      this.changes.clear();
      for (const [stickyId, updatedAt] of changes) this.options.onChange(stickyId, updatedAt);
    }, STICKY_CHANGE_DELAY_MS);
  }
}
