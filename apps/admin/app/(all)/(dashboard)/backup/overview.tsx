/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { AlertTriangle, CheckCircle2, History, Loader2, Play, ShieldAlert, Undo2 } from "lucide-react";
// plane imports
import { Button } from "@plane/propel/button";
import type { TBackupOverview, TBackupRestore, TBackupSnapshot } from "@plane/types";
import { Loader } from "@plane/ui";
import { cn } from "@plane/utils";
// local
import { describeSchedule, formatBytes, formatDateTime, relativeTime } from "./helpers";
import type { TBackupTab } from "./page";
import { RestoreWizard, UndoRestoreModal } from "./restore-wizard";
import { StartBackupModal } from "./start-backup-modal";
import { useBackupOverview } from "./use-backup";

const HEALTH = {
  good: {
    title: "Your data is protected",
    Icon: CheckCircle2,
    className: "border-success-subtle bg-success-subtle-1 text-success-primary",
  },
  warning: {
    title: "Backups need attention",
    Icon: AlertTriangle,
    className: "border-warning-subtle bg-warning-subtle text-warning-primary",
  },
  critical: {
    title: "Your data is not safely backed up",
    Icon: ShieldAlert,
    className: "border-danger-subtle bg-danger-subtle text-danger-primary",
  },
} as const;

const STAT_LABELS: [keyof TBackupSnapshot["stats"], string][] = [
  ["workspaces", "Workspaces"],
  ["projects", "Projects"],
  ["work_items", "Work items"],
  ["pages", "Pages"],
  ["users", "Users"],
];

type Props = { onNavigate: (tab: TBackupTab) => void };

export function BackupOverview(props: Props) {
  const { onNavigate } = props;
  const { data, isLoading } = useBackupOverview();
  const [isStartOpen, setIsStartOpen] = useState(false);
  const [openRestoreId, setOpenRestoreId] = useState<string | null>(null);
  const [toUndo, setToUndo] = useState<TBackupRestore | null>(null);

  if (isLoading && !data) {
    return (
      <Loader className="flex flex-col gap-4 py-6">
        <Loader.Item height="96px" />
        <Loader.Item height="96px" />
      </Loader>
    );
  }
  if (!data) {
    return <div className="py-6 text-13 text-danger-primary">Couldn't load the backup status. Refresh the page.</div>;
  }

  const health = HEALTH[data.health];
  const canStart = data.tools_available && data.destinations.enabled > 0 && !data.running;

  return (
    <div className="flex flex-col gap-6 py-6">
      <div className={cn("flex flex-col gap-3 rounded-lg border p-4", health.className)}>
        <div className="flex items-center gap-2">
          <health.Icon className="size-5 shrink-0" />
          <h3 className="text-16 font-medium">{health.title}</h3>
        </div>
        {data.messages.length > 0 ? (
          <ul className="flex list-disc flex-col gap-1 pl-9 text-13 text-primary">
            {data.messages.map((message) => (
              <li key={message.text}>{message.text}</li>
            ))}
          </ul>
        ) : (
          <p className="pl-7 text-13 text-primary">
            Backups run on schedule and the last one completed. Nothing to do.
          </p>
        )}
        <NextSteps overview={data} onNavigate={onNavigate} />
      </div>

      {data.restore && (
        <RestoreBanner
          restore={data.restore}
          onOpen={() => setOpenRestoreId(data.restore?.id ?? null)}
          onUndo={() => setToUndo(data.restore)}
        />
      )}

      {data.running && <RunningCard snapshot={data.running} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Last good backup"
          value={data.last_success ? relativeTime(data.last_success.finished_at) : "None yet"}
          detail={data.last_success ? formatDateTime(data.last_success.finished_at) : "Start one with Back up now."}
        />
        <StatCard
          label="Next automatic backup"
          value={data.schedule.is_enabled ? relativeTime(data.schedule.next_run_at) : "Off"}
          detail={data.schedule.is_enabled ? describeSchedule(data.schedule) : "Turn it on in the Schedule tab."}
        />
        <StatCard
          label="Backups kept"
          value={String(data.totals.count)}
          detail={`${formatBytes(data.totals.database_size)} of database copies`}
        />
        <StatCard
          label="Destinations"
          value={`${data.destinations.enabled} active`}
          detail={
            data.destinations.total > data.destinations.enabled
              ? `${data.destinations.total - data.destinations.enabled} turned off`
              : "Where backups are saved"
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          size="lg"
          prependIcon={<Play />}
          onClick={() => setIsStartOpen(true)}
          disabled={!canStart}
        >
          Back up now
        </Button>
        <span className="text-12 text-tertiary">
          {data.running
            ? "A backup is in progress."
            : "Good to do before big changes, such as deleting a project or upgrading."}
        </span>
      </div>

      {data.last_success && <LatestContents snapshot={data.last_success} />}

      {!data.restore && (
        <div className="rounded-lg border border-subtle bg-layer-1 p-4 text-13 text-secondary">
          <span className="font-medium text-primary">Restoring.</span> To go back to an earlier state, open the Backups
          tab and choose Restore on a backup, or use Restore from a file. You always see what is inside before anything
          changes, and you can undo a restore for 24 hours.
        </div>
      )}

      <StartBackupModal isOpen={isStartOpen} onClose={() => setIsStartOpen(false)} />
      <RestoreWizard restoreId={openRestoreId} onClose={() => setOpenRestoreId(null)} />
      <UndoRestoreModal restore={toUndo} onClose={() => setToUndo(null)} />
    </div>
  );
}

function NextSteps(props: { overview: TBackupOverview; onNavigate: (tab: TBackupTab) => void }) {
  const { overview, onNavigate } = props;
  const steps: { label: string; tab: TBackupTab }[] = [];
  if (overview.destinations.enabled === 0) steps.push({ label: "Add a destination", tab: "destinations" });
  if (!overview.schedule.is_enabled) steps.push({ label: "Turn on automatic backups", tab: "schedule" });
  if (overview.latest?.status === "failed" || overview.latest?.status === "partial")
    steps.push({ label: "See what went wrong", tab: "backups" });
  if (steps.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 pl-7">
      {steps.map((step) => (
        <Button key={step.tab} variant="secondary" size="lg" onClick={() => onNavigate(step.tab)}>
          {step.label}
        </Button>
      ))}
    </div>
  );
}

function RunningCard(props: { snapshot: TBackupSnapshot }) {
  const { snapshot } = props;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-subtle bg-layer-1 p-4">
      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-accent-primary" />
      <div className="flex flex-col gap-0.5">
        <span className="text-13 font-medium text-primary">
          {snapshot.status === "queued" ? "Backup waiting to start" : "Backup in progress"}
        </span>
        <span className="text-12 text-secondary">
          {snapshot.progress || "Preparing"} · started {relativeTime(snapshot.started_at ?? snapshot.created_at)}
        </span>
        <span className="text-12 text-tertiary">People can keep working. This page updates by itself.</span>
      </div>
    </div>
  );
}

function StatCard(props: { label: string; value: string; detail: string }) {
  const { label, value, detail } = props;
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-subtle bg-layer-1 p-4">
      <span className="text-12 text-tertiary">{label}</span>
      <span className="text-18 font-medium text-primary first-letter:uppercase">{value}</span>
      <span className="text-12 text-secondary">{detail}</span>
    </div>
  );
}

function LatestContents(props: { snapshot: TBackupSnapshot }) {
  const { snapshot } = props;
  const stats = STAT_LABELS.filter(([key]) => snapshot.stats[key] !== undefined);
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h4 className="text-14 font-medium text-primary">What the last good backup contains</h4>
        <p className="text-12 text-tertiary">
          Made {formatDateTime(snapshot.finished_at)}
          {snapshot.app_version ? ` on platform version ${snapshot.app_version}` : ""}.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map(([key, label]) => (
          <div key={key} className="rounded-md border border-subtle px-3 py-2">
            <div className="text-16 font-medium text-primary">{(snapshot.stats[key] ?? 0).toLocaleString()}</div>
            <div className="text-12 text-tertiary">{label}</div>
          </div>
        ))}
        <div className="rounded-md border border-subtle px-3 py-2">
          <div className="text-16 font-medium text-primary">
            {snapshot.include_files ? snapshot.files_count.toLocaleString() : "—"}
          </div>
          <div className="text-12 text-tertiary">
            {snapshot.include_files ? `Files (${formatBytes(snapshot.files_size)})` : "Files not included"}
          </div>
        </div>
      </div>
    </div>
  );
}

function RestoreBanner(props: { restore: TBackupRestore; onOpen: () => void; onUndo: () => void }) {
  const { restore, onOpen, onUndo } = props;
  const inProgress = ["queued", "running", "undoing"].includes(restore.status);
  const waiting = restore.status === "inspecting" || restore.status === "ready" || restore.status === "invalid";

  if (restore.status === "succeeded") {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-subtle bg-layer-1 p-4 sm:flex-row sm:items-center">
        <History className="size-5 shrink-0 text-accent-primary" />
        <div className="flex grow flex-col gap-0.5">
          <span className="text-13 font-medium text-primary">
            Restored {restore.label} {relativeTime(restore.finished_at)}
          </span>
          <span className="text-12 text-secondary">
            {restore.error
              ? restore.error
              : `You can undo this until ${formatDateTime(restore.undo_until)}. Anything done since the restore would be lost.`}
          </span>
        </div>
        <Button variant="secondary" size="lg" prependIcon={<Undo2 />} onClick={onUndo}>
          Undo restore
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-subtle bg-layer-1 p-4 sm:flex-row sm:items-center">
      {inProgress || restore.status === "inspecting" ? (
        <Loader2 className="size-5 shrink-0 animate-spin text-accent-primary" />
      ) : (
        <History className="size-5 shrink-0 text-accent-primary" />
      )}
      <div className="flex grow flex-col gap-0.5">
        <span className="text-13 font-medium text-primary">
          {inProgress
            ? restore.status === "undoing"
              ? "Undoing a restore"
              : "A restore is in progress"
            : restore.status === "inspecting"
              ? `Checking ${restore.label}`
              : `${restore.label.replace(/^./, (c) => c.toUpperCase())} is checked and waiting for your decision`}
        </span>
        <span className="text-12 text-secondary">
          {inProgress ? "The platform is paused for a few minutes." : "Nothing changes until you confirm."}
        </span>
      </div>
      {(waiting || inProgress) && (
        <Button variant="secondary" size="lg" onClick={onOpen}>
          {inProgress ? "Show progress" : "Review"}
        </Button>
      )}
    </div>
  );
}
