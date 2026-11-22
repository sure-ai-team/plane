/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { FileArchive, Upload } from "lucide-react";
// plane imports
import { Button } from "@plane/propel/button";
import { EModalWidth, ModalCore } from "@plane/ui";
// local
import { formatBytes, getErrorMessage } from "./helpers";
import { backupService } from "./use-backup";

const MAX_RETRIES = 5;

type Props = {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the new restore once the file is uploaded and checking has started. */
  onInspecting: (restoreId: string) => void;
};

export function RestoreFromFileModal(props: Props) {
  const { isOpen, onClose, onInspecting } = props;
  const [file, setFile] = useState<File | null>(null);
  const [sent, setSent] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");
  const cancelled = useRef(false);

  useEffect(() => {
    if (isOpen) {
      setFile(null);
      setSent(0);
      setError("");
      cancelled.current = false;
    }
  }, [isOpen]);

  const upload = async () => {
    if (!file) return;
    setIsUploading(true);
    setError("");
    cancelled.current = false;
    try {
      const created = await backupService.createUpload({ filename: file.name, size: file.size });
      const chunkSize = created.chunk_size ?? 4 * 1024 * 1024;
      let offset = 0;
      let retries = 0;
      // Chunks go up one at a time and in order: the server only accepts the next expected offset.
      /* oxlint-disable no-await-in-loop */
      while (offset < file.size) {
        if (cancelled.current) return;
        try {
          const result = await backupService.uploadChunk(created.id, offset, file.slice(offset, offset + chunkSize));
          offset = result.received;
          retries = 0;
          setSent(offset);
        } catch (chunkError) {
          // The server says where it is; carry on from there (covers a lost response).
          const received = (chunkError as { received?: number } | undefined)?.received;
          if (typeof received === "number") {
            offset = received;
            continue;
          }
          retries += 1;
          if (retries > MAX_RETRIES) throw chunkError;
          await new Promise((resolve) => setTimeout(resolve, 1000 * retries));
          offset = (await backupService.getUpload(created.id)).received;
        }
      }
      /* oxlint-enable no-await-in-loop */
      const restore = await backupService.inspectUpload(created.id);
      onInspecting(restore.id);
    } catch (uploadError) {
      setError(getErrorMessage(uploadError, "The upload failed. Check your connection and try again."));
    } finally {
      setIsUploading(false);
    }
  };

  const close = () => {
    cancelled.current = true;
    onClose();
  };

  const percent = file && file.size ? Math.floor((sent / file.size) * 100) : 0;

  return (
    <ModalCore isOpen={isOpen} handleClose={close} width={EModalWidth.XL}>
      <div className="flex flex-col gap-5 p-5">
        <div>
          <h3 className="text-16 font-medium">Restore from a file</h3>
          <p className="mt-1 text-13 text-secondary">
            Choose a backup file you downloaded from this page earlier (it ends in .tar.gz). It is checked first and you
            see what is inside before anything changes.
          </p>
        </div>

        <label
          className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-strong bg-layer-1 px-4 py-8 text-center hover:bg-layer-1-hover"
          aria-disabled={isUploading}
        >
          <FileArchive className="size-6 text-accent-primary" />
          {file ? (
            <>
              <span className="text-13 font-medium text-primary">{file.name}</span>
              <span className="text-12 text-tertiary">{formatBytes(file.size)}</span>
            </>
          ) : (
            <span className="text-13 text-secondary">Click to choose a backup file</span>
          )}
          <input
            type="file"
            accept=".gz,.tgz,application/gzip"
            className="hidden"
            disabled={isUploading}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setSent(0);
              setError("");
            }}
          />
        </label>

        {isUploading && (
          <div className="flex flex-col gap-1">
            <div className="h-2 overflow-hidden rounded-full bg-layer-3">
              <div className="h-full bg-accent-primary transition-all" style={{ width: `${percent}%` }} />
            </div>
            <span className="text-12 text-tertiary">
              Uploading {formatBytes(sent)} of {formatBytes(file?.size ?? 0)} ({percent}%)
            </span>
          </div>
        )}

        {error && <div className="rounded-md bg-danger-subtle px-3 py-2 text-13 text-danger-primary">{error}</div>}

        <div className="flex justify-end gap-2 border-t border-subtle pt-4">
          <Button variant="secondary" size="lg" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="lg"
            prependIcon={<Upload />}
            onClick={() => void upload()}
            loading={isUploading}
            disabled={!file || isUploading}
          >
            {isUploading ? "Uploading" : "Upload and check"}
          </Button>
        </div>
      </div>
    </ModalCore>
  );
}
