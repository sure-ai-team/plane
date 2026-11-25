/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef, useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { STICKIES_PER_PAGE } from "@plane/constants";
import type { TStickyScope } from "@plane/types";
import { ContentWrapper, Loader } from "@plane/ui";
import { cn } from "@plane/utils";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useSticky } from "@/hooks/use-stickies";
import { StickiesLayout } from "./stickies-list";

export const StickiesInfinite = observer(function StickiesInfinite(props: TStickyScope) {
  const { workspaceSlug, projectId } = props;
  // hooks
  const { fetchStickies, fetchNextStickies, getList, getStickyIds } = useSticky();
  // derived values
  const scope = { workspaceSlug, projectId };
  const { loader, paginationInfo } = getList(scope);
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
