/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { NETWORK_CHOICES } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Logo } from "@plane/propel/emoji-icon-picker";
import type { IProject } from "@plane/types";
import { Avatar, AvatarGroup } from "@plane/ui";
import { getFileURL, renderFormattedDate } from "@plane/utils";
// components
import { CoverImage } from "@/components/common/cover-image";
// hooks
import { useMember } from "@/hooks/store/use-member";

type Props = {
  project: IProject;
};

type TDetailProps = {
  label: string;
  children: React.ReactNode;
};

function Detail(props: TDetailProps) {
  const { label, children } = props;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-12 text-tertiary">{label}</dt>
      <dd className="flex h-6 items-center gap-1.5 truncate text-13 text-primary">{children}</dd>
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
  const description = project.description?.trim();

  return (
    <section className="overflow-hidden rounded-lg border border-subtle">
      <div className="relative h-36 w-full">
        <div className="absolute inset-0 z-[1] bg-gradient-to-t from-black/60 to-transparent" />
        <CoverImage src={project.cover_image_url} alt="" showDefaultWhenEmpty className="absolute inset-0 size-full" />
        <div className="absolute inset-x-0 bottom-4 z-[1] flex items-center gap-3 px-5">
          <div className="grid size-10 flex-shrink-0 place-items-center rounded-sm bg-white/10">
            <Logo logo={project.logo_props} size={20} />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-18 font-semibold text-on-color">{project.name}</h1>
            <p className="text-11 font-medium text-on-color">{project.identifier}</p>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-5 p-5">
        {description && <p className="text-13 break-words whitespace-pre-line text-secondary">{description}</p>}
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Detail label={t("project_settings.members.project_lead")}>
            {lead ? (
              <>
                <Avatar name={lead.display_name} src={getFileURL(lead.avatar_url)} size="sm" showTooltip={false} />
                <span className="truncate">{lead.display_name}</span>
              </>
            ) : (
              <span className="text-tertiary">—</span>
            )}
          </Detail>
          <Detail label={t("common.members")}>
            <AvatarGroup size="sm" max={4}>
              {members.map((member) => (
                <Avatar key={member.id} name={member.display_name} src={getFileURL(member.avatar_url)} />
              ))}
            </AvatarGroup>
            <span className="text-tertiary">{members.length}</span>
          </Detail>
          <Detail label={t("workspace_projects.network.label")}>{network ? t(network.i18n_label) : "—"}</Detail>
          <Detail label={t("common.created_on")}>{renderFormattedDate(project.created_at)}</Detail>
        </dl>
      </div>
    </section>
  );
});
