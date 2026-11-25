/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback } from "react";
import { observer } from "mobx-react";
import { useSearchParams } from "next/navigation";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Logo } from "@plane/propel/emoji-icon-picker";
import { ProjectIcon } from "@plane/propel/icons";
import type { TUserWorkPeriod } from "@plane/types";
import { CustomSearchSelect, CustomSelect } from "@plane/ui";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useAppRouter } from "@/hooks/use-app-router";
import { useQueryParams } from "@/hooks/use-query-params";
// local imports
import { PERIODS } from "../helpers";

/** Filters live in the URL, so a view can be shared and survives a reload. */
export const useUrlFilters = () => {
  const router = useAppRouter();
  const searchParams = useSearchParams();
  const { updateQueryParams } = useQueryParams();

  const setParams = useCallback(
    (changes: Record<string, string | null>) => {
      const paramsToAdd: Record<string, string> = {};
      const paramsToRemove: string[] = [];
      for (const [key, value] of Object.entries(changes)) {
        if (value) paramsToAdd[key] = value;
        else paramsToRemove.push(key);
      }
      router.replace(updateQueryParams({ paramsToAdd, paramsToRemove }));
    },
    [router, updateQueryParams]
  );

  return { searchParams, setParams };
};

export function PeriodSelect({
  value,
  onChange,
}: {
  value: TUserWorkPeriod;
  onChange: (period: TUserWorkPeriod) => void;
}) {
  const { t } = useTranslation();
  return (
    <CustomSelect
      value={value}
      onChange={onChange}
      label={t("users_work.filters.period", { days: value })}
      buttonClassName="h-8"
      input
    >
      {PERIODS.map((period) => (
        <CustomSelect.Option key={period} value={period}>
          {t("users_work.filters.period", { days: period })}
        </CustomSelect.Option>
      ))}
    </CustomSelect>
  );
}

type ProjectFilterProps = {
  value: string[];
  onChange: (projectIds: string[]) => void;
};

/** Projects of the workspace. Admins see private ones too, as on the projects page. */
export const ProjectFilter = observer(function ProjectFilter({ value, onChange }: ProjectFilterProps) {
  const { t } = useTranslation();
  const { workspaceProjectIds, getPartialProjectById } = useProject();

  const projects = (workspaceProjectIds ?? [])
    .map((id) => getPartialProjectById(id))
    .filter((project): project is NonNullable<typeof project> => Boolean(project) && !project?.archived_at);

  const label = () => {
    if (value.length === 0) return t("users_work.filters.all_projects");
    const selected = value.length === 1 ? getPartialProjectById(value[0]) : undefined;
    return selected?.name ?? t("users_work.filters.projects_count", { count: value.length });
  };

  return (
    <CustomSearchSelect
      value={value}
      onChange={(ids: string[]) => onChange(ids)}
      options={projects.map((project) => ({
        value: project.id,
        query: `${project.name} ${project.identifier}`,
        content: (
          <span className="flex max-w-64 items-center gap-2">
            {project.logo_props ? <Logo logo={project.logo_props} size={14} /> : <ProjectIcon className="size-3.5" />}
            <span className="truncate">{project.name}</span>
          </span>
        ),
      }))}
      label={
        <span className="flex max-w-48 items-center gap-1.5">
          <ProjectIcon className="size-3.5 flex-shrink-0 text-tertiary" />
          <span className="truncate">{label()}</span>
        </span>
      }
      buttonClassName="h-8"
      multiple
      input
    />
  );
});
