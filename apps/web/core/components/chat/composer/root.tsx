/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef, useState } from "react";
import { observer } from "mobx-react";
import { CornerUpLeft, Paperclip, SendHorizontal, X } from "lucide-react";
import type { EditorRefApi } from "@plane/editor";
import { useTranslation } from "@plane/i18n";
import { IconButton } from "@plane/propel/icon-button";
import type { TChatConversation, TChatMessage } from "@plane/types";
import { cn, isCommentEmpty } from "@plane/utils";
// components
import { LiteTextEditor } from "@/components/editor/lite-text";
// hooks
import { useChat } from "@/hooks/store/use-chat";
// local
import { ChatUploadTray } from "../attachments/upload-tray";
import { userName } from "../common/helpers";
import { useChatFileIntake } from "../hooks/use-file-intake";

type Props = {
  workspaceSlug: string;
  workspaceId: string;
  conversation: TChatConversation;
  replyTo: TChatMessage | null;
  onCancelReply: () => void;
  onSent: () => void;
};

const EMPTY_HTML = "<p></p>";

const plainText = (html: string): string => {
  if (typeof DOMParser === "undefined") return html.replace(/<[^>]+>/g, " ").trim();
  const text = new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
  return text.replace(/\s+/g, " ").trim();
};

export const ChatComposer = observer(function ChatComposer(props: Props) {
  const { workspaceSlug, workspaceId, conversation, replyTo, onCancelReply, onSent } = props;
  const { t } = useTranslation();
  const chat = useChat();
  const editorRef = useRef<EditorRefApi>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [html, setHtml] = useState(EMPTY_HTML);
  const addFiles = useChatFileIntake(conversation.id);

  const name = chat.conversation.displayName(conversation);
  const hasText = !isCommentEmpty(html);
  const hasReadyFiles = chat.upload.canSend(conversation.id);
  const isUploading = chat.upload.isBusy(conversation.id);
  const hasFailedFiles = chat.upload.hasFailures(conversation.id);
  // Attachments must all be ready (failed ones removed or retried) before sending.
  const canSend = (hasText || hasReadyFiles) && !isUploading && !hasFailedFiles;
  const sendHint = isUploading
    ? t("chat.composer.waiting_uploads")
    : hasFailedFiles
      ? t("chat.composer.remove_failed")
      : undefined;

  const send = () => {
    if (!canSend) return;
    const bodyHtml = html;
    // Clear immediately: the message shows as "sending" in the thread straight away.
    editorRef.current?.clearEditor();
    setHtml(EMPTY_HTML);
    onCancelReply();
    onSent();
    void chat.send(conversation.id, {
      body_html: bodyHtml,
      body_stripped: plainText(bodyHtml),
      reply_to: replyTo
        ? {
            id: replyTo.id,
            seq: replyTo.seq,
            sender: replyTo.sender,
            kind: replyTo.kind,
            body_stripped: replyTo.body_stripped,
          }
        : null,
    });
  };

  return (
    <div className="flex flex-col gap-1 px-4 pb-1">
      <div className="rounded-lg border border-strong bg-surface-1 focus-within:border-accent-strong">
        {replyTo && (
          <div className="flex items-center gap-2 border-b border-subtle px-3 py-1.5 text-12 text-secondary">
            <CornerUpLeft className="size-3 shrink-0" />
            <span className="flex-1 truncate">
              {t("chat.thread.replying_to", {
                name: userName(replyTo.sender, t as (key: string, params?: Record<string, unknown>) => string),
              })}
              {replyTo.body_stripped && <span className="text-tertiary"> · {replyTo.body_stripped}</span>}
            </span>
            <IconButton
              icon={X}
              variant="ghost"
              size="sm"
              aria-label={t("chat.composer.reply_cancel")}
              onClick={onCancelReply}
            />
          </div>
        )}
        <ChatUploadTray conversationId={conversation.id} />
        <div
          role="group"
          onPaste={(event) => {
            const files = Array.from(event.clipboardData?.files ?? []);
            if (files.length === 0) return;
            event.preventDefault();
            addFiles(files);
          }}
          className="max-h-60 overflow-y-auto px-1"
          onKeyDown={(event) => {
            if (event.key === "Escape" && replyTo) onCancelReply();
          }}
        >
          <LiteTextEditor
            editable
            key={conversation.id}
            ref={editorRef}
            id={`chat-composer-${conversation.id}`}
            workspaceSlug={workspaceSlug}
            workspaceId={workspaceId}
            projectId={conversation.project?.id}
            initialValue={EMPTY_HTML}
            value={null}
            placeholder={t("chat.composer.placeholder", { name })}
            onChange={(_json, nextHtml) => {
              setHtml(nextHtml);
              if (!isCommentEmpty(nextHtml)) chat.sendTyping(conversation.id);
            }}
            onEnterKeyPress={() => send()}
            variant="none"
            disabledExtensions={["image"]}
            uploadFile={async () => ""}
            duplicateFile={async () => ""}
            parentClassName="border-none"
            containerClassName="px-2 py-2"
            displayConfig={{ fontSize: "small-font" }}
          />
        </div>
        <div className="flex items-center gap-1 px-2 pb-2">
          <IconButton
            icon={Paperclip}
            variant="ghost"
            size="lg"
            aria-label={t("chat.composer.attach")}
            onClick={() => fileInputRef.current?.click()}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          {/* The voice-note recorder joins here in PR 7. */}
          <span className="flex-1" />
          {sendHint && <span className="text-11 text-tertiary">{sendHint}</span>}
          <button
            type="button"
            onClick={send}
            disabled={!canSend}
            title={sendHint}
            aria-label={t("chat.composer.send")}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-12 font-medium transition-colors",
              canSend ? "bg-accent-primary text-on-color hover:bg-accent-primary-hover" : "bg-layer-1 text-placeholder"
            )}
          >
            {t("chat.composer.send")}
            <SendHorizontal className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
});
