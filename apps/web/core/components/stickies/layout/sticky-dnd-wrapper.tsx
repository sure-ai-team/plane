/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { attachClosestEdge, extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { observer } from "mobx-react";
// plane imports
import { cn } from "@plane/utils";
// hooks
import { useSticky } from "@/hooks/use-stickies";
// components
import { StickyNote } from "../sticky";
import { StickyItemDragHandle } from "../sticky/sticky-item-drag-handle";

type TDropEdge = "left" | "right";

type Props = {
  stickyId: string;
  workspaceSlug: string;
  projectId?: string;
  isStickiesPage: boolean;
  isLinked: boolean;
  itemWidth: string;
  handleDrop: (sourceId: string, destinationId: string, edge: TDropEdge) => void;
  handleLayout: () => void;
};

export const StickyDNDWrapper = observer(function StickyDNDWrapper(props: Props) {
  const { stickyId, workspaceSlug, projectId, isStickiesPage, isLinked, itemWidth, handleDrop, handleLayout } = props;
  // states
  const [isDragging, setIsDragging] = useState(false);
  const [dropEdge, setDropEdge] = useState<TDropEdge | null>(null);
  // refs
  const elementRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  // store hooks
  const { stickies } = useSticky();
  // derived values
  const canMove = isStickiesPage && (!projectId || (stickies[stickyId]?.my_permission ?? "view") !== "view");

  useEffect(() => {
    // after the layout has positioned the note
    if (isLinked) requestAnimationFrame(() => elementRef.current?.scrollIntoView({ block: "center" }));
  }, [isLinked]);

  useEffect(() => {
    const element = elementRef.current;
    const dragHandle = handleRef.current;
    if (!element || !dragHandle || !canMove) return;

    return draggable({
      element,
      dragHandle,
      getInitialData: () => ({ id: stickyId, type: "sticky" }),
      onDragStart: () => setIsDragging(true),
      onDrop: () => setIsDragging(false),
    });
  }, [canMove, stickyId]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || !isStickiesPage) return;

    return dropTargetForElements({
      element,
      canDrop: ({ source }) => source.data.type === "sticky" && source.data.id !== stickyId,
      getData: ({ input, element: target }) =>
        attachClosestEdge({ id: stickyId }, { input, element: target, allowedEdges: ["left", "right"] }),
      onDrag: ({ self }) => setDropEdge(extractClosestEdge(self.data) as TDropEdge | null),
      onDragLeave: () => setDropEdge(null),
      onDrop: ({ self, source }) => {
        const edge = extractClosestEdge(self.data) as TDropEdge | null;
        setDropEdge(null);
        if (edge) handleDrop(source.data.id as string, stickyId, edge);
      },
    });
  }, [handleDrop, isStickiesPage, stickyId]);

  return (
    <div
      ref={elementRef}
      className={cn("group/sticky-item box-border flex flex-col p-[8px]", { "opacity-50": isDragging })}
      style={{
        width: itemWidth,
      }}
    >
      {dropEdge && (
        <div
          className={cn(
            "absolute inset-y-2 w-0.5 rounded-full bg-accent-primary",
            dropEdge === "left" ? "left-[3px]" : "right-[3px]"
          )}
        />
      )}
      {canMove && <StickyItemDragHandle ref={handleRef} isDragging={isDragging} />}
      <StickyNote
        key={stickyId || "new"}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        stickyId={stickyId}
        className={cn({ "ring-2 ring-accent-strong": isLinked })}
        isStickiesPage={isStickiesPage}
        handleLayout={handleLayout}
      />
    </div>
  );
});
