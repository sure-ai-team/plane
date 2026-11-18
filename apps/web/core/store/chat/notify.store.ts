/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { action, makeObservable, observable, runInAction } from "mobx";
import type { TChatConversation, TChatMessage, TChatPreferences } from "@plane/types";
import type { IChatServiceLike } from "./types";

export type TNotifyPermission = "default" | "granted" | "denied" | "unsupported";

/** Everything the decision needs, so it can be tested without a browser. */
export type TNotifyContext = {
  me: string | undefined;
  conversation: TChatConversation | undefined;
  preferences: TChatPreferences | null;
  /** The tab is visible and this conversation is open in it (full page or an expanded dock window). */
  isConversationOnScreen: boolean;
  now: number;
  permission: TNotifyPermission;
};

/**
 * Whether a new message deserves any alert at all, by conversation level, snooze and what is on
 * screen (docs/chat/phase-2/03-realtime.md). The desktop notification and the sound both start here.
 */
export const isAlertWorthy = (message: TChatMessage, context: TNotifyContext): boolean => {
  const { me, conversation } = context;
  if (!me || !conversation || message.kind === "system") return false;
  if (message.sender?.id === me) return false;
  if (context.isConversationOnScreen) return false;
  if (conversation.snoozed_until && new Date(conversation.snoozed_until).getTime() > context.now) return false;
  const level = conversation.notify_level ?? (conversation.is_muted ? "off" : "all");
  if (level === "off") return false;
  if (level === "mentions") {
    return message.mentions.includes(me) || message.reply_to?.sender?.id === me;
  }
  return true;
};

/** A desktop notification also needs the browser's permission and the user's switch. */
export const shouldNotify = (message: TChatMessage, context: TNotifyContext): boolean => {
  if (context.permission !== "granted") return false;
  if (context.preferences && !context.preferences.desktop_notifications) return false;
  return isAlertWorthy(message, context);
};

/** The sound rings on its own switch: it does not need notification permission. */
export const shouldPlaySound = (message: TChatMessage, context: TNotifyContext): boolean =>
  (context.preferences?.sound ?? true) && isAlertWorthy(message, context);

type TTranslate = (key: string, params?: Record<string, unknown>) => string;

/** Title and body for the notification, honouring "show message preview" (P2-S9). */
export const notificationContent = (
  message: TChatMessage,
  conversation: TChatConversation,
  preferences: TChatPreferences | null,
  t: TTranslate
): { title: string; body: string } => {
  const sender = message.sender?.display_name ?? t("chat.system.someone");
  const title = conversation.type === "direct" ? sender : `${sender} · ${conversation.name}`;
  if (preferences && !preferences.show_preview) return { title, body: t("chat.notify.new_message") };
  const text = message.body_stripped?.trim();
  if (text) return { title, body: text.length > 180 ? `${text.slice(0, 177)}…` : text };
  if (message.kind === "voice") return { title, body: t("chat.notify.sent_voice") };
  const kind = message.attachments[0]?.kind;
  if (kind === "image") return { title, body: t("chat.notify.sent_photo") };
  if (kind === "video") return { title, body: t("chat.notify.sent_video") };
  return { title, body: t("chat.notify.sent_file") };
};

// ---------------------------------------------------------------- one tab notifies

type TChannelLike = {
  postMessage: (message: unknown) => void;
  close: () => void;
  addEventListener: (type: "message", listener: (event: MessageEvent) => void) => void;
};

export const LEADER_HEARTBEAT_MS = 2_000;
export const LEADER_TIMEOUT_MS = 6_000;

/**
 * Picks one open tab to show desktop notifications: tabs announce themselves on a
 * BroadcastChannel and the one with the smallest id among the live ones leads.
 * Without BroadcastChannel every tab leads; the shared `tag` still collapses them.
 */
export class TabLeader {
  private peers = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly channel: TChannelLike | null,
    readonly id: string,
    private readonly now: () => number = () => Date.now()
  ) {
    channel?.addEventListener("message", (event) => {
      const data = event.data as { t?: string; id?: string } | undefined;
      if (!data?.id || data.id === this.id) return;
      if (data.t === "bye") this.peers.delete(data.id);
      else this.peers.set(data.id, this.now());
    });
  }

  private send(kind: "hb" | "bye") {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel.postMessage has no target origin
    this.channel?.postMessage({ t: kind, id: this.id });
  }

  start() {
    if (!this.channel || this.timer) return;
    this.send("hb");
    this.timer = setInterval(() => this.send("hb"), LEADER_HEARTBEAT_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.send("bye");
  }

  isLeader(): boolean {
    if (!this.channel) return true;
    const now = this.now();
    for (const [peer, seen] of this.peers) {
      if (now - seen > LEADER_TIMEOUT_MS) this.peers.delete(peer);
    }
    return Array.from(this.peers.keys()).every((peer) => this.id < peer);
  }
}

// ---------------------------------------------------------------- store

/** Shows the notification; the browser implementation lives in services/chat-notifier.ts. */
export type TDesktopNotifier = {
  permission: () => TNotifyPermission;
  requestPermission: () => Promise<TNotifyPermission>;
  show: (notification: { title: string; body: string; tag: string; onClick: () => void }) => void;
  playSound: (tone: TChatPreferences["sound_tone"], volume: number) => void;
};

export const SOUND_THROTTLE_MS = 3_000;

export class ChatNotifyStore {
  preferences: TChatPreferences | null = null;
  permission: TNotifyPermission = "unsupported";
  private lastSoundAt = 0;
  private openHandler: ((conversationId: string, messageId: string) => void) | null = null;

  constructor(
    private readonly service: IChatServiceLike,
    private readonly desktop: TDesktopNotifier | null,
    private readonly leader: TabLeader | null,
    private readonly now: () => number = () => Date.now()
  ) {
    this.permission = desktop?.permission() ?? "unsupported";
    makeObservable(this, {
      preferences: observable.ref,
      permission: observable,
      applyPreferences: action,
      refreshPermission: action,
      reset: action,
    });
  }

  async loadPreferences(workspaceSlug: string): Promise<void> {
    try {
      const preferences = await this.service.getPreferences(workspaceSlug);
      runInAction(() => this.applyPreferences(preferences));
    } catch {
      // Defaults apply until the next load.
    }
  }

  async updatePreferences(workspaceSlug: string, changes: Partial<TChatPreferences>): Promise<void> {
    const before = this.preferences;
    if (before) runInAction(() => this.applyPreferences({ ...before, ...changes }));
    try {
      const saved = await this.service.updatePreferences(workspaceSlug, changes);
      runInAction(() => this.applyPreferences(saved));
    } catch (error) {
      runInAction(() => this.applyPreferences(before));
      throw error;
    }
  }

  applyPreferences(preferences: TChatPreferences | null) {
    this.preferences = preferences;
  }

  refreshPermission() {
    this.permission = this.desktop?.permission() ?? "unsupported";
  }

  /** Ask the browser for permission. Call only from a user action (a click). */
  async requestPermission(): Promise<TNotifyPermission> {
    if (!this.desktop) return "unsupported";
    const result = await this.desktop.requestPermission();
    runInAction(() => {
      this.permission = result;
    });
    return result;
  }

  setOpenHandler(handler: ((conversationId: string, messageId: string) => void) | null) {
    this.openHandler = handler;
  }

  /** Called for every new message from the socket. Returns whether a notification was shown. */
  onMessage(
    message: TChatMessage,
    context: Omit<TNotifyContext, "preferences" | "permission" | "now">,
    t: TTranslate
  ): boolean {
    if (!this.desktop || !context.conversation) return false;
    const full: TNotifyContext = {
      ...context,
      preferences: this.preferences,
      permission: this.desktop.permission(),
      now: this.now(),
    };
    const notify = shouldNotify(message, full);
    const ring = shouldPlaySound(message, full);
    if (!notify && !ring) return false;
    if (this.leader && !this.leader.isLeader()) return false;
    const conversation = context.conversation;
    if (notify) {
      const { title, body } = notificationContent(message, conversation, this.preferences, t);
      this.desktop.show({
        title,
        body,
        // One notification per conversation: a newer message replaces the older one.
        tag: `chat-${conversation.id}`,
        onClick: () => this.openHandler?.(conversation.id, message.id),
      });
    }
    if (ring && this.now() - this.lastSoundAt >= SOUND_THROTTLE_MS) {
      this.lastSoundAt = this.now();
      this.playTone();
    }
    return notify;
  }

  /** The user's chosen tone at their chosen volume. Also used by the settings Play button. */
  playTone(overrides?: Partial<Pick<TChatPreferences, "sound_tone" | "sound_volume">>) {
    const tone = overrides?.sound_tone ?? this.preferences?.sound_tone ?? "chime";
    const volume = overrides?.sound_volume ?? this.preferences?.sound_volume ?? 60;
    this.desktop?.playSound(tone, volume);
  }

  /** A real notification plus the tone, so the user can check both from settings. */
  sendTest(t: TTranslate): void {
    this.desktop?.show({
      title: t("chat.notify.test_title"),
      body: t("chat.notify.test_body"),
      tag: "chat-test",
      onClick: () => undefined,
    });
    if (this.preferences?.sound ?? true) this.playTone();
  }

  start() {
    this.leader?.start();
  }

  reset() {
    this.leader?.stop();
    this.preferences = null;
  }
}
