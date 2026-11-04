/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { Check, Forward, MessageSquare } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { IconButton } from "@plane/propel/icon-button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useChat } from "@/hooks/store/use-chat";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProject } from "@/hooks/store/use-project";
import { useAppRouter } from "@/hooks/use-app-router";
// local
import { ConversationAvatar } from "../common/avatars";
import { chatPath, noteToHtml, orderForProject } from "../common/helpers";
import { workItemLinkHtml } from "../composer/helpers";
import { useChatAvailability } from "../hooks/use-chat-availability";

/** Same limit as forwarding (docs/chat/phase-2/02-api-contracts.md § Share to chat). */
export const MAX_SHARE_TARGETS = 5;

type TPickerProps = {
  projectId: string;
  selected: string[];
  onToggle: (id: string) => void;
  multiple: boolean;
};

const ConversationPicker = observer(function ConversationPicker(props: TPickerProps) {
  const { projectId, selected, onToggle, multiple } = props;
  const { t } = useTranslation();
  const chat = useChat();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const candidates = orderForProject(chat.conversation.sorted, projectId).filter(
    (conversation) => !needle || chat.conversation.displayName(conversation).toLowerCase().includes(needle)
  );
  return (
    <div className="flex flex-col gap-2">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("chat.forward.search")}
        aria-label={t("chat.forward.search")}
        className="h-8 rounded-md border border-strong bg-surface-1 px-2.5 text-13 text-primary placeholder:text-placeholder focus:border-accent-strong focus:outline-none"
      />
      <div className="vertical-scrollbar flex scrollbar-sm max-h-64 flex-col overflow-y-auto rounded-md border border-subtle p-1">
        {candidates.length === 0 ? (
          <p className="px-2 py-6 text-center text-13 text-tertiary">{t("chat.forward.no_results")}</p>
        ) : (
          candidates.map((conversation) => {
            const isSelected = selected.includes(conversation.id);
            const isFull = multiple && !isSelected && selected.length >= MAX_SHARE_TARGETS;
            return (
              <button
                key={conversation.id}
                type="button"
                aria-pressed={isSelected}
                disabled={isFull}
                onClick={() => onToggle(conversation.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-13 text-primary hover:bg-layer-transparent-hover disabled:cursor-not-allowed disabled:opacity-50",
                  { "bg-layer-transparent-active": isSelected }
                )}
              >
                <ConversationAvatar conversation={conversation} size={20} />
                <span className="flex-1 truncate">{chat.conversation.displayName(conversation)}</span>
                {conversation.project?.id === projectId && (
                  <span className="text-11 text-tertiary">{t("chat.workitem.this_project")}</span>
                )}
                {isSelected && <Check className="size-3.5 text-accent-primary" />}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
});

type Props = { workspaceSlug: string; projectId: string; issueId: string };

/** "Share to chat" and "Discuss in chat" in the work-item header. */
export const ChatWorkItemActions = observer(function ChatWorkItemActions(props: Props) {
  const { workspaceSlug, projectId, issueId } = props;
  const { t } = useTranslation();
  const chat = useChat();
  const router = useAppRouter();
  const isAvailable = useChatAvailability(workspaceSlug);
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const { getProjectIdentifierById } = useProject();
  const [dialog, setDialog] = useState<"share" | "discuss" | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [isSending, setIsSending] = useState(false);

  const issue = getIssueById(issueId);
  const identifier = getProjectIdentifierById(projectId);
  if (!isAvailable || !issue || !identifier || issue.archived_at) return null;

  const link = workItemLinkHtml(workspaceSlug, { identifier, sequenceId: issue.sequence_id, name: issue.name });
  const close = () => {
    setDialog(null);
    setSelected([]);
    setNote("");
  };

  const share = async () => {
    setIsSending(true);
    try {
      const body = `${noteToHtml(note)}<p>${link}</p>`;
      const text = `${note.trim()} ${identifier}-${issue.sequence_id} ${issue.name}`.trim();
      await Promise.all(
        selected.map(async (conversationId) => {
          const message = await chat.message.send(workspaceSlug, conversationId, {
            body_html: body,
            body_stripped: text,
          });
          if (message) chat.conversation.applyMessageCreated(message);
        })
      );
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("chat.workitem.shared", { count: selected.length }) });
      close();
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: t("chat.errors.generic") });
    } finally {
      setIsSending(false);
    }
  };

  const discuss = (conversationId: string) => {
    // Start the reply with a link to the work item, then open the chat.
    const existing = chat.getDraft(conversationId) ?? "";
    chat.setDraft(conversationId, `<p>${link}</p>${existing === "<p></p>" ? "" : existing}`);
    close();
    if (chat.dock.isShown) chat.dock.open(conversationId);
    else router.push(chatPath(workspaceSlug, conversationId));
  };

  return (
    <>
      <Tooltip tooltipContent={t("chat.workitem.share")}>
        <IconButton
          variant="secondary"
          size="lg"
          icon={Forward}
          aria-label={t("chat.workitem.share")}
          onClick={() => setDialog("share")}
        />
      </Tooltip>
      <Tooltip tooltipContent={t("chat.workitem.discuss")}>
        <IconButton
          variant="secondary"
          size="lg"
          icon={MessageSquare}
          aria-label={t("chat.workitem.discuss")}
          onClick={() => setDialog("discuss")}
        />
      </Tooltip>

      <ModalCore isOpen={dialog !== null} handleClose={close} position={EModalPosition.TOP} width={EModalWidth.LG}>
        <div className="flex flex-col gap-3 p-5">
          <h3 className="text-18 font-medium text-primary">
            {dialog === "share" ? t("chat.workitem.share") : t("chat.workitem.discuss")}
          </h3>
          <div className="truncate rounded-md border border-subtle bg-layer-1 px-3 py-2 text-13 text-secondary">
            <span className="font-medium text-tertiary">
              {identifier}-{issue.sequence_id}
            </span>{" "}
            {issue.name}
          </div>
          <ConversationPicker
            projectId={projectId}
            multiple={dialog === "share"}
            selected={selected}
            onToggle={(id) =>
              dialog === "discuss"
                ? discuss(id)
                : setSelected((current) =>
                    current.includes(id)
                      ? current.filter((value) => value !== id)
                      : current.length >= MAX_SHARE_TARGETS
                        ? current
                        : [...current, id]
                  )
            }
          />
          {dialog === "share" && (
            <label className="flex flex-col gap-1 text-12 font-medium text-secondary">
              {t("chat.forward.note")}
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                className="font-normal resize-none rounded-md border border-strong bg-surface-1 px-2.5 py-2 text-13 text-primary focus:border-accent-strong focus:outline-none"
              />
            </label>
          )}
          {dialog === "discuss" && <p className="text-12 text-tertiary">{t("chat.workitem.discuss_hint")}</p>}
        </div>
        {dialog === "share" && (
          <div className="flex justify-end gap-2 border-t border-subtle px-5 py-4">
            <Button variant="secondary" size="lg" onClick={close}>
              {t("chat.message.cancel")}
            </Button>
            <Button
              variant="primary"
              size="lg"
              disabled={selected.length === 0}
              loading={isSending}
              onClick={() => void share()}
            >
              {t("chat.forward.submit", { count: Math.max(selected.length, 1) })}
            </Button>
          </div>
        )}
      </ModalCore>
    </>
  );
});
