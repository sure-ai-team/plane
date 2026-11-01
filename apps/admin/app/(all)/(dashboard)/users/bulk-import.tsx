/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef, useState } from "react";
import { Download, FileSpreadsheet, Upload, X } from "lucide-react";
// plane imports
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { InstanceService } from "@plane/services";
import type { TBulkUserCreateError, TBulkUserCreateResponse, TBulkUserRole } from "@plane/types";
// local
import { ACCEPTED_FILE_TYPES, buildResultsCsv, downloadFile, resultsFilename } from "./helpers";
import { BulkUserResultsTable } from "./results-table";
import {
  DISCARD_PASSWORDS_PROMPT,
  NO_WORKSPACE,
  PasswordNotice,
  RoleSelect,
  Step,
  WorkspaceSelect,
  useUnsavedPasswordsWarning,
} from "./shared";

const instanceService = new InstanceService();

type Props = { loginUrl: string };

export function BulkUserImport(props: Props) {
  const { loginUrl } = props;
  // state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [workspace, setWorkspace] = useState<string>(NO_WORKSPACE);
  const [role, setRole] = useState<TBulkUserRole>("member");
  const [response, setResponse] = useState<TBulkUserCreateResponse | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [hasSavedPasswords, setHasSavedPasswords] = useState(false);

  const isPreview = response?.dry_run ?? true;
  const createdRows = response && !response.dry_run ? response.results.filter((row) => row.password) : [];
  const hasUnsavedPasswords = createdRows.length > 0 && !hasSavedPasswords;
  useUnsavedPasswordsWarning(hasUnsavedPasswords);

  const confirmDiscardPasswords = () => !hasUnsavedPasswords || window.confirm(DISCARD_PASSWORDS_PROMPT);

  const resetResults = () => {
    setResponse(null);
    setHasSavedPasswords(false);
  };

  const handleTemplateDownload = async () => {
    setIsDownloading(true);
    try {
      downloadFile(await instanceService.downloadBulkUserTemplate(), "users-template.xlsx");
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: "Download failed", message: "Could not download the template." });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleFileChange = (selected: File | null) => {
    if (!confirmDiscardPasswords()) return;
    setFile(selected);
    resetResults();
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const submit = async (dryRun: boolean) => {
    if (!file) return;
    if (dryRun && !confirmDiscardPasswords()) return;
    const setBusy = dryRun ? setIsChecking : setIsCreating;
    setBusy(true);
    try {
      const result = await instanceService.bulkCreateUsers({
        file,
        dryRun,
        workspace: workspace || undefined,
        role,
      });
      setResponse(result);
      setHasSavedPasswords(false);
      if (!dryRun) {
        const { created, existing, failed } = result.summary;
        setToast({
          type: failed ? TOAST_TYPE.WARNING : TOAST_TYPE.SUCCESS,
          title: `${created} account${created === 1 ? "" : "s"} created`,
          message: `${existing} already existed, ${failed} failed.`,
        });
      }
    } catch (error) {
      const message = (error as TBulkUserCreateError | undefined)?.error ?? "Something went wrong. Try again.";
      setToast({
        type: TOAST_TYPE.ERROR,
        title: dryRun ? "Could not check the file" : "Could not create users",
        message,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleResultsDownload = () => {
    if (!response) return;
    downloadFile(buildResultsCsv(response.results), resultsFilename());
    setHasSavedPasswords(true);
  };

  const handleStartOver = () => {
    if (!confirmDiscardPasswords()) return;
    setFile(null);
    resetResults();
  };

  const summary = response?.summary;
  const canCreate = Boolean(response?.dry_run && summary && summary.created + summary.existing > 0);

  return (
    <div>
      <Step
        number={1}
        title="Download the template"
        description="Fill in one row per user: email, first and last name, and phone number with country code. Workspace, role and projects are optional."
      >
        <div>
          <Button
            variant="secondary"
            size="lg"
            prependIcon={<Download />}
            loading={isDownloading}
            onClick={() => void handleTemplateDownload()}
          >
            Download template (.xlsx)
          </Button>
        </div>
      </Step>

      <Step
        number={2}
        title="Upload the filled-in file"
        description="Choose the defaults for rows that leave workspace or role empty, then check the file. Nothing is saved until you create the accounts."
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          className="hidden"
          onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)}
        />
        {file ? (
          <div className="flex max-w-xl items-center gap-3 rounded-md border border-subtle bg-layer-1 px-3 py-2">
            <FileSpreadsheet className="size-5 shrink-0 text-success-primary" />
            <div className="min-w-0 grow">
              <div className="truncate text-13 font-medium text-primary">{file.name}</div>
              <div className="text-11 text-tertiary">{(file.size / 1024).toFixed(1)} KB</div>
            </div>
            <Button variant="ghost" size="base" onClick={() => fileInputRef.current?.click()}>
              Change
            </Button>
            <Button variant="ghost" size="base" aria-label="Remove file" onClick={handleStartOver}>
              <X className="size-3.5" />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              handleFileChange(event.dataTransfer.files?.[0] ?? null);
            }}
            className="flex max-w-xl flex-col items-center gap-1 rounded-md border border-dashed border-strong px-4 py-8 text-center transition-colors hover:bg-layer-transparent-hover"
          >
            <Upload className="size-5 text-tertiary" />
            <span className="text-13 font-medium text-primary">Choose a file or drop it here</span>
            <span className="text-11 text-tertiary">Excel (.xlsx) or CSV, up to 1,000 users</span>
          </button>
        )}

        <div className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
          <WorkspaceSelect
            label="Default workspace"
            value={workspace}
            onChange={(value) => {
              setWorkspace(value);
              resetResults();
            }}
          />
          <RoleSelect
            label="Default role"
            value={role}
            onChange={(value) => {
              setRole(value);
              resetResults();
            }}
          />
        </div>

        <div>
          <Button
            variant="primary"
            size="lg"
            disabled={!file || isCreating}
            loading={isChecking}
            onClick={() => void submit(true)}
          >
            Check file
          </Button>
        </div>
      </Step>

      <Step
        number={3}
        title={isPreview ? "Review and create" : "Send each user their password"}
        description={
          isPreview
            ? "Check the rows below. Rows with errors are skipped; fix them in the file and upload it again, or create the valid rows now."
            : "Copy each user's message and send it to them privately, for example on WhatsApp. Download the list to keep a copy."
        }
      >
        {!response ? (
          <div className="text-13 text-tertiary">Results appear here after you check a file.</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-13">
              <span className="rounded-md bg-success-subtle-1 px-2 py-0.5 text-success-primary">
                {summary?.created} {isPreview ? "to create" : "created"}
              </span>
              <span className="rounded-md bg-warning-subtle px-2 py-0.5 text-warning-primary">
                {summary?.existing} already exist
              </span>
              <span className="rounded-md bg-danger-subtle px-2 py-0.5 text-danger-primary">
                {summary?.failed} {isPreview ? "with errors" : "failed"}
              </span>
              <div className="grow" />
              {isPreview ? (
                <Button
                  variant="primary"
                  size="lg"
                  disabled={!canCreate || isChecking}
                  loading={isCreating}
                  onClick={() => void submit(false)}
                >
                  {summary?.created ? `Create ${summary.created} account${summary.created === 1 ? "" : "s"}` : "Apply"}
                </Button>
              ) : (
                <>
                  <Button variant="secondary" size="lg" prependIcon={<Download />} onClick={handleResultsDownload}>
                    Download list (.csv)
                  </Button>
                  <Button variant="ghost" size="lg" onClick={handleStartOver}>
                    Upload another file
                  </Button>
                </>
              )}
            </div>

            {createdRows.length > 0 && (
              <PasswordNotice
                saved={hasSavedPasswords}
                savedText="List downloaded. Delete the file once every user has their password."
                unsavedText="These temporary passwords are shown only now and are not stored. Copy the messages or download the list before you leave this page."
              />
            )}

            <BulkUserResultsTable rows={response.results} isPreview={isPreview} loginUrl={loginUrl} />
          </>
        )}
      </Step>
    </div>
  );
}
