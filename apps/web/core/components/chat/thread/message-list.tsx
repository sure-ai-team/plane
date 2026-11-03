/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { ArrowDown } from "lucide-react";
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
import { dayKey, startsGroup } from "../common/helpers";
import { ChatMessageItem } from "./message-item";
import { ChatDayDivider, ChatPendingMessage, ChatSystemMessage } from "./small-items";

/** Virtuoso needs a stable, large starting index so older pages can be prepended. */
const START_INDEX = 1_000_000;
const SKELETON_WIDTHS = ["40%", "57%", "74%", "46%", "63%"];

type TRow = {
  key: string;
  item: TThreadItem;
  showDay: string | null;
  showHeader: boolean;
};

type Props = {
  workspaceSlug: string;
  workspaceId: string;
  conversation: TChatConversation;
  onReply: (message: TChatMessage) => void;
};

const itemTime = (item: TThreadItem) => (item.type === "message" ? item.message.created_at : item.pending.created_at);
const itemKey = (item: TThreadItem) =>
  item.type === "message" ? item.message.id : `pending-${item.pending.client_id}`;

export const ChatMessageList = observer(function ChatMessageList(props: Props) {
  const { workspaceSlug, workspaceId, conversation, onReply } = props;
  const { t } = useTranslation();
  const chat = useChat();
  const { data: currentUser } = useUser();
  const virtuoso = useRef<VirtuosoHandle>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [hasNewBelow, setHasNewBelow] = useState(false);
  const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX);
  const previousFirstKey = useRef<string | null>(null);
  const previousLastKey = useRef<string | null>(null);

  const thread = chat.message.thread(conversation.id);
  const items = chat.message.items(conversation.id);

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
      result.push({ key: itemKey(item), item, showDay, showHeader });
    }
    return result;
  }, [items]);

  // The newest message I sent: the only one that shows "Seen by".
  const lastOwnMessageId = useMemo(() => {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (row.item.type === "message" && row.item.message.sender?.id === currentUser?.id) return row.item.message.id;
    }
    return null;
  }, [rows, currentUser?.id]);

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

  // Mark read whenever the newest message is on screen and the tab is visible.
  const newestSeq = thread?.newestSeq ?? null;
  useEffect(() => {
    if (!isAtBottom || newestSeq === null) return;
    const markIfVisible = () => {
      if (document.visibilityState === "visible") void chat.markRead(conversation.id);
    };
    const timer = window.setTimeout(markIfVisible, 500);
    document.addEventListener("visibilitychange", markIfVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", markIfVisible);
    };
  }, [isAtBottom, newestSeq, chat, conversation.id]);

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

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center">
        <p className="text-14 font-medium text-primary">{t("chat.thread.empty_title")}</p>
        <p className="text-13 text-tertiary">{t("chat.thread.empty_body")}</p>
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <Virtuoso
        ref={virtuoso}
        className="vertical-scrollbar scrollbar-sm h-full"
        data={rows}
        firstItemIndex={firstItemIndex}
        initialTopMostItemIndex={rows.length - 1}
        computeItemKey={(_index, row) => row.key}
        followOutput={(atBottom) => (atBottom ? "smooth" : false)}
        atBottomStateChange={(atBottom) => {
          setIsAtBottom(atBottom);
          if (atBottom) setHasNewBelow(false);
        }}
        atBottomThreshold={48}
        startReached={() => void chat.message.loadOlder(workspaceSlug, conversation.id)}
        increaseViewportBy={{ top: 600, bottom: 300 }}
        components={{
          Header: () =>
            thread.isLoadingOlder ? (
              <p className="py-3 text-center text-12 text-tertiary">{t("chat.thread.loading_older")}</p>
            ) : (
              <div className="h-3" />
            ),
          Footer: () => <div className="h-2" />,
        }}
        itemContent={(_index, row) => (
          <div>
            {row.showDay && <ChatDayDivider iso={row.showDay} />}
            {row.item.type === "pending" ? (
              <ChatPendingMessage
                workspaceSlug={workspaceSlug}
                pending={row.item.pending}
                showHeader={row.showHeader}
              />
            ) : row.item.message.kind === "system" ? (
              <ChatSystemMessage message={row.item.message} conversation={conversation} />
            ) : (
              <ChatMessageItem
                workspaceSlug={workspaceSlug}
                workspaceId={workspaceId}
                conversation={conversation}
                message={row.item.message}
                showHeader={row.showHeader}
                showSeenBy={row.item.message.id === lastOwnMessageId}
                onReply={onReply}
              />
            )}
          </div>
        )}
      />
      {hasNewBelow && !isAtBottom && (
        <button
          type="button"
          onClick={() => {
            virtuoso.current?.scrollToIndex({ index: "LAST", behavior: "smooth" });
            setHasNewBelow(false);
          }}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-accent-primary px-3 py-1.5 text-12 font-medium text-on-color shadow-raised-200"
        >
          <ArrowDown className="size-3.5" />
          {t("chat.thread.new_messages")}
        </button>
      )}
    </div>
  );
});
