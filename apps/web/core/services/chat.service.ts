/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import axios, { isCancel } from "axios";
import { API_BASE_URL } from "@plane/constants";
import type {
  TChatApiError,
  TChatConfig,
  TChatConversation,
  TChatCreateConversationPayload,
  TChatMember,
  TChatMessage,
  TChatMessagePage,
  TChatMessagePageQuery,
  TChatPresignedPost,
  TChatSendMessagePayload,
  TChatUnreadCount,
  TChatUpdateConversationPayload,
  TChatUploadRequest,
  TChatUploadResponse,
  TChatAttachment,
  TChatForwardPayload,
  TChatMembershipSettings,
  TChatMembershipSettingsPayload,
  TChatPreferences,
  TChatSearchQuery,
  TChatSearchResponse,
  TChatPinnedMessage,
  TChatReactionSummary,
} from "@plane/types";
import { APIService } from "@/services/api.service";

const toApiError = (error: unknown): TChatApiError => {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (data && typeof data === "object" && "error" in data) return data as TChatApiError;
  return { error: "Something went wrong. Please try again.", code: "NETWORK" };
};

/** REST client for workspace chat (docs/chat/02-api-contracts.md). */
export class ChatService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private base(workspaceSlug: string) {
    return `/api/workspaces/${workspaceSlug}/chat`;
  }

  private async call<T>(request: Promise<{ data: T }>): Promise<T> {
    try {
      const response = await request;
      return response.data;
    } catch (error) {
      throw toApiError(error);
    }
  }

  // ---------------------------------------------------------------- conversations

  listConversations(workspaceSlug: string, options: { archived?: boolean } = {}): Promise<TChatConversation[]> {
    return this.call(
      this.get(`${this.base(workspaceSlug)}/conversations/`, options.archived ? { params: { archived: "true" } } : {})
    );
  }

  /** My settings for one conversation: notify level, snooze, star, archive. */
  updateMembership(
    workspaceSlug: string,
    conversationId: string,
    payload: TChatMembershipSettingsPayload
  ): Promise<TChatMembershipSettings> {
    return this.call(this.patch(`${this.base(workspaceSlug)}/conversations/${conversationId}/me/`, payload));
  }

  getPreferences(workspaceSlug: string): Promise<TChatPreferences> {
    return this.call(this.get(`${this.base(workspaceSlug)}/preferences/`));
  }

  updatePreferences(workspaceSlug: string, payload: Partial<TChatPreferences>): Promise<TChatPreferences> {
    return this.call(this.patch(`${this.base(workspaceSlug)}/preferences/`, payload));
  }

  searchMessages(workspaceSlug: string, query: TChatSearchQuery): Promise<TChatSearchResponse> {
    return this.call(this.get(`${this.base(workspaceSlug)}/search/`, { params: query }));
  }

  getConversation(workspaceSlug: string, conversationId: string): Promise<TChatConversation> {
    return this.call(this.get(`${this.base(workspaceSlug)}/conversations/${conversationId}/`));
  }

  createConversation(workspaceSlug: string, payload: TChatCreateConversationPayload): Promise<TChatConversation> {
    return this.call(this.post(`${this.base(workspaceSlug)}/conversations/`, payload));
  }

  updateConversation(
    workspaceSlug: string,
    conversationId: string,
    payload: TChatUpdateConversationPayload
  ): Promise<TChatConversation> {
    return this.call(this.patch(`${this.base(workspaceSlug)}/conversations/${conversationId}/`, payload));
  }

  deleteConversation(workspaceSlug: string, conversationId: string): Promise<void> {
    return this.call(this.delete(`${this.base(workspaceSlug)}/conversations/${conversationId}/`));
  }

  // ---------------------------------------------------------------- members

  listMembers(workspaceSlug: string, conversationId: string): Promise<TChatMember[]> {
    return this.call(this.get(`${this.base(workspaceSlug)}/conversations/${conversationId}/members/`));
  }

  addMembers(workspaceSlug: string, conversationId: string, memberIds: string[]): Promise<TChatMember[]> {
    return this.call(
      this.post(`${this.base(workspaceSlug)}/conversations/${conversationId}/members/`, { member_ids: memberIds })
    );
  }

  updateMember(
    workspaceSlug: string,
    conversationId: string,
    userId: string,
    payload: Partial<{ role: number; is_muted: boolean }>
  ): Promise<TChatMember> {
    return this.call(
      this.patch(`${this.base(workspaceSlug)}/conversations/${conversationId}/members/${userId}/`, payload)
    );
  }

  removeMember(workspaceSlug: string, conversationId: string, userId: string): Promise<void> {
    return this.call(this.delete(`${this.base(workspaceSlug)}/conversations/${conversationId}/members/${userId}/`));
  }

  // ---------------------------------------------------------------- messages

  listMessages(
    workspaceSlug: string,
    conversationId: string,
    query: TChatMessagePageQuery = {}
  ): Promise<TChatMessagePage> {
    return this.call(
      this.get(`${this.base(workspaceSlug)}/conversations/${conversationId}/messages/`, { params: query })
    );
  }

  sendMessage(workspaceSlug: string, conversationId: string, payload: TChatSendMessagePayload): Promise<TChatMessage> {
    return this.call(this.post(`${this.base(workspaceSlug)}/conversations/${conversationId}/messages/`, payload));
  }

  editMessage(
    workspaceSlug: string,
    messageId: string,
    payload: { body_html: string; body_json?: Record<string, unknown> }
  ): Promise<TChatMessage> {
    return this.call(this.patch(`${this.base(workspaceSlug)}/messages/${messageId}/`, payload));
  }

  deleteMessage(workspaceSlug: string, messageId: string): Promise<void> {
    return this.call(this.delete(`${this.base(workspaceSlug)}/messages/${messageId}/`));
  }

  getMessage(workspaceSlug: string, messageId: string): Promise<TChatMessage> {
    return this.call(this.get(`${this.base(workspaceSlug)}/messages/${messageId}/`));
  }

  // ---------------------------------------------------------------- reactions, pins, forward (phase 2)

  addReaction(workspaceSlug: string, messageId: string, emoji: string): Promise<TChatReactionSummary[]> {
    return this.call(this.post(`${this.base(workspaceSlug)}/messages/${messageId}/reactions/`, { emoji }));
  }

  removeReaction(workspaceSlug: string, messageId: string, emoji: string): Promise<void> {
    return this.call(
      this.delete(`${this.base(workspaceSlug)}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/`)
    );
  }

  listPins(workspaceSlug: string, conversationId: string): Promise<TChatPinnedMessage[]> {
    return this.call(this.get(`${this.base(workspaceSlug)}/conversations/${conversationId}/pins/`));
  }

  pinMessage(workspaceSlug: string, messageId: string): Promise<{ message_id: string; is_pinned: boolean }> {
    return this.call(this.post(`${this.base(workspaceSlug)}/messages/${messageId}/pin/`, {}));
  }

  unpinMessage(workspaceSlug: string, messageId: string): Promise<void> {
    return this.call(this.delete(`${this.base(workspaceSlug)}/messages/${messageId}/pin/`));
  }

  forwardMessage(
    workspaceSlug: string,
    messageId: string,
    payload: TChatForwardPayload
  ): Promise<{ messages: Array<{ conversation_id: string; id: string; seq: number }> }> {
    return this.call(this.post(`${this.base(workspaceSlug)}/messages/${messageId}/forward/`, payload));
  }

  markRead(
    workspaceSlug: string,
    conversationId: string,
    seq: number
  ): Promise<{ last_read_seq: number; unread_count: number }> {
    return this.call(this.post(`${this.base(workspaceSlug)}/conversations/${conversationId}/read/`, { seq }));
  }

  // ---------------------------------------------------------------- misc

  unreadCount(workspaceSlug: string): Promise<TChatUnreadCount> {
    return this.call(this.get(`${this.base(workspaceSlug)}/unread-count/`));
  }

  presence(workspaceSlug: string): Promise<{ online_user_ids: string[] }> {
    return this.call(this.get(`${this.base(workspaceSlug)}/presence/`));
  }

  config(workspaceSlug: string): Promise<TChatConfig> {
    return this.call(this.get(`${this.base(workspaceSlug)}/config/`));
  }

  // ---------------------------------------------------------------- attachments

  requestUpload(
    workspaceSlug: string,
    conversationId: string,
    payload: TChatUploadRequest
  ): Promise<TChatUploadResponse> {
    return this.call(this.post(`${this.base(workspaceSlug)}/conversations/${conversationId}/attachments/`, payload));
  }

  requestThumbnailUpload(
    workspaceSlug: string,
    conversationId: string,
    assetId: string,
    payload: { type: string; size: number }
  ): Promise<{ upload_data: TChatPresignedPost }> {
    return this.call(
      this.post(
        `${this.base(workspaceSlug)}/conversations/${conversationId}/attachments/${assetId}/thumbnail/`,
        payload
      )
    );
  }

  confirmUpload(workspaceSlug: string, assetId: string): Promise<TChatAttachment> {
    return this.call(this.patch(`${this.base(workspaceSlug)}/attachments/${assetId}/`, {}));
  }

  cancelUpload(workspaceSlug: string, assetId: string): Promise<void> {
    return this.call(this.delete(`${this.base(workspaceSlug)}/attachments/${assetId}/`));
  }

  /** Upload straight to storage with a presigned POST (never through the API). */
  async uploadToStorage(
    uploadData: TChatPresignedPost,
    file: Blob,
    options: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {}
  ): Promise<void> {
    const form = new FormData();
    for (const [key, value] of Object.entries(uploadData.fields)) form.append(key, value);
    form.append("file", file);
    try {
      await axios.post(uploadData.url, form, {
        withCredentials: false,
        signal: options.signal,
        onUploadProgress: (event) => {
          if (options.onProgress && event.total) options.onProgress(Math.min(1, event.loaded / event.total));
        },
      });
    } catch (error) {
      if (isCancel(error)) throw { error: "Upload cancelled.", code: "CANCELLED" } satisfies TChatApiError;
      throw { error: "Upload failed.", code: "UPLOAD_FAILED" } satisfies TChatApiError;
    }
  }
}
