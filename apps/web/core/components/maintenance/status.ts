/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL, MAINTENANCE_STATUS_PATH } from "@plane/constants";

/** Whether the platform is still paused. Errors count as "still paused": the server may be restarting. */
export async function stillPaused(fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetcher(`${API_BASE_URL}${MAINTENANCE_STATUS_PATH}`, { cache: "no-store" });
    if (!response.ok) return true;
    const body = (await response.json()) as { active?: boolean };
    return body.active !== false;
  } catch {
    return true;
  }
}
