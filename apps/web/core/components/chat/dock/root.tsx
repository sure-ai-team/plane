/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useParams, usePathname } from "next/navigation";
import { ChevronDown, ChevronUp, MessageSquare, X } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Tooltip } from "@plane/propel/tooltip";
import type { TChatConversation } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { useChat } from "@/hooks/store/use-chat";
import { useUser } from "@/hooks/store/user";
// local
import { ConversationAvatar } from "../common/avatars";
import { previewText } from "../common/helpers";
import { useChatAvailability } from "../hooks/use-chat-availability";
import { ChatDockWindow } from "./window";

/** Below this width the phone layout takes over and the dock is hidden. */
const DOCK_MIN_WIDTH = "(min-width: 768px)";
const LAUNCHER_LIST_LIMIT = 8;

const useIsWide = () => {
  const [isWide, setIsWide] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(DOCK_MIN_WIDTH).matches
  );
  useEffect(() => {
    const query = window.matchMedia(DOCK_MIN_WIDTH);
    const update = () => setIsWide(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return isWide;
};

const UnreadBadge = ({ count, className }: { count: number; className?: string }) =>
  count > 0 ? (
    <span
      className={cn(
        "flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-primary px-1 text-10 font-semibold text-on-color",
        className
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  ) : null;

/**
 * Minimized chat (docs/chat/phase-2/04-frontend.md § Minimized chat): docked
 * windows, minimized tabs or chat heads, and a launcher, on every non-chat page.
 */
export const ChatDock = observer(function ChatDock() {
  const { workspaceSlug } = useParams();
  const slug = workspaceSlug?.toString() ?? "";
  const pathname = usePathname();
  const { t } = useTranslation();
  const tr = t as (key: string, params?: Record<string, unknown>) => string;
  const chat = useChat();
  const { data: currentUser } = useUser();
  const isAvailable = useChatAvailability(slug);
  const isWide = useIsWide();
  const isChatPage = !!slug && (pathname ?? "").startsWith(`/${slug}/chat`);
  const isShown = isAvailable && chat.isInitialized && chat.workspaceSlug === slug && !isChatPage && isWide;
  const dock = chat.dock;

  useEffect(() => {
    dock.setShown(isShown);
  }, [dock, isShown]);

  if (!isShown) return null;

  const useHeads = chat.notify.preferences?.minimize_style === "heads";
  const conversation = (id: string) => chat.conversation.getById(id);
  const expanded = dock.expandedIds.filter((id) => conversation(id));
  const minimized = dock.minimizedIds.map((id) => conversation(id)).filter((item): item is TChatConversation => !!item);
  const launcherList = chat.conversation.sorted.slice(0, LAUNCHER_LIST_LIMIT);
  const preview = (item: TChatConversation) => previewText(item.last_message_preview, item, currentUser?.id, tr);

  return (
    <>
      {useHeads && minimized.length > 0 && (
        <div
          aria-label={t("chat.dock.heads")}
          className="fixed top-1/4 right-4 z-[30] flex flex-col items-center gap-3"
        >
          {minimized.map((item) => (
            <div key={item.id} className="group/head relative">
              <Tooltip position="left" tooltipContent={`${chat.conversation.displayName(item)}: ${preview(item)}`}>
                <button
                  type="button"
                  aria-label={t("chat.dock.expand", { name: chat.conversation.displayName(item) })}
                  onClick={() => dock.expand(item.id)}
                  className="ring-surface-1 rounded-full shadow-raised-200 ring-2"
                >
                  <ConversationAvatar conversation={item} size={48} />
                </button>
              </Tooltip>
              <UnreadBadge count={item.unread_count} className="absolute -top-1 -right-1 bg-danger-primary" />
              <button
                type="button"
                aria-label={t("chat.dock.close")}
                onClick={() => dock.close(item.id)}
                className="absolute -bottom-1 -left-1 hidden size-5 items-center justify-center rounded-full bg-surface-1 text-tertiary shadow-raised-100 group-hover/head:flex"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="pointer-events-none fixed right-4 bottom-0 z-[30] flex flex-row-reverse items-end gap-3">
        {/* Launcher: total unread and a short list to open a window from. */}
        <div className="pointer-events-auto flex w-[260px] flex-col overflow-hidden rounded-t-lg border border-b-0 border-strong bg-surface-1 shadow-raised-200">
          {dock.isLauncherOpen && (
            <div className="vertical-scrollbar flex scrollbar-sm max-h-80 flex-col overflow-y-auto border-b border-subtle p-1">
              {launcherList.length === 0 ? (
                <p className="px-2 py-4 text-center text-12 text-tertiary">{t("chat.thread.no_conversation_body")}</p>
              ) : (
                launcherList.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => dock.open(item.id)}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-layer-transparent-hover"
                  >
                    <ConversationAvatar conversation={item} size={24} showPresence />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-13 font-medium text-primary">
                        {chat.conversation.displayName(item)}
                      </span>
                      <span className="truncate text-11 text-tertiary">{preview(item)}</span>
                    </span>
                    <UnreadBadge count={item.unread_count} />
                  </button>
                ))
              )}
            </div>
          )}
          <button
            type="button"
            aria-expanded={dock.isLauncherOpen}
            onClick={() => dock.toggleLauncher()}
            className="flex h-11 items-center gap-2 px-3 text-left hover:bg-layer-transparent-hover"
          >
            <MessageSquare className="size-4 text-secondary" />
            <span className="flex-1 text-13 font-semibold text-primary">{t("chat.title")}</span>
            <UnreadBadge count={chat.conversation.totalUnread} />
            {dock.isLauncherOpen ? (
              <ChevronDown className="size-4 text-tertiary" />
            ) : (
              <ChevronUp className="size-4 text-tertiary" />
            )}
          </button>
        </div>

        {!useHeads &&
          minimized.map((item) => (
            <div
              key={item.id}
              className="pointer-events-auto flex h-11 w-[220px] items-center gap-2 rounded-t-lg border border-b-0 border-strong bg-surface-1 pr-1 pl-3 shadow-raised-200"
            >
              <button
                type="button"
                onClick={() => dock.expand(item.id)}
                aria-label={t("chat.dock.expand", { name: chat.conversation.displayName(item) })}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <ConversationAvatar conversation={item} size={22} showPresence />
                <span className="flex-1 truncate text-13 font-semibold text-primary">
                  {chat.conversation.displayName(item)}
                </span>
                <UnreadBadge count={item.unread_count} />
              </button>
              <button
                type="button"
                aria-label={t("chat.dock.close")}
                onClick={() => dock.close(item.id)}
                className="flex size-6 items-center justify-center rounded-sm text-tertiary hover:bg-layer-transparent-hover"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}

        {expanded.map((id) => (
          <ChatDockWindow key={id} workspaceSlug={slug} conversationId={id} />
        ))}
      </div>
    </>
  );
});
