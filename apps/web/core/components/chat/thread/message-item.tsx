/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { Copy, CornerUpLeft, Forward, MoreHorizontal, Pin, PinOff, SmilePlus } from "lucide-react";
import type { EditorRefApi } from "@plane/editor";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { IconButton } from "@plane/propel/icon-button";
import { EditIcon, LinkIcon, TrashIcon, WorkItemsIcon } from "@plane/propel/icons";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TChatApiError, TChatConversation, TChatMessage } from "@plane/types";
import { AlertModalCore, CustomMenu } from "@plane/ui";
import { cn, copyUrlToClipboard, getFileURL, isCommentEmpty } from "@plane/utils";
// components
import { LiteTextEditor } from "@/components/editor/lite-text";
import { CreateUpdateIssueModal } from "@/components/issues/issue-modal/modal";
// hooks
import { useChat } from "@/hooks/store/use-chat";
import { useUser } from "@/hooks/store/user";
// local
import { ChatMessageAttachments } from "../attachments/message-attachments";
import { ChatEmojiPicker } from "../common/emoji-picker";
import { ChatForwardModal } from "../modals/forward";
import { ChatReactions, QUICK_REACTIONS } from "./reactions";
import { ChatWorkItemCards } from "./work-item-cards";
import { ChatVoiceNotePlayer } from "../voice/voice-note-player";
import { ChatUserAvatar } from "../common/avatars";
import { useLatestCallback } from "../hooks/use-latest";
import { chatPath, timeLabel, userName } from "../common/helpers";

type Props = {
  workspaceSlug: string;
  workspaceId: string;
  conversation: TChatConversation;
  message: TChatMessage;
  showHeader: boolean;
  showSeenBy: boolean;
  /** Briefly highlighted after a jump (reply, pin, search, link). */
  isHighlighted?: boolean;
  /** Changes when a shortcut asks this message to enter edit mode (↑ in the composer). */
  editNonce?: number;
  /** "bubbles": mine on the right (P2-D11). Defaults to the compact layout. */
  layout?: "compact" | "bubbles";
  onReply: (message: TChatMessage) => void;
};

/** How long a touch must be held to open the message action sheet. */
const LONG_PRESS_MS = 450;

/** Link to one message: opening it scrolls there (docs/chat/phase-2/DECISIONS.md P2-D7). */
export const messageLink = (workspaceSlug: string, conversationId: string, messageId: string) =>
  `${chatPath(workspaceSlug, conversationId).replace(/^\//, "")}?m=${messageId}`;

export const ChatMessageItem = observer(function ChatMessageItem(props: Props) {
  const {
    workspaceSlug,
    workspaceId,
    conversation,
    message,
    showHeader,
    showSeenBy,
    isHighlighted,
    editNonce = 0,
    layout = "compact",
    onReply,
  } = props;
  const { t } = useTranslation();
  const chat = useChat();
  const { data: currentUser } = useUser();
  const editorRef = useRef<EditorRefApi>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draftHtml, setDraftHtml] = useState(message.body_html);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCreateWorkItemOpen, setIsCreateWorkItemOpen] = useState(false);
  const [isForwardOpen, setIsForwardOpen] = useState(false);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  // The hover toolbar anchors the emoji picker: keep it shown while the picker is open.
  const [isToolbarPinned, setIsToolbarPinned] = useState(false);
  const pressTimer = useRef<number | null>(null);
  // Touch: long-press opens the action sheet (phones have no hover toolbar).
  const startPress = () => {
    if (isEditing) return;
    pressTimer.current = window.setTimeout(() => setIsSheetOpen(true), LONG_PRESS_MS);
  };
  const cancelPress = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  const isOwn = !!currentUser && message.sender?.id === currentUser.id;
  const isBubble = layout === "bubbles";
  const mine = isBubble && isOwn;
  // In the compact layout the bubble wrapper is `display: contents`, so nothing changes.
  // While editing, the bubble turns neutral and wide so the editor, its buttons and the
  // attachments stay grouped (and the on-colour text rule doesn't hit the editor).
  const bubbleClass = !isBubble
    ? "contents"
    : cn(
        "mt-0.5 flex flex-col gap-1 rounded-2xl px-3 py-2",
        isEditing
          ? "w-[78%] rounded-br-md bg-layer-1"
          : cn(
              "w-fit max-w-[78%]",
              mine
                ? "rounded-br-md bg-accent-primary text-on-color [&_.ProseMirror]:!text-on-color [&_.text-tertiary]:!text-on-color [&_a]:!text-on-color [&_a]:underline"
                : "rounded-bl-md bg-layer-1"
            )
      );

  useEffect(() => {
    if (editNonce > 0) {
      setDraftHtml(message.body_html);
      setIsEditing(true);
    }
    // Only when a new edit request arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editNonce]);
  const isGroupAdmin = conversation.type === "group" && conversation.my_role === 20;
  const canDelete = isOwn || isGroupAdmin;
  const hasBody = !isCommentEmpty(message.body_html);
  const tr = t as (key: string, params?: Record<string, unknown>) => string;

  const save = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await chat.message.edit(workspaceSlug, message, draftHtml);
      setIsEditing(false);
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("chat.errors.generic"), message: (error as TChatApiError)?.error });
    } finally {
      setIsSaving(false);
    }
  };

  // The editor keeps the Enter handler from its first render, which would save the original text.
  const onEnterSave = useLatestCallback(() => void save());

  const showError = (error: unknown) =>
    setToast({ type: TOAST_TYPE.ERROR, title: t("chat.errors.generic"), message: (error as TChatApiError)?.error });

  const react = (emoji: string) => void chat.message.toggleReaction(workspaceSlug, message, emoji).catch(showError);

  const togglePin = () =>
    void (
      message.is_pinned ? chat.message.unpin(workspaceSlug, message) : chat.message.pin(workspaceSlug, message)
    ).catch(showError);

  const jumpToReply = () => {
    if (!message.reply_to) return;
    void chat.message
      .jumpToMessage(workspaceSlug, conversation.id, { seq: message.reply_to.seq })
      .catch(() => setToast({ type: TOAST_TYPE.ERROR, title: t("chat.message.no_access") }));
  };

  const remove = async () => {
    setIsDeleting(true);
    try {
      await chat.message.remove(workspaceSlug, message);
      setIsDeleteOpen(false);
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("chat.errors.generic"), message: (error as TChatApiError)?.error });
    } finally {
      setIsDeleting(false);
    }
  };

  const menuItems = [
    {
      key: "edit",
      title: t("chat.message.edit"),
      icon: EditIcon,
      shouldRender: isOwn,
      action: () => {
        setDraftHtml(message.body_html);
        setIsEditing(true);
      },
    },
    {
      key: "work-item",
      title: t("chat.message.create_work_item"),
      icon: WorkItemsIcon,
      shouldRender: message.kind !== "system" && hasBody,
      action: () => setIsCreateWorkItemOpen(true),
    },
    {
      key: "copy",
      title: t("chat.message.copy_link"),
      icon: LinkIcon,
      shouldRender: true,
      action: () =>
        void copyUrlToClipboard(messageLink(workspaceSlug, conversation.id, message.id)).then(() =>
          setToast({ type: TOAST_TYPE.SUCCESS, title: t("chat.message.link_copied") })
        ),
    },
    {
      key: "delete",
      title: t("chat.message.delete"),
      icon: TrashIcon,
      shouldRender: canDelete,
      action: () => setIsDeleteOpen(true),
      className: "text-danger-primary",
    },
  ].filter((item) => item.shouldRender);

  return (
    <div
      className={cn(
        "group/message relative flex gap-2.5 rounded-md px-3 transition-colors duration-700 hover:bg-layer-transparent-hover motion-reduce:transition-none",
        {
          "flex-row-reverse": mine,
          "pt-2": showHeader,
          "bg-layer-transparent-hover": isEditing,
          "bg-warning-subtle hover:bg-warning-subtle": isHighlighted,
        }
      )}
      onTouchStart={startPress}
      onTouchEnd={cancelPress}
      onTouchMove={cancelPress}
      onTouchCancel={cancelPress}
    >
      <div className={cn("w-7 shrink-0", { hidden: mine })}>
        {showHeader && <ChatUserAvatar user={message.sender} size={28} showTooltip />}
      </div>
      <div className={cn("min-w-0 flex-1 pb-1", { "flex flex-col": isBubble, "items-end": mine })}>
        {showHeader && (
          <div className="flex items-baseline gap-2">
            {!mine && <span className="truncate text-13 font-medium text-primary">{userName(message.sender, tr)}</span>}
            <span className="text-11 text-tertiary">{timeLabel(message.created_at)}</span>
            {message.is_pinned && (
              <span className="flex items-center gap-0.5 text-11 text-tertiary">
                <Pin className="size-3" aria-hidden />
                {t("chat.pins.pinned")}
              </span>
            )}
            {isHighlighted && (
              <span className="text-11 font-medium text-warning-primary">{t("chat.jump.highlight")}</span>
            )}
          </div>
        )}

        <div className={bubbleClass}>
          {message.forwarded_from && (
            <div className="mt-0.5 flex items-center gap-1 text-11 text-tertiary">
              <Forward className="size-3 shrink-0" aria-hidden />
              <span className="truncate">
                {message.forwarded_from.conversation_name
                  ? t("chat.forward.from_conversation", {
                      name: message.forwarded_from.sender_name ?? t("chat.system.someone"),
                      conversation: message.forwarded_from.conversation_name,
                    })
                  : t("chat.forward.from", { name: message.forwarded_from.sender_name ?? t("chat.system.someone") })}
              </span>
            </div>
          )}

          {message.reply_to && (
            <button
              type="button"
              onClick={jumpToReply}
              aria-label={t("chat.jump.to_message")}
              className="mt-1 flex max-w-xl items-center gap-1.5 rounded-sm border-l-2 border-strong bg-layer-1 px-2 py-1 text-left text-12 text-secondary hover:bg-layer-1-hover"
            >
              <CornerUpLeft className="size-3 shrink-0" />
              <span className="truncate">
                <span className="font-medium text-primary">{userName(message.reply_to.sender, tr)}</span>
                {" · "}
                {message.reply_to.body_stripped ||
                  (message.reply_to.kind === "voice"
                    ? t("chat.thread.reply_voice")
                    : t("chat.thread.reply_attachment"))}
              </span>
            </button>
          )}

          {isEditing ? (
            <div
              role="group"
              className="mt-1 flex flex-col gap-2"
              onKeyDown={(event) => {
                if (event.key === "Escape") setIsEditing(false);
              }}
            >
              <LiteTextEditor
                editable
                ref={editorRef}
                id={`chat-edit-${message.id}`}
                workspaceSlug={workspaceSlug}
                workspaceId={workspaceId}
                initialValue={message.body_html}
                value={null}
                onChange={(_json, html) => setDraftHtml(html)}
                onEnterKeyPress={onEnterSave}
                variant="none"
                disabledExtensions={["image"]}
                uploadFile={async () => ""}
                duplicateFile={async () => ""}
                parentClassName="rounded-md border-strong bg-surface-1 p-2"
                displayConfig={{ fontSize: "small-font" }}
              />
              <div className="flex gap-2">
                <Button variant="primary" size="sm" onClick={() => void save()} loading={isSaving}>
                  {t("chat.message.save")}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setIsEditing(false)}>
                  {t("chat.message.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            hasBody && (
              <div className="flex items-end gap-1">
                <div className="min-w-0 flex-1">
                  <LiteTextEditor
                    editable={false}
                    id={`chat-message-${message.id}`}
                    initialValue={message.body_html}
                    workspaceSlug={workspaceSlug}
                    workspaceId={workspaceId}
                    containerClassName="!p-0 [&_.ProseMirror]:!min-h-0"
                    parentClassName="border-none"
                    displayConfig={{ fontSize: "small-font" }}
                  />
                </div>
                {message.edited_at && (
                  <span className="shrink-0 text-11 text-tertiary">({t("chat.thread.edited")})</span>
                )}
              </div>
            )
          )}

          <ChatMessageAttachments
            attachments={message.attachments}
            renderAudio={(attachment) => (
              <ChatVoiceNotePlayer
                src={getFileURL(attachment.url) ?? attachment.url}
                waveform={attachment.waveform}
                duration={attachment.duration}
                tone={mine ? "inverse" : "default"}
              />
            )}
          />
          <ChatWorkItemCards
            workspaceSlug={workspaceSlug}
            workItems={message.work_items}
            tone={mine ? "inverse" : "default"}
          />
        </div>

        <ChatReactions
          workspaceSlug={workspaceSlug}
          conversation={conversation}
          message={message}
          currentUserId={currentUser?.id}
        />

        {showSeenBy && message.seen_by_count > 0 && (
          <div className="mt-0.5 text-11 text-tertiary">
            {t("chat.thread.seen_by", { count: message.seen_by_count })}
          </div>
        )}
      </div>

      {!isEditing && (
        <div
          className={cn(
            "absolute -top-3 right-3 hidden items-center gap-0.5 rounded-md border border-subtle bg-surface-1 p-0.5 shadow-raised-100 group-focus-within/message:flex group-hover/message:flex",
            { flex: isToolbarPinned }
          )}
        >
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={t("chat.reactions.react_with", { emoji })}
              onClick={() => react(emoji)}
              className="text-15 flex size-7 items-center justify-center rounded-sm hover:bg-layer-transparent-hover"
            >
              {emoji}
            </button>
          ))}
          <ChatEmojiPicker
            ariaLabel={t("chat.reactions.add")}
            onSelect={react}
            onOpenChange={setIsToolbarPinned}
            buttonClassName="flex size-7 items-center justify-center rounded-sm text-secondary hover:bg-layer-transparent-hover"
          >
            <SmilePlus className="size-4" />
          </ChatEmojiPicker>
          <span className="mx-0.5 h-4 w-px bg-layer-3" aria-hidden />
          <IconButton
            icon={CornerUpLeft}
            variant="ghost"
            size="base"
            aria-label={t("chat.message.reply")}
            onClick={() => onReply(message)}
          />
          <IconButton
            icon={message.is_pinned ? PinOff : Pin}
            variant="ghost"
            size="base"
            aria-label={message.is_pinned ? t("chat.pins.unpin") : t("chat.pins.pin")}
            onClick={togglePin}
          />
          <IconButton
            icon={Forward}
            variant="ghost"
            size="base"
            aria-label={t("chat.forward.action")}
            onClick={() => setIsForwardOpen(true)}
          />
          {menuItems.length > 0 && (
            <CustomMenu
              customButton={
                <IconButton icon={MoreHorizontal} variant="ghost" size="base" aria-label={t("chat.message.more")} />
              }
              closeOnSelect
              placement="bottom-end"
            >
              {menuItems.map((item) => (
                <CustomMenu.MenuItem
                  key={item.key}
                  onClick={item.action}
                  className={cn("flex items-center gap-2", item.className)}
                >
                  <item.icon className="size-3 shrink-0" />
                  <span>{item.title}</span>
                </CustomMenu.MenuItem>
              ))}
            </CustomMenu>
          )}
        </div>
      )}

      {isCreateWorkItemOpen && (
        <CreateUpdateIssueModal
          isOpen
          onClose={() => setIsCreateWorkItemOpen(false)}
          data={{
            name: (message.body_stripped || "").slice(0, 255),
            description_html: message.body_html,
            ...(conversation.project ? { project_id: conversation.project.id } : {}),
          }}
        />
      )}

      {isSheetOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-backdrop"
          role="presentation"
          onClick={() => setIsSheetOpen(false)}
        >
          <div
            role="dialog"
            aria-label={t("chat.mobile.message_actions")}
            className="rounded-t-2xl bg-surface-1 pt-2 pb-6 shadow-raised-300"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") setIsSheetOpen(false);
            }}
          >
            <span className="mx-auto mb-3 block h-1 w-9 rounded-full bg-layer-3" aria-hidden />
            <div className="flex justify-between border-b border-subtle px-5 pb-3">
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={t("chat.reactions.react_with", { emoji })}
                  onClick={() => {
                    react(emoji);
                    setIsSheetOpen(false);
                  }}
                  className="flex size-11 items-center justify-center rounded-full bg-layer-1 text-18"
                >
                  {emoji}
                </button>
              ))}
              <ChatEmojiPicker
                ariaLabel={t("chat.reactions.add")}
                onSelect={(emoji) => {
                  react(emoji);
                  setIsSheetOpen(false);
                }}
                buttonClassName="flex size-11 items-center justify-center rounded-full bg-layer-1 text-secondary"
              >
                <SmilePlus className="size-5" />
              </ChatEmojiPicker>
            </div>
            {[
              { key: "reply", title: t("chat.message.reply"), icon: CornerUpLeft, action: () => onReply(message) },
              {
                key: "pin",
                title: message.is_pinned ? t("chat.pins.unpin") : t("chat.pins.pin"),
                icon: message.is_pinned ? PinOff : Pin,
                action: togglePin,
              },
              { key: "forward", title: t("chat.forward.action"), icon: Forward, action: () => setIsForwardOpen(true) },
              {
                key: "copy-text",
                title: t("chat.mobile.copy_text"),
                icon: Copy,
                action: () => void navigator.clipboard?.writeText(message.body_stripped ?? ""),
              },
              ...menuItems,
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setIsSheetOpen(false);
                  item.action();
                }}
                className={cn(
                  "flex h-12 w-full items-center gap-3.5 px-5 text-left text-14 text-primary active:bg-layer-transparent-active",
                  "className" in item ? item.className : undefined
                )}
              >
                <item.icon className="size-4 shrink-0" />
                {item.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {isForwardOpen && (
        <ChatForwardModal
          workspaceSlug={workspaceSlug}
          message={message}
          isOpen
          onClose={() => setIsForwardOpen(false)}
        />
      )}

      <AlertModalCore
        isOpen={isDeleteOpen}
        handleClose={() => setIsDeleteOpen(false)}
        handleSubmit={() => void remove()}
        isSubmitting={isDeleting}
        title={t("chat.message.delete_confirm_title")}
        content={t("chat.message.delete_confirm_body")}
        primaryButtonText={{ loading: t("chat.message.delete"), default: t("chat.message.delete") }}
        secondaryButtonText={t("chat.message.cancel")}
      />
    </div>
  );
});
