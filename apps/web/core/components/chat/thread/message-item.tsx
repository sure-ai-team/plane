/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef, useState } from "react";
import { observer } from "mobx-react";
import { CornerUpLeft, MoreHorizontal } from "lucide-react";
import type { EditorRefApi } from "@plane/editor";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { IconButton } from "@plane/propel/icon-button";
import { EditIcon, LinkIcon, TrashIcon } from "@plane/propel/icons";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TChatApiError, TChatConversation, TChatMessage } from "@plane/types";
import { AlertModalCore, CustomMenu } from "@plane/ui";
import { cn, copyUrlToClipboard, getFileURL, isCommentEmpty } from "@plane/utils";
// components
import { LiteTextEditor } from "@/components/editor/lite-text";
// hooks
import { useChat } from "@/hooks/store/use-chat";
import { useUser } from "@/hooks/store/user";
// local
import { ChatMessageAttachments } from "../attachments/message-attachments";
import { ChatVoiceNotePlayer } from "../voice/voice-note-player";
import { ChatUserAvatar } from "../common/avatars";
import { chatPath, timeLabel, userName } from "../common/helpers";

type Props = {
  workspaceSlug: string;
  workspaceId: string;
  conversation: TChatConversation;
  message: TChatMessage;
  showHeader: boolean;
  showSeenBy: boolean;
  onReply: (message: TChatMessage) => void;
};

export const ChatMessageItem = observer(function ChatMessageItem(props: Props) {
  const { workspaceSlug, workspaceId, conversation, message, showHeader, showSeenBy, onReply } = props;
  const { t } = useTranslation();
  const chat = useChat();
  const { data: currentUser } = useUser();
  const editorRef = useRef<EditorRefApi>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draftHtml, setDraftHtml] = useState(message.body_html);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const isOwn = !!currentUser && message.sender?.id === currentUser.id;
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
      key: "copy",
      title: t("chat.message.copy_link"),
      icon: LinkIcon,
      shouldRender: true,
      action: () =>
        void copyUrlToClipboard(chatPath(workspaceSlug, conversation.id).replace(/^\//, "")).then(() =>
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
      className={cn("group/message relative flex gap-2.5 rounded-md px-3 hover:bg-layer-transparent-hover", {
        "pt-2": showHeader,
        "bg-layer-transparent-hover": isEditing,
      })}
    >
      <div className="w-7 shrink-0">{showHeader && <ChatUserAvatar user={message.sender} size={28} showTooltip />}</div>
      <div className="min-w-0 flex-1 pb-1">
        {showHeader && (
          <div className="flex items-baseline gap-2">
            <span className="truncate text-13 font-medium text-primary">{userName(message.sender, tr)}</span>
            <span className="text-11 text-tertiary">{timeLabel(message.created_at)}</span>
          </div>
        )}

        {message.reply_to && (
          <div className="mt-1 flex max-w-xl items-center gap-1.5 rounded-sm border-l-2 border-strong bg-layer-1 px-2 py-1 text-12 text-secondary">
            <CornerUpLeft className="size-3 shrink-0" />
            <span className="truncate">
              <span className="font-medium text-primary">{userName(message.reply_to.sender, tr)}</span>
              {" · "}
              {message.reply_to.body_stripped ||
                (message.reply_to.kind === "voice" ? t("chat.thread.reply_voice") : t("chat.thread.reply_attachment"))}
            </span>
          </div>
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
              onEnterKeyPress={() => void save()}
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
              {message.edited_at && <span className="shrink-0 text-11 text-tertiary">({t("chat.thread.edited")})</span>}
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
            />
          )}
        />

        {showSeenBy && message.seen_by_count > 0 && (
          <div className="mt-0.5 text-11 text-tertiary">
            {t("chat.thread.seen_by", { count: message.seen_by_count })}
          </div>
        )}
      </div>

      {!isEditing && (
        <div className="absolute -top-3 right-3 hidden items-center gap-0.5 rounded-md border border-subtle bg-surface-1 p-0.5 shadow-raised-100 group-focus-within/message:flex group-hover/message:flex">
          <IconButton
            icon={CornerUpLeft}
            variant="ghost"
            size="base"
            aria-label={t("chat.message.reply")}
            onClick={() => onReply(message)}
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
