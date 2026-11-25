/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import useSWRInfinite from "swr/infinite";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { ChevronRightIcon, StateGroupIcon } from "@plane/propel/icons";
import type {
  TReportExportFormat,
  TStateGroups,
  TUserWorkFilters,
  TUserWorkFocus,
  TUserWorkItemsResponse,
} from "@plane/types";
import { CustomSelect, Loader } from "@plane/ui";
import { cn } from "@plane/utils";
// components
import { IssuePeekOverview } from "@/components/issues/peek-overview";
import { ReportExportMenu } from "@/components/report-charts";
// services
import { userWorkService } from "@/services/user-work.service";
// local imports
import { HiddenProjects, WorkItemEntry, useRefreshAfterPeek } from "../common/items";
import { LoadError } from "../common/primitives";
import { FOCUSES, OPEN_STATE_GROUPS, STATE_GROUP_ORDER, exportLabels, userParams } from "../helpers";

const PER_PAGE = 25;
const KEY = "USER_WORK_ITEMS";

type GroupProps = {
  workspaceSlug: string;
  userId: string;
  group: TStateGroups;
  filters: TUserWorkFilters;
  /** Changes when the lists must be loaded again. */
  version: number;
  onJoined: () => void;
};

function StateGroupSection(props: GroupProps) {
  const { workspaceSlug, userId, group, filters, version, onJoined } = props;
  const { t } = useTranslation();
  // Cancelled work is rarely what an admin looks for.
  const [isOpen, setIsOpen] = useState(group !== "cancelled");
  const params = { ...userParams(filters), state_group: group, ...(filters.focus ? { focus: filters.focus } : {}) };
  const query = JSON.stringify(params);
  const isBoard = filters.layout === "board";

  const { data, error, size, setSize, mutate, isValidating } = useSWRInfinite(
    (index: number, previous: TUserWorkItemsResponse | null) =>
      previous && !previous.has_more ? null : [KEY, workspaceSlug, userId, query, version, index + 1],
    ([, , , , , page]: [string, string, string, string, number, number]) =>
      userWorkService.items(workspaceSlug, userId, { ...params, page, per_page: PER_PAGE }),
    { keepPreviousData: true, revalidateAll: true, revalidateOnFocus: false }
  );
  useRefreshAfterPeek(() => void mutate());

  const items = data?.flatMap((page) => page.results) ?? [];
  const last = data?.[data.length - 1];
  const hidden = data?.[0]?.hidden_projects ?? [];
  const label = t(`users_work.state_groups.${group}`);

  const content =
    error && !data ? (
      <LoadError onRetry={() => void mutate()} />
    ) : !data ? (
      <Loader className="space-y-2">
        <Loader.Item height="40px" />
        <Loader.Item height="40px" />
      </Loader>
    ) : (
      <div className="flex flex-col gap-2">
        {items.length === 0 && hidden.length === 0 && (
          <p className="px-1 py-2 text-13 text-placeholder">
            {t(filters.focus ? "users_work.items.empty_filtered" : "users_work.items.empty")}
          </p>
        )}
        {items.length > 0 && (
          <div className={isBoard ? "flex flex-col gap-2" : "rounded-lg border border-subtle"}>
            {items.map((item) => (
              <WorkItemEntry
                key={item.id}
                workspaceSlug={workspaceSlug}
                item={item}
                onJoined={onJoined}
                variant={isBoard ? "card" : "row"}
              />
            ))}
          </div>
        )}
        {last?.has_more && (
          <Button variant="ghost" loading={isValidating} onClick={() => void setSize(size + 1)}>
            {t("users_work.items.load_more")}
          </Button>
        )}
        <HiddenProjects workspaceSlug={workspaceSlug} projects={hidden} onJoined={onJoined} />
      </div>
    );

  // Titles the viewer may not see are still part of the number.
  const count = last ? last.total + hidden.reduce((sum, project) => sum + project.count, 0) : null;

  if (isBoard)
    return (
      <section className="flex w-72 flex-shrink-0 flex-col gap-2 rounded-lg bg-layer-1 p-3" aria-label={label}>
        <h3 className="flex items-center gap-2 text-13 font-medium text-primary">
          <StateGroupIcon stateGroup={group} className="size-3.5" />
          {label}
          <span className="text-tertiary tabular-nums">{count ?? ""}</span>
        </h3>
        {content}
      </section>
    );

  return (
    <section className="flex flex-col gap-2" aria-label={label}>
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        aria-expanded={isOpen}
        className="flex items-center gap-2 text-left text-13 font-medium text-primary"
      >
        <ChevronRightIcon className={cn("size-3.5 text-tertiary transition-transform", { "rotate-90": isOpen })} />
        <StateGroupIcon stateGroup={group} className="size-3.5" />
        {label}
        <span className="text-tertiary tabular-nums">{count ?? ""}</span>
      </button>
      {isOpen && content}
    </section>
  );
}

type Props = {
  workspaceSlug: string;
  userId: string;
  filters: TUserWorkFilters;
  setParams: (changes: Record<string, string | null>) => void;
};

export function UserWorkItemsTab({ workspaceSlug, userId, filters, setParams }: Props) {
  const { t } = useTranslation();
  // Joining a project changes what every group may show.
  const [version, setVersion] = useState(0);
  // Every focus is about open work.
  const groups = filters.focus ? OPEN_STATE_GROUPS : STATE_GROUP_ORDER;

  const exportItems = (format: TReportExportFormat) =>
    userWorkService.exportPerson(
      workspaceSlug,
      userId,
      { ...userParams(filters), ...(filters.focus ? { focus: filters.focus } : {}), format, type: "items" },
      exportLabels(t)
    );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <CustomSelect
          value={filters.focus ?? "all"}
          onChange={(focus: TUserWorkFocus | "all") => setParams({ focus: focus === "all" ? null : focus })}
          label={filters.focus ? t(`users_work.stats.${filters.focus}`) : t("users_work.items.all")}
          buttonClassName="h-8"
          input
        >
          <CustomSelect.Option value="all">{t("users_work.items.all")}</CustomSelect.Option>
          {FOCUSES.map((focus) => (
            <CustomSelect.Option key={focus} value={focus}>
              {t(`users_work.stats.${focus}`)}
            </CustomSelect.Option>
          ))}
        </CustomSelect>
        <div className="flex rounded-md border border-subtle p-0.5" role="group">
          {(["list", "board"] as const).map((layout) => (
            <button
              key={layout}
              type="button"
              aria-pressed={filters.layout === layout}
              onClick={() => setParams({ layout: layout === "list" ? null : layout })}
              className={cn("rounded-sm px-2.5 py-1 text-12 font-medium", {
                "bg-layer-3 text-primary": filters.layout === layout,
                "text-tertiary hover:text-primary": filters.layout !== layout,
              })}
            >
              {t(`users_work.items.${layout}`)}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          <ReportExportMenu onExport={exportItems} />
        </div>
      </div>
      <div
        className={filters.layout === "board" ? "flex items-start gap-3 overflow-x-auto pb-2" : "flex flex-col gap-5"}
      >
        {groups.map((group) => (
          <StateGroupSection
            key={group}
            workspaceSlug={workspaceSlug}
            userId={userId}
            group={group}
            filters={filters}
            version={version}
            onJoined={() => setVersion((value) => value + 1)}
          />
        ))}
      </div>
      <IssuePeekOverview />
    </div>
  );
}
