/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { LucideIcon } from "lucide-react";

type Props = {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
};

/** Quiet, centered message for the README area (empty, unavailable, failed to load). */
export function ProjectReadmeMessage(props: Props) {
  const { icon: Icon, title, description, action } = props;
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-subtle px-6 py-14 text-center">
      <span className="mb-1 grid size-10 place-items-center rounded-full bg-layer-2 text-tertiary">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="text-14 font-medium text-primary">{title}</p>
      <p className="max-w-sm text-13 text-tertiary">{description}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
