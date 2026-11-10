/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import useSWR from "swr";
import { AlertTriangle, CheckCircle2, Copy, Download, KeyRound, Package, Trash2, UploadCloud } from "lucide-react";
// plane imports
import { Badge } from "@plane/propel/badge";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TBackupRelease, TBackupReleaseCopy } from "@plane/types";
import { AlertModalCore, Input, Loader } from "@plane/ui";
import { cn } from "@plane/utils";
// local
import { formatBytes, formatDateTime, getErrorMessage, getFieldErrors } from "./helpers";
import { backupService, useBackupReleases } from "./use-backup";

const EXPORT_COMMAND = "deployments/backup/export-release-images.sh";

const COPY_BADGE: Record<
  TBackupReleaseCopy["status"],
  { label: string; variant: "neutral" | "brand" | "success" | "danger" }
> = {
  queued: { label: "Waiting", variant: "neutral" },
  copying: { label: "Copying", variant: "brand" },
  saved: { label: "Saved", variant: "success" },
  failed: { label: "Failed", variant: "danger" },
};

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    setToast({ type: TOAST_TYPE.SUCCESS, title: "Copied", message: "Paste it in the server's terminal." });
  } catch {
    setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't copy", message: "Select the text and copy it by hand." });
  }
}

function CommandBox(props: { command: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-subtle bg-layer-2 p-2">
      <code className="font-mono grow text-12 break-all text-primary">{props.command}</code>
      <Button variant="ghost" size="base" onClick={() => void copyText(props.command)} aria-label="Copy command">
        <Copy className="size-3.5" />
      </Button>
    </div>
  );
}

export function BackupRecovery() {
  return (
    <div className="flex flex-col gap-10 py-6">
      <p className="max-w-3xl text-13 text-secondary">
        Backups protect your data. To rebuild a server that was lost completely, your IT team also needs the
        server&apos;s settings and the platform itself. Keep both of these somewhere other than this server.
      </p>
      <SettingsKitSection />
      <ReleaseCopiesSection />
    </div>
  );
}

// ---------------------------------------------------------------------------

function SettingsKitSection() {
  const { data: info } = useSWR("BACKUP_SETTINGS_KIT_INFO", () => backupService.settingsKitInfo(), {
    revalidateOnFocus: false,
  });
  const [password, setPassword] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [repeat, setRepeat] = useState("");
  const [stored, setStored] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [downloadedAs, setDownloadedAs] = useState<string | null>(null);

  const minimum = info?.min_passphrase_length ?? 12;
  const tooShort = passphrase.length > 0 && passphrase.length < minimum;
  const mismatch = repeat.length > 0 && repeat !== passphrase;
  const canSubmit = Boolean(password) && passphrase.length >= minimum && repeat === passphrase && stored;

  const submit = async () => {
    setIsSubmitting(true);
    setErrors({});
    setMessage("");
    try {
      const blob = await backupService.downloadSettingsKit({ password, passphrase });
      const filename = info?.filename ?? "sgtpm-settings-kit.tar.gz.enc";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      setDownloadedAs(filename);
      setPassword("");
      setPassphrase("");
      setRepeat("");
      setStored(false);
    } catch (error) {
      setErrors(getFieldErrors(error));
      setMessage(getErrorMessage(error, "Couldn't create the settings kit."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const openCommand = (info?.open_command ?? "").replace(info?.filename ?? "", downloadedAs ?? info?.filename ?? "");

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 size-5 shrink-0 text-accent-primary" />
        <div>
          <h4 className="text-14 font-medium text-primary">Server settings kit</h4>
          <p className="max-w-3xl text-12 text-tertiary">
            One locked file with what a new server needs besides the data: the server&apos;s settings (including the
            secret key that unlocks saved passwords), the passwords of your backup destinations, and step-by-step
            rebuild instructions. Download a new one after changing server settings or destinations.
          </p>
        </div>
      </div>

      <form
        className="grid max-w-3xl grid-cols-1 gap-4 rounded-lg border border-subtle bg-layer-1 p-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) void submit();
        }}
      >
        <Field label="Your password" error={errors.password}>
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            hasError={Boolean(errors.password)}
            className="w-full"
          />
        </Field>
        <div className="hidden sm:block" />
        <Field
          label="Passphrase to lock the kit"
          hint={`At least ${minimum} characters. A short sentence works well.`}
          error={errors.passphrase || (tooShort ? `At least ${minimum} characters.` : "")}
        >
          <Input
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            autoComplete="new-password"
            hasError={tooShort || Boolean(errors.passphrase)}
            className="w-full"
          />
        </Field>
        <Field label="Repeat the passphrase" error={mismatch ? "Doesn't match." : ""}>
          <Input
            type="password"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
            autoComplete="new-password"
            hasError={mismatch}
            className="w-full"
          />
        </Field>
        <label className="flex items-start gap-2 text-13 text-secondary sm:col-span-2">
          <input
            type="checkbox"
            checked={stored}
            onChange={(event) => setStored(event.target.checked)}
            className="mt-0.5"
          />
          I will keep the passphrase somewhere safe, separate from the kit. Without it the kit can&apos;t be opened, and
          it can&apos;t be recovered.
        </label>
        {message && (
          <div className="rounded-md bg-danger-subtle px-3 py-2 text-13 text-danger-primary sm:col-span-2">
            {message}
          </div>
        )}
        <div className="sm:col-span-2">
          <Button
            type="submit"
            variant="primary"
            size="lg"
            prependIcon={<Download />}
            loading={isSubmitting}
            disabled={!canSubmit || isSubmitting}
          >
            {isSubmitting ? "Preparing" : "Download settings kit"}
          </Button>
        </div>
      </form>

      {downloadedAs && (
        <div className="flex max-w-3xl flex-col gap-2 rounded-lg border border-success-subtle bg-success-subtle-1 p-4">
          <span className="flex items-center gap-2 text-13 font-medium text-success-primary">
            <CheckCircle2 className="size-4" />
            Downloaded {downloadedAs}
          </span>
          <span className="text-12 text-secondary">
            Store it outside this server, for example in your company&apos;s password manager or a locked drive. Your IT
            team opens it with this standard command and the passphrase:
          </span>
          {openCommand && <CommandBox command={openCommand} />}
        </div>
      )}
    </section>
  );
}

function Field(props: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-13 text-tertiary">{props.label}</span>
      {props.children}
      {(props.error || props.hint) && (
        <span className={cn("text-12", props.error ? "text-danger-primary" : "text-tertiary")}>
          {props.error || props.hint}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ReleaseCopiesSection() {
  const { data, isLoading, mutate } = useBackupReleases();
  const [toDelete, setToDelete] = useState<TBackupRelease | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [copying, setCopying] = useState<string | null>(null);

  const copyToDestinations = async (release: TBackupRelease) => {
    setCopying(release.version);
    try {
      await backupService.copyRelease(release.version);
      await mutate();
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Copying started",
        message: "Large copies take a while. This page updates by itself.",
      });
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't copy", message: getErrorMessage(error) });
    } finally {
      setCopying(null);
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    setIsDeleting(true);
    try {
      await backupService.deleteRelease(toDelete.version);
      await mutate();
      setToDelete(null);
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't delete", message: getErrorMessage(error) });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <Package className="mt-0.5 size-5 shrink-0 text-accent-primary" />
        <div>
          <h4 className="text-14 font-medium text-primary">Platform release copies</h4>
          <p className="max-w-3xl text-12 text-tertiary">
            A saved copy of the platform itself (its Docker images and setup files) for each version you run. With it, a
            new server can start the exact same version without downloading or building anything.
          </p>
        </div>
      </div>

      {isLoading && !data ? (
        <Loader className="flex flex-col gap-2">
          <Loader.Item height="64px" />
        </Loader>
      ) : data ? (
        <>
          {data.has_current ? (
            <div className="flex max-w-3xl items-center gap-2 text-13 text-success-primary">
              <CheckCircle2 className="size-4" />A copy of the version running now ({data.current_version}) is saved.
            </div>
          ) : (
            <div className="flex max-w-3xl flex-col gap-2 rounded-lg border border-warning-subtle bg-warning-subtle p-4">
              <span className="flex items-center gap-2 text-13 font-medium text-warning-primary">
                <AlertTriangle className="size-4" />
                No copy of the version running now{data.current_version ? ` (${data.current_version})` : ""}
              </span>
              <span className="text-12 text-secondary">
                For security, the platform can&apos;t make this copy itself. Ask your IT team to run this on the server,
                in the platform&apos;s folder, once after every upgrade:
              </span>
              <CommandBox command={EXPORT_COMMAND} />
            </div>
          )}

          {data.releases.length > 0 && (
            <div className="flex max-w-4xl flex-col gap-2">
              {data.releases.map((release) => (
                <ReleaseRow
                  key={release.version}
                  release={release}
                  isCopying={copying === release.version}
                  onCopy={() => void copyToDestinations(release)}
                  onDelete={() => setToDelete(release)}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="text-13 text-danger-primary">Couldn&apos;t load the release copies.</div>
      )}

      <AlertModalCore
        isOpen={Boolean(toDelete)}
        handleClose={() => setToDelete(null)}
        handleSubmit={() => void remove()}
        isSubmitting={isDeleting}
        variant="danger"
        title={`Delete the copy of version ${toDelete?.version ?? ""}?`}
        primaryButtonText={{ loading: "Deleting", default: "Delete" }}
        content={
          <>
            It is removed from this server. Copies already saved to your destinations are kept.
            {toDelete?.is_current ? " This is the version running now." : ""}
          </>
        }
      />
    </section>
  );
}

function ReleaseRow(props: { release: TBackupRelease; isCopying: boolean; onCopy: () => void; onDelete: () => void }) {
  const { release, isCopying, onCopy, onDelete } = props;
  const copies = Object.entries(release.copies);
  const busy = copies.some(([, c]) => c.status === "queued" || c.status === "copying");

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-subtle bg-layer-1 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex grow flex-col gap-0.5">
          <span className="flex items-center gap-2 text-13 font-medium text-primary">
            Version {release.version}
            {release.is_current && (
              <Badge variant="success" size="sm">
                Running now
              </Badge>
            )}
          </span>
          <span className="text-12 text-tertiary">
            Saved {formatDateTime(release.created_at)}
            {release.made_on ? ` on ${release.made_on}` : ""} · {release.images.length} images ·{" "}
            {formatBytes(release.images_size + release.compose_size)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={backupService.releaseDownloadUrl(release.version, "images")}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-strong bg-layer-2 px-2 text-body-xs-medium text-secondary hover:bg-layer-2-hover"
          >
            <Download className="size-3.5" />
            Images
          </a>
          {release.has_compose_files && (
            <a
              href={backupService.releaseDownloadUrl(release.version, "compose")}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-strong bg-layer-2 px-2 text-body-xs-medium text-secondary hover:bg-layer-2-hover"
            >
              <Download className="size-3.5" />
              Setup files
            </a>
          )}
          <Button
            variant="secondary"
            prependIcon={<UploadCloud />}
            onClick={onCopy}
            loading={isCopying}
            disabled={busy || isCopying}
          >
            Copy to destinations
          </Button>
          <Button variant="ghost" onClick={onDelete} aria-label="Delete">
            <Trash2 className="size-3.5 text-danger-primary" />
          </Button>
        </div>
      </div>
      {copies.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {copies.map(([name, copy]) => (
            <span key={name} className="flex items-center gap-1 text-12 text-secondary" title={copy.error || undefined}>
              {name}:
              <Badge variant={COPY_BADGE[copy.status].variant} size="sm">
                {COPY_BADGE[copy.status].label}
              </Badge>
            </span>
          ))}
        </div>
      )}
      {release.images_sha256 && (
        <span className="font-mono text-11 break-all text-tertiary">SHA-256 {release.images_sha256}</span>
      )}
    </div>
  );
}
