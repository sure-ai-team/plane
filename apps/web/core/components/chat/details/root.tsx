/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { Bell, BellOff, LogOut, MoreHorizontal, UserPlus } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { IconButton } from "@plane/propel/icon-button";
import { TrashIcon } from "@plane/propel/icons";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TChatApiError, TChatConversation, TChatMember } from "@plane/types";
import { AlertModalCore, CustomMenu } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useChat } from "@/hooks/store/use-chat";
import { useUser } from "@/hooks/store/user";
import { useAppRouter } from "@/hooks/use-app-router";
// services
import { ChatService } from "@/services/chat.service";
// local
import { ChatUserAvatar } from "../common/avatars";
import { chatPath } from "../common/helpers";
import { ChatAddMembersModal } from "../modals/add-members";

const chatService = new ChatService();

type Props = {
  workspaceSlug: string;
  conversation: TChatConversation;
};

type TConfirm = "leave" | "delete" | null;

export const ChatDetailsPanel = observer(function ChatDetailsPanel(props: Props) {
  const { workspaceSlug, conversation } = props;
  const { t } = useTranslation();
  const chat = useChat();
  const router = useAppRouter();
  const { data: currentUser } = useUser();
  const [confirm, setConfirm] = useState<TConfirm>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);

  const isGroup = conversation.type === "group";
  const isAdmin = isGroup && conversation.my_role === 20;
  const name = chat.conversation.displayName(conversation);
  const members = conversation.members ?? [];

  const fail = (error: unknown) =>
    setToast({ type: TOAST_TYPE.ERROR, title: t("chat.errors.generic"), message: (error as TChatApiError)?.error });

  const toggleMute = async () => {
    try {
      await chat.conversation.setMuted(workspaceSlug, conversation.id, !conversation.is_muted);
    } catch (error) {
      fail(error);
    }
  };

  const runConfirm = async () => {
    setIsWorking(true);
    try {
      if (confirm === "leave") await chat.conversation.leave(workspaceSlug, conversation.id);
      if (confirm === "delete") await chat.conversation.remove(workspaceSlug, conversation.id);
      setConfirm(null);
      router.push(chatPath(workspaceSlug));
    } catch (error) {
      fail(error);
    } finally {
      setIsWorking(false);
    }
  };

  const changeRole = async (member: TChatMember, role: 15 | 20) => {
    try {
      await chatService.updateMember(workspaceSlug, conversation.id, member.member.id, { role });
      await chat.conversation.fetchOne(workspaceSlug, conversation.id);
    } catch (error) {
      fail(error);
    }
  };

  const removeMember = async (member: TChatMember) => {
    try {
      await chatService.removeMember(workspaceSlug, conversation.id, member.member.id);
      await chat.conversation.fetchOne(workspaceSlug, conversation.id);
    } catch (error) {
      fail(error);
    }
  };

  return (
    <aside className="flex h-full w-full flex-col bg-surface-1" aria-label={t("chat.actions.details")}>
      <div className="flex h-header shrink-0 items-center border-b border-subtle px-4 text-14 font-medium text-primary">
        {t("chat.actions.details")}
      </div>

      <div className="vertical-scrollbar flex scrollbar-sm flex-1 flex-col gap-4 overflow-y-auto p-4">
        <section className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <h4 className="text-12 font-semibold text-tertiary">
              {t("chat.members.count", { count: conversation.member_count })}
            </h4>
            {isAdmin && (
              <IconButton
                icon={UserPlus}
                variant="ghost"
                size="base"
                aria-label={t("chat.actions.add_members")}
                onClick={() => setIsAddOpen(true)}
              />
            )}
          </div>
          {members.map((member) => {
            const isMe = member.member.id === currentUser?.id;
            return (
              <div key={member.id} className="flex items-center gap-2 py-1">
                <ChatUserAvatar user={member.member} size="base" showPresence />
                <span className="flex-1 truncate text-13 text-primary">
                  {member.member.display_name}
                  {isMe && <span className="text-tertiary"> ({t("chat.members.you")})</span>}
                </span>
                {isGroup && member.role === 20 && (
                  <span className="rounded-sm bg-layer-1 px-1.5 py-0.5 text-11 text-secondary">
                    {t("chat.members.role_admin")}
                  </span>
                )}
                {isAdmin && !isMe && (
                  <CustomMenu
                    customButton={
                      <IconButton icon={MoreHorizontal} variant="ghost" size="sm" aria-label={t("chat.message.more")} />
                    }
                    closeOnSelect
                    placement="bottom-end"
                  >
                    <CustomMenu.MenuItem onClick={() => void changeRole(member, member.role === 20 ? 15 : 20)}>
                      {member.role === 20 ? t("chat.members.remove_admin") : t("chat.members.make_admin")}
                    </CustomMenu.MenuItem>
                    <CustomMenu.MenuItem onClick={() => void removeMember(member)} className="text-danger-primary">
                      {t("chat.members.remove")}
                    </CustomMenu.MenuItem>
                  </CustomMenu>
                )}
              </div>
            );
          })}
        </section>
      </div>

      <div className="flex flex-col gap-0.5 border-t border-subtle p-2">
        <button
          type="button"
          onClick={() => void toggleMute()}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover"
        >
          {conversation.is_muted ? <Bell className="size-3.5" /> : <BellOff className="size-3.5" />}
          {conversation.is_muted ? t("chat.actions.unmute") : t("chat.actions.mute")}
        </button>
        {isGroup && (
          <button
            type="button"
            onClick={() => setConfirm("leave")}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-13 text-secondary hover:bg-layer-transparent-hover"
          >
            <LogOut className="size-3.5" />
            {t("chat.actions.leave")}
          </button>
        )}
        {isAdmin && (
          <button
            type="button"
            onClick={() => setConfirm("delete")}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-13 text-danger-primary hover:bg-danger-subtle"
            )}
          >
            <TrashIcon className="size-3.5" />
            {t("chat.actions.delete_group")}
          </button>
        )}
      </div>

      <AlertModalCore
        isOpen={confirm !== null}
        handleClose={() => setConfirm(null)}
        handleSubmit={() => void runConfirm()}
        isSubmitting={isWorking}
        title={confirm === "delete" ? t("chat.delete_group.title", { name }) : t("chat.leave_group.title", { name })}
        content={confirm === "delete" ? t("chat.delete_group.body") : t("chat.leave_group.body")}
        primaryButtonText={{
          loading: confirm === "delete" ? t("chat.delete_group.confirm") : t("chat.leave_group.confirm"),
          default: confirm === "delete" ? t("chat.delete_group.confirm") : t("chat.leave_group.confirm"),
        }}
        secondaryButtonText={t("chat.message.cancel")}
      />
      {isAdmin && (
        <ChatAddMembersModal
          workspaceSlug={workspaceSlug}
          conversation={conversation}
          isOpen={isAddOpen}
          onClose={() => setIsAddOpen(false)}
        />
      )}
    </aside>
  );
});
