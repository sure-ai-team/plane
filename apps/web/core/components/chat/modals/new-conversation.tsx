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
import type { TChatApiError } from "@plane/types";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useChat } from "@/hooks/store/use-chat";
import { useMember } from "@/hooks/store/use-member";
import { useUser } from "@/hooks/store/user";
import { useAppRouter } from "@/hooks/use-app-router";
// local
import { ChatUserAvatar } from "../common/avatars";
import { chatPath } from "../common/helpers";

type TMode = "direct" | "group";

type Props = {
  workspaceSlug: string;
  isOpen: boolean;
  onClose: () => void;
  /** Start in group mode with these people pre-selected (used by "Add members" too). */
  initialMode?: TMode;
};

const CHAT_ROLES = new Set([15, 20]);

export const ChatNewConversationModal = observer(function ChatNewConversationModal(props: Props) {
  const { workspaceSlug, isOpen, onClose, initialMode = "direct" } = props;
  const { t } = useTranslation();
  const chat = useChat();
  const router = useAppRouter();
  const { data: currentUser } = useUser();
  const {
    workspace: { getWorkspaceMemberIds, getWorkspaceMemberDetails },
  } = useMember();

  const [mode, setMode] = useState<TMode>(initialMode);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setName("");
      setQuery("");
      setSelected([]);
    }
  }, [isOpen, initialMode]);

  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return getWorkspaceMemberIds(workspaceSlug)
      .map((id) => getWorkspaceMemberDetails(id))
      .filter((details): details is NonNullable<typeof details> => !!details)
      .filter(
        (details) =>
          details.member.id !== currentUser?.id &&
          details.is_active !== false &&
          CHAT_ROLES.has(Number(details.role)) &&
          !details.member.is_bot
      )
      .filter((details) => {
        if (!needle) return true;
        const haystack =
          `${details.member.display_name} ${details.member.first_name ?? ""} ${details.member.last_name ?? ""}`.toLowerCase();
        return haystack.includes(needle);
      });
  }, [getWorkspaceMemberIds, getWorkspaceMemberDetails, workspaceSlug, currentUser?.id, query]);

  const toggle = (userId: string) => {
    if (mode === "direct") {
      setSelected([userId]);
      return;
    }
    setSelected((current) => (current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]));
  };

  const canSubmit = mode === "direct" ? selected.length === 1 : name.trim().length > 0 && selected.length > 0;

  const handleSubmit = async () => {
    if (!canSubmit || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const conversation = await chat.conversation.create(
        workspaceSlug,
        mode === "direct"
          ? { type: "direct", user_id: selected[0] }
          : { type: "group", name: name.trim(), member_ids: selected }
      );
      onClose();
      router.push(chatPath(workspaceSlug, conversation.id));
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("chat.errors.generic"),
        message: (error as TChatApiError)?.error,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const segmentClass = (active: boolean) =>
    cn(
      "h-6 rounded-sm px-3 text-12 font-medium transition-colors",
      active ? "bg-layer-2 text-primary shadow-raised-100" : "text-tertiary hover:text-secondary"
    );

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} position={EModalPosition.TOP} width={EModalWidth.XL}>
      <div className="flex flex-col gap-4 p-5">
        <h3 className="text-18 font-medium text-primary">{t("chat.new_conversation.title")}</h3>

        <div role="tablist" className="flex w-fit gap-1 rounded-md bg-layer-1 p-0.5">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "direct"}
            className={segmentClass(mode === "direct")}
            onClick={() => {
              setMode("direct");
              setSelected((current) => current.slice(0, 1));
            }}
          >
            {t("chat.new_conversation.direct")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "group"}
            className={segmentClass(mode === "group")}
            onClick={() => setMode("group")}
          >
            {t("chat.new_conversation.group")}
          </button>
        </div>

        {mode === "group" && (
          <label className="flex flex-col gap-1">
            <span className="text-12 font-medium text-secondary">{t("chat.new_conversation.group_name")}</span>
            <input
              value={name}
              maxLength={255}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("chat.new_conversation.group_name_placeholder")}
              className="h-8 rounded-md border border-strong bg-surface-1 px-2.5 text-13 text-primary placeholder:text-placeholder focus:border-accent-strong focus:outline-none"
            />
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-12 font-medium text-secondary">
            {mode === "group" ? t("chat.new_conversation.members") : t("chat.new_conversation.to")}
          </span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("chat.new_conversation.search_members")}
            className="h-8 rounded-md border border-strong bg-surface-1 px-2.5 text-13 text-primary placeholder:text-placeholder focus:border-accent-strong focus:outline-none"
          />
        </label>

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
                  onClick={() => toggle(details.member.id)}
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
                    showPresence
                  />
                  <span className="flex-1 truncate">
                    {details.member.display_name}
                    {(details.member.first_name || details.member.last_name) && (
                      <span className="text-tertiary">
                        {" "}
                        · {`${details.member.first_name ?? ""} ${details.member.last_name ?? ""}`.trim()}
                      </span>
                    )}
                  </span>
                  {isSelected && <Check className="size-3.5 text-accent-primary" />}
                </button>
              );
            })
          )}
        </div>
        <p className="text-12 text-tertiary">{t("chat.members.only_members_hint")}</p>
      </div>
      <div className="flex justify-end gap-2 border-t border-subtle px-5 py-4">
        <Button variant="secondary" size="lg" onClick={onClose}>
          {t("chat.new_conversation.cancel")}
        </Button>
        <Button variant="primary" size="lg" onClick={handleSubmit} disabled={!canSubmit} loading={isSubmitting}>
          {mode === "group" ? t("chat.new_conversation.create_group") : t("chat.new_conversation.start")}
        </Button>
      </div>
    </ModalCore>
  );
});
