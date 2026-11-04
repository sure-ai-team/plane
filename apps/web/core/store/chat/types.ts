/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ChatService } from "@/services/chat.service";

/**
 * The chat stores depend on this interface rather than on ChatService directly,
 * so tests can pass a fake.
 */
export type IChatServiceLike = Pick<
  ChatService,
  | "listConversations"
  | "updateMembership"
  | "searchMessages"
  | "getPreferences"
  | "updatePreferences"
  | "getConversation"
  | "createConversation"
  | "updateConversation"
  | "deleteConversation"
  | "listMembers"
  | "addMembers"
  | "updateMember"
  | "removeMember"
  | "listMessages"
  | "sendMessage"
  | "editMessage"
  | "deleteMessage"
  | "getMessage"
  | "addReaction"
  | "removeReaction"
  | "listPins"
  | "pinMessage"
  | "unpinMessage"
  | "forwardMessage"
  | "markRead"
  | "unreadCount"
  | "presence"
  | "config"
  | "requestUpload"
  | "requestThumbnailUpload"
  | "confirmUpload"
  | "cancelUpload"
  | "uploadToStorage"
>;
