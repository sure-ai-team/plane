/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { forwardRef } from "react";
// ui
import { DragHandle } from "@plane/ui";
// helper
import { cn } from "@plane/utils";

type Props = {
  isDragging: boolean;
};

/** Shown while hovering the sticky; a handle, so that text in the sticky can still be selected. */
export const StickyItemDragHandle = forwardRef(function StickyItemDragHandle(
  props: Props,
  ref: React.ForwardedRef<HTMLButtonElement | null>
) {
  const { isDragging } = props;

  return (
    <div className="absolute top-2 left-1/2 z-[1] hidden -translate-x-1/2 rotate-90 text-placeholder group-hover/sticky-item:flex">
      <DragHandle ref={ref} className={cn("bg-transparent", { "cursor-grabbing": isDragging })} />
    </div>
  );
});
