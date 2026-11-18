/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { ChevronDown, Pin, X } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { IconButton } from "@plane/propel/icon-button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TChatApiError, TChatConversation, TChatPinnedMessage } from "@plane/types";
// hooks
import { useChat } from "@/hooks/store/use-chat";
// local
import { ChatUserAvatar } from "../common/avatars";
import { listTimeLabel, userName } from "../common/helpers";

type TTranslate = (key: string, params?: Record<string, unknown>) => string;

const pinText = (message: TChatPinnedMessage, t: TTranslate) =>
  message.body_stripped ||
  (message.kind === "voice"
    ? t("chat.preview.voice")
    : t("chat.preview.attachments", { count: Math.max(message.attachments.length, 1) }));

const useJump = (workspaceSlug: string, conversationId: string) => {
  const { t } = useTranslation();
  const chat = useChat();
  return (seq: number) =>
    void chat.message
      .jumpToMessage(workspaceSlug, conversationId, { seq })
      .catch((error: TChatApiError) =>
        setToast({ type: TOAST_TYPE.ERROR, title: t("chat.message.no_access"), message: error?.error })
      );
};

type TBarProps = { workspaceSlug: string; conversation: TChatConversation; onOpenPanel: () => void };

/** One line under the thread header: the newest pin, cycling through the others. */
export const ChatPinnedBar = observer(function ChatPinnedBar(props: TBarProps) {
  const { workspaceSlug, conversation, onOpenPanel } = props;
  const { t } = useTranslation();
  const chat = useChat();
  const [index, setIndex] = useState(0);
  const jump = useJump(workspaceSlug, conversation.id);
  const state = chat.message.pinState(conversation.id);

  useEffect(() => {
    setIndex(0);
    void chat.message.fetchPins(workspaceSlug, conversation.id).catch(() => undefined);
  }, [chat, workspaceSlug, conversation.id]);

  const items = state?.items ?? [];
  if (items.length === 0) return null;
  const current = items[index % items.length];

  return (
    <div className="flex items-center gap-2 border-b border-subtle bg-layer-1 px-4 py-1.5 text-12">
      <Pin className="size-3.5 shrink-0 text-accent-primary" />
      <button
        type="button"
        onClick={() => jump(current.seq)}
        className="min-w-0 flex-1 truncate text-left text-primary hover:underline"
      >
        <span className="font-medium">
          {t("chat.pins.count", { index: (index % items.length) + 1, total: items.length })}
        </span>
        {" — "}
        {pinText(current, t as TTranslate)}
      </button>
      {items.length > 1 && (
        <IconButton
          icon={ChevronDown}
          variant="ghost"
          size="sm"
          aria-label={t("chat.pins.next")}
          onClick={() => setIndex((value) => value + 1)}
        />
      )}
      <button type="button" onClick={onOpenPanel} className="shrink-0 font-medium text-accent-primary hover:underline">
        {t("chat.pins.view_all")}
      </button>
    </div>
  );
});

type TPanelProps = { workspaceSlug: string; conversation: TChatConversation; onClose: () => void };

/** Right-side panel listing every pinned message with Jump and Unpin. */
export const ChatPinnedPanel = observer(function ChatPinnedPanel(props: TPanelProps) {
  const { workspaceSlug, conversation, onClose } = props;
  const { t } = useTranslation();
  const chat = useChat();
  const jump = useJump(workspaceSlug, conversation.id);
  const state = chat.message.pinState(conversation.id);
  const items = state?.items ?? [];
  const tr = t as TTranslate;

  const nameOf = (userId: string | null) =>
    conversation.members?.find((member) => member.member.id === userId)?.member.display_name ??
    (conversation.direct_user?.id === userId ? conversation.direct_user.display_name : t("chat.system.someone"));

  return (
    <aside aria-label={t("chat.pins.title")} className="flex h-full flex-col">
      <div className="flex h-header shrink-0 items-center justify-between border-b border-subtle px-4">
        <span className="text-14 font-medium text-primary">
          {t("chat.pins.title")} · {items.length}
        </span>
        <IconButton icon={X} variant="ghost" size="base" aria-label={t("chat.pins.close")} onClick={onClose} />
      </div>
      <div className="vertical-scrollbar flex scrollbar-sm flex-1 flex-col gap-2.5 overflow-y-auto p-3">
        {state?.isLoaded && items.length === 0 && (
          <p className="px-2 py-6 text-center text-13 text-tertiary">{t("chat.pins.empty")}</p>
        )}
        {items.map((message) => (
          <div key={message.id} className="flex flex-col gap-1.5 rounded-lg border border-subtle p-3">
            <div className="flex items-center gap-2">
              <ChatUserAvatar user={message.sender} size={20} />
              <span className="flex-1 truncate text-13 font-medium text-primary">{userName(message.sender, tr)}</span>
              <span className="text-11 text-tertiary">{listTimeLabel(message.created_at)}</span>
            </div>
            <p className="line-clamp-3 text-13 break-words text-primary">{pinText(message, tr)}</p>
            <div className="flex items-center justify-between text-11 text-tertiary">
              <span>{t("chat.pins.pinned_by", { name: nameOf(message.pinned_by) })}</span>
              <span className="flex gap-3">
                <button
                  type="button"
                  className="font-medium text-secondary hover:underline"
                  onClick={() =>
                    void chat.message
                      .unpin(workspaceSlug, message)
                      .catch((error: TChatApiError) =>
                        setToast({ type: TOAST_TYPE.ERROR, title: t("chat.errors.generic"), message: error?.error })
                      )
                  }
                >
                  {t("chat.pins.unpin")}
                </button>
                <button
                  type="button"
                  className="font-medium text-accent-primary hover:underline"
                  onClick={() => jump(message.seq)}
                >
                  {t("chat.jump.jump")}
                </button>
              </span>
            </div>
          </div>
        ))}
        <p className="px-1 text-11 text-tertiary">{t("chat.pins.hint")}</p>
      </div>
    </aside>
  );
});
