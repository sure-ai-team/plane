/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Search, X } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { IconButton } from "@plane/propel/icon-button";
import type { TChatMessage, TChatSearchHas, TChatSearchResult } from "@plane/types";
import { Loader } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { useChat } from "@/hooks/store/use-chat";
import { useAppRouter } from "@/hooks/use-app-router";
import { ChatService } from "@/services/chat.service";
import { canSearch } from "@/store/chat";
import type { TChatSearchFilters } from "@/store/chat";
// local
import { ChatUserAvatar } from "../common/avatars";
import { chatPath, chatSearchPath, groupResults, listTimeLabel, timeLabel, userName } from "../common/helpers";

type TTranslate = (key: string, params?: Record<string, unknown>) => string;

const HAS_OPTIONS: TChatSearchHas[] = ["file", "image", "video", "voice", "link", "work_item"];
const DEBOUNCE_MS = 300;
const chatService = new ChatService();

const conversationName = (result: TChatSearchResult) =>
  result.conversation.type === "direct"
    ? (result.conversation.direct_user?.display_name ?? "")
    : result.conversation.name;

const selectClass =
  "h-7 rounded-md border border-subtle bg-surface-1 px-2 text-12 font-medium text-secondary focus:border-accent-strong focus:outline-none";

type Props = { workspaceSlug: string };

export const ChatSearch = observer(function ChatSearch({ workspaceSlug }: Props) {
  const { t } = useTranslation();
  const tr = t as TTranslate;
  const chat = useChat();
  const search = chat.search;
  const router = useAppRouter();
  // The router object may change identity between renders; effects read it through a ref.
  const routerRef = useRef(router);
  routerRef.current = router;
  const params = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    workspace: { getWorkspaceMemberIds, getWorkspaceMemberDetails },
  } = useMember();
  const [context, setContext] = useState<TChatMessage[] | null>(null);

  // Start from the URL (shared links, the sidebar's "Search messages for …").
  useEffect(() => {
    search.setText(params.get("q") ?? "");
    search.setFilters({
      conversation_id: params.get("conversation_id") ?? undefined,
      from: params.get("from") ?? undefined,
      has: (params.get("has") as TChatSearchHas | null) ?? undefined,
      after: params.get("after") ?? undefined,
      before: params.get("before") ?? undefined,
    });
    inputRef.current?.focus();
    // Only on first render: later changes come from the inputs below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Run the search (debounced) and keep the URL in sync.
  const { text, filters } = search;
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void search.run(workspaceSlug);
      routerRef.current.replace(chatSearchPath(workspaceSlug, { q: text.trim() || undefined, ...filters }));
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text, filters, search, workspaceSlug]);

  // Context around the selected result: two messages before and after.
  const selected = search.selected;
  useEffect(() => {
    setContext(null);
    if (!selected) return;
    let cancelled = false;
    void chatService
      .listMessages(workspaceSlug, selected.conversation.id, { around_seq: selected.message.seq, limit: 5 })
      .then((page) => {
        if (!cancelled) setContext(page.results);
        return page;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [selected, workspaceSlug]);

  const setFilter = (key: keyof TChatSearchFilters, value: string) =>
    search.setFilters({ ...search.filters, [key]: value || undefined });

  const open = (result: TChatSearchResult) =>
    router.push(`${chatPath(workspaceSlug, result.conversation.id)}?m=${result.message.id}`);

  const members = getWorkspaceMemberIds(workspaceSlug)
    .map((id) => getWorkspaceMemberDetails(id))
    .filter((details): details is NonNullable<typeof details> => !!details && !details.member.is_bot);

  const groups = groupResults(search.results);
  const hasQuery = canSearch(search.text, search.filters);

  return (
    <div className="flex h-full min-w-0 flex-1">
      <section aria-label={t("chat.search.title")} className="flex h-full min-w-0 flex-1 flex-col">
        <div className="flex flex-col gap-3 border-b border-subtle px-4 py-3">
          <div className="flex items-center gap-2">
            <Link
              href={chatPath(workspaceSlug)}
              aria-label={t("chat.search.back")}
              className="flex size-7 items-center justify-center rounded-md text-secondary hover:bg-layer-transparent-hover"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <label className="flex h-9 flex-1 items-center gap-2 rounded-md border border-strong px-3 focus-within:border-accent-strong">
              <Search className="size-4 shrink-0 text-tertiary" />
              <input
                ref={inputRef}
                value={search.text}
                onChange={(event) => search.setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    search.moveSelection(1);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    search.moveSelection(-1);
                  } else if (event.key === "Enter" && search.selected) {
                    open(search.selected);
                  }
                }}
                placeholder={t("chat.search.placeholder")}
                aria-label={t("chat.search.placeholder")}
                className="flex-1 bg-transparent text-14 text-primary placeholder:text-placeholder focus:outline-none"
              />
              {search.text && (
                <IconButton
                  icon={X}
                  variant="ghost"
                  size="sm"
                  aria-label={t("chat.search.clear")}
                  onClick={() => search.setText("")}
                />
              )}
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label={t("chat.search.filter.in")}
              className={selectClass}
              value={search.filters.conversation_id ?? ""}
              onChange={(event) => setFilter("conversation_id", event.target.value)}
            >
              <option value="">{t("chat.search.filter.in_all")}</option>
              {chat.conversation.sorted.map((conversation) => (
                <option key={conversation.id} value={conversation.id}>
                  {chat.conversation.displayName(conversation)}
                </option>
              ))}
            </select>
            <select
              aria-label={t("chat.search.filter.from")}
              className={selectClass}
              value={search.filters.from ?? ""}
              onChange={(event) => setFilter("from", event.target.value)}
            >
              <option value="">{t("chat.search.filter.from_anyone")}</option>
              {members.map((details) => (
                <option key={details.member.id} value={details.member.id}>
                  {details.member.display_name}
                </option>
              ))}
            </select>
            <select
              aria-label={t("chat.search.filter.has")}
              className={selectClass}
              value={search.filters.has ?? ""}
              onChange={(event) => setFilter("has", event.target.value)}
            >
              <option value="">{t("chat.search.filter.has_any")}</option>
              {HAS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {tr(`chat.search.has.${option}`)}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-12 text-tertiary">
              {t("chat.search.filter.after")}
              <input
                type="date"
                className={selectClass}
                value={search.filters.after ?? ""}
                onChange={(event) => setFilter("after", event.target.value)}
              />
            </label>
            <label className="flex items-center gap-1 text-12 text-tertiary">
              {t("chat.search.filter.before")}
              <input
                type="date"
                className={selectClass}
                value={search.filters.before ?? ""}
                onChange={(event) => setFilter("before", event.target.value)}
              />
            </label>
            {hasQuery && search.totalEstimate !== null && (
              <span className="ml-auto text-12 text-tertiary" aria-live="polite">
                {search.totalEstimate > 1000
                  ? t("chat.search.results_many")
                  : t("chat.search.results", { count: search.totalEstimate })}
              </span>
            )}
          </div>
        </div>

        <div className="vertical-scrollbar flex scrollbar-sm flex-1 flex-col overflow-y-auto px-2 py-2">
          {!hasQuery ? (
            <p className="px-4 py-10 text-center text-13 text-tertiary">{t("chat.search.hint")}</p>
          ) : search.isLoading && search.results.length === 0 ? (
            <Loader className="flex flex-col gap-3 p-3">
              <Loader.Item height="48px" />
              <Loader.Item height="48px" />
              <Loader.Item height="48px" />
            </Loader>
          ) : search.error ? (
            <p className="px-4 py-10 text-center text-13 text-danger-primary">{search.error}</p>
          ) : search.results.length === 0 ? (
            <p className="px-4 py-10 text-center text-13 text-tertiary">{t("chat.search.empty")}</p>
          ) : (
            <div role="listbox" aria-label={t("chat.search.results_label")}>
              {groups.map((group) => (
                <section key={`${group.conversationId}-${group.items[0].index}`} className="mb-2">
                  <h3 className="px-3 pt-2 pb-1 text-12 font-semibold text-tertiary">
                    {conversationName(group.items[0].result)}
                  </h3>
                  {group.items.map(({ result, index }) => (
                    <div
                      key={result.message.id}
                      role="option"
                      tabIndex={-1}
                      aria-selected={index === search.selectedIndex}
                      onMouseEnter={() => search.select(index)}
                      onClick={() => open(result)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") open(result);
                      }}
                      className={cn("flex cursor-pointer gap-2.5 rounded-md px-3 py-2", {
                        "bg-accent-subtle": index === search.selectedIndex,
                      })}
                    >
                      <ChatUserAvatar user={result.message.sender} size={28} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="truncate text-13 font-medium text-primary">
                            {userName(result.message.sender, tr)}
                          </span>
                          <span className="text-11 text-tertiary">{listTimeLabel(result.message.created_at)}</span>
                        </div>
                        <p
                          className="text-13 break-words text-secondary [&_mark]:rounded-sm [&_mark]:bg-warning-subtle [&_mark]:px-0.5 [&_mark]:text-primary"
                          // Escaped by the server; only <mark> tags are added back (07-security.md P2-S2).
                          // eslint-disable-next-line react/no-danger
                          dangerouslySetInnerHTML={{ __html: result.snippet_html }}
                        />
                        {result.attachment_names.length > 0 && (
                          <p className="mt-0.5 truncate text-11 text-tertiary">{result.attachment_names.join(", ")}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </section>
              ))}
              {search.nextCursor && (
                <button
                  type="button"
                  onClick={() => void search.loadMore(workspaceSlug)}
                  className="mx-auto my-2 block text-13 font-medium text-accent-primary hover:underline"
                >
                  {search.isLoadingMore ? t("chat.search.loading") : t("chat.search.load_more")}
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      <aside
        aria-label={t("chat.search.context")}
        className="hidden h-full w-96 shrink-0 flex-col border-l border-subtle bg-layer-1 lg:flex"
      >
        {selected ? (
          <>
            <div className="flex h-header items-center justify-between gap-2 border-b border-subtle bg-surface-1 px-4">
              <span className="truncate text-13 font-medium text-primary">{conversationName(selected)}</span>
              <button
                type="button"
                onClick={() => open(selected)}
                className="shrink-0 text-12 font-medium text-accent-primary hover:underline"
              >
                {t("chat.search.open")}
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-1 overflow-hidden p-3">
              {(context ?? []).map((message) => (
                <div
                  key={message.id}
                  className={cn("flex gap-2 rounded-md p-2", {
                    "bg-warning-subtle": message.id === selected.message.id,
                  })}
                >
                  <ChatUserAvatar user={message.sender} size={24} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-12 font-medium text-primary">{userName(message.sender, tr)}</span>
                      <span className="text-11 text-tertiary">{timeLabel(message.created_at)}</span>
                    </div>
                    <p className="line-clamp-3 text-12 break-words text-secondary">
                      {message.kind === "system" ? t("chat.preview.system") : message.body_stripped}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <p className="border-t border-subtle px-4 py-2.5 text-11 text-tertiary">{t("chat.search.footer")}</p>
          </>
        ) : (
          <p className="m-auto px-6 text-center text-12 text-tertiary">{t("chat.search.footer")}</p>
        )}
      </aside>
    </div>
  );
});
