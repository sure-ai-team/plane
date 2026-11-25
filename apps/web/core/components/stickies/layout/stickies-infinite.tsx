/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef, useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { STICKIES_PER_PAGE } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TStickyScope } from "@plane/types";
import { ContentWrapper, Loader } from "@plane/ui";
import { cn } from "@plane/utils";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useSticky } from "@/hooks/use-stickies";
import { useStickyLiveUpdates } from "../hooks/use-sticky-live-updates";
import { StickiesLayout } from "./stickies-list";

type TProps = TStickyScope & {
  /** a sticky to show even if it is not among those loaded first */
  linkedStickyId?: string;
};

export const StickiesInfinite = observer(function StickiesInfinite(props: TProps) {
  const { workspaceSlug, projectId, linkedStickyId } = props;
  // plane hooks
  const { t } = useTranslation();
  // hooks
  const { fetchStickies, fetchNextStickies, fetchSticky, getList, getStickyIds } = useSticky();
  // derived values
  const scope = { workspaceSlug, projectId };
  const { loader, paginationInfo } = getList(scope);

  useStickyLiveUpdates(scope);
  //state
  const [elementRef, setElementRef] = useState<HTMLDivElement | null>(null);

  // ref
  const containerRef = useRef<HTMLDivElement>(null);

  useSWR(
    projectId ? `PROJECT_STICKIES_${workspaceSlug}_${projectId}` : `WORKSPACE_STICKIES_${workspaceSlug}`,
    () => fetchStickies(scope),
    // other people change project stickies, so they are fetched on every visit
    { revalidateIfStale: !!projectId, revalidateOnFocus: false }
  );

  // once the list is there, which would replace it
  useSWR(
    linkedStickyId && loader === "loaded" ? `LINKED_STICKY_${workspaceSlug}_${linkedStickyId}` : null,
    () =>
      fetchSticky(scope, linkedStickyId ?? "").catch(() =>
        setToast({ type: TOAST_TYPE.ERROR, title: t("stickies.sharing.unavailable") })
      ),
    { revalidateIfStale: true, revalidateOnFocus: false, revalidateOnReconnect: false }
  );

  const handleLoadMore = () => {
    if (loader === "pagination") return;
    void fetchNextStickies(scope);
  };

  const hasNextPage = paginationInfo?.next_page_results && paginationInfo?.next_cursor !== undefined;
  const shouldObserve = hasNextPage && loader !== "pagination";
  const stickyIds = getStickyIds(scope);
  useIntersectionObserver(containerRef, shouldObserve ? elementRef : null, handleLoadMore);

  return (
    <ContentWrapper ref={containerRef} className="space-y-4">
      <StickiesLayout
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        isStickiesPage
        linkedStickyId={linkedStickyId}
        intersectionElement={
          hasNextPage &&
          stickyIds.length >= STICKIES_PER_PAGE && (
            <div
              className={cn("box-border flex min-h-[300px] w-full p-2")}
              ref={setElementRef}
              id="intersection-element"
            >
              <div className="flex min-h-[300px] w-full rounded-sm">
                <Loader className="h-full w-full">
                  <Loader.Item height="100%" width="100%" />
                </Loader>
              </div>
            </div>
          )
        }
      />
    </ContentWrapper>
  );
});
