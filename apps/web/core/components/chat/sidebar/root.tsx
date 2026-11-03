/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { ChevronDown, Search, SquarePen } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { IconButton } from "@plane/propel/icon-button";
import type { TChatConversation } from "@plane/types";
import { Loader } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useChat } from "@/hooks/store/use-chat";
// local
import { ChatNewConversationModal } from "../modals/new-conversation";
import { ChatConversationItem } from "./conversation-item";

type Props = {
  workspaceSlug: string;
  activeConversationId: string | undefined;
};

const SKELETON_KEYS = ["s1", "s2", "s3", "s4", "s5", "s6"];

type TSectionProps = {
  title: string;
  conversations: TChatConversation[];
  workspaceSlug: string;
  activeConversationId: string | undefined;
};

function ChatSidebarSection(props: TSectionProps) {
  const { title, conversations, workspaceSlug, activeConversationId } = props;
  const [isOpen, setIsOpen] = useState(true);
  if (conversations.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-1 rounded-sm px-2 py-1.5 text-left text-13 font-semibold text-placeholder hover:bg-layer-transparent-hover"
      >
        {title}
        <ChevronDown className={cn("size-3 transition-transform", { "-rotate-90": !isOpen })} />
      </button>
      {isOpen &&
        conversations.map((conversation) => (
          <ChatConversationItem
            key={conversation.id}
            workspaceSlug={workspaceSlug}
            conversation={conversation}
            isActive={conversation.id === activeConversationId}
          />
        ))}
    </div>
  );
}

export const ChatSidebar = observer(function ChatSidebar(props: Props) {
  const { workspaceSlug, activeConversationId } = props;
  const { t } = useTranslation();
  const chat = useChat();
  const [query, setQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isNewOpen, setIsNewOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isSearchOpen) searchRef.current?.focus();
  }, [isSearchOpen]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return null;
    return chat.conversation.sorted.filter((conversation) =>
      chat.conversation.displayName(conversation).toLowerCase().includes(needle)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `sorted` is observable; re-read on every render via observer
  }, [query, chat.conversation.sorted]);

  const { isFetched, groups, directs } = chat.conversation;

  return (
    <div className="flex h-full w-full flex-col bg-surface-1 pt-3">
      <div className="flex flex-col gap-3 px-3">
        <div className="flex items-center justify-between gap-2 px-2">
          <h2 className="pt-1 text-16 font-medium text-primary">{t("chat.title")}</h2>
          <div className="flex items-center gap-1">
            <IconButton
              icon={Search}
              variant="ghost"
              size="base"
              aria-label={t("common.search.label")}
              onClick={() => setIsSearchOpen((value) => !value)}
            />
            <IconButton
              icon={SquarePen}
              variant="secondary"
              size="base"
              aria-label={t("chat.actions.new")}
              onClick={() => setIsNewOpen(true)}
            />
          </div>
        </div>
        {isSearchOpen && (
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setQuery("");
                setIsSearchOpen(false);
              }
            }}
            placeholder={t("chat.new_conversation.search_members")}
            aria-label={t("common.search.label")}
            className="h-8 w-full rounded-md border border-subtle bg-surface-1 px-2 text-13 text-primary placeholder:text-placeholder focus:border-accent-strong focus:outline-none"
          />
        )}
      </div>

      <div className="vertical-scrollbar flex scrollbar-sm flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
        {!isFetched ? (
          <Loader className="flex flex-col gap-2 px-2">
            {SKELETON_KEYS.map((key) => (
              <Loader.Item key={key} height="36px" />
            ))}
          </Loader>
        ) : matches ? (
          <div className="flex flex-col gap-0.5">
            {matches.map((conversation) => (
              <ChatConversationItem
                key={conversation.id}
                workspaceSlug={workspaceSlug}
                conversation={conversation}
                isActive={conversation.id === activeConversationId}
              />
            ))}
          </div>
        ) : groups.length === 0 && directs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <p className="text-13 text-secondary">{t("chat.thread.no_conversation_body")}</p>
            <button
              type="button"
              className="text-13 font-medium text-accent-primary hover:underline"
              onClick={() => setIsNewOpen(true)}
            >
              {t("chat.actions.new")}
            </button>
          </div>
        ) : (
          <>
            <ChatSidebarSection
              title={t("chat.sections.groups")}
              conversations={groups}
              workspaceSlug={workspaceSlug}
              activeConversationId={activeConversationId}
            />
            <ChatSidebarSection
              title={t("chat.sections.directs")}
              conversations={directs}
              workspaceSlug={workspaceSlug}
              activeConversationId={activeConversationId}
            />
          </>
        )}
      </div>

      <ChatNewConversationModal workspaceSlug={workspaceSlug} isOpen={isNewOpen} onClose={() => setIsNewOpen(false)} />
    </div>
  );
});
