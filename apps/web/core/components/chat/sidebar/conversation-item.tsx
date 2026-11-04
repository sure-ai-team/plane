/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

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
    <div className="group/row relative">
      <Link
        href={chatPath(workspaceSlug, conversation.id)}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-13 outline-none focus-visible:ring-1 focus-visible:ring-accent-strong",
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
