/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { Archive, ArchiveRestore, Bell, BellOff, CheckCheck, MoreHorizontal, Star, StarOff } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TChatApiError, TChatConversation } from "@plane/types";
import { CustomMenu } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useChat } from "@/hooks/store/use-chat";
import { useUser } from "@/hooks/store/user";
import { isQuiet } from "@/store/chat";
// local
import { ConversationAvatar } from "../common/avatars";
import { chatPath, listTimeLabel, previewText } from "../common/helpers";

/** Width of the two actions revealed by swiping a row left (touch). */
const SWIPE_WIDTH = 148;
const SWIPE_OPEN_AT = 60;

type Props = {
  workspaceSlug: string;
  conversation: TChatConversation;
  isActive: boolean;
};

export const ChatConversationItem = observer(function ChatConversationItem(props: Props) {
  const { workspaceSlug, conversation, isActive } = props;
  const { t } = useTranslation();
  const chat = useChat();
  const { data: currentUser } = useUser();
  const name = chat.conversation.displayName(conversation);
  const unread = conversation.unread_count;
  const mentions = conversation.unread_mention_count ?? 0;
  const quiet = isQuiet(conversation);
  const isTyping = chat.realtime.typingUserIds(conversation.id).length > 0;
  const draft = isActive ? "" : chat.draftText(conversation.id);
  const preview = previewText(
    conversation.last_message_preview,
    conversation,
    currentUser?.id,
    t as (key: string, params?: Record<string, unknown>) => string
  );

  // Touch: swipe left to reveal Mute and Archive.
  const [offset, setOffset] = useState(0);
  const touchStart = useRef<{ x: number; y: number; base: number } | null>(null);
  const onTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY, base: offset };
  };
  const onTouchMove = (event: React.TouchEvent) => {
    const start = touchStart.current;
    if (!start) return;
    const touch = event.touches[0];
    const dx = touch.clientX - start.x;
    if (Math.abs(touch.clientY - start.y) > Math.abs(dx)) return; // scrolling the list
    setOffset(Math.max(-SWIPE_WIDTH, Math.min(0, start.base + dx)));
  };
  const onTouchEnd = () => {
    touchStart.current = null;
    setOffset((value) => (value < -SWIPE_OPEN_AT ? -SWIPE_WIDTH : 0));
  };

  const run = (task: Promise<void>) =>
    void task.catch((error: TChatApiError) =>
      setToast({ type: TOAST_TYPE.ERROR, title: t("chat.errors.generic"), message: error?.error })
    );

  const menuItems = [
    {
      key: "star",
      title: conversation.is_starred ? t("chat.sidebar.unstar") : t("chat.sidebar.star"),
      icon: conversation.is_starred ? StarOff : Star,
      action: () =>
        run(
          chat.conversation.updateMySettings(workspaceSlug, conversation.id, { is_starred: !conversation.is_starred })
        ),
    },
    {
      key: "read",
      title: t("chat.sidebar.mark_read"),
      icon: CheckCheck,
      hidden: unread === 0,
      action: () => run(chat.conversation.markRead(workspaceSlug, conversation.id, conversation.last_message_seq)),
    },
    {
      key: "mute",
      title: quiet ? t("chat.actions.unmute") : t("chat.actions.mute"),
      icon: quiet ? Bell : BellOff,
      action: () => run(chat.conversation.setMuted(workspaceSlug, conversation.id, !quiet)),
    },
    {
      key: "archive",
      title: conversation.archived_at ? t("chat.sidebar.unarchive") : t("chat.sidebar.archive"),
      icon: conversation.archived_at ? ArchiveRestore : Archive,
      action: () =>
        run(
          chat.conversation.updateMySettings(workspaceSlug, conversation.id, { archived: !conversation.archived_at })
        ),
    },
  ].filter((item) => !item.hidden);

  return (
    <div className="group/row relative overflow-hidden rounded-md">
      {offset < 0 && (
        <div className="absolute inset-y-0 right-0 flex" style={{ width: SWIPE_WIDTH }}>
          <button
            type="button"
            onClick={() => {
              setOffset(0);
              run(chat.conversation.setMuted(workspaceSlug, conversation.id, !quiet));
            }}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 bg-layer-3 text-11 font-medium text-primary"
          >
            {quiet ? <Bell className="size-4" /> : <BellOff className="size-4" />}
            {quiet ? t("chat.actions.unmute") : t("chat.actions.mute")}
          </button>
          <button
            type="button"
            onClick={() => {
              setOffset(0);
              run(
                chat.conversation.updateMySettings(workspaceSlug, conversation.id, {
                  archived: !conversation.archived_at,
                })
              );
            }}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 bg-accent-primary text-11 font-medium text-on-color"
          >
            {conversation.archived_at ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
            {conversation.archived_at ? t("chat.sidebar.unarchive") : t("chat.sidebar.archive")}
          </button>
        </div>
      )}
      <Link
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={(event) => {
          // Tapping a swiped-open row closes it instead of opening the chat.
          if (offset !== 0) {
            event.preventDefault();
            setOffset(0);
          }
        }}
        style={offset ? { transform: `translateX(${offset}px)` } : undefined}
        href={chatPath(workspaceSlug, conversation.id)}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "relative flex w-full items-center gap-2 rounded-md bg-surface-1 px-2 py-1.5 text-13 transition-transform outline-none focus-visible:ring-1 focus-visible:ring-accent-strong motion-reduce:transition-none",
          isActive
            ? "bg-layer-transparent-active text-primary"
            : "text-secondary hover:bg-layer-transparent-hover active:bg-layer-transparent-active"
        )}
      >
        <ConversationAvatar conversation={conversation} size={28} showPresence />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5">
            <span
              className={cn("flex-1 truncate", unread > 0 && !quiet ? "font-semibold text-primary" : "font-medium")}
            >
              {name}
            </span>
            {quiet && <BellOff className="size-3 shrink-0 text-tertiary" aria-label={t("chat.sidebar.muted")} />}
            <span className="shrink-0 text-11 text-tertiary group-hover/row:invisible">
              {listTimeLabel(conversation.last_message_at)}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "flex-1 truncate text-12",
                isTyping ? "text-accent-primary" : draft ? "font-medium text-warning-primary" : "text-tertiary"
              )}
            >
              {isTyping ? t("chat.thread.typing_many") : draft ? t("chat.sidebar.draft", { text: draft }) : preview}
            </span>
            {mentions > 0 && (
              <span
                aria-label={t("chat.sidebar.mentions_label", { count: mentions })}
                className="flex size-4 shrink-0 items-center justify-center rounded-full bg-danger-primary text-10 font-semibold text-on-color"
              >
                @
              </span>
            )}
            {unread > 0 && (
              <span
                className={cn(
                  "flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-10 font-semibold",
                  quiet ? "bg-layer-3 text-secondary" : "bg-accent-primary text-on-color"
                )}
              >
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </span>
        </span>
      </Link>
      <div className="absolute top-1.5 right-1.5 hidden group-focus-within/row:block group-hover/row:block">
        <CustomMenu
          customButton={
            <span
              className="flex size-5 items-center justify-center rounded-sm bg-surface-1 text-tertiary hover:text-secondary"
              aria-label={t("chat.sidebar.options", { name })}
            >
              <MoreHorizontal className="size-3.5" />
            </span>
          }
          placement="bottom-end"
          closeOnSelect
        >
          {menuItems.map((item) => (
            <CustomMenu.MenuItem key={item.key} onClick={item.action} className="flex items-center gap-2">
              <item.icon className="size-3 shrink-0" />
              <span>{item.title}</span>
            </CustomMenu.MenuItem>
          ))}
        </CustomMenu>
      </div>
    </div>
  );
});
