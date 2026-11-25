/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWRInfinite from "swr/infinite";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import type { TUserWorkBucket, TUserWorkItemsResponse } from "@plane/types";
import { Loader } from "@plane/ui";
// components
import { IssuePeekOverview } from "@/components/issues/peek-overview";
// services
import { userWorkService } from "@/services/user-work.service";
// local imports
import { ProjectFilter, useUrlFilters } from "../common/filters";
import { HiddenProjects, WorkItemEntry, useRefreshAfterPeek } from "../common/items";
import { LoadError, MutedCard } from "../common/primitives";
import { parseTeamFilters } from "../helpers";

type Props = { workspaceSlug: string; bucket: TUserWorkBucket };

/** Open work that nobody in the team is taking care of. */
export function NeglectedItems({ workspaceSlug, bucket }: Props) {
  const { t } = useTranslation();
  const { searchParams, setParams } = useUrlFilters();
  const { projects } = parseTeamFilters(searchParams);
  const project = projects.join(",");

  const { data, error, size, setSize, mutate, isValidating } = useSWRInfinite(
    (index: number, previous: TUserWorkItemsResponse | null) =>
      previous && !previous.has_more ? null : ["USERS_WORK_ITEMS", workspaceSlug, bucket, project, index + 1],
    ([, , , , page]: [string, string, string, string, number]) =>
      userWorkService.neglectedItems(workspaceSlug, bucket, { ...(project ? { project } : {}), page, per_page: 50 }),
    { revalidateAll: true, revalidateOnFocus: false }
  );
  const refresh = () => void mutate();
  useRefreshAfterPeek(refresh);

  const items = data?.flatMap((page) => page.results) ?? [];
  const last = data?.[data.length - 1];

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-y-auto px-4 py-4 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/${workspaceSlug}/users`}
            className="mb-1 inline-flex items-center gap-1 text-12 text-tertiary hover:text-primary"
          >
            <ArrowLeft className="size-3" aria-hidden="true" />
            {t("users_work.neglected.back")}
          </Link>
          <h2 className="text-16 font-medium text-primary">{t(`users_work.neglected.${bucket}_title`)}</h2>
          <p className="text-13 text-tertiary">{t(`users_work.neglected.${bucket}_description`)}</p>
        </div>
        <ProjectFilter value={projects} onChange={(ids) => setParams({ project: ids.join(",") || null })} />
      </div>

      {error && !data ? (
        <LoadError onRetry={refresh} />
      ) : !data ? (
        <Loader className="space-y-2">
          {Array.from({ length: 6 }, (_, index) => (
            <Loader.Item key={index} height="40px" />
          ))}
        </Loader>
      ) : (
        <>
          {items.length > 0 ? (
            <div className="rounded-lg border border-subtle">
              {items.map((item) => (
                <WorkItemEntry key={item.id} workspaceSlug={workspaceSlug} item={item} onJoined={refresh} />
              ))}
            </div>
          ) : (
            (data[0]?.hidden_projects ?? []).length === 0 && (
              <MutedCard>{t(`users_work.neglected.${bucket}_empty`)}</MutedCard>
            )
          )}
          {last?.has_more && (
            <div className="flex justify-center">
              <Button variant="secondary" loading={isValidating} onClick={() => void setSize(size + 1)}>
                {t("users_work.items.load_more")}
              </Button>
            </div>
          )}
          <HiddenProjects workspaceSlug={workspaceSlug} projects={data[0]?.hidden_projects ?? []} onJoined={refresh} />
        </>
      )}
      <IssuePeekOverview />
    </div>
  );
}
