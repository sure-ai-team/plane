/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLiveSocketUrl } from "./chat-socket";
import { STICKY_CHANGE_DELAY_MS, StickyLiveUpdates } from "./sticky-live-updates";
import type { TStickySocketListeners } from "./sticky-live-updates";

let listeners: TStickySocketListeners;
let isHidden: boolean;
const socket = { connect: vi.fn(), disconnect: vi.fn() };
const onChange = vi.fn();
const onMissed = vi.fn();

const make = () =>
  new StickyLiveUpdates({
    workspaceSlug: "acme",
    projectId: "p1",
    createSocket: (socketListeners) => {
      listeners = socketListeners;
      return socket;
    },
    onChange,
    onMissed,
    isHidden: () => isHidden,
  });

const changed = (sticky_id: string, updated_at = "t1", project_id = "p1") =>
  listeners.onFrame({ t: "sticky.changed", d: { project_id, sticky_id, updated_at } });

const settle = () => vi.advanceTimersByTime(STICKY_CHANGE_DELAY_MS);

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  isHidden = false;
});

afterEach(() => vi.useRealTimers());

describe("StickyLiveUpdates", () => {
  it("connects for its workspace and disconnects", () => {
    const liveUpdates = make();
    liveUpdates.start();
    expect(socket.connect).toHaveBeenCalledWith("acme");
    liveUpdates.stop();
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it("reports the changes of one sticky once, with the latest time", () => {
    make();
    changed("a", "t1");
    changed("b");
    changed("a", "t2");
    expect(onChange).not.toHaveBeenCalled();
    settle();

    expect(onChange.mock.calls).toEqual([
      ["a", "t2"],
      ["b", "t1"],
    ]);
  });

  it("keeps reporting while changes go on", () => {
    make();
    for (let i = 0; i < 10; i++) {
      changed("a", `t${i}`);
      vi.advanceTimersByTime(STICKY_CHANGE_DELAY_MS / 2);
    }
    expect(onChange.mock.calls.length).toBeGreaterThan(2);
  });

  it("ignores other projects, other frames and malformed ones", () => {
    make();
    changed("a", "t1", "p2");
    listeners.onFrame({ t: "ready", d: { user_id: "u" } });
    listeners.onFrame({ t: "sticky.changed", d: null });
    listeners.onFrame({ t: "sticky.changed", d: { project_id: "p1" } });
    settle();

    expect(onChange).not.toHaveBeenCalled();
  });

  it("fetches nothing in the background and catches up when shown", () => {
    const liveUpdates = make();
    listeners.onStatus("open");
    isHidden = true;
    changed("a");
    settle();
    expect(onChange).not.toHaveBeenCalled();

    isHidden = false;
    liveUpdates.handleVisibility();
    settle();
    expect(onChange).toHaveBeenCalledExactlyOnceWith("a", "t1");
    expect(onMissed).not.toHaveBeenCalled();
  });

  it("holds back a change when the tab is hidden before it is reported", () => {
    const liveUpdates = make();
    listeners.onStatus("open");
    changed("a");
    isHidden = true;
    settle();
    expect(onChange).not.toHaveBeenCalled();

    isHidden = false;
    liveUpdates.handleVisibility();
    settle();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("fetches the list after a reconnection, not after the first connection", () => {
    make();
    listeners.onReady(false);
    expect(onMissed).not.toHaveBeenCalled();
    listeners.onReady(true);
    expect(onMissed).toHaveBeenCalledTimes(1);
  });

  it.each(["reconnecting", "blocked"] as const)(
    "without a connection (%s), showing the tab fetches the list",
    (status) => {
      const liveUpdates = make();
      listeners.onStatus(status);
      isHidden = true;
      liveUpdates.handleVisibility();
      expect(onMissed).not.toHaveBeenCalled();
      isHidden = false;
      liveUpdates.handleVisibility();
      expect(onMissed).toHaveBeenCalledTimes(1);
    }
  );

  it("reports nothing after it was stopped", () => {
    const liveUpdates = make();
    changed("a");
    liveUpdates.stop();
    settle();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("buildLiveSocketUrl", () => {
  it("addresses the stickies endpoint", () => {
    expect(buildLiveSocketUrl("https://pm.sure.test", "/live/", "stickies", "acme")).toBe(
      "wss://pm.sure.test/live/stickies/?workspace=acme"
    );
  });
});
