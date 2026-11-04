/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import type { VirtuosoHandle } from "react-virtuoso";
import { useTranslation } from "@plane/i18n";
import type { TChatConversation, TChatMessage } from "@plane/types";
import { Loader } from "@plane/ui";
// hooks
import { useChat } from "@/hooks/store/use-chat";
import { useUser } from "@/hooks/store/user";
import type { TThreadItem } from "@/store/chat";
// local
import { dayKey, firstUnreadIndex, startsGroup, timeLabel } from "../common/helpers";
import { ConversationAvatar } from "../common/avatars";
import { ChatMessageItem } from "./message-item";
import { ChatDayDivider, ChatPendingMessage, ChatSystemMessage } from "./small-items";

/** Virtuoso needs a stable, large starting index so older pages can be prepended. */
const START_INDEX = 1_000_000;
const SKELETON_WIDTHS = ["40%", "57%", "74%", "46%", "63%"];
/** How long a jumped-to message stays highlighted. */
export const HIGHLIGHT_MS = 2_500;

type TRow = {
  key: string;
  item: TThreadItem;
  showDay: string | null;
  showHeader: boolean;
  /** The "New" divider goes above this row (first message after the last read one). */
  showUnread: boolean;
};

type Props = {
  workspaceSlug: string;
  workspaceId: string;
  conversation: TChatConversation;
  onReply: (message: TChatMessage) => void;
  layout?: "compact" | "bubbles";
};

const itemTime = (item: TThreadItem) => (item.type === "message" ? item.message.created_at : item.pending.created_at);
const itemKey = (item: TThreadItem) =>
  item.type === "message" ? item.message.id : `pending-${item.pending.client_id}`;

export const ChatMessageList = observer(function ChatMessageList(props: Props) {
  const { workspaceSlug, workspaceId, conversation, onReply, layout = "compact" } = props;
  const { t } = useTranslation();
  const chat = useChat();
  const { data: currentUser } = useUser();
  const virtuoso = useRef<VirtuosoHandle>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [hasNewBelow, setHasNewBelow] = useState(false);
  const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX);
  const previousFirstKey = useRef<string | null>(null);
  const previousLastKey = useRef<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [isDividerVisible, setIsDividerVisible] = useState(false);
  const [isPillDismissed, setIsPillDismissed] = useState(false);
  const dividerObserver = useRef<IntersectionObserver | null>(null);

  const thread = chat.message.thread(conversation.id);
  const items = chat.message.items(conversation.id);
  const marker = chat.message.unreadMarkers.get(conversation.id);
  const unreadIndex = useMemo(() => firstUnreadIndex(items, marker, currentUser?.id), [items, marker, currentUser?.id]);
  const unreadCount = useMemo(
    () =>
      unreadIndex < 0
        ? 0
        : items
            .slice(unreadIndex)
            .filter((item) => item.type === "message" && item.message.sender?.id !== currentUser?.id).length,
    [items, unreadIndex, currentUser?.id]
  );

  useEffect(() => {
    setIsPillDismissed(false);
    setHighlightedId(null);
  }, [conversation.id]);

  // The pill shows while the "New" divider is off screen.
  const dividerRef = useCallback((node: HTMLDivElement | null) => {
    dividerObserver.current?.disconnect();
    dividerObserver.current = null;
    if (!node) {
      setIsDividerVisible(false);
      return;
    }
    const intersection = new IntersectionObserver(([entry]) => setIsDividerVisible(entry.isIntersecting));
    intersection.observe(node);
    dividerObserver.current = intersection;
  }, []);

  const rows: TRow[] = useMemo(() => {
    const result: TRow[] = [];
    let previousMessage: TChatMessage | undefined;
    let previousDay: string | null = null;
    for (const item of items) {
      const time = itemTime(item);
      const day = dayKey(time);
      const showDay = day !== previousDay ? time : null;
      let showHeader = true;
      if (item.type === "message") {
        showHeader = startsGroup(item.message, previousMessage) || !!showDay;
        previousMessage = item.message;
      } else {
        showHeader = !previousMessage || previousMessage.sender?.id !== item.pending.sender?.id || !!showDay;
      }
      previousDay = day;
      const showUnread = result.length === unreadIndex;
      result.push({ key: itemKey(item), item, showDay, showHeader: showHeader || showUnread, showUnread });
    }
    return result;
  }, [items, unreadIndex]);

  // Scroll to a message someone jumped to (reply quote, pin, search, link) and highlight it.
  // Shift+J: scroll to the "New" divider.
  const jumpUnreadNonce = chat.jumpUnreadNonce;
  const lastJumpNonce = useRef(jumpUnreadNonce);
  useEffect(() => {
    if (jumpUnreadNonce === lastJumpNonce.current) return;
    lastJumpNonce.current = jumpUnreadNonce;
    if (unreadIndex >= 0) virtuoso.current?.scrollToIndex({ index: unreadIndex, align: "start", behavior: "smooth" });
  }, [jumpUnreadNonce, unreadIndex]);

  const focusRequest = chat.message.focusRequest;
  useEffect(() => {
    if (!focusRequest || focusRequest.conversationId !== conversation.id) return;
    const index = rows.findIndex(
      (row) =>
        row.item.type === "message" &&
        (row.item.message.id === focusRequest.messageId || row.item.message.seq === focusRequest.seq)
    );
    if (index < 0) return;
    const row = rows[index];
    virtuoso.current?.scrollToIndex({ index, align: "center", behavior: "auto" });
    setHighlightedId(row.item.type === "message" ? row.item.message.id : null);
    chat.message.clearFocusRequest();
    const timer = window.setTimeout(() => setHighlightedId(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [focusRequest, rows, conversation.id, chat.message]);

  // ↑ in an empty composer: edit my newest message.
  const editRequest = chat.editLastRequest;
  const [editTarget, setEditTarget] = useState<{ id: string; nonce: number } | null>(null);
  const lastOwnMessageId = useMemo(() => {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (row.item.type === "message" && row.item.message.sender?.id === currentUser?.id) return row.item.message.id;
    }
    return null;
  }, [rows, currentUser?.id]);

  useEffect(() => {
    if (!editRequest || editRequest.conversationId !== conversation.id) return;
    chat.clearEditLastRequest();
    if (!lastOwnMessageId) return;
    setEditTarget({ id: lastOwnMessageId, nonce: editRequest.nonce });
    const index = rows.findIndex((row) => row.item.type === "message" && row.item.message.id === lastOwnMessageId);
    if (index >= 0) virtuoso.current?.scrollToIndex({ index, align: "center" });
  }, [editRequest, conversation.id, lastOwnMessageId, rows, chat]);

  useEffect(() => {
    const firstKey = rows[0]?.key ?? null;
    const lastKey = rows[rows.length - 1]?.key ?? null;
    // Keep the view still when older messages are prepended.
    if (previousFirstKey.current && firstKey && firstKey !== previousFirstKey.current) {
      const oldFirstIndex = rows.findIndex((row) => row.key === previousFirstKey.current);
      if (oldFirstIndex > 0) setFirstItemIndex((value) => value - oldFirstIndex);
    }
    // Something new arrived at the bottom while the user was reading older messages.
    if (previousLastKey.current && lastKey !== previousLastKey.current && !isAtBottom) setHasNewBelow(true);
    previousFirstKey.current = firstKey;
    previousLastKey.current = lastKey;
  }, [rows, isAtBottom]);

  // Screen readers: announce the newest incoming message (one polite announcement at a time).
  const [announcement, setAnnouncement] = useState("");
  const lastAnnounced = useRef<string | null>(null);
  useEffect(() => {
    lastAnnounced.current = null;
    setAnnouncement("");
  }, [conversation.id]);
  useEffect(() => {
    const last = rows[rows.length - 1]?.item;
    if (!last || last.type !== "message") return;
    const message = last.message;
    if (lastAnnounced.current === null) {
      lastAnnounced.current = message.id; // don't announce what was already there on open
      return;
    }
    if (message.id === lastAnnounced.current || message.sender?.id === currentUser?.id || message.kind === "system")
      return;
    lastAnnounced.current = message.id;
    const timer = window.setTimeout(
      () =>
        setAnnouncement(
          t("chat.a11y.new_message", {
            name: message.sender?.display_name ?? t("chat.system.someone"),
            text:
              message.body_stripped?.slice(0, 120) ||
              t("chat.preview.attachments", { count: message.attachments.length }),
          })
        ),
      400
    );
    return () => window.clearTimeout(timer);
  }, [rows, currentUser?.id, t]);

  // Mark read whenever the newest message is on screen and the tab is visible.
  const newestSeq = thread?.newestSeq ?? null;
  const hasMoreAfter = !!thread?.hasMoreAfter;
  useEffect(() => {
    // In a window opened around an older message, the bottom isn't the newest message.
    if (!isAtBottom || newestSeq === null || hasMoreAfter) return;
    const markIfVisible = () => {
      if (document.visibilityState === "visible") void chat.markRead(conversation.id);
    };
    const timer = window.setTimeout(markIfVisible, 500);
    document.addEventListener("visibilitychange", markIfVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", markIfVisible);
    };
  }, [isAtBottom, newestSeq, hasMoreAfter, chat, conversation.id]);

  const jumpToLatest = async () => {
    setHasNewBelow(false);
    if (hasMoreAfter) await chat.message.jumpToLatest(workspaceSlug, conversation.id);
    virtuoso.current?.scrollToIndex({ index: "LAST", behavior: "smooth" });
  };

  if (!thread || thread.isLoadingInitial) {
    return (
      <Loader className="flex flex-1 flex-col justify-end gap-4 p-4">
        {SKELETON_WIDTHS.map((width) => (
          <div key={width} className="flex gap-2.5">
            <Loader.Item height="28px" width="28px" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Loader.Item height="12px" width="25%" />
              <Loader.Item height="14px" width={width} />
            </div>
          </div>
        ))}
      </Loader>
    );
  }

  if (thread.error && rows.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-13 text-secondary">{t("chat.thread.load_failed")}</p>
        <button
          type="button"
          className="text-13 font-medium text-accent-primary hover:underline"
          onClick={() => void chat.message.open(workspaceSlug, conversation.id)}
        >
          {t("chat.thread.retry")}
        </button>
      </div>
    );
  }

  const intro = (
    <div className="flex flex-col items-center justify-center gap-2 p-6 text-center">
      <ConversationAvatar conversation={conversation} size={48} />
      <p className="text-16 font-semibold text-primary">{chat.conversation.displayName(conversation)}</p>
      <p className="max-w-xs text-13 text-tertiary">
        {conversation.type === "direct"
          ? t("chat.states.new_direct", { name: chat.conversation.displayName(conversation) })
          : t("chat.states.new_group", { name: conversation.name })}
      </p>
      <button
        type="button"
        onClick={() => void chat.send(conversation.id, { body_html: "<p>👋</p>", body_stripped: "👋" })}
        className="mt-1 h-8 rounded-md border border-subtle px-3 text-13 font-medium text-primary hover:bg-layer-transparent-hover"
      >
        {t("chat.states.say_hi")}
      </button>
    </div>
  );

  if (rows.length === 0) return <div className="flex flex-1 flex-col justify-center">{intro}</div>;

  // A new group only has its "created" line; keep the intro above it until someone writes.
  const hasUserMessages = items.some((item) => item.type !== "message" || item.message.kind !== "system");
  const showIntro = !thread.hasMoreBefore && !hasUserMessages;

  return (
    <div className="relative min-h-0 flex-1">
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      <Virtuoso
        ref={virtuoso}
        className="vertical-scrollbar scrollbar-sm h-full"
        data={rows}
        firstItemIndex={firstItemIndex}
        initialTopMostItemIndex={rows.length - 1}
        computeItemKey={(_index, row) => row.key}
        followOutput={(atBottom) => (atBottom && !hasMoreAfter ? "smooth" : false)}
        atBottomStateChange={(atBottom) => {
          setIsAtBottom(atBottom);
          if (atBottom) setHasNewBelow(false);
        }}
        atBottomThreshold={48}
        startReached={() => void chat.message.loadOlder(workspaceSlug, conversation.id)}
        endReached={() => {
          if (hasMoreAfter) void chat.message.loadNewer(workspaceSlug, conversation.id);
        }}
        increaseViewportBy={{ top: 600, bottom: 300 }}
        components={{
          Header: () =>
            showIntro ? (
              intro
            ) : thread.isLoadingOlder ? (
              <p className="py-3 text-center text-12 text-tertiary">{t("chat.thread.loading_older")}</p>
            ) : (
              <div className="h-3" />
            ),
          Footer: () =>
            thread.isLoadingNewer ? (
              <p className="py-3 text-center text-12 text-tertiary">{t("chat.thread.loading_newer")}</p>
            ) : (
              <div className="h-2" />
            ),
        }}
        itemContent={(_index, row) => (
          <div>
            {row.showDay && <ChatDayDivider iso={row.showDay} />}
            {row.showUnread && (
              <div
                ref={dividerRef}
                role="separator"
                aria-label={t("chat.unread.divider_label")}
                className="flex items-center gap-2.5 px-3 py-2 text-11 font-semibold tracking-wide text-danger-primary uppercase"
              >
                <span className="h-px flex-1 bg-danger-subtle" />
                {t("chat.unread.divider")}
              </div>
            )}
            {row.item.type === "pending" ? (
              <ChatPendingMessage
                workspaceSlug={workspaceSlug}
                pending={row.item.pending}
                showHeader={row.showHeader}
              />
            ) : row.item.message.kind === "system" ? (
              <ChatSystemMessage workspaceSlug={workspaceSlug} message={row.item.message} conversation={conversation} />
            ) : (
              <ChatMessageItem
                workspaceSlug={workspaceSlug}
                workspaceId={workspaceId}
                conversation={conversation}
                message={row.item.message}
                showHeader={row.showHeader}
                showSeenBy={row.item.message.id === lastOwnMessageId}
                isHighlighted={row.item.message.id === highlightedId}
                editNonce={editTarget?.id === row.item.message.id ? editTarget.nonce : 0}
                layout={layout}
                onReply={onReply}
              />
            )}
          </div>
        )}
      />
      {unreadIndex >= 0 && unreadCount > 0 && !isDividerVisible && !isPillDismissed && (
        <div className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-accent-primary py-0.5 pr-0.5 pl-3 text-12 font-medium text-on-color shadow-raised-200">
          <span>
            {t("chat.unread.pill", {
              count: unreadCount,
              time:
                rows[unreadIndex]?.item.type === "message" ? timeLabel(rows[unreadIndex].item.message.created_at) : "",
            })}
          </span>
          <button
            type="button"
            onClick={() => virtuoso.current?.scrollToIndex({ index: unreadIndex, align: "start", behavior: "smooth" })}
            className="ml-2 flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-1 font-semibold hover:bg-white/30"
          >
            <ArrowUp className="size-3" />
            {t("chat.unread.jump")}
          </button>
          <button
            type="button"
            aria-label={t("chat.unread.dismiss")}
            onClick={() => setIsPillDismissed(true)}
            className="flex size-6 items-center justify-center rounded-full hover:bg-white/20"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
      {(hasMoreAfter || (hasNewBelow && !isAtBottom)) && (
        <button
          type="button"
          onClick={() => void jumpToLatest()}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-accent-primary px-3 py-1.5 text-12 font-medium text-on-color shadow-raised-200"
        >
          <ArrowDown className="size-3.5" />
          {hasMoreAfter ? t("chat.thread.jump_to_latest") : t("chat.thread.new_messages")}
        </button>
      )}
    </div>
  );
});
