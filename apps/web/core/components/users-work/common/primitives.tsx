/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import Link from "next/link";
// plane imports
import { STATE_GROUPS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Avatar } from "@plane/propel/avatar";
import { Badge } from "@plane/propel/badge";
import { Button } from "@plane/propel/button";
import { EmptyStateCompact } from "@plane/propel/empty-state";
import { Tooltip } from "@plane/propel/tooltip";
import type { TStateGroups, TUserWorkStatus } from "@plane/types";
import { cn, getFileURL } from "@plane/utils";
// local imports
import { STATE_GROUP_ORDER, percentage, roleLabelKey } from "../helpers";

type PersonAvatarProps = { name: string; url: string | null; className: string };

/** The fixed sizes of Avatar stop at 28px and shrink next to long names. */
export function PersonAvatar({ name, url, className }: PersonAvatarProps) {
  return (
    <span className={cn("block flex-shrink-0", className)}>
      <Avatar name={name} src={getFileURL(url ?? "")} size={28} shape="circle" className={className} />
    </span>
  );
}

export function RoleBadge({ role }: { role: number }) {
  const { t } = useTranslation();
  return <Badge variant={role === 20 ? "brand" : "neutral"}>{t(roleLabelKey(role))}</Badge>;
}

const STATUS_VARIANTS = { active: "success", suspended: "danger", invited: "warning" } as const;

export function StatusBadge({ status }: { status: TUserWorkStatus }) {
  const { t } = useTranslation();
  return <Badge variant={STATUS_VARIANTS[status]}>{t(`users_work.status.${status}`)}</Badge>;
}

type StatTileProps = {
  label: string;
  value: ReactNode;
  detail?: string;
  href?: string;
  /** Draws attention to a number that should be low. */
  isAlert?: boolean;
};

export function StatTile({ label, value, detail, href, isAlert }: StatTileProps) {
  const content = (
    <>
      <span className="text-12 text-tertiary">{label}</span>
      <span className={cn("text-20 font-semibold tabular-nums", isAlert ? "text-danger-primary" : "text-primary")}>
        {value}
      </span>
      {detail && <span className="text-11 text-tertiary">{detail}</span>}
    </>
  );
  const className = "flex min-w-0 flex-col gap-1 rounded-lg border border-subtle bg-surface-1 px-4 py-3";
  if (!href) return <div className={className}>{content}</div>;
  return (
    <Link href={href} className={cn(className, "transition-colors hover:bg-layer-1")}>
      {content}
    </Link>
  );
}

type SectionProps = { title: string; action?: ReactNode; children: ReactNode; className?: string };

export function Section({ title, action, children, className }: SectionProps) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h3 className="text-14 font-medium text-primary">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function SectionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-12 font-medium text-accent-primary hover:underline">
      {children}
    </Link>
  );
}

export function MutedCard({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-subtle px-4 py-6 text-center text-13 text-tertiary">{children}</p>;
}

/** Work by state as one bar. Every part is also listed with its number, so color is never the only clue. */
export function StateGroupBar({ counts }: { counts: Record<TStateGroups, number> }) {
  const { t } = useTranslation();
  const total = STATE_GROUP_ORDER.reduce((sum, group) => sum + counts[group], 0);
  if (total === 0) return <MutedCard>{t("users_work.state_groups.empty")}</MutedCard>;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-subtle px-4 py-3">
      <div className="flex h-2 w-full gap-0.5" aria-hidden="true">
        {STATE_GROUP_ORDER.filter((group) => counts[group] > 0).map((group) => (
          <Tooltip key={group} tooltipContent={`${t(`users_work.state_groups.${group}`)}: ${counts[group]}`}>
            <span
              className="h-full min-w-1 rounded-sm"
              style={{ flexGrow: counts[group], backgroundColor: STATE_GROUPS[group].color }}
            />
          </Tooltip>
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
        {STATE_GROUP_ORDER.map((group) => (
          <li key={group} className="flex items-center gap-1.5 text-12 text-secondary">
            <span
              className="size-2 flex-shrink-0 rounded-full"
              style={{ backgroundColor: STATE_GROUPS[group].color }}
              aria-hidden="true"
            />
            {t(`users_work.state_groups.${group}`)}
            <span className="font-medium text-primary tabular-nums">{counts[group]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const value = percentage(done, total);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1.5 w-full overflow-hidden rounded-sm bg-layer-3"
    >
      <div className="h-full rounded-sm bg-success-primary" style={{ width: `${value}%` }} />
    </div>
  );
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 py-10" role="alert">
      <EmptyStateCompact assetKey="unknown" title={t("users_work.error.title")} assetClassName="size-20" />
      <Button variant="secondary" onClick={onRetry}>
        {t("users_work.error.retry")}
      </Button>
    </div>
  );
}
