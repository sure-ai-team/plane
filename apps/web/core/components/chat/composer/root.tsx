/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { Baseline, CornerUpLeft, Mic, Paperclip, SendHorizontal, SmilePlus, X } from "lucide-react";
import type { EditorRefApi } from "@plane/editor";
import { useTranslation } from "@plane/i18n";
import { IconButton } from "@plane/propel/icon-button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { ISearchIssueResponse, TChatConversation, TChatMessage, TIssue } from "@plane/types";
import { cn, isCommentEmpty } from "@plane/utils";
// components
import { ExistingIssuesListModal } from "@/components/core/modals/existing-issues-list-modal";
import { LiteTextEditor } from "@/components/editor/lite-text";
import { CreateUpdateIssueModal } from "@/components/issues/issue-modal/modal";
// hooks
import { useChat } from "@/hooks/store/use-chat";
import { useProject } from "@/hooks/store/use-project";
import { ProjectService } from "@/services/project";
// local
import { ChatUploadTray } from "../attachments/upload-tray";
import { ChatEmojiPicker } from "../common/emoji-picker";
import { userName } from "../common/helpers";
import { useChatFileIntake } from "../hooks/use-file-intake";
import { ChatVoiceRecorder } from "../voice/voice-recorder";
import { ChatFormatToolbar } from "./format-toolbar";
import {
  SHRUG,
  emojiSuggestions,
  replaceTrailingToken,
  shortcodeQuery,
  slashQuery,
  slashSuggestions,
  workItemLinkHtml,
} from "./helpers";
import type { TSlashCommand } from "./helpers";

type Props = {
  workspaceSlug: string;
  workspaceId: string;
  conversation: TChatConversation;
  replyTo: TChatMessage | null;
  onCancelReply: () => void;
  onSent: () => void;
};

const EMPTY_HTML = "<p></p>";
const TOOLBAR_KEY = "chat:composer-toolbar";
const projectService = new ProjectService();

const readToolbarPreference = () => {
  try {
    return window.localStorage.getItem(TOOLBAR_KEY) === "1";
  } catch {
    return false;
  }
};

type TSuggestion =
  | { type: "emoji"; key: string; label: string; emoji: string }
  | { type: "command"; key: string; command: TSlashCommand };

const plainText = (html: string): string => {
  if (typeof DOMParser === "undefined") return html.replace(/<[^>]+>/g, " ").trim();
  const text = new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
  return text.replace(/\s+/g, " ").trim();
};

export const ChatComposer = observer(function ChatComposer(props: Props) {
  const { workspaceSlug, workspaceId, conversation, replyTo, onCancelReply, onSent } = props;
  const { t } = useTranslation();
  const chat = useChat();
  const editorRef = useRef<EditorRefApi | null>(null);
  const [editorApi, setEditorApi] = useState<EditorRefApi | null>(null);
  const setEditor = useCallback((api: EditorRefApi | null) => {
    editorRef.current = api;
    setEditorApi(api);
  }, []);
  const [showToolbar, setShowToolbar] = useState(readToolbarPreference);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [modal, setModal] = useState<"workitem" | "link" | null>(null);
  const { joinedProjectIds, getPartialProjectById } = useProject();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The composer is keyed by conversation, so this restores the draft on switch.
  const [initialHtml] = useState(() => chat.getDraft(conversation.id) ?? EMPTY_HTML);
  const [html, setHtml] = useState(initialHtml);
  const [isRecording, setIsRecording] = useState(false);
  const addFiles = useChatFileIntake(conversation.id);

  const name = chat.conversation.displayName(conversation);
  const hasText = !isCommentEmpty(html);

  // Inline suggestions: ":thu" -> emoji, "/wo" (as the whole message) -> commands.
  const text = plainText(html);
  const emojiQuery = shortcodeQuery(text);
  const commandQuery = emojiQuery === null ? slashQuery(text) : null;
  const tokenKey = emojiQuery !== null ? `:${emojiQuery}` : commandQuery !== null ? `/${commandQuery}` : null;
  const canLink = !!(conversation.project?.id ?? joinedProjectIds?.[0]);
  const suggestions: TSuggestion[] =
    tokenKey === null || tokenKey === dismissedFor
      ? []
      : emojiQuery !== null
        ? emojiSuggestions(emojiQuery).map((item) => ({
            type: "emoji" as const,
            key: item.name,
            label: `:${item.name}:`,
            emoji: item.emoji,
          }))
        : slashSuggestions(commandQuery ?? "")
            .filter((command) => command !== "link" || canLink)
            .map((command) => ({ type: "command" as const, key: command, command }));
  const isSuggesting = suggestions.length > 0;

  useEffect(() => {
    setSelectedSuggestion(0);
  }, [tokenKey]);

  const toggleToolbar = () =>
    setShowToolbar((value) => {
      try {
        window.localStorage.setItem(TOOLBAR_KEY, value ? "0" : "1");
      } catch {
        // Only a convenience.
      }
      return !value;
    });

  const insert = (content: string) => {
    editorRef.current?.insertText(content);
    editorRef.current?.focus("end");
  };

  const replaceToken = (token: string, replacement: string) => {
    const next = replaceTrailingToken(html, token, replacement);
    if (next === null) return false;
    editorRef.current?.setEditorValue(next, true);
    editorRef.current?.focus("end");
    return true;
  };

  const runCommand = (command: TSlashCommand) => {
    replaceToken(`/${commandQuery ?? ""}`, "");
    if (command === "shrug") insert(SHRUG);
    else if (command === "code") {
      editorRef.current?.executeMenuItemCommand({ itemKey: "code" } as Parameters<
        EditorRefApi["executeMenuItemCommand"]
      >[0]);
    } else if (command === "mute") {
      const muted = conversation.notify_level === "off" || conversation.is_muted;
      void chat.conversation
        .setMuted(workspaceSlug, conversation.id, !muted)
        .then(() =>
          setToast({ type: TOAST_TYPE.SUCCESS, title: muted ? t("chat.slash.unmuted") : t("chat.slash.muted") })
        )
        .catch(() => setToast({ type: TOAST_TYPE.ERROR, title: t("chat.errors.generic") }));
    } else setModal(command);
  };

  const applySuggestion = (suggestion: TSuggestion) => {
    if (suggestion.type === "emoji") {
      if (!replaceToken(`:${emojiQuery ?? ""}`, `${suggestion.emoji} `)) insert(suggestion.emoji);
    } else runCommand(suggestion.command);
  };

  const linkWorkItems = async (items: ISearchIssueResponse[]) => {
    insert(
      items
        .map((item) =>
          workItemLinkHtml(workspaceSlug, {
            identifier: item.project__identifier,
            sequenceId: item.sequence_id,
            name: item.name,
          })
        )
        .join(" ")
    );
  };

  const linkCreatedWorkItem = async (issue: TIssue) => {
    const identifier = issue.project_id ? getPartialProjectById(issue.project_id)?.identifier : undefined;
    if (identifier && issue.sequence_id) {
      insert(workItemLinkHtml(workspaceSlug, { identifier, sequenceId: issue.sequence_id, name: issue.name }));
    }
  };
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
    chat.setDraft(conversation.id, null);
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
        {isRecording ? (
          <ChatVoiceRecorder conversationId={conversation.id} onClose={() => setIsRecording(false)} />
        ) : (
          <>
            {showToolbar && <ChatFormatToolbar editorRef={editorApi} />}
            {isSuggesting && (
              <div
                role="listbox"
                aria-label={emojiQuery !== null ? t("chat.composer.emoji_suggestions") : t("chat.slash.title")}
                className="mx-1 mt-1 flex flex-col rounded-md border border-subtle bg-surface-1 p-1 shadow-raised-200"
              >
                {suggestions.map((suggestion, index) => (
                  <button
                    key={suggestion.key}
                    type="button"
                    role="option"
                    aria-selected={index === selectedSuggestion}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setSelectedSuggestion(index)}
                    onClick={() => applySuggestion(suggestion)}
                    className={cn("flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-13", {
                      "bg-layer-transparent-active": index === selectedSuggestion,
                    })}
                  >
                    {suggestion.type === "emoji" ? (
                      <>
                        <span className="text-16 leading-none">{suggestion.emoji}</span>
                        <span className="text-secondary">{suggestion.label}</span>
                      </>
                    ) : (
                      <>
                        <span className="font-medium text-primary">/{suggestion.command}</span>
                        <span className="truncate text-12 text-tertiary">{t(`chat.slash.${suggestion.command}`)}</span>
                      </>
                    )}
                  </button>
                ))}
                <p className="px-2 pt-1 text-11 text-tertiary">{t("chat.composer.suggestion_hint")}</p>
              </div>
            )}
            <div
              role="group"
              onKeyDownCapture={(event) => {
                if (!isSuggesting) return;
                const keys = ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"];
                if (!keys.includes(event.key) || event.shiftKey) return;
                event.preventDefault();
                event.stopPropagation();
                if (event.key === "ArrowDown") setSelectedSuggestion((value) => (value + 1) % suggestions.length);
                else if (event.key === "ArrowUp")
                  setSelectedSuggestion((value) => (value - 1 + suggestions.length) % suggestions.length);
                else if (event.key === "Escape") setDismissedFor(tokenKey);
                else applySuggestion(suggestions[selectedSuggestion] ?? suggestions[0]);
              }}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData?.files ?? []);
                if (files.length === 0) return;
                event.preventDefault();
                addFiles(files);
              }}
              className="max-h-60 overflow-y-auto px-1"
              onKeyDown={(event) => {
                if (event.key === "Escape" && replyTo) onCancelReply();
                // ↑ in an empty composer edits my last message (shortcuts sheet).
                if (event.key === "ArrowUp" && !hasText && !event.shiftKey && !event.altKey) {
                  event.preventDefault();
                  chat.requestEditLast(conversation.id);
                }
              }}
            >
              <LiteTextEditor
                editable
                key={conversation.id}
                ref={setEditor}
                id={`chat-composer-${conversation.id}`}
                workspaceSlug={workspaceSlug}
                workspaceId={workspaceId}
                projectId={conversation.project?.id}
                initialValue={initialHtml}
                value={null}
                placeholder={t("chat.composer.placeholder", { name })}
                onChange={(_json, nextHtml) => {
                  setHtml(nextHtml);
                  chat.setDraft(conversation.id, isCommentEmpty(nextHtml) ? null : nextHtml);
                  if (!isCommentEmpty(nextHtml)) chat.sendTyping(conversation.id);
                }}
                onEnterKeyPress={() => {
                  if (!isSuggesting) send();
                }}
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
              <ChatEmojiPicker
                ariaLabel={t("chat.composer.emoji")}
                onSelect={insert}
                side="top"
                align="start"
                buttonClassName="flex size-8 items-center justify-center rounded-md text-secondary hover:bg-layer-transparent-hover"
              >
                <SmilePlus className="size-4" />
              </ChatEmojiPicker>
              <IconButton
                icon={Baseline}
                variant={showToolbar ? "tertiary" : "ghost"}
                size="lg"
                aria-label={t("chat.composer.formatting")}
                aria-pressed={showToolbar}
                onClick={toggleToolbar}
              />
              <IconButton
                icon={Mic}
                variant="ghost"
                size="lg"
                aria-label={t("chat.voice.record")}
                onClick={() => setIsRecording(true)}
                disabled={isRecording}
              />
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
                  canSend
                    ? "bg-accent-primary text-on-color hover:bg-accent-primary-hover"
                    : "bg-layer-1 text-placeholder"
                )}
              >
                {t("chat.composer.send")}
                <SendHorizontal className="size-3.5" />
              </button>
            </div>
          </>
        )}
      </div>
      {modal === "workitem" && (
        <CreateUpdateIssueModal
          isOpen
          onClose={() => setModal(null)}
          data={conversation.project ? { project_id: conversation.project.id } : {}}
          onSubmit={linkCreatedWorkItem}
        />
      )}
      {modal === "link" && (
        <ExistingIssuesListModal
          workspaceSlug={workspaceSlug}
          isOpen
          handleClose={() => setModal(null)}
          searchParams={{}}
          workspaceLevelToggle
          handleOnSubmit={linkWorkItems}
          workItemSearchServiceCallback={(params) =>
            // Workspace-wide search across the projects the user is in; the URL needs some project id.
            projectService.projectIssuesSearch(workspaceSlug, conversation.project?.id ?? joinedProjectIds?.[0] ?? "", {
              ...params,
              workspace_search: true,
            })
          }
        />
      )}
    </div>
  );
});
