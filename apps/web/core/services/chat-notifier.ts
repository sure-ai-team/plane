/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TDesktopNotifier, TNotifyPermission } from "@/store/chat/notify.store";
import { playChatTone } from "./chat-sounds";

const supported = () => typeof window !== "undefined" && "Notification" in window;

/** Browser Notification API wrapper used while a tab is open. */
export const createBrowserNotifier = (iconUrl?: string): TDesktopNotifier => ({
  permission: (): TNotifyPermission => (supported() ? (Notification.permission as TNotifyPermission) : "unsupported"),
  requestPermission: async () => {
    if (!supported()) return "unsupported";
    try {
      return (await Notification.requestPermission()) as TNotifyPermission;
    } catch {
      return Notification.permission as TNotifyPermission;
    }
  },
  show: ({ title, body, tag, onClick }) => {
    if (!supported() || Notification.permission !== "granted") return;
    try {
      const notification = new Notification(title, { body, tag, icon: iconUrl, silent: true });
      notification.addEventListener("click", () => {
        window.focus();
        onClick();
        notification.close();
      });
    } catch {
      // Some browsers (Android Chrome) only allow notifications from a service worker.
    }
  },
  playSound: playChatTone,
});

/** BroadcastChannel for leader election, when the browser has one. */
export const createNotifyChannel = () =>
  typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("chat-notify");
