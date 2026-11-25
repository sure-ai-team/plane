/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import Link from "next/link";
import useSWR from "swr";
import { Lock } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Badge } from "@plane/propel/badge";
import { Logo } from "@plane/propel/emoji-icon-picker";
import type { TUserWorkCycle, TUserWorkFilters } from "@plane/types";
import { Loader } from "@plane/ui";
import { renderFormattedDate } from "@plane/utils";
// services
import { userWorkService } from "@/services/user-work.service";
// local imports
import { LoadError, MutedCard, ProgressBar, Section } from "../common/primitives";
import { userParams } from "../helpers";

type CycleCardProps = { workspaceSlug: string; cycle: TUserWorkCycle };

export function CycleCard({ workspaceSlug, cycle }: CycleCardProps) {
  const { t } = useTranslation();
  const progress = t("users_work.cycles.progress", { done: cycle.done, total: cycle.total });
  const name = cycle.can_open ? (
    <Link
      href={`/${workspaceSlug}/projects/${cycle.project_id}/cycles/${cycle.id}`}
      className="truncate text-13 font-medium text-primary hover:underline"
    >
      {cycle.name}
    </Link>
  ) : (
    <span className="truncate text-13 font-medium text-primary">{cycle.name}</span>
  );

  return (
    <article className="flex flex-col gap-2 rounded-lg border border-subtle px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          {cycle.project_logo_props && <Logo logo={cycle.project_logo_props} size={14} />}
          {name}
          <span className="truncate text-12 text-tertiary">{cycle.project_name}</span>
        </span>
        <span className="text-12 whitespace-nowrap text-tertiary">
          {cycle.days_left !== null && t("users_work.cycles.days_left", { count: cycle.days_left })}
          {cycle.days_to_start !== null && t("users_work.cycles.starts_in", { count: cycle.days_to_start })}
        </span>
      </div>
      <ProgressBar done={cycle.done} total={cycle.total} label={progress} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-12 text-secondary">
        <span className="font-medium">{progress}</span>
        {cycle.points > 0 && (
          <span>{t("users_work.cycles.points", { done: cycle.points_done, total: cycle.points })}</span>
        )}
        {cycle.in_progress > 0 && <span>{t("users_work.cycles.in_progress", { count: cycle.in_progress })}</span>}
        {cycle.not_started > 0 && <span>{t("users_work.cycles.not_started", { count: cycle.not_started })}</span>}
        {cycle.overdue > 0 && (
          <Badge variant="danger">{t("users_work.cycles.overdue", { count: cycle.overdue })}</Badge>
        )}
        <span className="ml-auto text-tertiary">
          {renderFormattedDate(cycle.start_date)} – {renderFormattedDate(cycle.end_date)}
        </span>
      </div>
    </article>
  );
}

type Props = { workspaceSlug: string; userId: string; filters: TUserWorkFilters };

export function UserWorkCyclesTab({ workspaceSlug, userId, filters }: Props) {
  const { t } = useTranslation();
  const params = userParams(filters);
  const { data, error, mutate } = useSWR(
    ["USER_WORK_CYCLES", workspaceSlug, userId, JSON.stringify(params)],
    () => userWorkService.cycles(workspaceSlug, userId, params),
    { keepPreviousData: true }
  );

  if (error && !data) return <LoadError onRetry={() => void mutate()} />;
  if (!data)
    return (
      <Loader className="space-y-3">
        <Loader.Item height="88px" />
        <Loader.Item height="88px" />
      </Loader>
    );

  return (
    <div className="flex flex-col gap-6">
      {(["active", "upcoming"] as const).map((kind) => (
        <Section key={kind} title={t(`users_work.cycles.${kind}`)}>
          {data[kind].length === 0 ? (
            <MutedCard>{t(`users_work.cycles.${kind}_empty`)}</MutedCard>
          ) : (
            <div className="flex flex-col gap-2">
              {data[kind].map((cycle) => (
                <CycleCard key={cycle.id} workspaceSlug={workspaceSlug} cycle={cycle} />
              ))}
            </div>
          )}
        </Section>
      ))}
      {data.hidden > 0 && (
        <p className="flex items-center gap-1.5 text-12 text-tertiary">
          <Lock className="size-3" aria-hidden="true" />
          {t("users_work.cycles.hidden", { count: data.hidden })}
        </p>
      )}
    </div>
  );
}
