/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
import { BellOff } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import type { TChatConversation } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { useChat } from "@/hooks/store/use-chat";
import { useUser } from "@/hooks/store/user";
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
  const isTyping = chat.realtime.typingUserIds(conversation.id).length > 0;
  const preview = previewText(
    conversation.last_message_preview,
    conversation,
    currentUser?.id,
    t as (key: string, params?: Record<string, unknown>) => string
  );

  return (
    <Link
      href={chatPath(workspaceSlug, conversation.id)}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-13 outline-none focus-visible:ring-1 focus-visible:ring-accent-strong",
        isActive
          ? "bg-layer-transparent-active text-primary"
          : "text-secondary hover:bg-layer-transparent-hover active:bg-layer-transparent-active"
      )}
    >
      <ConversationAvatar conversation={conversation} size={28} showPresence />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "flex-1 truncate",
              unread > 0 && !conversation.is_muted ? "font-semibold text-primary" : "font-medium"
            )}
          >
            {name}
          </span>
          {conversation.is_muted && (
            <BellOff className="size-3 shrink-0 text-tertiary" aria-label={t("chat.actions.unmute")} />
          )}
          <span className="shrink-0 text-11 text-tertiary">{listTimeLabel(conversation.last_message_at)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className={cn("flex-1 truncate text-12", isTyping ? "text-accent-primary" : "text-tertiary")}>
            {isTyping ? t("chat.thread.typing_many") : preview}
          </span>
          {unread > 0 && (
            <span
              className={cn(
                "flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-10 font-semibold",
                conversation.is_muted ? "bg-layer-3 text-secondary" : "bg-accent-primary text-on-color"
              )}
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </span>
      </span>
    </Link>
  );
});
