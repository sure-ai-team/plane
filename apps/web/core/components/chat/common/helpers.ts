/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TChatConversation, TChatMessage, TChatPreview, TChatUser } from "@plane/types";
import type { TThreadItem } from "@/store/chat/message.store";

type TTranslate = (key: string, params?: Record<string, unknown>) => string;

export const chatPath = (workspaceSlug: string, conversationId?: string) =>
  conversationId ? `/${workspaceSlug}/chat/${conversationId}` : `/${workspaceSlug}/chat`;

export const userName = (user: TChatUser | null | undefined, t: TTranslate) =>
  user?.display_name || t("chat.thread.deleted_user");

/** Localised one-line summary for the sidebar (the API stores structured preview data). */
export const previewText = (
  preview: TChatPreview | undefined,
  conversation: TChatConversation,
  currentUserId: string | undefined,
  t: TTranslate
): string => {
  if (!preview || !preview.kind) return t("chat.preview.empty");
  if (preview.kind === "system") return t("chat.preview.system");

  let body = (preview.text ?? "").trim();
  if (!body) {
    const kinds = preview.attachment_kinds ?? [];
    if (preview.kind === "voice") body = t("chat.preview.voice");
    else if (kinds.length > 1) body = t("chat.preview.attachments", { count: kinds.length });
    else if (kinds[0] === "image") body = t("chat.preview.photo");
    else if (kinds[0] === "video") body = t("chat.preview.video");
    else if (kinds[0] === "audio") body = t("chat.preview.voice");
    else if (kinds[0] === "file") body = t("chat.preview.file");
  }

  if (preview.sender_id && preview.sender_id === currentUserId) return `${t("chat.preview.you")}: ${body}`;
  if (conversation.type === "group" && preview.sender_id) {
    const sender = conversation.members?.find((member) => member.member.id === preview.sender_id)?.member;
    if (sender?.display_name) return `${sender.display_name}: ${body}`;
  }
  return body;
};

/** Short relative label for the sidebar: time today, weekday this week, otherwise date. */
export const listTimeLabel = (iso: string | null, now: Date = new Date()): string => {
  if (!iso) return "";
  const date = new Date(iso);
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const days = (now.getTime() - date.getTime()) / 86_400_000;
  if (days < 7) return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
};

export const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export const dayKey = (iso: string) => new Date(iso).toDateString();

export const dayLabel = (iso: string, t: TTranslate, now: Date = new Date()) => {
  const date = new Date(iso);
  if (date.toDateString() === now.toDateString()) return t("chat.thread.today");
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return t("chat.thread.yesterday");
  return date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
};

/** Consecutive messages from the same person within 5 minutes share one header. */
export const GROUP_WINDOW_MS = 5 * 60_000;

export const startsGroup = (message: TChatMessage, previous: TChatMessage | undefined): boolean => {
  if (!previous) return true;
  if (message.kind === "system" || previous.kind === "system") return true;
  if (message.reply_to) return true;
  if (message.sender?.id !== previous.sender?.id) return true;
  if (dayKey(message.created_at) !== dayKey(previous.created_at)) return true;
  return new Date(message.created_at).getTime() - new Date(previous.created_at).getTime() > GROUP_WINDOW_MS;
};

/** Index of the first message after `marker` sent by someone else, or -1. */
export const firstUnreadIndex = (
  items: TThreadItem[],
  marker: number | undefined,
  currentUserId: string | undefined
): number => {
  if (marker === undefined) return -1;
  return items.findIndex(
    (item) => item.type === "message" && item.message.seq > marker && item.message.sender?.id !== currentUserId
  );
};

export const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A plain-text note becomes paragraphs of escaped text. */
export const noteToHtml = (note: string): string =>
  note
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
