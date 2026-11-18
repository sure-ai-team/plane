/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { EmojiPicker } from "@plane/propel/emoji-icon-picker";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TChatApiError, TChatConversation } from "@plane/types";
// hooks
import { useChat } from "@/hooks/store/use-chat";
// local
import { ConversationAvatar } from "../common/avatars";

/** Server limit (docs/chat/phase-2/02-api-contracts.md § Group details). */
export const MAX_DESCRIPTION_LENGTH = 500;

type Props = { workspaceSlug: string; conversation: TChatConversation };

/** Group icon and description; group admins can change both. */
export const ChatGroupAbout = observer(function ChatGroupAbout({ workspaceSlug, conversation }: Props) {
  const { t } = useTranslation();
  const chat = useChat();
  const isAdmin = conversation.my_role === 20;
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(conversation.description ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const fail = (error: unknown) =>
    setToast({ type: TOAST_TYPE.ERROR, title: t("chat.errors.generic"), message: (error as TChatApiError)?.error });

  const save = async () => {
    setIsSaving(true);
    try {
      await chat.conversation.update(workspaceSlug, conversation.id, { description: draft.trim() });
      setIsEditing(false);
    } catch (error) {
      fail(error);
    } finally {
      setIsSaving(false);
    }
  };

  const setLogo = (value: { type?: string; value?: unknown }) => {
    if (!value?.type) return;
    const logo = value.type === "emoji" ? { value: value.value } : value.value;
    void chat.conversation
      .update(workspaceSlug, conversation.id, { logo_props: { in_use: value.type, [value.type]: logo } })
      .catch(fail);
    setIsPickerOpen(false);
  };

  return (
    <section className="flex flex-col gap-2" aria-label={t("chat.about.title")}>
      <div className="flex items-center gap-3">
        {isAdmin ? (
          <EmojiPicker
            isOpen={isPickerOpen}
            handleToggle={setIsPickerOpen}
            closeOnSelect={false}
            iconType="lucide"
            buttonClassName="rounded-md"
            label={<ConversationAvatar conversation={conversation} size={40} />}
            onChange={(value: { type?: string; value?: unknown }) => setLogo(value)}
          />
        ) : (
          <ConversationAvatar conversation={conversation} size={40} />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-14 font-medium text-primary">{conversation.name}</p>
          {isAdmin && <p className="text-11 text-tertiary">{t("chat.about.change_icon")}</p>}
        </div>
      </div>

      {isEditing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, MAX_DESCRIPTION_LENGTH))}
            rows={3}
            aria-label={t("chat.about.description")}
            placeholder={t("chat.about.placeholder")}
            className="resize-none rounded-md border border-strong bg-surface-1 px-2.5 py-2 text-13 text-primary focus:border-accent-strong focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <Button variant="primary" size="sm" loading={isSaving} onClick={() => void save()}>
              {t("chat.message.save")}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setIsEditing(false)}>
              {t("chat.message.cancel")}
            </Button>
            <span className="ml-auto text-11 text-tertiary">
              {draft.length}/{MAX_DESCRIPTION_LENGTH}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {conversation.description ? (
            <p className="text-13 break-words whitespace-pre-wrap text-secondary">{conversation.description}</p>
          ) : (
            <p className="text-13 text-tertiary">{t("chat.about.empty")}</p>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                setDraft(conversation.description ?? "");
                setIsEditing(true);
              }}
              className="self-start text-12 font-medium text-accent-primary hover:underline"
            >
              {conversation.description ? t("chat.about.edit") : t("chat.about.add")}
            </button>
          )}
        </div>
      )}
    </section>
  );
});
