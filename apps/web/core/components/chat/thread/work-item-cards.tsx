/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { useTranslation } from "@plane/i18n";
import { PriorityIcon, StateGroupIcon, WorkItemsIcon } from "@plane/propel/icons";
import type { TChatWorkItemRef } from "@plane/types";
import { cn, renderFormattedDate } from "@plane/utils";
// hooks
import { useChat } from "@/hooks/store/use-chat";
import { useMember } from "@/hooks/store/use-member";
import { useProjectState } from "@/hooks/store/use-project-state";
// local
import { ChatUserAvatar } from "../common/avatars";

const browsePath = (workspaceSlug: string, ref: TChatWorkItemRef) =>
  `/${workspaceSlug}/browse/${ref.project_identifier}-${ref.sequence_id}/`;

type TCardProps = { workspaceSlug: string; workItem: TChatWorkItemRef; tone: "default" | "inverse" };

const WorkItemCard = observer(function WorkItemCard({ workspaceSlug, workItem, tone }: TCardProps) {
  const { t } = useTranslation();
  const chat = useChat();
  const { getStateById, getProjectStates, fetchProjectStates } = useProjectState();
  const { getUserDetails } = useMember();
  const entry = chat.workItems.get(workItem.id);
  const card = entry && entry !== "missing" ? entry : null;
  const key = `${workItem.project_identifier}-${workItem.sequence_id}`;

  useEffect(() => {
    chat.workItems.request(workspaceSlug, workItem);
  }, [chat, workspaceSlug, workItem]);

  // States are per project; load them once when a card needs them.
  const needsStates = !!card && !getProjectStates(card.projectId);
  useEffect(() => {
    if (needsStates && card) void fetchProjectStates(workspaceSlug, card.projectId).catch(() => undefined);
  }, [needsStates, card, fetchProjectStates, workspaceSlug]);

  // Not visible to me (private project) or deleted: just the key, no details (P2-S4).
  if (!card) {
    return (
      <Link
        href={browsePath(workspaceSlug, workItem)}
        className={cn(
          "inline-flex h-6 items-center gap-1 rounded-sm border px-1.5 text-12 font-medium",
          tone === "inverse" ? "border-white/40 text-on-color" : "border-subtle text-secondary"
        )}
      >
        <WorkItemsIcon className="size-3" />
        {entry === "missing" ? t("chat.workitem.chip", { key }) : key}
      </Link>
    );
  }

  const state = getStateById(card.stateId);
  const assignee = card.assigneeIds[0] ? getUserDetails(card.assigneeIds[0]) : undefined;

  return (
    <Link
      href={browsePath(workspaceSlug, workItem)}
      className="flex w-full max-w-md flex-col gap-1.5 rounded-md border border-subtle bg-surface-1 px-2.5 py-2 text-primary no-underline hover:bg-layer-transparent-hover"
    >
      <span className="flex items-center gap-2">
        {state ? (
          <StateGroupIcon stateGroup={state.group} color={state.color} className="size-3.5 shrink-0" />
        ) : (
          <WorkItemsIcon className="size-3.5 shrink-0 text-tertiary" />
        )}
        <span className="shrink-0 text-12 font-medium text-tertiary">{key}</span>
        <span className="truncate text-13 font-medium">{card.name}</span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5 text-11 text-secondary">
        {card.isArchived && (
          <span className="rounded-sm border border-subtle px-1.5 py-0.5">{t("chat.workitem.archived")}</span>
        )}
        {state && <span className="rounded-sm border border-subtle px-1.5 py-0.5">{state.name}</span>}
        {card.priority && card.priority !== "none" && (
          <span className="flex items-center gap-1 rounded-sm border border-subtle px-1.5 py-0.5 capitalize">
            <PriorityIcon priority={card.priority} size={10} />
            {card.priority}
          </span>
        )}
        {card.targetDate && (
          <span className="rounded-sm border border-subtle px-1.5 py-0.5">
            {t("chat.workitem.due", { date: renderFormattedDate(card.targetDate) ?? card.targetDate })}
          </span>
        )}
        {assignee && (
          <span className="flex items-center gap-1 rounded-sm border border-subtle px-1.5 py-0.5">
            <ChatUserAvatar
              user={{
                id: assignee.id,
                display_name: assignee.display_name,
                first_name: assignee.first_name ?? "",
                last_name: assignee.last_name ?? "",
                avatar: null,
                avatar_url: assignee.avatar_url ?? null,
                is_bot: false,
                is_active: true,
              }}
              size={14}
            />
            {assignee.display_name}
          </span>
        )}
        {card.subIssuesCount > 0 && (
          <span className="ml-auto text-tertiary">{t("chat.workitem.sub_items", { count: card.subIssuesCount })}</span>
        )}
      </span>
    </Link>
  );
});

type Props = { workspaceSlug: string; workItems: TChatWorkItemRef[] | undefined; tone?: "default" | "inverse" };

/** Cards for the work items a message links to (P2-D13). */
export const ChatWorkItemCards = observer(function ChatWorkItemCards(props: Props) {
  const { workspaceSlug, workItems, tone = "default" } = props;
  if (!workItems || workItems.length === 0) return null;
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      {workItems.map((workItem) => (
        <WorkItemCard key={workItem.id} workspaceSlug={workspaceSlug} workItem={workItem} tone={tone} />
      ))}
    </div>
  );
});
