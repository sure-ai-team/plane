/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { CheckCircle2, Cloud, Database, Folder, Pencil, Plus, Trash2, XCircle } from "lucide-react";
// plane imports
import { Badge } from "@plane/propel/badge";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TBackupDestination, TBackupDestinationKind } from "@plane/types";
import { AlertModalCore, Loader, ToggleSwitch } from "@plane/ui";
import { cn } from "@plane/utils";
// local
import { DestinationModal } from "./destination-modal";
import { DESTINATION_KINDS, getErrorMessage, relativeTime } from "./helpers";
import { backupService, refreshBackupData, useBackupDestinations } from "./use-backup";

const KIND_ICONS: Record<TBackupDestinationKind, React.ComponentType<{ className?: string }>> = {
  s3: Cloud,
  local: Folder,
  postgres: Database,
};

function summary(destination: TBackupDestination): string {
  const { config } = destination;
  if (destination.kind === "local") return `/backups/${config.folder ?? ""}`;
  if (destination.kind === "s3") {
    const where = [config.bucket, config.prefix].filter(Boolean).join("/");
    let host = "Amazon S3";
    if (config.endpoint_url) {
      try {
        host = new URL(config.endpoint_url).host;
      } catch {
        host = config.endpoint_url;
      }
    }
    return `${where} · ${host}${config.region ? ` · ${config.region}` : ""}`;
  }
  return `${config.database} on ${config.host}:${config.port}`;
}

export function BackupDestinations() {
  const { data: destinations, isLoading } = useBackupDestinations();
  const [editing, setEditing] = useState<TBackupDestination | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [toDelete, setToDelete] = useState<TBackupDestination | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const openAdd = () => {
    setEditing(null);
    setIsModalOpen(true);
  };

  const openEdit = (destination: TBackupDestination) => {
    setEditing(destination);
    setIsModalOpen(true);
  };

  const runTest = async (destination: TBackupDestination) => {
    setTestingId(destination.id);
    try {
      const result = await backupService.testDestination({}, destination.id);
      await refreshBackupData();
      setToast({
        type: result.ok ? TOAST_TYPE.SUCCESS : TOAST_TYPE.ERROR,
        title: result.ok ? "Connection works" : "Connection failed",
        message: result.message,
      });
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't test", message: getErrorMessage(error) });
    } finally {
      setTestingId(null);
    }
  };

  const toggle = async (destination: TBackupDestination, value: boolean) => {
    try {
      await backupService.updateDestination(destination.id, { is_enabled: value });
      await refreshBackupData();
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't update", message: getErrorMessage(error) });
    }
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    setIsDeleting(true);
    try {
      await backupService.deleteDestination(toDelete.id);
      await refreshBackupData();
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Destination removed", message: `${toDelete.name} was removed.` });
      setToDelete(null);
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't remove", message: getErrorMessage(error) });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-13 text-secondary">
          Every backup is saved to all active destinations. Two destinations in different places (for example a server
          folder and cloud storage) protect you even if one of them is lost.
        </p>
        <Button variant="primary" size="lg" prependIcon={<Plus />} onClick={openAdd}>
          Add destination
        </Button>
      </div>

      {isLoading && !destinations ? (
        <Loader className="flex flex-col gap-2">
          <Loader.Item height="72px" />
          <Loader.Item height="72px" />
        </Loader>
      ) : !destinations?.length ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-subtle px-4 py-10 text-center">
          <span className="text-13 text-tertiary">No destinations yet. Backups need somewhere to go.</span>
          <Button variant="secondary" size="lg" prependIcon={<Plus />} onClick={openAdd}>
            Add your first destination
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {destinations.map((destination) => {
            const Icon = KIND_ICONS[destination.kind];
            return (
              <div
                key={destination.id}
                className={cn(
                  "flex flex-col gap-3 rounded-lg border border-subtle bg-layer-1 p-4 sm:flex-row sm:items-center",
                  !destination.is_enabled && "opacity-70"
                )}
              >
                <Icon className="size-5 shrink-0 text-accent-primary" />
                <div className="flex min-w-0 grow flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2 text-13 font-medium text-primary">
                    {destination.name}
                    {!destination.is_enabled && (
                      <Badge variant="neutral" size="sm">
                        Off
                      </Badge>
                    )}
                  </span>
                  <span className="text-12 text-tertiary">{DESTINATION_KINDS[destination.kind].label}</span>
                  <span className="font-mono truncate text-11 text-tertiary">{summary(destination)}</span>
                  <TestStatus destination={destination} />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => void runTest(destination)}
                    loading={testingId === destination.id}
                    disabled={testingId !== null}
                  >
                    Test
                  </Button>
                  <Button variant="ghost" onClick={() => openEdit(destination)} aria-label="Edit">
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button variant="ghost" onClick={() => setToDelete(destination)} aria-label="Remove">
                    <Trash2 className="size-3.5 text-danger-primary" />
                  </Button>
                  <ToggleSwitch
                    value={destination.is_enabled}
                    onChange={(value) => void toggle(destination, value)}
                    size="sm"
                    label={destination.is_enabled ? "Active" : "Off"}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <DestinationModal isOpen={isModalOpen} destination={editing} onClose={() => setIsModalOpen(false)} />
      <AlertModalCore
        isOpen={Boolean(toDelete)}
        handleClose={() => setToDelete(null)}
        handleSubmit={() => void handleDelete()}
        isSubmitting={isDeleting}
        variant="danger"
        title="Remove this destination?"
        primaryButtonText={{ loading: "Removing", default: "Remove" }}
        content={
          <>
            New backups will no longer be saved to {toDelete?.name}. Backups already saved there are not deleted; you
            can still find them at that location.
          </>
        }
      />
    </div>
  );
}

function TestStatus(props: { destination: TBackupDestination }) {
  const { destination } = props;
  if (destination.last_check_ok === null) {
    return <span className="text-12 text-tertiary">Not tested yet.</span>;
  }
  const Icon = destination.last_check_ok ? CheckCircle2 : XCircle;
  return (
    <span
      className={cn(
        "flex items-start gap-1 text-12",
        destination.last_check_ok ? "text-success-primary" : "text-danger-primary"
      )}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" />
      <span>
        {destination.last_check_message}{" "}
        <span className="text-tertiary">({relativeTime(destination.last_checked_at)})</span>
      </span>
    </span>
  );
}
