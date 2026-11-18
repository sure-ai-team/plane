/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { SmilePlus } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import type { TChatApiError, TChatConversation, TChatMessage, TChatReactionSummary } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { useChat } from "@/hooks/store/use-chat";
// local
import { ChatEmojiPicker } from "../common/emoji-picker";

/** The four reactions offered on hover (P2-D1). */
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉"];

type TTranslate = (key: string, params?: Record<string, unknown>) => string;

/** "Sara, Omar and 3 others" for the reaction tooltip. */
export const reactorNames = (
  entry: TChatReactionSummary,
  conversation: TChatConversation,
  currentUserId: string | undefined,
  t: TTranslate
): string => {
  const names = entry.user_ids.map((id) => {
    if (id === currentUserId) return t("chat.preview.you");
    const member = conversation.members?.find((item) => item.member.id === id)?.member;
    if (member) return member.display_name;
    if (conversation.direct_user?.id === id) return conversation.direct_user.display_name;
    return t("chat.system.someone");
  });
  const others = entry.count - names.length;
  if (others > 0) return t("chat.reactions.and_others", { names: names.join(", "), count: others });
  return names.join(", ");
};

type Props = {
  workspaceSlug: string;
  conversation: TChatConversation;
  message: TChatMessage;
  currentUserId: string | undefined;
};

export const ChatReactions = observer(function ChatReactions(props: Props) {
  const { workspaceSlug, conversation, message, currentUserId } = props;
  const { t } = useTranslation();
  const chat = useChat();
  const reactions = message.reactions ?? [];
  if (reactions.length === 0) return null;

  const toggle = (emoji: string) =>
    void chat.message
      .toggleReaction(workspaceSlug, message, emoji)
      .catch((error: TChatApiError) =>
        setToast({ type: TOAST_TYPE.ERROR, title: t("chat.errors.generic"), message: error?.error })
      );

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {reactions.map((entry) => (
        <Tooltip
          key={entry.emoji}
          position="top"
          tooltipContent={t("chat.reactions.tooltip", {
            names: reactorNames(entry, conversation, currentUserId, t as TTranslate),
            emoji: entry.emoji,
          })}
        >
          <button
            type="button"
            aria-pressed={entry.reacted}
            aria-label={t("chat.reactions.chip_label", { emoji: entry.emoji, count: entry.count })}
            onClick={() => toggle(entry.emoji)}
            className={cn(
              "flex h-6 items-center gap-1 rounded-full border px-2 text-12 font-medium transition-colors",
              entry.reacted
                ? "border-accent-subtle bg-accent-subtle text-accent-primary"
                : "border-subtle bg-surface-1 text-secondary hover:bg-layer-transparent-hover"
            )}
          >
            <span className="text-13 leading-none">{entry.emoji}</span>
            <span>{entry.count}</span>
          </button>
        </Tooltip>
      ))}
      <ChatEmojiPicker
        ariaLabel={t("chat.reactions.add")}
        onSelect={toggle}
        side="top"
        align="start"
        buttonClassName="flex size-6 items-center justify-center rounded-full border border-subtle text-tertiary hover:bg-layer-transparent-hover hover:text-secondary"
      >
        <SmilePlus className="size-3.5" />
      </ChatEmojiPicker>
    </div>
  );
});
