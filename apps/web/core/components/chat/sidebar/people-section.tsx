/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import type { TChatApiError } from "@plane/types";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
// hooks
import { useChat } from "@/hooks/store/use-chat";
import { useAppRouter } from "@/hooks/use-app-router";
// local
import { ChatUserAvatar } from "../common/avatars";
import { chatPath } from "../common/helpers";
import { useChatPeople } from "../hooks/use-chat-people";

const COLLAPSED_COUNT = 8;

type Props = { workspaceSlug: string };

/**
 * Quick start: workspace members you have no direct chat with yet. One click opens the chat
 * (the API returns the existing direct conversation if there is one).
 */
export const ChatPeopleSection = observer(function ChatPeopleSection({ workspaceSlug }: Props) {
  const { t } = useTranslation();
  const chat = useChat();
  const router = useAppRouter();
  const people = useChatPeople(workspaceSlug, { withoutDirect: true });
  const [expanded, setExpanded] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (people.length === 0) return null;
  const shown = expanded ? people : people.slice(0, COLLAPSED_COUNT);

  const start = async (userId: string) => {
    if (pendingId) return;
    setPendingId(userId);
    try {
      const conversation = await chat.conversation.create(workspaceSlug, { type: "direct", user_id: userId });
      router.push(chatPath(workspaceSlug, conversation.id));
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("chat.errors.generic"), message: (error as TChatApiError)?.error });
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <span className="text-12 font-semibold text-secondary">{t("chat.sidebar.people")}</span>
        <span className="text-11 text-tertiary">{people.length}</span>
      </div>
      {shown.map((details) => (
        <button
          key={details.member.id}
          type="button"
          disabled={pendingId !== null}
          aria-label={t("chat.sidebar.people_message", { name: details.member.display_name })}
          onClick={() => void start(details.member.id)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-13 text-primary hover:bg-layer-transparent-hover disabled:opacity-60"
        >
          <ChatUserAvatar
            user={{
              id: details.member.id,
              display_name: details.member.display_name,
              first_name: details.member.first_name ?? "",
              last_name: details.member.last_name ?? "",
              avatar: null,
              avatar_url: details.member.avatar_url ?? null,
              is_bot: false,
              is_active: true,
            }}
            size="base"
            showPresence
          />
          <span className="flex-1 truncate">{details.member.display_name}</span>
        </button>
      ))}
      {people.length > COLLAPSED_COUNT && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="px-2 py-1.5 text-left text-12 font-medium text-accent-primary hover:underline"
        >
          {expanded ? t("chat.sidebar.people_show_fewer") : t("chat.sidebar.people_show_all", { count: people.length })}
        </button>
      )}
    </div>
  );
});
