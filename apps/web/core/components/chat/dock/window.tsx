/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Maximize2, Minus, X } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { IconButton } from "@plane/propel/icon-button";
import type { TChatMessage } from "@plane/types";
// hooks
import { useChat } from "@/hooks/store/use-chat";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useAppRouter } from "@/hooks/use-app-router";
// local
import { ConversationAvatar } from "../common/avatars";
import { chatPath } from "../common/helpers";
import { ChatComposer } from "../composer/root";
import { ChatMessageList } from "../thread/message-list";
import { ChatTypingIndicator } from "../thread/small-items";

type Props = { workspaceSlug: string; conversationId: string };

/** One docked conversation (300 × 460): bubbles, typing, composer (P2-D10). */
export const ChatDockWindow = observer(function ChatDockWindow({ workspaceSlug, conversationId }: Props) {
  const { t } = useTranslation();
  const chat = useChat();
  const router = useAppRouter();
  const { getWorkspaceBySlug } = useWorkspace();
  const [replyTo, setReplyTo] = useState<TChatMessage | null>(null);
  const conversation = chat.conversation.getById(conversationId);
  const workspaceId = getWorkspaceBySlug(workspaceSlug)?.id ?? "";

  useEffect(() => {
    void chat.message.open(workspaceSlug, conversationId);
    void chat.conversation.fetchOne(workspaceSlug, conversationId);
  }, [chat, workspaceSlug, conversationId]);

  if (!conversation) return null;
  const name = chat.conversation.displayName(conversation);
  const subtitle =
    conversation.type === "direct"
      ? chat.realtime.isOnline(conversation.direct_user?.id)
        ? t("chat.status.online")
        : t("chat.status.offline")
      : t("chat.members.count", { count: conversation.member_count });

  return (
    <section
      role="dialog"
      aria-label={name}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) chat.dock.minimize(conversationId);
      }}
      className="pointer-events-auto flex h-[460px] w-[320px] flex-col overflow-hidden rounded-t-lg border border-b-0 border-strong bg-surface-1 shadow-raised-300"
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-subtle pr-1 pl-3">
        <ConversationAvatar conversation={conversation} size={24} showPresence />
        <button
          type="button"
          onClick={() => chat.dock.minimize(conversationId)}
          className="flex min-w-0 flex-1 flex-col text-left"
        >
          <span className="truncate text-13 font-semibold text-primary">{name}</span>
          <span className="truncate text-11 text-tertiary">{subtitle}</span>
        </button>
        <IconButton
          icon={Maximize2}
          variant="ghost"
          size="base"
          aria-label={t("chat.dock.open_full")}
          onClick={() => {
            chat.dock.close(conversationId);
            router.push(chatPath(workspaceSlug, conversationId));
          }}
        />
        <IconButton
          icon={Minus}
          variant="ghost"
          size="base"
          aria-label={t("chat.dock.minimize")}
          onClick={() => chat.dock.minimize(conversationId)}
        />
        <IconButton
          icon={X}
          variant="ghost"
          size="base"
          aria-label={t("chat.dock.close")}
          onClick={() => chat.dock.close(conversationId)}
        />
      </header>
      <div className="flex min-h-0 flex-1 flex-col bg-layer-1/40">
        <ChatMessageList
          workspaceSlug={workspaceSlug}
          workspaceId={workspaceId}
          conversation={conversation}
          onReply={setReplyTo}
          layout="bubbles"
        />
        <ChatTypingIndicator conversation={conversation} />
      </div>
      <ChatComposer
        key={conversation.id}
        workspaceSlug={workspaceSlug}
        workspaceId={workspaceId}
        conversation={conversation}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onSent={() => undefined}
      />
    </section>
  );
});
