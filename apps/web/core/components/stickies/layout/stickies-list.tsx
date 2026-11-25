/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useTheme } from "next-themes";

// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { PlusIcon } from "@plane/propel/icons";
import { EUserWorkspaceRoles } from "@plane/types";
// assets
import darkStickiesAsset from "@/app/assets/empty-state/stickies/stickies-dark.webp?url";
import lightStickiesAsset from "@/app/assets/empty-state/stickies/stickies-light.webp?url";
import darkStickiesSearchAsset from "@/app/assets/empty-state/stickies/stickies-search-dark.webp?url";
import lightStickiesSearchAsset from "@/app/assets/empty-state/stickies/stickies-search-light.webp?url";
// components
import { DetailedEmptyState } from "@/components/empty-state/detailed-empty-state-root";
import { SimpleEmptyState } from "@/components/empty-state/simple-empty-state-root";
import { StickiesEmptyState } from "@/components/home/widgets/empty-states/stickies";
// hooks
import { useUserPermissions } from "@/hooks/store/user";
import { useSticky } from "@/hooks/use-stickies";
// local imports
import { useStickyOperations } from "../sticky/use-operations";
import { StickiesLoader } from "./stickies-loader";
import { StickiesMasonry } from "./stickies-masonry";
import type { TStickiesMasonryRef } from "./stickies-masonry";
import { StickyDNDWrapper } from "./sticky-dnd-wrapper";

type TStickiesLayout = {
  workspaceSlug: string;
  projectId?: string;
  /** the full page, where stickies can be reordered, as opposed to a widget or a modal */
  isStickiesPage?: boolean;
  /** only the stickies pinned to the project overview */
  isPinned?: boolean;
  /** shown instead of the default empty state */
  emptyState?: React.ReactNode;
  /** a sticky to scroll to and point out */
  linkedStickyId?: string;
  intersectionElement?: React.ReactNode | null;
};

type TProps = TStickiesLayout & {
  columnCount: number;
};

export const StickiesList = observer(function StickiesList(props: TProps) {
  const {
    workspaceSlug,
    projectId,
    isStickiesPage = false,
    isPinned,
    emptyState,
    linkedStickyId,
    intersectionElement,
    columnCount,
  } = props;
  // theme hook
  const { resolvedTheme } = useTheme();
  // plane hooks
  const { t } = useTranslation();
  // store hooks
  const { getList, getStickyIds, toggleShowNewSticky } = useSticky();
  const { allowPermissions } = useUserPermissions();
  // sticky operations
  const { stickyOperations } = useStickyOperations({ workspaceSlug, projectId });
  // derived values
  const { searchQuery, loader } = getList({ workspaceSlug, projectId, isPinned });
  const stickyIds = getStickyIds({ workspaceSlug, projectId, isPinned });
  const itemWidth = `${100 / columnCount}%`;
  const canCreateSticky = projectId
    ? allowPermissions(
        [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
        EUserPermissionsLevel.PROJECT,
        workspaceSlug,
        projectId
      )
    : allowPermissions(
        [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER, EUserWorkspaceRoles.GUEST],
        EUserPermissionsLevel.WORKSPACE
      );
  const stickiesResolvedPath = resolvedTheme === "light" ? lightStickiesAsset : darkStickiesAsset;
  const stickiesSearchResolvedPath = resolvedTheme === "light" ? lightStickiesSearchAsset : darkStickiesSearchAsset;
  const masonryRef = useRef<TStickiesMasonryRef | null>(null);

  const handleLayout = useCallback(() => masonryRef.current?.performLayout(), []);

  const handleDrop = useCallback(
    (sourceId: string, destinationId: string, edge: "left" | "right") =>
      void stickyOperations.updatePosition(sourceId, destinationId, edge),
    [stickyOperations]
  );

  if (loader === "init-loader") {
    return <StickiesLoader />;
  }

  if (loader === "loaded" && stickyIds.length === 0) {
    if (emptyState) return <>{emptyState}</>;
    return (
      <div className="grid size-full place-items-center">
        {isStickiesPage ? (
          <>
            {searchQuery ? (
              <SimpleEmptyState
                title={t("stickies.empty_state.search.title")}
                description={t("stickies.empty_state.search.description")}
                assetPath={stickiesSearchResolvedPath}
              />
            ) : (
              <DetailedEmptyState
                title={t(projectId ? "stickies.project.empty_state.title" : "stickies.empty_state.general.title")}
                description={t(
                  projectId ? "stickies.project.empty_state.description" : "stickies.empty_state.general.description"
                )}
                assetPath={stickiesResolvedPath}
                primaryButton={{
                  prependIcon: <PlusIcon className="size-4" />,
                  text: t("stickies.empty_state.general.primary_button.text"),
                  onClick: () => {
                    if (!projectId) toggleShowNewSticky(true);
                    void stickyOperations.create();
                  },
                  disabled: !canCreateSticky,
                }}
              />
            )}
          </>
        ) : (
          <StickiesEmptyState />
        )}
      </div>
    );
  }

  return (
    <div className="transition-opacity duration-300 ease-in-out">
      <StickiesMasonry ref={masonryRef}>
        {stickyIds.map((stickyId) => (
          <StickyDNDWrapper
            key={stickyId}
            stickyId={stickyId}
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            isStickiesPage={isStickiesPage}
            isLinked={stickyId === linkedStickyId}
            itemWidth={itemWidth}
            handleDrop={handleDrop}
            handleLayout={handleLayout}
          />
        ))}
        {intersectionElement && <div style={{ width: itemWidth }}>{intersectionElement}</div>}
      </StickiesMasonry>
    </div>
  );
});

const getColumnCount = (width: number | null): number => {
  if (width === null) return 4;

  if (width < 640) return 2; // sm
  if (width < 850) return 3; // md
  if (width < 1024) return 4; // lg
  if (width < 1280) return 5; // xl
  return 6; // 2xl and above
};

export function StickiesLayout(props: TStickiesLayout) {
  // states
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  // refs
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref?.current) return;

    setContainerWidth(ref?.current.offsetWidth);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    resizeObserver.observe(ref?.current);
    return () => resizeObserver.disconnect();
  }, []);

  const columnCount = getColumnCount(containerWidth);

  return (
    <div ref={ref} className="size-full">
      <StickiesList {...props} columnCount={columnCount} />
    </div>
  );
}
