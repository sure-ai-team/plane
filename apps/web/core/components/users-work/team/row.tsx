/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import Link from "next/link";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Tooltip } from "@plane/propel/tooltip";
import type { TTeamWorkRow, TUserWorkPeriod } from "@plane/types";
import { calculateTimeAgo, cn, renderFormattedDate } from "@plane/utils";
// local imports
import { PersonAvatar, RoleBadge, StatusBadge } from "../common/primitives";

function NumberCell({ value, isAlert }: { value: number; isAlert?: boolean }) {
  return (
    <td
      className={cn("px-3 py-2.5 text-right tabular-nums", {
        "text-placeholder": value === 0,
        "font-medium text-danger-primary": value > 0 && isAlert,
        "text-primary": value > 0 && !isAlert,
      })}
    >
      {value}
    </td>
  );
}

type Props = { workspaceSlug: string; row: TTeamWorkRow; period: TUserWorkPeriod };

export function TeamRow({ workspaceSlug, row, period }: Props) {
  const { t } = useTranslation();
  const isInvited = row.status === "invited";
  const href = `/${workspaceSlug}/users/${row.id}?period=${period}`;
  const hiddenCycles = row.hidden_cycles > 0 ? t("users_work.list.hidden_cycles", { count: row.hidden_cycles }) : null;

  const identity = (
    <span className="flex min-w-0 items-center gap-2.5">
      <PersonAvatar name={row.display_name} url={row.avatar_url} className="size-7 text-13" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-primary group-hover:underline">{row.name}</span>
        {row.email !== row.name && <span className="truncate text-12 text-tertiary">{row.email}</span>}
      </span>
    </span>
  );

  return (
    <tr className="border-b border-subtle last:border-b-0 hover:bg-layer-1">
      <td className="max-w-72 px-3 py-2.5">
        {isInvited ? (
          identity
        ) : (
          <Link href={href} className="group block" aria-label={t("users_work.list.open_user", { name: row.name })}>
            {identity}
          </Link>
        )}
      </td>
      <td className="px-3 py-2.5">
        <RoleBadge role={row.role} />
      </td>
      <td className="px-3 py-2.5">
        <StatusBadge status={row.status} />
      </td>
      <NumberCell value={row.open} />
      <NumberCell value={row.in_progress} />
      <NumberCell value={row.overdue} isAlert />
      <NumberCell value={row.done} />
      <NumberCell value={row.projects} />
      <td className="max-w-48 px-3 py-2.5 text-secondary">
        <span className="flex items-center gap-1.5">
          {row.cycles.length > 0 && <span className="truncate">{row.cycles[0].name}</span>}
          {row.cycles.length > 1 && (
            <Tooltip tooltipContent={row.cycles.map((cycle) => cycle.name).join(", ")}>
              <span className="flex-shrink-0 text-12 text-tertiary">
                {t("users_work.list.more_cycles", { count: row.cycles.length - 1 })}
              </span>
            </Tooltip>
          )}
          {hiddenCycles && row.cycles.length === 0 && (
            <span className="truncate text-12 text-tertiary" title={hiddenCycles}>
              {hiddenCycles}
            </span>
          )}
        </span>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap text-secondary">
        {row.last_activity_at ? (
          <Tooltip tooltipContent={renderFormattedDate(row.last_activity_at)}>
            <span>{calculateTimeAgo(row.last_activity_at)}</span>
          </Tooltip>
        ) : (
          !isInvited && <span className="text-placeholder">{t("users_work.list.no_activity")}</span>
        )}
      </td>
    </tr>
  );
}
