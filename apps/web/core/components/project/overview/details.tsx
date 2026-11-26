/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useLayoutEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { CalendarDays, Globe2, Lock, UserRound, Users } from "lucide-react";
// plane imports
import { NETWORK_CHOICES } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Logo } from "@plane/propel/emoji-icon-picker";
import { Tooltip } from "@plane/propel/tooltip";
import type { IProject } from "@plane/types";
import { Avatar, AvatarGroup } from "@plane/ui";
import { cn, getFileURL, renderFormattedDate } from "@plane/utils";
// components
import { CoverImage } from "@/components/common/cover-image";
// hooks
import { useMember } from "@/hooks/store/use-member";

type Props = {
  project: IProject;
};

type TStatChipProps = {
  icon?: React.ReactNode;
  tooltip: string;
  children: React.ReactNode;
};

function StatChip(props: TStatChipProps) {
  const { icon, tooltip, children } = props;
  return (
    <Tooltip tooltipContent={tooltip}>
      <li className="flex h-7 max-w-full min-w-0 cursor-default items-center gap-1.5 rounded-md border border-subtle bg-layer-1 px-2 text-12 text-secondary">
        {icon}
        <span className="truncate">{children}</span>
      </li>
    </Tooltip>
  );
}

/** Description text, clamped to a few lines with a toggle when it is longer. */
function ProjectDescription(props: { text: string }) {
  const { text } = props;
  // plane hooks
  const { t } = useTranslation();
  // states
  const [isExpanded, setIsExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);
  // refs
  const ref = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || isExpanded) return;
    const measure = () => setIsClamped(element.scrollHeight > element.clientHeight + 1);
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [text, isExpanded]);

  return (
    <div className="flex max-w-[760px] flex-col items-start gap-1">
      <p
        ref={ref}
        className={cn("text-14 leading-relaxed break-words whitespace-pre-line text-secondary", {
          "line-clamp-3": !isExpanded,
        })}
      >
        {text}
      </p>
      {(isClamped || isExpanded) && (
        <button
          type="button"
          className="text-13 font-medium text-accent-primary hover:underline"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((value) => !value)}
        >
          {isExpanded ? t("project_overview.hero.show_less") : t("project_overview.hero.show_more")}
        </button>
      )}
    </div>
  );
}

export const ProjectOverviewDetails = observer(function ProjectOverviewDetails(props: Props) {
  const { project } = props;
  // plane hooks
  const { t } = useTranslation();
  // store hooks
  const {
    getUserDetails,
    project: { getProjectMemberIds },
  } = useMember();
  // derived values
  const leadId = typeof project.project_lead === "string" ? project.project_lead : project.project_lead?.id;
  const lead = leadId ? getUserDetails(leadId) : undefined;
  const members = (getProjectMemberIds(project.id, true) ?? [])
    .map((memberId) => getUserDetails(memberId))
    .filter((member): member is NonNullable<typeof member> => !!member);
  const network = NETWORK_CHOICES.find((choice) => choice.key === project.network);
  const NetworkIcon = network?.iconKey === "Lock" ? Lock : Globe2;
  const description = project.description?.trim();
  const createdOn = renderFormattedDate(project.created_at);

  return (
    <section aria-labelledby="project-overview-title" className="relative">
      {/* cover, fading into the page so the title sits on the page background in light and dark mode */}
      <div className="relative h-36 w-full overflow-hidden rounded-xl md:h-44">
        <CoverImage src={project.cover_image_url} alt="" showDefaultWhenEmpty className="absolute inset-0 size-full" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-surface-1/20 to-surface-1" />
      </div>
      <div className="relative -mt-14 flex flex-col gap-4 px-1 md:-mt-16 md:px-6">
        <div className="flex items-end gap-4">
          <div className="grid size-16 flex-shrink-0 place-items-center rounded-xl border border-subtle bg-surface-1 shadow-raised-200 md:size-[72px]">
            <Logo logo={project.logo_props} size={32} />
          </div>
          <div className="flex min-w-0 flex-col gap-1 pb-1">
            <span className="font-mono w-fit rounded-sm bg-layer-2 px-1.5 py-0.5 text-11 font-medium text-tertiary">
              {project.identifier}
            </span>
            <h1 id="project-overview-title" className="truncate text-20 font-semibold text-primary md:text-24">
              {project.name}
            </h1>
          </div>
        </div>
        {description && <ProjectDescription text={description} />}
        <ul className="flex flex-wrap items-center gap-2">
          <StatChip
            tooltip={t("project_settings.members.project_lead")}
            icon={
              lead ? (
                <Avatar name={lead.display_name} src={getFileURL(lead.avatar_url)} size="sm" showTooltip={false} />
              ) : (
                <UserRound className="size-3.5 flex-shrink-0 text-tertiary" aria-hidden />
              )
            }
          >
            {lead ? lead.display_name : t("project_overview.hero.no_lead")}
          </StatChip>
          <StatChip
            tooltip={t("common.members")}
            icon={
              members.length > 0 ? (
                <AvatarGroup size="sm" max={3} showTooltip={false}>
                  {members.map((member) => (
                    <Avatar key={member.id} name={member.display_name} src={getFileURL(member.avatar_url)} />
                  ))}
                </AvatarGroup>
              ) : (
                <Users className="size-3.5 flex-shrink-0 text-tertiary" aria-hidden />
              )
            }
          >
            {t("project_overview.hero.members", { count: members.length })}
          </StatChip>
          {network && (
            <StatChip
              tooltip={t(network.description)}
              icon={<NetworkIcon className="size-3.5 flex-shrink-0 text-tertiary" aria-hidden />}
            >
              {t(network.i18n_label)}
            </StatChip>
          )}
          {createdOn && (
            <StatChip
              tooltip={t("common.created_on")}
              icon={<CalendarDays className="size-3.5 flex-shrink-0 text-tertiary" aria-hidden />}
            >
              {t("project_overview.hero.created", { date: createdOn })}
            </StatChip>
          )}
        </ul>
      </div>
    </section>
  );
});
