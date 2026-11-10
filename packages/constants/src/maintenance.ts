/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { MAINTENANCE_EVENT } from "./endpoints";

/** True for the API's "paused for a restore" answer (HTTP 503 with error MAINTENANCE). */
export function isMaintenanceResponse(status: number | undefined, body: unknown): boolean {
  return status === 503 && (body as { error?: unknown } | null | undefined)?.error === "MAINTENANCE";
}

/** Tells the app the platform is paused; the web app shows its maintenance screen. */
export function announceMaintenance(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(MAINTENANCE_EVENT));
}
