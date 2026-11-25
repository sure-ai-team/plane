/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
import useSWR from "swr";
import { Pin } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
// components
import { useStickyLiveUpdates } from "@/components/stickies/hooks/use-sticky-live-updates";
import { StickiesLayout } from "@/components/stickies/layout/stickies-list";
// hooks
import { useSticky } from "@/hooks/use-stickies";

type Props = {
  workspaceSlug: string;
  projectId: string;
};

export const ProjectPinnedStickies = observer(function ProjectPinnedStickies(props: Props) {
  const { workspaceSlug, projectId } = props;
  // plane hooks
  const { t } = useTranslation();
  // store hooks
  const { fetchStickies, fetchNextStickies, getList } = useSticky();
  // derived values
  const scope = { workspaceSlug, projectId, isPinned: true };
  const { loader, paginationInfo } = getList(scope);

  useStickyLiveUpdates(scope);

  // other people pin stickies too, so they are fetched on every visit
  useSWR(`PROJECT_PINNED_STICKIES_${workspaceSlug}_${projectId}`, () => fetchStickies(scope), {
    revalidateIfStale: true,
    revalidateOnFocus: false,
  });

  return (
    <section aria-labelledby="pinned-stickies" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="pinned-stickies" className="text-14 font-semibold text-primary">
          {t("stickies.overview.pinned")}
        </h2>
        <Link
          href={`/${workspaceSlug}/projects/${projectId}/stickies/`}
          className="text-13 font-medium text-accent-primary"
        >
          {t("stickies.overview.view_all")}
        </Link>
      </div>
      <div className="-mx-2">
        <StickiesLayout
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          isPinned
          emptyState={
            <div className="mx-2 flex flex-col items-center gap-1 rounded-lg border border-dashed border-subtle px-4 py-10 text-center">
              <Pin className="mb-1 size-5 text-tertiary" aria-hidden />
              <p className="text-13 font-medium text-secondary">{t("stickies.overview.empty.title")}</p>
              <p className="text-13 text-tertiary">{t("stickies.overview.empty.description")}</p>
            </div>
          }
        />
      </div>
      {paginationInfo?.next_page_results && (
        <Button
          variant="secondary"
          size="lg"
          className="mx-auto"
          loading={loader === "pagination"}
          onClick={() => void fetchNextStickies(scope)}
        >
          {t("common.load_more")}
        </Button>
      )}
    </section>
  );
});
