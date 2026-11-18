/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { env } from "@/env";
import { APIService } from "@/services/api.service";

export type TChatAccess = "allowed" | "forbidden" | "disabled";

const statusOf = (error: unknown): number | undefined => {
  if (error && typeof error === "object" && "statusCode" in error) {
    const value = (error as { statusCode?: unknown }).statusCode;
    return typeof value === "number" ? value : undefined;
  }
  return undefined;
};

/**
 * Internal chat endpoints on the API, authenticated with the shared live-server secret.
 * They return ids and booleans only (docs/chat/07-security.md S10).
 */
export class ChatApiService extends APIService {
  private secretHeaders() {
    return { headers: { "X-Live-Secret": env.LIVE_SERVER_SECRET_KEY } };
  }

  async checkAccess(workspaceSlug: string, userId: string): Promise<TChatAccess> {
    try {
      const response = await this.get(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/chat/live/users/${userId}/access/`,
        {},
        this.secretHeaders()
      );
      return response?.data?.allowed === true ? "allowed" : "forbidden";
    } catch (error) {
      // The access endpoint answers allowed/forbidden for any workspace; a 404 means
      // chat is turned off in Superadmin (CHAT_DISABLED).
      if (statusOf(error) === 404) return "disabled";
      throw error;
    }
  }

  async memberIds(workspaceSlug: string, conversationId: string): Promise<string[]> {
    const response = await this.get(
      `/api/workspaces/${encodeURIComponent(workspaceSlug)}/chat/live/conversations/${conversationId}/member-ids/`,
      {},
      this.secretHeaders()
    );
    const ids: unknown = response?.data?.member_ids;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  }
}
