/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TDesktopNotifier, TNotifyPermission } from "@/store/chat/notify.store";

const supported = () => typeof window !== "undefined" && "Notification" in window;

let audioContext: AudioContext | null = null;

/** A short two-tone chime made with Web Audio, so no sound file ships with the app. */
const chime = () => {
  try {
    const AudioCtor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    audioContext = audioContext ?? new AudioCtor();
    const start = audioContext.currentTime;
    for (const [offset, frequency] of [
      [0, 880],
      [0.12, 1320],
    ] as const) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.12, start + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.18);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.2);
    }
  } catch {
    // Sound is a nicety; browsers may block audio until the user interacts.
  }
};

/** Browser Notification API wrapper used while a tab is open (P2-D4: no web push). */
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
  playSound: chime,
});

/** BroadcastChannel for leader election, when the browser has one. */
export const createNotifyChannel = () =>
  typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("chat-notify");
