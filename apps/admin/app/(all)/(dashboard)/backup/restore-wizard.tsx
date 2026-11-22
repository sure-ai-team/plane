/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import useSWR from "swr";
import { AlertTriangle, CheckCircle2, Info, Loader2, ShieldAlert, XCircle } from "lucide-react";
// plane imports
import { ADMIN_BASE_PATH } from "@plane/constants";
import { Button } from "@plane/propel/button";
import type {
  TBackupContentCounts,
  TBackupRestore,
  TBackupRestoreCheck,
  TBackupRestorePublicStatus,
} from "@plane/types";
import { EModalWidth, Input, ModalCore } from "@plane/ui";
import { cn } from "@plane/utils";
// local
import { formatBytes, formatDateTime, getErrorMessage, getFieldErrors, relativeTime } from "./helpers";
import { backupService, refreshBackupData } from "./use-backup";

const CHECK_STYLE: Record<TBackupRestoreCheck["level"], { Icon: typeof Info; className: string }> = {
  ok: { Icon: CheckCircle2, className: "text-success-primary" },
  info: { Icon: Info, className: "text-accent-primary" },
  warning: { Icon: AlertTriangle, className: "text-warning-primary" },
  blocker: { Icon: XCircle, className: "text-danger-primary" },
};

const COUNT_ROWS: [keyof TBackupContentCounts, string][] = [
  ["workspaces", "Workspaces"],
  ["projects", "Projects"],
  ["work_items", "Work items"],
  ["pages", "Pages"],
  ["users", "Users"],
];

/** Reloads the admin panel from its start page: sessions now match the restored data, so it asks to sign in if needed. */
export function reopenAdminPanel() {
  window.location.assign(`${ADMIN_BASE_PATH || ""}/`);
}

type Props = {
  /** The restore being checked; null closes the wizard. */
  restoreId: string | null;
  onClose: () => void;
};

export function RestoreWizard(props: Props) {
  const { restoreId, onClose } = props;
  const [step, setStep] = useState<"summary" | "confirm" | "progress">("summary");

  useEffect(() => {
    if (restoreId) setStep("summary");
  }, [restoreId]);

  const { data: restore, error } = useSWR(
    restoreId && step !== "progress" ? ["BACKUP_RESTORE", restoreId] : null,
    () => backupService.getRestore(restoreId as string),
    { refreshInterval: (data) => (data?.status === "inspecting" ? 2000 : 0), revalidateOnFocus: false }
  );

  // A restore already under way (opened from the overview) goes straight to progress.
  useEffect(() => {
    if (restore && ["queued", "running", "undoing"].includes(restore.status)) setStep("progress");
  }, [restore]);

  const close = () => {
    void refreshBackupData();
    onClose();
  };

  const cancel = async () => {
    if (restore && (restore.status === "ready" || restore.status === "invalid")) {
      try {
        await backupService.cancelRestore(restore.id);
      } catch {
        // Expires on its own after 12 hours; closing must not fail.
      }
    }
    close();
  };

  return (
    <ModalCore
      isOpen={Boolean(restoreId)}
      handleClose={step === "progress" ? () => undefined : cancel}
      width={EModalWidth.XXXXL}
    >
      <div className="flex max-h-[88vh] flex-col gap-5 overflow-y-auto p-5">
        {step === "progress" && restoreId ? (
          <RestoreProgress restoreId={restoreId} kind="restore" onClose={close} />
        ) : error ? (
          <div className="text-13 text-danger-primary">{getErrorMessage(error, "Couldn't load this restore.")}</div>
        ) : !restore || restore.status === "inspecting" ? (
          <Inspecting restore={restore} onCancel={cancel} />
        ) : step === "confirm" ? (
          <ConfirmStep restore={restore} onBack={() => setStep("summary")} onStarted={() => setStep("progress")} />
        ) : (
          <Summary restore={restore} onCancel={cancel} onContinue={() => setStep("confirm")} />
        )}
      </div>
    </ModalCore>
  );
}

function Inspecting(props: { restore?: TBackupRestore; onCancel: () => void }) {
  const { restore, onCancel } = props;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-16 font-medium">Checking the backup</h3>
        <p className="mt-1 text-13 text-secondary">
          The backup is loaded into a separate preview database so you can see what is inside. Nothing on the live
          platform changes.
        </p>
      </div>
      <div className="flex items-center gap-3 rounded-lg border border-subtle bg-layer-1 p-4">
        <Loader2 className="size-4 shrink-0 animate-spin text-accent-primary" />
        <span className="text-13 text-secondary">{restore?.progress || "Starting"}</span>
      </div>
      <div className="flex justify-end">
        <Button variant="secondary" size="lg" onClick={onCancel}>
          Close
        </Button>
      </div>
    </div>
  );
}

function Summary(props: { restore: TBackupRestore; onCancel: () => void; onContinue: () => void }) {
  const { restore, onCancel, onContinue } = props;
  const { backup, comparison, preview } = restore;
  const blocked = !restore.can_restore;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-16 font-medium">{blocked ? "This backup can't be restored" : "Review before restoring"}</h3>
        <p className="mt-1 text-13 text-secondary">
          {blocked
            ? "The reason is listed below. Nothing was changed."
            : "This is what the platform will look like after the restore. Nothing has changed yet."}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-lg border border-subtle bg-layer-1 p-4 text-13 sm:grid-cols-2">
        <Fact label="Backup from">
          {formatDateTime(backup.created_at)} ({relativeTime(backup.created_at)})
        </Fact>
        <Fact label="Source">{restore.label.replace(/^the /, "").replace(/^./, (c) => c.toUpperCase())}</Fact>
        <Fact label="Made">
          {backup.trigger === "scheduled"
            ? "Automatically"
            : backup.trigger === "safety"
              ? "Before a restore"
              : "By an admin"}
          {backup.note ? ` · ${backup.note}` : ""}
        </Fact>
        <Fact label="Platform version">{backup.app_version || "—"}</Fact>
        <Fact label="Database">{formatBytes(backup.database_size)}</Fact>
        <Fact label="Uploaded files">
          {backup.files.included
            ? `${(backup.files.count ?? 0).toLocaleString()} (${formatBytes(backup.files.size ?? 0)})`
            : "Not included"}
        </Fact>
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="text-14 font-medium text-primary">Checks</h4>
        <ul className="flex flex-col gap-1.5">
          {restore.checks.map((check) => {
            const style = CHECK_STYLE[check.level];
            return (
              <li key={check.text} className="flex items-start gap-2 text-13 text-primary">
                <style.Icon className={cn("mt-0.5 size-4 shrink-0", style.className)} />
                <span>{check.text}</span>
              </li>
            );
          })}
        </ul>
      </div>

      {comparison.backup && comparison.current && (
        <div className="flex flex-col gap-2">
          <h4 className="text-14 font-medium text-primary">Backup compared with now</h4>
          <div className="overflow-x-auto rounded-lg border border-subtle">
            <table className="w-full text-13">
              <thead>
                <tr className="border-b border-subtle text-left text-12 text-tertiary">
                  <th className="px-3 py-2 font-medium">What</th>
                  <th className="px-3 py-2 text-right font-medium">In the backup</th>
                  <th className="px-3 py-2 text-right font-medium">Now</th>
                  <th className="px-3 py-2 text-right font-medium">After restoring</th>
                </tr>
              </thead>
              <tbody>
                {COUNT_ROWS.map(([key, label]) => {
                  const then = Number(comparison.backup?.[key] ?? 0);
                  const now = Number(comparison.current?.[key] ?? 0);
                  const diff = then - now;
                  return (
                    <tr key={key} className="border-b border-subtle last:border-0">
                      <td className="px-3 py-2 text-secondary">{label}</td>
                      <td className="px-3 py-2 text-right text-primary">{then.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-primary">{now.toLocaleString()}</td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right",
                          diff < 0 ? "text-danger-primary" : diff > 0 ? "text-success-primary" : "text-tertiary"
                        )}
                      >
                        {diff === 0 ? "No change" : `${diff > 0 ? "+" : "−"}${Math.abs(diff).toLocaleString()}`}
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td className="px-3 py-2 text-secondary">Last work item change</td>
                  <td className="px-3 py-2 text-right text-primary">
                    {formatDateTime(comparison.backup.last_activity)}
                  </td>
                  <td className="px-3 py-2 text-right text-primary">
                    {formatDateTime(comparison.current.last_activity)}
                  </td>
                  <td className="px-3 py-2" />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-12 text-tertiary">Anything created or changed after the backup is replaced.</p>
        </div>
      )}

      {(preview.workspaces?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-14 font-medium text-primary">Workspaces in the backup</h4>
          <div className="flex flex-wrap gap-2">
            {preview.workspaces?.map((workspace) => (
              <span key={workspace.slug} className="rounded-md border border-subtle px-2 py-1 text-12 text-secondary">
                {workspace.name} · {workspace.projects} {workspace.projects === 1 ? "project" : "projects"}
              </span>
            ))}
          </div>
        </div>
      )}
      {(preview.admins?.length ?? 0) > 0 && (
        <p className="text-12 text-tertiary">Admins who can sign in after the restore: {preview.admins?.join(", ")}</p>
      )}

      <div className="flex justify-end gap-2 border-t border-subtle pt-4">
        <Button variant="secondary" size="lg" onClick={onCancel}>
          {blocked ? "Close" : "Cancel"}
        </Button>
        {!blocked && (
          <Button variant="primary" size="lg" onClick={onContinue}>
            Continue
          </Button>
        )}
      </div>
    </div>
  );
}

function Fact(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-12 text-tertiary">{props.label}</span>
      <span className="text-primary">{props.children}</span>
    </div>
  );
}

function ConfirmStep(props: { restore: TBackupRestore; onBack: () => void; onStarted: () => void }) {
  const { restore, onBack, onStarted } = props;
  const [password, setPassword] = useState("");
  const [phrase, setPhrase] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const matches = phrase.trim().toLowerCase() === restore.confirm_phrase.toLowerCase();

  const submit = async () => {
    setIsSubmitting(true);
    setErrors({});
    setMessage("");
    try {
      await backupService.confirmRestore(restore.id, { password, confirm_text: phrase });
      onStarted();
    } catch (error) {
      setErrors(getFieldErrors(error));
      setMessage(getErrorMessage(error, "Couldn't start the restore."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (matches && password) void submit();
      }}
    >
      <div>
        <h3 className="flex items-center gap-2 text-16 font-medium text-danger-primary">
          <ShieldAlert className="size-5" />
          Restore {restore.label}?
        </h3>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-13 text-secondary">
          <li>A safety backup of the current data is made first.</li>
          <li>The platform pauses for a few minutes. People see a maintenance message.</li>
          <li>Sign-ins go back to how they were at backup time, so you or others may need to sign in again.</li>
          <li>You can undo the restore for 24 hours.</li>
        </ul>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="restore-password" className="text-13 text-tertiary">
          Your password
        </label>
        <Input
          id="restore-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          hasError={Boolean(errors.password)}
          autoComplete="current-password"
          className="w-full"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="restore-phrase" className="text-13 text-tertiary">
          Type <span className="font-medium text-primary">{restore.confirm_phrase}</span> to confirm
        </label>
        <Input
          id="restore-phrase"
          value={phrase}
          onChange={(event) => setPhrase(event.target.value)}
          hasError={Boolean(errors.confirm_text)}
          autoComplete="off"
          className="w-full"
        />
      </div>

      {message && <div className="rounded-md bg-danger-subtle px-3 py-2 text-13 text-danger-primary">{message}</div>}

      <div className="flex justify-between gap-2 border-t border-subtle pt-4">
        <Button variant="ghost" size="lg" onClick={onBack} disabled={isSubmitting}>
          Back
        </Button>
        <Button type="submit" variant="error-fill" size="lg" loading={isSubmitting} disabled={!matches || !password}>
          {isSubmitting ? "Starting" : "Restore now"}
        </Button>
      </div>
    </form>
  );
}

const DONE = new Set<TBackupRestorePublicStatus["status"]>(["succeeded", "failed", "undone"]);

/** Live progress of a restore or undo. Reads the public status, so it keeps working after sign-out. */
export function RestoreProgress(props: { restoreId: string; kind: "restore" | "undo"; onClose: () => void }) {
  const { restoreId, kind, onClose } = props;
  const { data } = useSWR(["BACKUP_RESTORE_STATUS", restoreId], () => backupService.restoreStatus(restoreId), {
    refreshInterval: (latest) => (latest && DONE.has(latest.status) ? 0 : 2000),
    revalidateOnFocus: false,
  });
  const status = data?.status;
  const finished = status ? DONE.has(status) : false;
  // An undo that couldn't run reports the restore as still in place.
  const undoFailed = kind === "undo" && status === "succeeded" && data?.switched === false;
  const ok = (kind === "restore" && status === "succeeded") || (kind === "undo" && status === "undone");
  const signedOut = Boolean(data?.switched);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-16 font-medium">
          {!finished && !undoFailed
            ? kind === "restore"
              ? "Restoring"
              : "Undoing the restore"
            : ok
              ? kind === "restore"
                ? "Restore complete"
                : "Restore undone"
              : kind === "restore"
                ? "The restore didn't go through"
                : "The undo didn't go through"}
        </h3>
        <p className="mt-1 text-13 text-secondary">
          {!finished && !undoFailed
            ? "Keep this window open. It updates by itself, even if you are signed out."
            : ok
              ? kind === "restore"
                ? "The platform is back online with the restored data. You can undo this for 24 hours from the Overview tab."
                : "The data from before the restore is live again."
              : "Nothing was changed."}
        </p>
      </div>

      <div
        className={cn(
          "flex items-start gap-3 rounded-lg border p-4",
          !finished && !undoFailed
            ? "border-subtle bg-layer-1"
            : ok
              ? "border-success-subtle bg-success-subtle-1"
              : "border-danger-subtle bg-danger-subtle"
        )}
      >
        {!finished && !undoFailed ? (
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-accent-primary" />
        ) : ok ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-primary" />
        ) : (
          <XCircle className="mt-0.5 size-4 shrink-0 text-danger-primary" />
        )}
        <span className="text-13 text-primary">
          {!finished && !undoFailed ? data?.progress || "Waiting to start" : data?.error || (ok ? "Done." : "")}
        </span>
      </div>

      {(finished || undoFailed) && (
        <div className="flex justify-end gap-2 border-t border-subtle pt-4">
          {signedOut ? (
            <Button variant="primary" size="lg" onClick={reopenAdminPanel}>
              Open the admin panel
            </Button>
          ) : (
            <Button variant="primary" size="lg" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Undo confirmation: asks for the password, then shows progress. */
export function UndoRestoreModal(props: { restore: TBackupRestore | null; onClose: () => void }) {
  const { restore, onClose } = props;
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    setPassword("");
    setMessage("");
    setStarted(false);
  }, [restore]);

  const submit = async () => {
    if (!restore) return;
    setIsSubmitting(true);
    setMessage("");
    try {
      await backupService.undoRestore(restore.id, { password });
      setStarted(true);
    } catch (error) {
      setMessage(getErrorMessage(error, "Couldn't start the undo."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalCore isOpen={Boolean(restore)} handleClose={started ? () => undefined : onClose} width={EModalWidth.XXL}>
      <div className="flex flex-col gap-5 p-5">
        {restore && started ? (
          <RestoreProgress
            restoreId={restore.id}
            kind="undo"
            onClose={() => {
              void refreshBackupData();
              onClose();
            }}
          />
        ) : (
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (password) void submit();
            }}
          >
            <div>
              <h3 className="text-16 font-medium">Undo the restore?</h3>
              <p className="mt-1 text-13 text-secondary">
                The data from just before the restore comes back. Anything done since the restore is lost. The platform
                pauses for a moment and people may need to sign in again.
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="undo-password" className="text-13 text-tertiary">
                Your password
              </label>
              <Input
                id="undo-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                className="w-full"
              />
            </div>
            {message && (
              <div className="rounded-md bg-danger-subtle px-3 py-2 text-13 text-danger-primary">{message}</div>
            )}
            <div className="flex justify-end gap-2 border-t border-subtle pt-4">
              <Button variant="secondary" size="lg" onClick={onClose} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" variant="error-fill" size="lg" loading={isSubmitting} disabled={!password}>
                Undo restore
              </Button>
            </div>
          </form>
        )}
      </div>
    </ModalCore>
  );
}
