/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { Lock, Pin, PinOff, Users } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { ProjectIcon } from "@plane/propel/icons";
import { Tooltip } from "@plane/propel/tooltip";
import type { TSticky } from "@plane/types";
import { EStickyAccess } from "@plane/types";
import { Avatar } from "@plane/ui";
import { cn, getFileURL } from "@plane/utils";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { useUser } from "@/hooks/store/user";
// local imports
import { useStickyOperations } from "../sticky/use-operations";
import { ShareStickyModal } from "./share-modal";

type Props = {
  workspaceSlug: string;
  projectId: string;
  sticky: TSticky;
};

/** Who a project sticky is shared with, whose it is and whether it is pinned, and the means to change that. */
export const StickySharingHeader = observer(function StickySharingHeader(props: Props) {
  const { workspaceSlug, projectId, sticky } = props;
  // states
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  // plane hooks
  const { t } = useTranslation();
  // store hooks
  const { data: currentUser } = useUser();
  const { getUserDetails } = useMember();
  // sticky operations
  const { stickyOperations } = useStickyOperations({ workspaceSlug, projectId });
  // derived values
  const canManage = sticky.my_permission === "manage";
  const isPinned = !!sticky.pinned_at;
  const canPin = sticky.access === EStickyAccess.PROJECT;
  const pinLabel = t(`stickies.pin.${!canPin ? "needs_project" : isPinned ? "unpin" : "pin"}`);
  const owner = sticky.owner && sticky.owner !== currentUser?.id ? getUserDetails(sticky.owner) : undefined;
  const access = sticky.access ?? EStickyAccess.PRIVATE;
  const Icon = { [EStickyAccess.PRIVATE]: Lock, [EStickyAccess.MEMBERS]: Users, [EStickyAccess.PROJECT]: ProjectIcon }[
    access
  ];
  const accessLabel = {
    [EStickyAccess.PRIVATE]: t("stickies.sharing.access.private.label"),
    [EStickyAccess.MEMBERS]: t("stickies.sharing.shared_with", { count: sticky.shares?.length ?? 0 }),
    [EStickyAccess.PROJECT]: t("stickies.sharing.access.project.label"),
  }[access];
  const className = "flex min-w-0 items-center gap-1 rounded-sm px-1 py-0.5";
  const content = (
    <>
      <Icon className="size-3 flex-shrink-0" />
      <span className="truncate">{sticky.my_permission === "view" ? t("stickies.view_only") : accessLabel}</span>
    </>
  );

  return (
    <div className="flex items-center justify-between gap-2 px-3 pt-2 pb-3 text-11 text-primary/60">
      {canManage ? (
        <>
          <button
            type="button"
            className={cn(className, "hover:bg-primary/10 hover:text-primary")}
            onClick={() => setIsShareModalOpen(true)}
            aria-label={`${t("stickies.sharing.title")}: ${accessLabel}`}
          >
            {content}
          </button>
          {isShareModalOpen && (
            <ShareStickyModal
              workspaceSlug={workspaceSlug}
              projectId={projectId}
              sticky={sticky}
              handleClose={() => setIsShareModalOpen(false)}
            />
          )}
        </>
      ) : (
        <div className={className} title={accessLabel}>
          {content}
        </div>
      )}
      <div className="flex flex-shrink-0 items-center gap-1.5">
        {canManage ? (
          <Tooltip tooltipContent={pinLabel}>
            <button
              type="button"
              aria-label={pinLabel}
              aria-pressed={isPinned}
              aria-disabled={!canPin}
              className={cn("group/pin grid size-5 place-items-center rounded-sm", {
                "hover:bg-primary/10 hover:text-primary": canPin,
                "cursor-not-allowed opacity-40": !canPin,
                "text-primary": isPinned,
              })}
              onClick={() => {
                if (canPin) void stickyOperations.updatePin(sticky.id, !isPinned);
              }}
            >
              <Pin
                className={cn("size-3", { "fill-current": isPinned, "group-hover/pin:hidden": isPinned })}
                aria-hidden
              />
              {isPinned && <PinOff className="hidden size-3 group-hover/pin:block" aria-hidden />}
            </button>
          </Tooltip>
        ) : (
          isPinned && <Pin className="size-3 fill-current" aria-label={t("stickies.overview.pinned")} />
        )}
        {owner && (
          <Avatar
            name={owner.display_name}
            src={getFileURL(owner.avatar_url)}
            size="sm"
            showTooltip
            className="text-9"
          />
        )}
      </div>
    </div>
  );
});
