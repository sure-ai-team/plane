/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileUp,
  Loader2,
  Pencil,
  Pin,
  PinOff,
  Play,
  RotateCcw,
  Trash2,
} from "lucide-react";
// plane imports
import { Badge } from "@plane/propel/badge";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TBackupSnapshot, TBackupSnapshotFilter } from "@plane/types";
import { AlertModalCore, CustomSelect, EModalWidth, Input, Loader, ModalCore } from "@plane/ui";
import { cn } from "@plane/utils";
// local
import {
  COPY_STATUS,
  DESTINATION_KINDS,
  SNAPSHOT_STATUS,
  formatBytes,
  formatDateTime,
  formatDuration,
  getErrorMessage,
  relativeTime,
} from "./helpers";
import { DownloadBackupModal } from "./download-modal";
import { RestoreFromFileModal } from "./restore-file-modal";
import { RestoreWizard } from "./restore-wizard";
import { StartBackupModal } from "./start-backup-modal";
import { backupService, refreshBackupData, useBackupSnapshots } from "./use-backup";

const PER_PAGE = 20;

const FILTERS: { key: TBackupSnapshotFilter; label: string }[] = [
  { key: "", label: "All backups" },
  { key: "kept", label: "Usable backups" },
  { key: "failed", label: "Failed backups" },
];

const TRIGGER_BADGE: Record<TBackupSnapshot["trigger"], { label: string; variant: "neutral" | "brand" | "warning" }> = {
  scheduled: { label: "Automatic", variant: "neutral" },
  manual: { label: "Manual", variant: "brand" },
  // Made right before a restore, so the restore can be reversed even after the undo window.
  safety: { label: "Safety copy", variant: "warning" },
};

const STAT_LABELS: Record<string, string> = {
  workspaces: "workspaces",
  projects: "projects",
  work_items: "work items",
  pages: "pages",
  users: "users",
};

export function BackupSnapshots() {
  const [filter, setFilter] = useState<TBackupSnapshotFilter>("");
  const [page, setPage] = useState(0);
  const [isStartOpen, setIsStartOpen] = useState(false);
  const [toDelete, setToDelete] = useState<TBackupSnapshot | null>(null);
  const [toEditNote, setToEditNote] = useState<TBackupSnapshot | null>(null);
  const [toDownload, setToDownload] = useState<TBackupSnapshot | null>(null);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [isFileOpen, setIsFileOpen] = useState(false);
  const [startingRestoreFor, setStartingRestoreFor] = useState<string | null>(null);

  const startRestore = async (snapshot: TBackupSnapshot) => {
    setStartingRestoreFor(snapshot.id);
    try {
      setRestoreId((await backupService.inspectSnapshot(snapshot.id)).id);
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't check this backup", message: getErrorMessage(error) });
    } finally {
      setStartingRestoreFor(null);
    }
  };

  useEffect(() => setPage(0), [filter]);

  const { data, isLoading } = useBackupSnapshots({ limit: PER_PAGE, offset: page * PER_PAGE, status: filter });
  const snapshots = data?.results ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  const togglePin = async (snapshot: TBackupSnapshot) => {
    try {
      await backupService.updateSnapshot(snapshot.id, { is_pinned: !snapshot.is_pinned });
      await refreshBackupData();
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: snapshot.is_pinned ? "Unpinned" : "Pinned",
        message: snapshot.is_pinned
          ? "This backup can now be removed automatically when it gets old."
          : "This backup will never be removed automatically.",
      });
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't update", message: getErrorMessage(error) });
    }
  };

  return (
    <div className="flex flex-col gap-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex w-52 flex-col gap-1">
          <span className="text-13 text-tertiary">Show</span>
          <CustomSelect
            value={filter}
            label={FILTERS.find((option) => option.key === filter)?.label}
            onChange={setFilter}
            buttonClassName="rounded-md border-subtle"
            input
          >
            {FILTERS.map((option) => (
              <CustomSelect.Option key={option.key} value={option.key} className="w-full">
                {option.label}
              </CustomSelect.Option>
            ))}
          </CustomSelect>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="lg" prependIcon={<FileUp />} onClick={() => setIsFileOpen(true)}>
            Restore from a file
          </Button>
          <Button variant="primary" size="lg" prependIcon={<Play />} onClick={() => setIsStartOpen(true)}>
            Back up now
          </Button>
        </div>
      </div>

      <p className="text-12 text-tertiary">
        Automatic backups are removed when they are older than the number you keep (see Schedule). Backups you start
        yourself and pinned backups are never removed automatically.
      </p>

      {isLoading && !data ? (
        <Loader className="flex flex-col gap-2">
          <Loader.Item height="64px" />
          <Loader.Item height="64px" />
          <Loader.Item height="64px" />
        </Loader>
      ) : snapshots.length === 0 ? (
        <div className="rounded-md border border-subtle px-4 py-10 text-center text-13 text-tertiary">
          {filter ? "No backups match this filter." : "No backups yet. Start one with Back up now."}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {snapshots.map((snapshot) => (
            <SnapshotRow
              key={snapshot.id}
              snapshot={snapshot}
              onTogglePin={() => void togglePin(snapshot)}
              onEditNote={() => setToEditNote(snapshot)}
              onDelete={() => setToDelete(snapshot)}
              onRestore={() => void startRestore(snapshot)}
              onDownload={() => setToDownload(snapshot)}
              isStartingRestore={startingRestoreFor === snapshot.id}
            />
          ))}
        </div>
      )}

      {total > PER_PAGE && (
        <div className="flex items-center justify-between text-13 text-tertiary">
          <span>
            Page {page + 1} of {pages} · {total} backups
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setPage((p) => p - 1)} disabled={page === 0}>
              Newer
            </Button>
            <Button variant="secondary" onClick={() => setPage((p) => p + 1)} disabled={page + 1 >= pages}>
              Older
            </Button>
          </div>
        </div>
      )}

      <StartBackupModal isOpen={isStartOpen} onClose={() => setIsStartOpen(false)} />
      <DeleteSnapshotModal snapshot={toDelete} onClose={() => setToDelete(null)} />
      <NoteModal snapshot={toEditNote} onClose={() => setToEditNote(null)} />
      <DownloadBackupModal snapshot={toDownload} onClose={() => setToDownload(null)} />
      <RestoreFromFileModal
        isOpen={isFileOpen}
        onClose={() => setIsFileOpen(false)}
        onInspecting={(id) => {
          setIsFileOpen(false);
          setRestoreId(id);
        }}
      />
      <RestoreWizard restoreId={restoreId} onClose={() => setRestoreId(null)} />
    </div>
  );
}

type TRowProps = {
  snapshot: TBackupSnapshot;
  onTogglePin: () => void;
  onEditNote: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onDownload: () => void;
  isStartingRestore: boolean;
};

function SnapshotRow(props: TRowProps) {
  const { snapshot, onTogglePin, onEditNote, onDelete, onRestore, onDownload, isStartingRestore } = props;
  const [isOpen, setIsOpen] = useState(false);
  const status = SNAPSHOT_STATUS[snapshot.status];
  const isActive = snapshot.status === "queued" || snapshot.status === "running";
  const isUsable = snapshot.status === "succeeded" || snapshot.status === "partial";
  const size = snapshot.database_size + (snapshot.include_files ? snapshot.files_size : 0);

  return (
    <div className="rounded-lg border border-subtle bg-layer-1">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          className="flex min-w-0 grow items-center gap-3 text-left"
          aria-expanded={isOpen}
        >
          {isOpen ? (
            <ChevronDown className="size-4 shrink-0 text-tertiary" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-tertiary" />
          )}
          <div className="flex min-w-0 flex-col">
            <span className="flex items-center gap-2 text-13 font-medium text-primary">
              {formatDateTime(snapshot.created_at)}
              {snapshot.is_pinned && <Pin className="size-3.5 text-accent-primary" aria-label="Pinned" />}
            </span>
            <span className="truncate text-12 text-tertiary">
              {snapshot.note ||
                (snapshot.trigger === "scheduled"
                  ? "Automatic backup"
                  : `Started by ${snapshot.created_by?.name ?? "an admin"}`)}
            </span>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={TRIGGER_BADGE[snapshot.trigger].variant} size="sm">
            {TRIGGER_BADGE[snapshot.trigger].label}
          </Badge>
          <Badge
            variant={status.variant}
            size="sm"
            prependIcon={isActive ? <Loader2 className="animate-spin" /> : undefined}
          >
            {status.label}
          </Badge>
          <span className="w-20 text-right text-12 text-secondary">{size ? formatBytes(size) : "—"}</span>
          {isUsable && (
            <>
              <Button
                variant="secondary"
                size="base"
                prependIcon={<RotateCcw />}
                onClick={onRestore}
                loading={isStartingRestore}
              >
                Restore
              </Button>
              <Button variant="ghost" size="base" onClick={onDownload} aria-label="Download">
                <Download className="size-3.5" />
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="base"
            onClick={onTogglePin}
            disabled={isActive}
            aria-label={snapshot.is_pinned ? "Unpin" : "Pin"}
          >
            {snapshot.is_pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          </Button>
          <Button variant="ghost" size="base" onClick={onEditNote} aria-label="Edit note">
            <Pencil className="size-3.5" />
          </Button>
          <Button variant="ghost" size="base" onClick={onDelete} disabled={isActive} aria-label="Delete">
            <Trash2 className="size-3.5 text-danger-primary" />
          </Button>
        </div>
      </div>

      {isOpen && <SnapshotDetails snapshot={snapshot} />}
    </div>
  );
}

function SnapshotDetails(props: { snapshot: TBackupSnapshot }) {
  const { snapshot } = props;
  const isActive = snapshot.status === "queued" || snapshot.status === "running";
  const stats = Object.entries(snapshot.stats)
    .filter(([key]) => key in STAT_LABELS)
    .map(([key, value]) => `${(value ?? 0).toLocaleString()} ${STAT_LABELS[key]}`);

  return (
    <div className="flex flex-col gap-4 border-t border-subtle px-4 py-4 text-13">
      {isActive && (
        <div className="text-secondary">
          {snapshot.progress || "Preparing"} · started {relativeTime(snapshot.started_at ?? snapshot.created_at)}
        </div>
      )}
      {snapshot.error && (
        <div className="rounded-md bg-danger-subtle px-3 py-2 text-danger-primary">{snapshot.error}</div>
      )}

      <dl className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
        <Detail label="Contents">{stats.length ? stats.join(", ") : "—"}</Detail>
        <Detail label="Database">{snapshot.database_size ? formatBytes(snapshot.database_size) : "—"}</Detail>
        <Detail label="Uploaded files">
          {snapshot.include_files
            ? `${snapshot.files_count.toLocaleString()} files, ${formatBytes(snapshot.files_size)}`
            : "Not included"}
        </Detail>
        <Detail label="Took">{formatDuration(snapshot.started_at, snapshot.finished_at) || "—"}</Detail>
        <Detail label="Platform version">{snapshot.app_version || "—"}</Detail>
        <Detail label="Database version">
          {snapshot.postgres_version ? `PostgreSQL ${snapshot.postgres_version}` : "—"}
        </Detail>
        <Detail label="Backup name">
          <span className="font-mono text-12">{snapshot.folder}</span>
        </Detail>
        {snapshot.created_by && <Detail label="Started by">{snapshot.created_by.name}</Detail>}
      </dl>

      <div className="flex flex-col gap-2">
        <span className="text-12 font-medium text-tertiary">Saved to</span>
        {snapshot.copies.length === 0 ? (
          <span className="text-tertiary">Nowhere yet.</span>
        ) : (
          snapshot.copies.map((copy) => {
            const copyStatus = COPY_STATUS[copy.status];
            return (
              <div
                key={copy.id}
                className="flex flex-col gap-1 rounded-md border border-subtle px-3 py-2 sm:flex-row sm:items-start"
              >
                <div className="flex min-w-0 grow flex-col">
                  <span className="font-medium text-primary">
                    {copy.destination_name}
                    {!copy.destination_id && <span className="font-normal text-tertiary"> (removed)</span>}
                  </span>
                  <span className="text-12 text-tertiary">{DESTINATION_KINDS[copy.destination_kind]?.label}</span>
                  {copy.location && <span className="font-mono text-11 break-all text-tertiary">{copy.location}</span>}
                  {copy.error && <span className="text-12 text-danger-primary">{copy.error}</span>}
                </div>
                <Badge variant={copyStatus.variant} size="sm">
                  {copyStatus.label}
                </Badge>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function Detail(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-12 text-tertiary">{props.label}</dt>
      <dd className="text-primary">{props.children}</dd>
    </div>
  );
}

function DeleteSnapshotModal(props: { snapshot: TBackupSnapshot | null; onClose: () => void }) {
  const { snapshot, onClose } = props;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => setProblems([]), [snapshot]);

  const handleSubmit = async () => {
    if (!snapshot) return;
    setIsSubmitting(true);
    try {
      await backupService.deleteSnapshot(snapshot.id, problems.length > 0);
      await refreshBackupData();
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Backup deleted", message: "Its copies were removed." });
      onClose();
    } catch (error) {
      const body = error as { problems?: string[] } | undefined;
      if (body?.problems?.length) {
        setProblems(body.problems);
      } else {
        setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't delete", message: getErrorMessage(error) });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AlertModalCore
      isOpen={Boolean(snapshot)}
      handleClose={onClose}
      handleSubmit={() => void handleSubmit()}
      isSubmitting={isSubmitting}
      variant="danger"
      title={problems.length ? "Some copies couldn't be removed" : "Delete this backup?"}
      primaryButtonText={
        problems.length
          ? { loading: "Removing", default: "Remove from list anyway" }
          : { loading: "Deleting", default: "Delete backup" }
      }
      content={
        problems.length ? (
          <div className="flex flex-col gap-2">
            <span>These destinations couldn't be reached, so their copy is still there:</span>
            <ul className="list-disc pl-5">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
            <span>You can remove the backup from this list anyway and delete those copies by hand later.</span>
          </div>
        ) : (
          <>
            The backup from {formatDateTime(snapshot?.created_at)} will be deleted from every destination. This can't be
            undone. Uploaded files shared with other backups are kept.
          </>
        )
      }
    />
  );
}

function NoteModal(props: { snapshot: TBackupSnapshot | null; onClose: () => void }) {
  const { snapshot, onClose } = props;
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => setNote(snapshot?.note ?? ""), [snapshot]);

  const handleSubmit = async () => {
    if (!snapshot) return;
    setIsSubmitting(true);
    try {
      await backupService.updateSnapshot(snapshot.id, { note: note.trim() });
      await refreshBackupData();
      onClose();
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't save the note", message: getErrorMessage(error) });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalCore isOpen={Boolean(snapshot)} handleClose={onClose} width={EModalWidth.LG}>
      <form
        className="flex flex-col gap-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <h3 className="text-16 font-medium">Backup note</h3>
        <Input
          value={note}
          maxLength={200}
          onChange={(event) => setNote(event.target.value)}
          placeholder="For example: Before the yearly clean-up"
          className={cn("w-full")}
        />
        <div className="flex justify-end gap-2 border-t border-subtle pt-4">
          <Button variant="secondary" size="lg" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="lg" loading={isSubmitting}>
            Save
          </Button>
        </div>
      </form>
    </ModalCore>
  );
}
