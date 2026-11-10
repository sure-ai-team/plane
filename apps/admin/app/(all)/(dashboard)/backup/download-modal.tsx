/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Download, Loader2 } from "lucide-react";
// plane imports
import { Button } from "@plane/propel/button";
import type { TBackupSnapshot } from "@plane/types";
import { EModalWidth, ModalCore, ToggleSwitch } from "@plane/ui";
// local
import { formatBytes, formatDateTime, getErrorMessage } from "./helpers";
import { backupService } from "./use-backup";

type Props = { snapshot: TBackupSnapshot | null; onClose: () => void };

export function DownloadBackupModal(props: Props) {
  const { snapshot, onClose } = props;
  const [includeFiles, setIncludeFiles] = useState(false);
  const [exportId, setExportId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    setIncludeFiles(false);
    setExportId(null);
    setError("");
  }, [snapshot]);

  const { data: prepared } = useSWR(
    exportId ? ["BACKUP_EXPORT", exportId] : null,
    () => backupService.getDownload(exportId as string),
    {
      refreshInterval: (data) => (data && (data.status === "queued" || data.status === "running") ? 2000 : 0),
      revalidateOnFocus: false,
    }
  );

  const prepare = async () => {
    if (!snapshot) return;
    setIsStarting(true);
    setError("");
    try {
      setExportId((await backupService.prepareDownload(snapshot.id, includeFiles)).id);
    } catch (prepareError) {
      setError(getErrorMessage(prepareError, "Couldn't prepare the download."));
    } finally {
      setIsStarting(false);
    }
  };

  const estimate = snapshot ? snapshot.database_size + (includeFiles ? snapshot.files_size : 0) : 0;
  const isPreparing = prepared && (prepared.status === "queued" || prepared.status === "running");

  return (
    <ModalCore isOpen={Boolean(snapshot)} handleClose={onClose} width={EModalWidth.XL}>
      <div className="flex flex-col gap-5 p-5">
        <div>
          <h3 className="text-16 font-medium">Download this backup</h3>
          <p className="mt-1 text-13 text-secondary">
            One compressed file you can keep anywhere. You can upload it later with &quot;Restore from a file&quot;, on
            this server or a new one.
          </p>
        </div>

        {!exportId && snapshot && (
          <>
            <div className="flex items-start justify-between gap-6 rounded-lg border border-subtle bg-layer-1 p-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-13 font-medium text-primary">Include uploaded files</span>
                <span className="text-12 text-tertiary">
                  {snapshot.include_files
                    ? `Adds ${snapshot.files_count.toLocaleString()} files (${formatBytes(snapshot.files_size)}). Without them you get the database only.`
                    : "This backup was made without uploaded files."}
                </span>
              </div>
              <ToggleSwitch
                value={includeFiles}
                onChange={setIncludeFiles}
                size="sm"
                disabled={!snapshot.include_files || isStarting}
              />
            </div>
            <p className="text-12 text-tertiary">
              About {formatBytes(estimate)}. Large files are prepared on the server first; you can close this window and
              come back.
            </p>
          </>
        )}

        {prepared && isPreparing && (
          <div className="flex items-center gap-3 rounded-lg border border-subtle bg-layer-1 p-4">
            <Loader2 className="size-4 shrink-0 animate-spin text-accent-primary" />
            <span className="text-13 text-secondary">{prepared.progress || "Preparing the file"}</span>
          </div>
        )}

        {prepared?.status === "ready" && (
          <div className="flex flex-col gap-1 rounded-lg border border-success-subtle bg-success-subtle-1 p-4">
            <span className="text-13 font-medium text-success-primary">Ready: {formatBytes(prepared.size)}</span>
            <span className="text-12 text-secondary">
              Available until {formatDateTime(prepared.expires_at)}. Keep the file somewhere safe: it contains all the
              platform&apos;s data.
            </span>
          </div>
        )}

        {(error || prepared?.status === "failed") && (
          <div className="rounded-md bg-danger-subtle px-3 py-2 text-13 text-danger-primary">
            {error || prepared?.error}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-subtle pt-4">
          <Button variant="secondary" size="lg" onClick={onClose}>
            Close
          </Button>
          {prepared?.status === "ready" ? (
            <a
              href={backupService.downloadUrl(prepared.id)}
              className="inline-flex h-7 items-center gap-1 rounded-md bg-accent-primary px-2 text-body-xs-medium text-on-color hover:bg-accent-primary-hover"
            >
              <Download className="size-3.5" />
              Download
            </a>
          ) : (
            <Button
              variant="primary"
              size="lg"
              onClick={() => void prepare()}
              loading={isStarting || Boolean(isPreparing)}
              disabled={isStarting || Boolean(isPreparing) || !snapshot}
            >
              {isPreparing ? "Preparing" : "Prepare download"}
            </Button>
          )}
        </div>
      </div>
    </ModalCore>
  );
}
