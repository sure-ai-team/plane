/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { Check } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TChatApiError, TChatConversation } from "@plane/types";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useChat } from "@/hooks/store/use-chat";
import { useMember } from "@/hooks/store/use-member";
// services
import { ChatService } from "@/services/chat.service";
// local
import { ChatUserAvatar } from "../common/avatars";

const chatService = new ChatService();
const CHAT_ROLES = new Set([15, 20]);

type Props = {
  workspaceSlug: string;
  conversation: TChatConversation;
  isOpen: boolean;
  onClose: () => void;
};

export const ChatAddMembersModal = observer(function ChatAddMembersModal(props: Props) {
  const { workspaceSlug, conversation, isOpen, onClose } = props;
  const { t } = useTranslation();
  const chat = useChat();
  const {
    workspace: { getWorkspaceMemberIds, getWorkspaceMemberDetails },
  } = useMember();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelected([]);
    }
  }, [isOpen]);

  const existing = useMemo(
    () => new Set((conversation.members ?? []).map((member) => member.member.id)),
    [conversation.members]
  );

  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return getWorkspaceMemberIds(workspaceSlug)
      .map((id) => getWorkspaceMemberDetails(id))
      .filter((details): details is NonNullable<typeof details> => !!details)
      .filter(
        (details) =>
          !existing.has(details.member.id) &&
          details.is_active !== false &&
          CHAT_ROLES.has(Number(details.role)) &&
          !details.member.is_bot
      )
      .filter((details) => !needle || details.member.display_name.toLowerCase().includes(needle));
  }, [getWorkspaceMemberIds, getWorkspaceMemberDetails, workspaceSlug, existing, query]);

  const submit = async () => {
    if (selected.length === 0) return;
    setIsSubmitting(true);
    try {
      await chatService.addMembers(workspaceSlug, conversation.id, selected);
      await chat.conversation.fetchOne(workspaceSlug, conversation.id);
      onClose();
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("chat.errors.generic"), message: (error as TChatApiError)?.error });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} position={EModalPosition.TOP} width={EModalWidth.LG}>
      <div className="flex flex-col gap-3 p-5">
        <h3 className="text-18 font-medium text-primary">{t("chat.actions.add_members")}</h3>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("chat.new_conversation.search_members")}
          className="h-8 rounded-md border border-strong bg-surface-1 px-2.5 text-13 text-primary placeholder:text-placeholder focus:border-accent-strong focus:outline-none"
        />
        <div className="vertical-scrollbar flex scrollbar-sm max-h-72 flex-col overflow-y-auto rounded-md border border-subtle p-1">
          {candidates.length === 0 ? (
            <p className="px-2 py-6 text-center text-13 text-tertiary">{t("chat.new_conversation.no_members_found")}</p>
          ) : (
            candidates.map((details) => {
              const isSelected = selected.includes(details.member.id);
              return (
                <button
                  key={details.member.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() =>
                    setSelected((current) =>
                      isSelected ? current.filter((id) => id !== details.member.id) : [...current, details.member.id]
                    )
                  }
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-13 text-primary hover:bg-layer-transparent-hover",
                    { "bg-layer-transparent-active": isSelected }
                  )}
                >
                  <ChatUserAvatar
                    user={{
                      id: details.member.id,
                      display_name: details.member.display_name,
                      first_name: details.member.first_name ?? "",
                      last_name: details.member.last_name ?? "",
                      avatar: null,
                      avatar_url: details.member.avatar_url ?? null,
                      is_bot: false,
                      is_active: true,
                    }}
                    size="base"
                  />
                  <span className="flex-1 truncate">{details.member.display_name}</span>
                  {isSelected && <Check className="size-3.5 text-accent-primary" />}
                </button>
              );
            })
          )}
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-subtle px-5 py-4">
        <Button variant="secondary" size="lg" onClick={onClose}>
          {t("chat.new_conversation.cancel")}
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={() => void submit()}
          disabled={selected.length === 0}
          loading={isSubmitting}
        >
          {t("chat.actions.add_members")}
        </Button>
      </div>
    </ModalCore>
  );
});
