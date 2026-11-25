/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { MultipleStickyIcon } from "@plane/propel/icons";
import type { TNotification } from "@plane/types";
import { Avatar, Row } from "@plane/ui";
import { calculateTimeAgo, cn, getFileURL } from "@plane/utils";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useAppRouter } from "@/hooks/use-app-router";

type Props = {
  workspaceSlug: string;
  notification: TNotification;
  isSelected: boolean;
  onOpen: () => Promise<void>;
  /** The Inbox's own row menu (read / archive / snooze). */
  options: React.ReactNode;
};

/** An Inbox row for a sticky that was shared with the user. */
export const StickyInboxNotificationItem = observer(function StickyInboxNotificationItem(props: Props) {
  const { workspaceSlug, notification, isSelected, onOpen, options } = props;
  // navigation
  const router = useAppRouter();
  // plane hooks
  const { t } = useTranslation();
  // store hooks
  const { getPartialProjectById } = useProject();
  // derived values
  const sender = notification.triggered_by_details;
  const senderName = sender?.display_name || sender?.first_name || "";
  const projectName = notification.project ? getPartialProjectById(notification.project)?.name : undefined;

  const open = async () => {
    await onOpen();
    if (notification.project && notification.data?.sticky_id)
      router.push(`/${workspaceSlug}/projects/${notification.project}/stickies/?sticky=${notification.data.sticky_id}`);
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
            <MultipleStickyIcon className="size-2.5" aria-hidden />
          </span>
        </div>
        <div className="-mt-2 w-full space-y-1">
          <div className="relative flex h-8 items-center gap-3">
            <div className="line-clamp-1 w-full truncate text-body-xs-medium text-primary">
              {t("stickies.sharing.notification", { name: senderName })}
            </div>
            {options}
          </div>
          <div className="relative flex items-center gap-3 text-caption-sm-regular text-secondary">
            <div className="line-clamp-1 w-full truncate">{projectName}</div>
            <p className="flex-shrink-0 text-tertiary">
              {notification.created_at && calculateTimeAgo(notification.created_at)}
            </p>
          </div>
        </div>
      </div>
    </Row>
  );
});
