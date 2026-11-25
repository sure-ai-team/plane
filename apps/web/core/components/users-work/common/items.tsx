/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { Lock } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Avatar } from "@plane/propel/avatar";
import { Badge } from "@plane/propel/badge";
import { Button } from "@plane/propel/button";
import { PriorityIcon, StateGroupIcon } from "@plane/propel/icons";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import type { TUserWorkHiddenProject, TUserWorkItem } from "@plane/types";
import { ControlLink, EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { cn, generateWorkItemLink, getFileURL, renderFormattedDate } from "@plane/utils";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useMember } from "@/hooks/store/use-member";
import { useUserPermissions } from "@/hooks/store/user";

type JoinTarget = { id: string; name: string };

type JoinProps = {
  workspaceSlug: string;
  project: JoinTarget;
  onClose: () => void;
  onJoined: () => void;
};

/** Joining is visible to the other members of a project, so it is always confirmed. */
function JoinProjectConfirmation({ workspaceSlug, project, onClose, onJoined }: JoinProps) {
  const { t } = useTranslation();
  const { joinProject } = useUserPermissions();
  const [isJoining, setIsJoining] = useState(false);

  const join = async () => {
    setIsJoining(true);
    try {
      await joinProject(workspaceSlug, project.id);
      onClose();
      onJoined();
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: t("users_work.hidden.error") });
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <ModalCore isOpen handleClose={onClose} position={EModalPosition.CENTER} width={EModalWidth.LG}>
      <div className="flex flex-col gap-2 p-5">
        <h3 className="text-16 font-medium break-words">
          {t("users_work.hidden.confirm_title", { project: project.name })}
        </h3>
        <p className="text-13 text-secondary">{t("users_work.hidden.confirm_description")}</p>
      </div>
      <div className="flex justify-end gap-2 px-5 pb-5">
        <Button variant="secondary" size="lg" onClick={onClose}>
          {t("users_work.hidden.cancel")}
        </Button>
        <Button variant="primary" size="lg" onClick={() => void join()} loading={isJoining}>
          {isJoining ? t("users_work.hidden.joining") : t("users_work.hidden.confirm")}
        </Button>
      </div>
    </ModalCore>
  );
}

type HiddenProjectsProps = {
  workspaceSlug: string;
  projects: TUserWorkHiddenProject[];
  onJoined: () => void;
};

/** Work items that are counted but not shown, with a way in for admins. */
export function HiddenProjects({ workspaceSlug, projects, onJoined }: HiddenProjectsProps) {
  const { t } = useTranslation();
  const [joining, setJoining] = useState<JoinTarget | null>(null);
  if (projects.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-subtle bg-layer-1 px-4 py-3">
      <div>
        <p className="flex items-center gap-1.5 text-13 font-medium text-primary">
          <Lock className="size-3.5 text-tertiary" aria-hidden="true" />
          {t("users_work.hidden.title")}
        </p>
        <p className="text-12 text-tertiary">{t("users_work.hidden.description")}</p>
      </div>
      <ul className="flex flex-col gap-1">
        {projects.map((project) => (
          <li key={project.project_id} className="flex items-center gap-3 text-13">
            <span className="min-w-0 flex-1 truncate text-secondary">{project.project_name}</span>
            <span className="text-12 text-tertiary">{t("users_work.items.count", { count: project.count })}</span>
            <Button
              variant="secondary"
              onClick={() => setJoining({ id: project.project_id, name: project.project_name })}
            >
              {t("users_work.hidden.join")}
            </Button>
          </li>
        ))}
      </ul>
      {joining && (
        <JoinProjectConfirmation
          workspaceSlug={workspaceSlug}
          project={joining}
          onClose={() => setJoining(null)}
          onJoined={onJoined}
        />
      )}
    </div>
  );
}

/** Runs `onClose` when the side panel closes: the work item may have changed meanwhile. */
export const useRefreshAfterPeek = (onClose: () => void) => {
  const { peekIssue } = useIssueDetail();
  const wasOpen = useRef(false);
  const callback = useRef(onClose);
  const isOpen = Boolean(peekIssue?.issueId);

  useEffect(() => {
    callback.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (wasOpen.current && !isOpen) callback.current();
    wasOpen.current = isOpen;
  }, [isOpen]);
};

type ItemProps = {
  workspaceSlug: string;
  item: TUserWorkItem;
  onJoined: () => void;
  variant?: "row" | "card";
};

export const WorkItemEntry = observer(function WorkItemEntry(props: ItemProps) {
  const { workspaceSlug, item, onJoined, variant = "row" } = props;
  const { t } = useTranslation();
  const { getUserDetails } = useMember();
  const { setPeekIssue } = useIssueDetail();
  const [joining, setJoining] = useState<JoinTarget | null>(null);
  const isCard = variant === "card";

  const link = generateWorkItemLink({
    workspaceSlug,
    projectId: item.project_id,
    issueId: item.id,
    projectIdentifier: item.project_identifier,
    sequenceId: item.sequence_id,
  });

  const open = () => {
    if (item.can_open) setPeekIssue({ workspaceSlug, projectId: item.project_id, issueId: item.id });
    else setJoining({ id: item.project_id, name: item.project_name });
  };

  const date =
    item.state_group === "completed" && item.completed_at
      ? t("users_work.items.done_on", { date: renderFormattedDate(item.completed_at) ?? "" })
      : item.target_date
        ? t("users_work.items.due", { date: renderFormattedDate(item.target_date) ?? "" })
        : null;

  const title = (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <StateGroupIcon
        stateGroup={item.state_group ?? "backlog"}
        color={item.state_color ?? undefined}
        className="size-3.5 flex-shrink-0"
      />
      <span className="flex-shrink-0 text-12 text-tertiary">
        {item.project_identifier}-{item.sequence_id}
      </span>
      <span className={cn("text-13 text-primary", isCard ? "line-clamp-2" : "truncate")} title={item.name}>
        {item.name}
      </span>
      {!item.can_open && (
        <Tooltip tooltipContent={t("users_work.items.join_to_open")}>
          <span className="flex-shrink-0">
            <Lock className="size-3 text-tertiary" aria-label={t("users_work.items.join_to_open")} />
          </span>
        </Tooltip>
      )}
    </span>
  );

  const details = (
    <span className="flex flex-shrink-0 flex-wrap items-center gap-2">
      {item.is_stuck && <Badge variant="warning">{t("users_work.items.stuck")}</Badge>}
      {item.is_overdue && <Badge variant="danger">{t("users_work.items.overdue")}</Badge>}
      {date && (
        <span className={cn("text-12 whitespace-nowrap", item.is_overdue ? "text-danger-primary" : "text-tertiary")}>
          {date}
        </span>
      )}
      <PriorityIcon priority={item.priority} size={14} />
      <span className="hidden max-w-32 truncate text-12 text-tertiary lg:inline">{item.project_name}</span>
      <span className="flex -space-x-1">
        {item.assignee_ids.slice(0, 3).map((id) => {
          const user = getUserDetails(id);
          return (
            <Avatar key={id} name={user?.display_name} src={getFileURL(user?.avatar_url ?? "")} size="md" showTooltip />
          );
        })}
        {item.assignee_ids.length > 3 && (
          <span className="pl-2 text-11 text-tertiary">+{item.assignee_ids.length - 3}</span>
        )}
      </span>
    </span>
  );

  return (
    <>
      <ControlLink
        href={link}
        onClick={open}
        className={cn(
          "flex w-full gap-x-4 gap-y-2 hover:bg-layer-1",
          isCard
            ? "flex-col rounded-md border border-subtle bg-surface-1 p-3"
            : "flex-col border-b border-subtle px-4 py-2.5 last:border-b-0 md:flex-row md:items-center"
        )}
      >
        {title}
        {details}
      </ControlLink>
      {joining && (
        <JoinProjectConfirmation
          workspaceSlug={workspaceSlug}
          project={joining}
          onClose={() => setJoining(null)}
          onJoined={onJoined}
        />
      )}
    </>
  );
});
