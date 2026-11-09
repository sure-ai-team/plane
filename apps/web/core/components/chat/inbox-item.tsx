/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { MessageSquare } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import type { TNotification } from "@plane/types";
import { Avatar, Row } from "@plane/ui";
import { calculateTimeAgo, cn, getFileURL } from "@plane/utils";
// hooks
import { useAppRouter } from "@/hooks/use-app-router";
// local
import { chatPath } from "./common/helpers";

type Props = {
  workspaceSlug: string;
  notification: TNotification;
  isSelected: boolean;
  onOpen: () => Promise<void> | void;
  /** The Inbox's own row menu (read / archive / snooze). */
  options: React.ReactNode;
};

/** An Inbox row for a chat mention or direct message (docs/chat/phase-2/05-notifications.md). */
export const ChatInboxNotificationItem = observer(function ChatInboxNotificationItem(props: Props) {
  const { workspaceSlug, notification, isSelected, onOpen, options } = props;
  const { t } = useTranslation();
  const router = useAppRouter();
  const data = notification.data;
  const sender = notification.triggered_by_details;
  const senderName = sender?.display_name || sender?.first_name || t("chat.system.someone");
  const conversationName =
    data?.conversation_type === "group" && data.conversation_name ? data.conversation_name : null;
  const headline =
    data?.type === "mention"
      ? conversationName
        ? t("chat.inbox.mentioned_in", { name: senderName, conversation: conversationName })
        : t("chat.inbox.mentioned", { name: senderName })
      : t("chat.inbox.direct", { name: senderName });

  const open = async () => {
    await onOpen();
    if (data?.conversation_id) {
      router.push(`${chatPath(workspaceSlug, data.conversation_id)}${data.message_id ? `?m=${data.message_id}` : ""}`);
    }
  };

  return (
    <Row
      className={cn(
        "group relative flex cursor-pointer items-center gap-2 border-b border-subtle py-4 transition-all",
        {
          "bg-layer-1/30": isSelected,
          "bg-accent-primary/5": notification.read_at === null,
        }
      )}
      onClick={() => void open()}
    >
      {notification.read_at === null && (
        <div className="absolute top-[50%] left-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-primary" />
      )}
      <div className="relative flex w-full gap-2">
        <div className="relative flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-layer-1">
          {sender && (
            <Avatar
              name={senderName}
              src={getFileURL(sender.avatar_url)}
              size={42}
              shape="circle"
              className="bg-layer-1 text-body-sm-medium"
            />
          )}
          <span className="border-surface-1 absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full border-2 bg-accent-primary text-on-color">
            <MessageSquare className="size-2.5" aria-hidden />
          </span>
        </div>
        <div className="-mt-2 w-full space-y-1">
          <div className="relative flex h-8 items-center gap-3">
            <div className="line-clamp-1 w-full truncate text-body-xs-medium text-primary">{headline}</div>
            {options}
          </div>
          <div className="relative flex items-center gap-3 text-caption-sm-regular text-secondary">
            <div className="line-clamp-1 w-full truncate">{notification.message_stripped}</div>
            <p className="flex-shrink-0 text-tertiary">
              {notification.created_at && calculateTimeAgo(notification.created_at)}
            </p>
          </div>
        </div>
      </div>
    </Row>
  );
});
