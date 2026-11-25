/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Fragment } from "react";
import { Lock } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Logo } from "@plane/propel/emoji-icon-picker";
import { Tooltip } from "@plane/propel/tooltip";
import type { TUserWorkCycles, TUserWorkProject, TUserWorkSummary } from "@plane/types";
import { cn, renderFormattedDate, renderFormattedDateWithoutYear } from "@plane/utils";
// local imports
import { WorkItemEntry } from "../common/items";
import { MutedCard, RoleBadge, Section, SectionLink, StatTile, StateGroupBar } from "../common/primitives";
import { percentage } from "../helpers";
import { CycleCard } from "./cycles";

type StatsProps = {
  summary: TUserWorkSummary;
  /** Link to the Work tab with a filter, when the viewer has that tab. */
  workHref?: (focus?: string) => string;
};

export function WorkStats({ summary, workHref }: StatsProps) {
  const { t } = useTranslation();
  const { stats, period } = summary;
  const onTime = stats.on_time_total > 0 ? `${percentage(stats.on_time, stats.on_time_total)}%` : "–";

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label={t("users_work.stats.open")} value={stats.open} href={workHref?.()} />
        <StatTile label={t("users_work.stats.in_progress")} value={stats.in_progress} href={workHref?.()} />
        <StatTile
          label={t("users_work.stats.overdue")}
          value={stats.overdue}
          isAlert={stats.overdue > 0}
          href={workHref?.("overdue")}
        />
        <StatTile label={t("users_work.stats.due_soon")} value={stats.due_soon} href={workHref?.("due_soon")} />
        <StatTile label={t("users_work.stats.stuck")} value={stats.stuck} href={workHref?.("stuck")} />
        <StatTile
          label={t("users_work.stats.no_due_date")}
          value={stats.no_due_date}
          href={workHref?.("no_due_date")}
        />
        <StatTile label={t("users_work.stats.done", { days: period })} value={stats.done} />
        <StatTile
          label={t("users_work.stats.on_time")}
          value={onTime}
          detail={
            stats.on_time_total > 0
              ? t("users_work.stats.on_time_detail", { on_time: stats.on_time, total: stats.on_time_total })
              : t("users_work.stats.on_time_none")
          }
        />
      </div>
      <StateGroupBar counts={summary.state_groups} />
    </div>
  );
}

type AttentionProps = {
  workspaceSlug: string;
  attention: TUserWorkSummary["attention"];
  onJoined: () => void;
  workHref?: string;
};

export function Attention({ workspaceSlug, attention, onJoined, workHref }: AttentionProps) {
  const { t } = useTranslation();
  return (
    <Section
      title={t("users_work.attention.title")}
      action={workHref && <SectionLink href={workHref}>{t("users_work.attention.see_all")}</SectionLink>}
    >
      {attention.total === 0 ? (
        <MutedCard>{t("users_work.attention.empty")}</MutedCard>
      ) : (
        <>
          {attention.items.length > 0 && (
            <div className="rounded-lg border border-subtle">
              {attention.items.map((item) => (
                <WorkItemEntry key={item.id} workspaceSlug={workspaceSlug} item={item} onJoined={onJoined} />
              ))}
            </div>
          )}
          {attention.hidden > 0 && (
            <p className="flex items-center gap-1.5 text-12 text-tertiary">
              <Lock className="size-3" aria-hidden="true" />
              {t("users_work.attention.hidden", { count: attention.hidden })}
            </p>
          )}
        </>
      )}
    </Section>
  );
}

/** Items completed per week. One series, so the title names it; the same numbers are in a table below. */
export function CompletionTrend({ trend }: { trend: TUserWorkSummary["trend"] }) {
  const { t } = useTranslation();
  const highest = Math.max(...trend.map((week) => week.completed), 0);
  const weekLabel = (week: string) => t("users_work.trend.week_of", { date: renderFormattedDate(week) ?? week });

  return (
    <Section title={t("users_work.trend.title")}>
      {highest === 0 ? (
        <MutedCard>{t("users_work.trend.empty")}</MutedCard>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border border-subtle px-4 py-3">
          <div className="flex h-28 items-stretch gap-1" aria-hidden="true">
            {trend.map((week) => (
              <Tooltip key={week.week} tooltipHeading={weekLabel(week.week)} tooltipContent={String(week.completed)}>
                <div className="flex min-w-0 flex-1 flex-col justify-end gap-1 rounded-sm hover:bg-layer-1">
                  {week.completed === highest && (
                    <span className="text-center text-11 text-tertiary tabular-nums">{week.completed}</span>
                  )}
                  <div
                    className={cn("mx-auto w-full max-w-6 rounded-t-sm", {
                      "bg-accent-primary": week.completed > 0,
                      "bg-layer-3": week.completed === 0,
                    })}
                    // 75%: the highest bar leaves room for its number.
                    style={{ height: week.completed > 0 ? `${(week.completed / highest) * 75}%` : "2px" }}
                  />
                </div>
              </Tooltip>
            ))}
          </div>
          <div className="flex justify-between text-11 text-tertiary" aria-hidden="true">
            <span>{renderFormattedDateWithoutYear(trend[0].week)}</span>
            <span>{renderFormattedDateWithoutYear(trend[trend.length - 1].week)}</span>
          </div>
          <details className="text-12 text-secondary">
            <summary className="cursor-pointer text-tertiary hover:text-primary">{t("users_work.trend.table")}</summary>
            <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
              {trend.map((week) => (
                <Fragment key={week.week}>
                  <dt>{weekLabel(week.week)}</dt>
                  <dd className="text-right tabular-nums">{week.completed}</dd>
                </Fragment>
              ))}
            </dl>
          </details>
        </div>
      )}
    </Section>
  );
}

type CyclesProps = { workspaceSlug: string; cycles: TUserWorkCycles; href?: string };

export function ActiveCycles({ workspaceSlug, cycles, href }: CyclesProps) {
  const { t } = useTranslation();
  return (
    <Section
      title={t("users_work.cycles.active")}
      action={href && <SectionLink href={href}>{t("users_work.tabs.cycles")}</SectionLink>}
    >
      {cycles.active.length === 0 ? (
        <MutedCard>{t("users_work.cycles.active_empty")}</MutedCard>
      ) : (
        <div className="flex flex-col gap-2">
          {cycles.active.slice(0, 3).map((cycle) => (
            <CycleCard key={cycle.id} workspaceSlug={workspaceSlug} cycle={cycle} />
          ))}
        </div>
      )}
    </Section>
  );
}

export function ProjectWork({ projects }: { projects: TUserWorkProject[] }) {
  const { t } = useTranslation();
  const columns = ["open", "in_progress", "overdue", "done"] as const;

  return (
    <Section title={t("users_work.projects.title")}>
      {projects.length === 0 ? (
        <MutedCard>{t("users_work.projects.empty")}</MutedCard>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-subtle">
          <table className="w-full min-w-[480px] text-13">
            <thead className="border-b border-subtle bg-layer-1 text-tertiary">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  {t("users_work.columns.project")}
                </th>
                {columns.map((column) => (
                  <th key={column} scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap">
                    {t(`users_work.columns.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id} className="border-b border-subtle last:border-b-0">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      {project.logo_props && <Logo logo={project.logo_props} size={14} />}
                      <span className="truncate text-primary">{project.name}</span>
                      {!project.can_read && (
                        <Lock
                          className="size-3 flex-shrink-0 text-tertiary"
                          aria-label={t("users_work.projects.private")}
                        />
                      )}
                      {project.role === null ? (
                        <span className="text-11 whitespace-nowrap text-tertiary">
                          {t("users_work.projects.former")}
                        </span>
                      ) : (
                        <RoleBadge role={project.role} />
                      )}
                    </span>
                  </td>
                  {columns.map((column) => (
                    <td
                      key={column}
                      className={cn("px-3 py-2 text-right tabular-nums", {
                        "text-placeholder": project[column] === 0,
                        "text-danger-primary": column === "overdue" && project[column] > 0,
                      })}
                    >
                      {project[column]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
