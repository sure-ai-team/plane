/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
// plane imports
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EModalWidth, Input, ModalCore, ToggleSwitch } from "@plane/ui";
// local
import { getErrorMessage } from "./helpers";
import { backupService, refreshBackupData } from "./use-backup";

type Props = { isOpen: boolean; onClose: () => void };

export function StartBackupModal(props: Props) {
  const { isOpen, onClose } = props;
  const [note, setNote] = useState("");
  const [includeFiles, setIncludeFiles] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen) {
      setNote("");
      setIncludeFiles(true);
      setError("");
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError("");
    try {
      await backupService.startBackup({ note: note.trim(), include_files: includeFiles });
      await refreshBackupData();
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Backup started",
        message: "It runs in the background. You can leave this page.",
      });
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, "Couldn't start the backup."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} width={EModalWidth.XL}>
      <form
        className="flex flex-col gap-5 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <div>
          <h3 className="text-16 font-medium">Back up now</h3>
          <p className="mt-1 text-13 text-secondary">
            Makes a full copy right away and saves it to every active destination. People can keep working while it
            runs.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="backup-note" className="text-13 text-tertiary">
            Note (optional)
          </label>
          <Input
            id="backup-note"
            value={note}
            maxLength={200}
            onChange={(event) => setNote(event.target.value)}
            placeholder="For example: Before the yearly clean-up"
            className="w-full"
          />
          <p className="text-11 text-tertiary">Helps you find this backup later.</p>
        </div>

        <div className="flex items-start justify-between gap-6 rounded-lg border border-subtle bg-layer-1 p-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-13 font-medium text-primary">Include uploaded files</span>
            <span className="text-12 text-tertiary">
              Attachments, images and chat files. Only files added since the last backup are copied.
            </span>
          </div>
          <ToggleSwitch value={includeFiles} onChange={setIncludeFiles} size="sm" disabled={isSubmitting} />
        </div>

        {error && <div className="rounded-md bg-danger-subtle px-3 py-2 text-13 text-danger-primary">{error}</div>}

        <div className="flex justify-end gap-2 border-t border-subtle pt-4">
          <Button variant="secondary" size="lg" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="lg" loading={isSubmitting}>
            {isSubmitting ? "Starting" : "Start backup"}
          </Button>
        </div>
      </form>
    </ModalCore>
  );
}
