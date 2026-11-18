/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { Check } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TChatApiError, TChatMessage } from "@plane/types";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useChat } from "@/hooks/store/use-chat";
// local
import { ConversationAvatar } from "../common/avatars";
import { noteToHtml } from "../common/helpers";

/** Server limit per forward (docs/chat/phase-2/02-api-contracts.md). */
export const MAX_FORWARD_TARGETS = 5;

type Props = {
  workspaceSlug: string;
  message: TChatMessage;
  isOpen: boolean;
  onClose: () => void;
};

export const ChatForwardModal = observer(function ChatForwardModal(props: Props) {
  const { workspaceSlug, message, isOpen, onClose } = props;
  const { t } = useTranslation();
  const chat = useChat();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const needle = query.trim().toLowerCase();
  // Computed from the observable list on each render (the component is an observer).
  const candidates = chat.conversation.sorted.filter(
    (conversation) => !needle || chat.conversation.displayName(conversation).toLowerCase().includes(needle)
  );

  const toggle = (id: string) =>
    setSelected((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      if (current.length >= MAX_FORWARD_TARGETS) return current;
      return [...current, id];
    });

  const submit = async () => {
    if (selected.length === 0) return;
    setIsSubmitting(true);
    try {
      await chat.message.forward(workspaceSlug, message.id, selected, noteToHtml(note));
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("chat.forward.done", { count: selected.length }) });
      onClose();
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("chat.errors.generic"), message: (error as TChatApiError)?.error });
    } finally {
      setIsSubmitting(false);
    }
  };

  const preview =
    message.body_stripped ||
    (message.kind === "voice"
      ? t("chat.preview.voice")
      : t("chat.preview.attachments", { count: message.attachments.length }));

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} position={EModalPosition.TOP} width={EModalWidth.LG}>
      <div className="flex flex-col gap-3 p-5">
        <h3 className="text-18 font-medium text-primary">{t("chat.forward.title")}</h3>
        <div className="truncate rounded-md border border-subtle bg-layer-1 px-3 py-2 text-13 text-secondary">
          {preview}
        </div>
        <label className="flex flex-col gap-1 text-12 font-medium text-secondary">
          {t("chat.forward.to")}
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("chat.forward.search")}
            className="font-normal h-8 rounded-md border border-strong bg-surface-1 px-2.5 text-13 text-primary placeholder:text-placeholder focus:border-accent-strong focus:outline-none"
          />
        </label>
        <div className="vertical-scrollbar flex scrollbar-sm max-h-60 flex-col overflow-y-auto rounded-md border border-subtle p-1">
          {candidates.length === 0 ? (
            <p className="px-2 py-6 text-center text-13 text-tertiary">{t("chat.forward.no_results")}</p>
          ) : (
            candidates.map((conversation) => {
              const isSelected = selected.includes(conversation.id);
              const isFull = !isSelected && selected.length >= MAX_FORWARD_TARGETS;
              return (
                <button
                  key={conversation.id}
                  type="button"
                  aria-pressed={isSelected}
                  disabled={isFull}
                  onClick={() => toggle(conversation.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-13 text-primary hover:bg-layer-transparent-hover disabled:cursor-not-allowed disabled:opacity-50",
                    { "bg-layer-transparent-active": isSelected }
                  )}
                >
                  <ConversationAvatar conversation={conversation} size={20} />
                  <span className="flex-1 truncate">{chat.conversation.displayName(conversation)}</span>
                  {isSelected && <Check className="size-3.5 text-accent-primary" />}
                </button>
              );
            })
          )}
        </div>
        <p className="text-11 text-tertiary">{t("chat.forward.limit", { count: MAX_FORWARD_TARGETS })}</p>
        <label className="flex flex-col gap-1 text-12 font-medium text-secondary">
          {t("chat.forward.note")}
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            className="font-normal resize-none rounded-md border border-strong bg-surface-1 px-2.5 py-2 text-13 text-primary focus:border-accent-strong focus:outline-none"
          />
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t border-subtle px-5 py-4">
        <Button variant="secondary" size="lg" onClick={onClose}>
          {t("chat.message.cancel")}
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={() => void submit()}
          disabled={selected.length === 0}
          loading={isSubmitting}
        >
          {t("chat.forward.submit", { count: Math.max(selected.length, 1) })}
        </Button>
      </div>
    </ModalCore>
  );
});
