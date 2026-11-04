/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { Archive, ArrowLeft, ChevronDown, Search, Settings2, SquarePen, Star, TextSearch } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { IconButton } from "@plane/propel/icon-button";
import type { TChatConversation } from "@plane/types";
import { Loader } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useChat } from "@/hooks/store/use-chat";
import type { TChatListFilter } from "@/store/chat";
// local
import { chatSearchPath } from "../common/helpers";
import { ChatSettingsModal } from "../modals/chat-settings";
import { ChatNewConversationModal } from "../modals/new-conversation";
import { ChatConversationItem } from "./conversation-item";

type Props = {
  workspaceSlug: string;
  activeConversationId: string | undefined;
};

const SKELETON_KEYS = ["s1", "s2", "s3", "s4", "s5", "s6"];
const SECTION_STATE_KEY = "chat:sections";

const readCollapsed = (): Record<string, boolean> => {
  try {
    return JSON.parse(window.localStorage.getItem(SECTION_STATE_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
};

type TSectionProps = {
  id: string;
  title: string;
  icon?: React.ReactNode;
  conversations: TChatConversation[];
  workspaceSlug: string;
  activeConversationId: string | undefined;
};

function ChatSidebarSection(props: TSectionProps) {
  const { id, title, icon, conversations, workspaceSlug, activeConversationId } = props;
  const [isOpen, setIsOpen] = useState(() => !readCollapsed()[id]);
  if (conversations.length === 0) return null;
  const toggle = () => {
    setIsOpen((value) => {
      try {
        window.localStorage.setItem(SECTION_STATE_KEY, JSON.stringify({ ...readCollapsed(), [id]: value }));
      } catch {
        // Section state is a convenience only.
      }
      return !value;
    });
  };
  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-12 font-semibold text-placeholder hover:bg-layer-transparent-hover"
      >
        {icon}
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

const FILTERS: TChatListFilter[] = ["all", "unread", "mentions"];

export const ChatSidebar = observer(function ChatSidebar(props: Props) {
  const { workspaceSlug, activeConversationId } = props;
  const { t } = useTranslation();
  const chat = useChat();
  const [query, setQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const store = chat.conversation;

  useEffect(() => {
    if (isSearchOpen) searchRef.current?.focus();
  }, [isSearchOpen]);

  useEffect(() => {
    if (isArchiveOpen) void store.fetchArchived(workspaceSlug).catch(() => undefined);
  }, [isArchiveOpen, store, workspaceSlug]);

  const needle = query.trim().toLowerCase();
  const matches = needle
    ? [...store.sorted, ...store.archived].filter((conversation) =>
        store.displayName(conversation).toLowerCase().includes(needle)
      )
    : null;

  const filterLabel = (filter: TChatListFilter) => {
    if (filter === "unread") return t("chat.sidebar.filter.unread", { count: store.unreadConversationCount });
    if (filter === "mentions") return t("chat.sidebar.filter.mentions", { count: store.mentionConversationCount });
    return t("chat.sidebar.filter.all");
  };

  const renderList = (conversations: TChatConversation[]) => (
    <div className="flex flex-col gap-0.5">
      {conversations.map((conversation) => (
        <ChatConversationItem
          key={conversation.id}
          workspaceSlug={workspaceSlug}
          conversation={conversation}
          isActive={conversation.id === activeConversationId}
        />
      ))}
    </div>
  );

  const isEmpty = store.sorted.length === 0;
  const isFilteredEmpty = !isEmpty && store.visible.length === 0;

  return (
    <div className="flex h-full w-full flex-col bg-surface-1 pt-3">
      <div className="flex flex-col gap-2.5 px-3">
        <div className="flex items-center justify-between gap-2 px-2">
          <h2 className="pt-1 text-16 font-medium text-primary">{t("chat.title")}</h2>
          <div className="flex items-center gap-1">
            <IconButton
              icon={Search}
              variant={isSearchOpen ? "tertiary" : "ghost"}
              size="base"
              aria-label={t("chat.sidebar.find")}
              aria-pressed={isSearchOpen}
              onClick={() => setIsSearchOpen((value) => !value)}
            />
            <IconButton
              icon={Settings2}
              variant="ghost"
              size="base"
              aria-label={t("chat.prefs.title")}
              onClick={() => setIsSettingsOpen(true)}
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
            placeholder={t("chat.sidebar.find_placeholder")}
            aria-label={t("chat.sidebar.find")}
            className="h-8 w-full rounded-md border border-subtle bg-surface-1 px-2 text-13 text-primary placeholder:text-placeholder focus:border-accent-strong focus:outline-none"
          />
        )}
        {!isArchiveOpen && !matches && (
          <div role="radiogroup" aria-label={t("chat.sidebar.filter.label")} className="flex flex-wrap gap-1 px-1">
            {FILTERS.map((filter) => (
              <button
                key={filter}
                type="button"
                role="radio"
                aria-checked={store.filter === filter}
                onClick={() => store.setFilter(filter)}
                className={cn(
                  "h-6 rounded-full px-2.5 text-12 font-medium transition-colors",
                  store.filter === filter
                    ? "bg-layer-3 text-primary"
                    : "border border-subtle text-secondary hover:bg-layer-transparent-hover"
                )}
              >
                {filterLabel(filter)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="vertical-scrollbar flex scrollbar-sm flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
        {!store.isFetched ? (
          <Loader className="flex flex-col gap-2 px-2">
            {SKELETON_KEYS.map((key) => (
              <Loader.Item key={key} height="36px" />
            ))}
          </Loader>
        ) : matches ? (
          <>
            <Link
              href={chatSearchPath(workspaceSlug, { q: query.trim() })}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-13 text-accent-primary hover:bg-layer-transparent-hover"
            >
              <TextSearch className="size-4 shrink-0" />
              <span className="truncate">{t("chat.sidebar.search_messages_for", { query: query.trim() })}</span>
            </Link>
            {renderList(matches)}
          </>
        ) : isArchiveOpen ? (
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setIsArchiveOpen(false)}
              className="flex items-center gap-1.5 rounded-sm px-2 py-1.5 text-12 font-semibold text-secondary hover:bg-layer-transparent-hover"
            >
              <ArrowLeft className="size-3.5" />
              {t("chat.sidebar.archived")}
            </button>
            {store.isArchivedFetched && store.archived.length === 0 ? (
              <p className="px-2 py-6 text-center text-13 text-tertiary">{t("chat.sidebar.archived_empty")}</p>
            ) : (
              renderList(store.archived)
            )}
          </div>
        ) : isEmpty ? (
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
        ) : isFilteredEmpty ? (
          <p className="px-2 py-6 text-center text-13 text-tertiary">
            {store.filter === "mentions" ? t("chat.sidebar.no_mentions") : t("chat.sidebar.no_unread")}
          </p>
        ) : (
          <>
            <ChatSidebarSection
              id="starred"
              title={t("chat.sidebar.starred")}
              icon={<Star className="size-3 fill-current text-warning-primary" aria-hidden />}
              conversations={store.starred}
              workspaceSlug={workspaceSlug}
              activeConversationId={activeConversationId}
            />
            <ChatSidebarSection
              id="groups"
              title={t("chat.sections.groups")}
              conversations={store.groups}
              workspaceSlug={workspaceSlug}
              activeConversationId={activeConversationId}
            />
            <ChatSidebarSection
              id="directs"
              title={t("chat.sections.directs")}
              conversations={store.directs}
              workspaceSlug={workspaceSlug}
              activeConversationId={activeConversationId}
            />
          </>
        )}
      </div>

      {!isArchiveOpen && !matches && (
        <button
          type="button"
          onClick={() => setIsArchiveOpen(true)}
          className="flex items-center gap-2 border-t border-subtle px-5 py-2.5 text-12 text-tertiary hover:text-secondary"
        >
          <Archive className="size-3.5" />
          <span className="flex-1 text-left">{t("chat.sidebar.archived")}</span>
          {store.archivedUnread > 0 && (
            <span className="rounded-full bg-layer-3 px-1.5 text-10 font-semibold text-secondary">
              {store.archivedUnread}
            </span>
          )}
        </button>
      )}

      <ChatNewConversationModal workspaceSlug={workspaceSlug} isOpen={isNewOpen} onClose={() => setIsNewOpen(false)} />
      <ChatSettingsModal
        workspaceSlug={workspaceSlug}
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
});
