/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { MAINTENANCE_EVENT, announceMaintenance, isMaintenanceResponse } from "@plane/constants";
import { stillPaused } from "./status";

const json = (body: unknown, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);

describe("isMaintenanceResponse", () => {
  it("matches only the restore pause", () => {
    expect(isMaintenanceResponse(503, { error: "MAINTENANCE" })).toBe(true);
    expect(isMaintenanceResponse(503, { error: "Something else" })).toBe(false);
    expect(isMaintenanceResponse(500, { error: "MAINTENANCE" })).toBe(false);
    expect(isMaintenanceResponse(503, undefined)).toBe(false);
    expect(isMaintenanceResponse(undefined, null)).toBe(false);
  });
});

describe("announceMaintenance", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("raises the maintenance event on window", () => {
    const target = new EventTarget();
    const listener = vi.fn();
    target.addEventListener(MAINTENANCE_EVENT, listener);
    vi.stubGlobal("window", target);
    announceMaintenance();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("does nothing without a window (server rendering)", () => {
    expect(() => announceMaintenance()).not.toThrow();
  });
});

describe("stillPaused", () => {
  it("is false once the server says maintenance is over", async () => {
    expect(await stillPaused(() => json({ active: false }))).toBe(false);
  });

  it("stays paused while active, on errors, and when the server is unreachable", async () => {
    expect(await stillPaused(() => json({ active: true }))).toBe(true);
    expect(await stillPaused(() => json({}, false))).toBe(true);
    expect(await stillPaused(() => Promise.reject(new Error("offline")))).toBe(true);
  });
});
