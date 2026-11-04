/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useSearchParams } from "next/navigation";
import { PanelRight, Pin, Star, Upload } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { useTranslation } from "@plane/i18n";
import { IconButton } from "@plane/propel/icon-button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TChatMessage } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { useChat } from "@/hooks/store/use-chat";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useAppRouter } from "@/hooks/use-app-router";
// local
import { ConversationAvatar } from "../common/avatars";
import { chatPath } from "../common/helpers";
import { ChatComposer } from "../composer/root";
import { ChatDetailsPanel } from "../details/root";
import { useChatFileIntake } from "../hooks/use-file-intake";
import { ChatMessageList } from "./message-list";
import { ChatPinnedBar, ChatPinnedPanel } from "./pinned";
import { ChatTypingIndicator } from "./small-items";

type Props = {
  workspaceSlug: string;
  conversationId: string;
};

export const ChatThread = observer(function ChatThread(props: Props) {
  const { workspaceSlug, conversationId } = props;
  const { t } = useTranslation();
  const chat = useChat();
  const { getWorkspaceBySlug } = useWorkspace();
  const [replyTo, setReplyTo] = useState<TChatMessage | null>(null);
  const [sidePanel, setSidePanel] = useState<"details" | "pins" | null>(null);
  const [isMissing, setIsMissing] = useState(false);
  const searchParams = useSearchParams();
  const router = useAppRouter();
  const linkedMessageId = searchParams.get("m");
  const handledLink = useRef<string | null>(null);

  const workspaceId = getWorkspaceBySlug(workspaceSlug)?.id ?? "";
  const addFiles = useChatFileIntake(conversationId);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: addFiles,
    noClick: true,
    noKeyboard: true,
  });
  const conversation = chat.conversation.getById(conversationId);
  const isReady = chat.isInitialized && chat.workspaceSlug === workspaceSlug;

  useEffect(() => {
    setReplyTo(null);
    setIsMissing(false);
    if (!isReady) return;
    let cancelled = false;
    const open = async () => {
      await chat.openConversation(conversationId);
      if (!cancelled && !chat.conversation.getById(conversationId)) setIsMissing(true);
    };
    void open();
    return () => {
      cancelled = true;
      chat.setActiveConversation(null);
    };
  }, [chat, conversationId, isReady]);

  // A message link (?m=<id>): once the thread is open, scroll to that message.
  const isThreadLoaded = !!chat.message.thread(conversationId)?.isLoaded;
  useEffect(() => {
    if (!linkedMessageId || !isThreadLoaded || handledLink.current === linkedMessageId) return;
    handledLink.current = linkedMessageId;
    void chat.message
      .jumpToMessage(workspaceSlug, conversationId, { messageId: linkedMessageId })
      .catch(() => setToast({ type: TOAST_TYPE.ERROR, title: t("chat.message.no_access") }))
      .finally(() => router.replace(chatPath(workspaceSlug, conversationId)));
  }, [linkedMessageId, isThreadLoaded, chat, workspaceSlug, conversationId, router, t]);

  if (isMissing) {
    return (
      <div className="flex h-full flex-1 items-center justify-center p-6 text-center text-13 text-secondary">
        {t("chat.errors.not_found")}
      </div>
    );
  }

  if (!conversation) return <div className="flex-1" />;

  const name = chat.conversation.displayName(conversation);
  const subtitle =
    conversation.type === "direct"
      ? chat.realtime.isOnline(conversation.direct_user?.id)
        ? t("chat.status.online")
        : t("chat.status.offline")
      : t("chat.members.count", { count: conversation.member_count });
  const status = chat.realtime.status;

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div {...getRootProps({ className: "relative flex h-full min-w-0 flex-1 flex-col" })}>
        <input {...getInputProps()} />
        {isDragActive && (
          <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-accent-strong bg-accent-subtle/95 text-center">
            <Upload className="size-7 text-accent-primary" />
            <p className="text-16 font-medium text-primary">{t("chat.upload.drop_title", { name })}</p>
            {chat.config && (
              <p className="text-12 text-secondary">
                {t("chat.upload.drop_hint", {
                  image: chat.config.max_image_mb,
                  video: chat.config.max_video_mb,
                  audio: chat.config.max_audio_mb,
                  file: chat.config.max_file_mb,
                })}
              </p>
            )}
          </div>
        )}
        <header className="flex h-header shrink-0 items-center gap-2.5 border-b border-subtle px-4">
          <ConversationAvatar conversation={conversation} size={24} showPresence />
          <div className="flex min-w-0 flex-1 flex-col">
            <h1 className="truncate text-14 font-medium text-primary">{name}</h1>
            <span className="truncate text-11 text-tertiary">{subtitle}</span>
          </div>
          <button
            type="button"
            aria-pressed={!!conversation.is_starred}
            aria-label={conversation.is_starred ? t("chat.sidebar.unstar") : t("chat.sidebar.star")}
            onClick={() =>
              void chat.conversation
                .updateMySettings(workspaceSlug, conversation.id, { is_starred: !conversation.is_starred })
                .catch(() => setToast({ type: TOAST_TYPE.ERROR, title: t("chat.errors.generic") }))
            }
            className="flex size-7 items-center justify-center rounded-md text-tertiary hover:bg-layer-transparent-hover"
          >
            <Star className={conversation.is_starred ? "size-4 fill-current text-warning-primary" : "size-4"} />
          </button>
          <IconButton
            icon={Pin}
            variant={sidePanel === "pins" ? "tertiary" : "ghost"}
            size="lg"
            aria-label={t("chat.pins.title")}
            aria-pressed={sidePanel === "pins"}
            onClick={() => setSidePanel((value) => (value === "pins" ? null : "pins"))}
          />
          <IconButton
            icon={PanelRight}
            variant={sidePanel === "details" ? "tertiary" : "ghost"}
            size="lg"
            aria-label={sidePanel === "details" ? t("chat.actions.hide_details") : t("chat.actions.details")}
            aria-pressed={sidePanel === "details"}
            onClick={() => setSidePanel((value) => (value === "details" ? null : "details"))}
          />
        </header>

        <ChatPinnedBar
          workspaceSlug={workspaceSlug}
          conversation={conversation}
          onOpenPanel={() => setSidePanel("pins")}
        />

        {(status === "reconnecting" || status === "blocked") && (
          <div
            role="status"
            className={cn(
              "border-b px-4 py-1.5 text-12",
              status === "blocked"
                ? "border-danger-subtle bg-danger-subtle text-danger-primary"
                : "border-warning-subtle bg-warning-subtle text-warning-primary"
            )}
          >
            {status === "reconnecting"
              ? t("chat.status.reconnecting")
              : chat.realtime.closeCode === 4404
                ? t("chat.status.blocked_disabled")
                : t("chat.status.blocked_access")}
          </div>
        )}

        <ChatMessageList
          workspaceSlug={workspaceSlug}
          workspaceId={workspaceId}
          conversation={conversation}
          onReply={setReplyTo}
        />
        <ChatTypingIndicator conversation={conversation} />
        <ChatComposer
          key={conversation.id}
          workspaceSlug={workspaceSlug}
          workspaceId={workspaceId}
          conversation={conversation}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSent={() => undefined}
        />
      </div>

      {sidePanel && (
        <div className="hidden h-full w-72 shrink-0 border-l border-subtle lg:block">
          {sidePanel === "details" ? (
            <ChatDetailsPanel workspaceSlug={workspaceSlug} conversation={conversation} />
          ) : (
            <ChatPinnedPanel
              workspaceSlug={workspaceSlug}
              conversation={conversation}
              onClose={() => setSidePanel(null)}
            />
          )}
        </div>
      )}
    </div>
  );
});
