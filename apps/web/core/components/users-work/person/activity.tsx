/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { MessageSquare } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { Tooltip } from "@plane/propel/tooltip";
import type { TReportExportFormat, TUserWorkActivity, TUserWorkActivityResponse, TUserWorkFilters } from "@plane/types";
import { Loader } from "@plane/ui";
import { calculateTimeAgo, getDate, renderFormattedDate, renderFormattedPayloadDate } from "@plane/utils";
// components
import { ActivityIcon, ActivityMessage, IssueLink } from "@/components/core/activity";
import { DateRangeDropdown } from "@/components/dropdowns/date-range";
import { ReportExportMenu } from "@/components/report-charts";
// services
import { userWorkService } from "@/services/user-work.service";
// local imports
import { LoadError, MutedCard, Section, SectionLink } from "../common/primitives";
import { commentText, exportLabels } from "../helpers";

const PER_PAGE = 50;
const LATEST = 5;

/** Fields whose values the API leaves out where the viewer has not joined the project. */
const hasHiddenValues = (activity: TUserWorkActivity) =>
  !activity.can_open && activity.old_value === null && activity.new_value === null;

function ActivityText({ activity }: { activity: TUserWorkActivity }) {
  const { t } = useTranslation();
  // Comments of deleted or hidden text still tell that something was said.
  if (activity.field === "comment") {
    const text = activity.verb === "deleted" ? "" : commentText(activity.new_value || activity.old_value);
    return (
      <>
        {t("users_work.activity.commented")} <IssueLink activity={activity} />
        {text && <span className="mt-0.5 line-clamp-2 block break-words text-tertiary">{text}</span>}
      </>
    );
  }
  if (!activity.field && activity.verb === "created")
    return (
      <>
        {t("users_work.activity.created")} <IssueLink activity={activity} />
      </>
    );
  if (hasHiddenValues(activity))
    return (
      <>
        {t("users_work.activity.updated")} <IssueLink activity={activity} />
      </>
    );
  return <ActivityMessage activity={activity} showIssue />;
}

function ActivityEntry({ activity }: { activity: TUserWorkActivity }) {
  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <span className="mt-0.5 grid size-5 flex-shrink-0 place-items-center rounded-full bg-layer-2">
        {activity.field === "comment" ? (
          <MessageSquare className="size-3 text-secondary" aria-hidden="true" />
        ) : (
          <ActivityIcon activity={activity} />
        )}
      </span>
      <span className="min-w-0 flex-1 text-13 text-secondary">
        <ActivityText activity={activity} />
      </span>
      <Tooltip tooltipContent={renderFormattedDate(activity.created_at)}>
        <span className="flex-shrink-0 text-12 text-tertiary">{calculateTimeAgo(activity.created_at)}</span>
      </Tooltip>
    </li>
  );
}

function ActivityList({ activities }: { activities: TUserWorkActivity[] }) {
  return (
    <ul className="divide-y divide-subtle rounded-lg border border-subtle">
      {activities.map((activity) => (
        <ActivityEntry key={activity.id} activity={activity} />
      ))}
    </ul>
  );
}

type LatestProps = { workspaceSlug: string; userId: string; project: string; href: string };

export function LatestActivity({ workspaceSlug, userId, project, href }: LatestProps) {
  const { t } = useTranslation();
  const { data, error, mutate } = useSWR(["USER_WORK_LATEST_ACTIVITY", workspaceSlug, userId, project], () =>
    userWorkService.activity(workspaceSlug, userId, { ...(project ? { project } : {}), per_page: LATEST })
  );

  return (
    <Section
      title={t("users_work.activity.title")}
      action={<SectionLink href={href}>{t("users_work.activity.see_all")}</SectionLink>}
    >
      {error && !data ? (
        <LoadError onRetry={() => void mutate()} />
      ) : !data ? (
        <Loader>
          <Loader.Item height="120px" />
        </Loader>
      ) : data.results.length === 0 ? (
        <MutedCard>{t("users_work.activity.empty")}</MutedCard>
      ) : (
        <ActivityList activities={data.results} />
      )}
    </Section>
  );
}

type Props = {
  workspaceSlug: string;
  userId: string;
  filters: TUserWorkFilters;
  setParams: (changes: Record<string, string | null>) => void;
};

export function UserWorkActivityTab({ workspaceSlug, userId, filters, setParams }: Props) {
  const { t } = useTranslation();
  const params = {
    ...(filters.projects.length > 0 ? { project: filters.projects.join(",") } : {}),
    ...(filters.start ? { start: filters.start } : {}),
    ...(filters.end ? { end: filters.end } : {}),
  };
  const query = JSON.stringify(params);
  const isFiltered = query !== "{}";

  const { data, error, size, setSize, mutate, isValidating } = useSWRInfinite(
    (index: number, previous: TUserWorkActivityResponse | null) =>
      previous && !previous.has_more ? null : ["USER_WORK_ACTIVITY", workspaceSlug, userId, query, index + 1],
    ([, , , , page]: [string, string, string, string, number]) =>
      userWorkService.activity(workspaceSlug, userId, { ...params, page, per_page: PER_PAGE }),
    { keepPreviousData: true, revalidateAll: true, revalidateOnFocus: false }
  );

  const activities = data?.flatMap((page) => page.results) ?? [];

  const exportActivity = (format: TReportExportFormat) =>
    userWorkService.exportPerson(workspaceSlug, userId, { ...params, format, type: "activity" }, exportLabels(t));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <DateRangeDropdown
          buttonVariant="border-with-text"
          className="h-8"
          value={{ from: getDate(filters.start), to: getDate(filters.end) }}
          onSelect={(range) =>
            setParams({
              start: (range?.from && renderFormattedPayloadDate(range.from)) || null,
              end: (range?.to && renderFormattedPayloadDate(range.to)) || null,
            })
          }
          placeholder={{ from: t("users_work.filters.date_from"), to: t("users_work.filters.date_to") }}
          hideIcon={{ to: true }}
          isClearable
        />
        <div className="ml-auto">
          <ReportExportMenu onExport={exportActivity} disabled={activities.length === 0} />
        </div>
      </div>
      {error && !data ? (
        <LoadError onRetry={() => void mutate()} />
      ) : !data ? (
        <Loader className="space-y-2">
          {Array.from({ length: 6 }, (_, index) => (
            <Loader.Item key={index} height="40px" />
          ))}
        </Loader>
      ) : activities.length === 0 ? (
        <MutedCard>{t(isFiltered ? "users_work.activity.empty_filtered" : "users_work.activity.empty")}</MutedCard>
      ) : (
        <ActivityList activities={activities} />
      )}
      {data?.[data.length - 1]?.has_more && (
        <div className="flex justify-center">
          <Button variant="secondary" loading={isValidating} onClick={() => void setSize(size + 1)}>
            {t("users_work.items.load_more")}
          </Button>
        </div>
      )}
    </div>
  );
}
