/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { AlertCircle } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import type { TChatConversation, TChatMessage } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { useChat } from "@/hooks/store/use-chat";
import type { TPendingMessage } from "@/store/chat";
// local
import { ChatMessageAttachments } from "../attachments/message-attachments";
import { ChatUserAvatar } from "../common/avatars";
import { dayLabel, timeLabel, userName } from "../common/helpers";

type TTranslate = (key: string, params?: Record<string, unknown>) => string;

export function ChatDayDivider({ iso }: { iso: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 px-3 py-3" role="separator">
      <span className="h-px flex-1 bg-layer-3" />
      <span className="rounded-full border border-subtle px-2.5 py-0.5 text-11 font-medium text-tertiary">
        {dayLabel(iso, t as TTranslate)}
      </span>
      <span className="h-px flex-1 bg-layer-3" />
    </div>
  );
}

type TSystemProps = { message: TChatMessage; conversation: TChatConversation };

/** "Sara added Omar", "Group renamed to …" */
export const ChatSystemMessage = observer(function ChatSystemMessage({ message, conversation }: TSystemProps) {
  const { t } = useTranslation();
  const tr = t as TTranslate;
  const nameOf = (userId: unknown) => {
    if (typeof userId !== "string") return t("chat.system.someone");
    const member = conversation.members?.find((item) => item.member.id === userId)?.member;
    if (member) return member.display_name;
    if (conversation.direct_user?.id === userId) return conversation.direct_user.display_name;
    return t("chat.system.someone");
  };
  const event = message.meta?.event ?? "created";
  const text = tr(`chat.system.${event}`, {
    actor: nameOf(message.meta?.actor_id),
    name: event === "renamed" || event === "created" ? String(message.meta?.name ?? "") : nameOf(message.meta?.user_id),
  });
  return (
    <div className="flex justify-center px-3 py-1.5 text-12 text-tertiary">
      <span>
        {text} · {timeLabel(message.created_at)}
      </span>
    </div>
  );
});

type TPendingProps = { workspaceSlug: string; pending: TPendingMessage; showHeader: boolean };

/** A message still being sent from this tab (or one that failed). */
export const ChatPendingMessage = observer(function ChatPendingMessage(props: TPendingProps) {
  const { workspaceSlug, pending, showHeader } = props;
  const { t } = useTranslation();
  const chat = useChat();
  const failed = pending.status === "failed";
  const queued = pending.status === "queued";
  return (
    <div className={cn("flex gap-2.5 px-3", { "pt-2": showHeader })}>
      <div className="w-7 shrink-0">{showHeader && <ChatUserAvatar user={pending.sender} size={28} />}</div>
      <div className="min-w-0 flex-1 pb-1">
        {showHeader && (
          <div className="flex items-baseline gap-2">
            <span className="truncate text-13 font-medium text-primary">
              {userName(pending.sender, t as TTranslate)}
            </span>
          </div>
        )}
        <p className={cn("text-13 break-words whitespace-pre-wrap", failed ? "text-secondary" : "text-tertiary")}>
          {pending.body_stripped}
        </p>
        <ChatMessageAttachments attachments={pending.attachments} />
        <div className="mt-0.5 flex items-center gap-2 text-11">
          {failed ? (
            <>
              <span className="flex items-center gap-1 text-danger-primary">
                <AlertCircle className="size-3" />
                {pending.error?.error ?? t("chat.message.send_failed")}
              </span>
              <button
                type="button"
                className="font-medium text-accent-primary hover:underline"
                onClick={() => void chat.message.retry(workspaceSlug, pending.client_id)}
              >
                {t("chat.message.retry")}
              </button>
              <button
                type="button"
                className="text-tertiary hover:underline"
                onClick={() => chat.message.discardPending(pending.client_id)}
              >
                {t("chat.message.discard")}
              </button>
            </>
          ) : (
            <span className="text-tertiary">{queued ? t("chat.states.waiting") : t("chat.message.sending")}</span>
          )}
        </div>
      </div>
    </div>
  );
});

type TTypingProps = { conversation: TChatConversation };

export const ChatTypingIndicator = observer(function ChatTypingIndicator({ conversation }: TTypingProps) {
  const { t } = useTranslation();
  const chat = useChat();
  const ids = chat.realtime.typingUserIds(conversation.id);
  if (ids.length === 0) return <div className="h-5" aria-hidden />;
  const names = ids.map(
    (id) =>
      conversation.members?.find((member) => member.member.id === id)?.member.display_name ??
      (conversation.direct_user?.id === id ? conversation.direct_user.display_name : t("chat.system.someone"))
  );
  const text =
    names.length === 1
      ? t("chat.thread.typing_one", { name: names[0] })
      : names.length === 2
        ? t("chat.thread.typing_two", { first: names[0], second: names[1] })
        : t("chat.thread.typing_many");
  return (
    <div className="flex h-5 items-center gap-1.5 px-4 text-12 text-tertiary" aria-live="polite">
      <span className="flex gap-0.5" aria-hidden>
        <span className="size-1 animate-bounce rounded-full bg-layer-3 [animation-delay:-0.3s] motion-reduce:animate-none" />
        <span className="size-1 animate-bounce rounded-full bg-layer-3 [animation-delay:-0.15s] motion-reduce:animate-none" />
        <span className="size-1 animate-bounce rounded-full bg-layer-3 motion-reduce:animate-none" />
      </span>
      {text}
    </div>
  );
});
