/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import ReconnectingWebSocket from "partysocket/ws";
import { v4 as uuidv4 } from "uuid";
import { LIVE_BASE_PATH, LIVE_BASE_URL } from "@plane/constants";
import type { IUser, TChatUser } from "@plane/types";
import { ChatService } from "@/services/chat.service";
import { IssueService } from "@/services/issue";
import { createBrowserNotifier, createNotifyChannel } from "@/services/chat-notifier";
import { buildChatSocketUrl, ChatSocket } from "@/services/chat-socket";
import type { IChatTransport } from "@/services/chat-socket";
import { TabLeader } from "./notify.store";
import { ChatRootStore } from "./root.store";

export { ChatRootStore } from "./root.store";
export type { TFocusRequest, TPinState, TThreadItem, TPendingMessage, TThreadState } from "./message.store";
export { applyReaction } from "./reactions";
export { canSearch } from "./search.store";
export { MAX_EXPANDED } from "./dock.store";
export type { TChatWorkItemCard, TWorkItemEntry } from "./work-items.store";
export type { TDockEntry } from "./dock.store";
export { notificationContent, shouldNotify, TabLeader } from "./notify.store";
export type { TNotifyPermission } from "./notify.store";
export type { TChatSearchFilters } from "./search.store";
export { defaultNotifyLevel, isQuiet } from "./conversation.store";
export type { TChatListFilter } from "./conversation.store";
export type { TUploadItem, TUploadStatus } from "./upload.store";

export const toChatUser = (user: IUser | undefined): TChatUser | null =>
  user
    ? {
        id: user.id,
        display_name: user.display_name,
        first_name: user.first_name,
        last_name: user.last_name,
        avatar: null,
        avatar_url: user.avatar_url ?? null,
        is_bot: !!user.is_bot,
        is_active: true,
      }
    : null;

const workItemService = new IssueService();

/** Production wiring: real REST service and a partysocket connection to the live server. */
export const createChatRootStore = (getCurrentUser: () => IUser | undefined): ChatRootStore =>
  new ChatRootStore({
    service: new ChatService(),
    currentUser: () => toChatUser(getCurrentUser()),
    createClientId: () => uuidv4(),
    desktop: createBrowserNotifier("/favicon/android-chrome-192x192.png"),
    leader: new TabLeader(createNotifyChannel(), uuidv4()),
    isVisible: () => typeof document === "undefined" || document.visibilityState === "visible",
    fetchWorkItems: (workspaceSlug, projectId, ids) => workItemService.retrieveIssues(workspaceSlug, projectId, ids),
    createSocket: (handlers) =>
      new ChatSocket({
        ...handlers,
        url: (workspaceSlug) => buildChatSocketUrl(LIVE_BASE_URL, LIVE_BASE_PATH, workspaceSlug),
        createTransport: (url) =>
          new ReconnectingWebSocket(url, [], {
            minReconnectionDelay: 1_000,
            maxReconnectionDelay: 30_000,
            reconnectionDelayGrowFactor: 1.6,
            connectionTimeout: 10_000,
            maxRetries: Infinity,
            maxEnqueuedMessages: 0,
          }) as unknown as IChatTransport,
      }),
  });
