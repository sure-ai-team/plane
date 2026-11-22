/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useState } from "react";
import { Download, FileUp, X } from "lucide-react";
import { useDropzone } from "react-dropzone";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type {
  TPageImportConflictMode,
  TPageImportError,
  TPageImportResponse,
  TPageImportResult,
  TPageTransferDocument,
  TPageTransferFormat,
} from "@plane/types";
import { CustomSelect, EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useFileSize } from "@/hooks/use-file-size";
// services
import { ProjectPageService } from "@/services/page";
// local imports
import { PageTransferFormatSelect } from "./format-select";
import { downloadBlob } from "./helpers/download";
import { IMPORT_ACCEPT, PageTransferFileError, parseImportFiles } from "./helpers/formats";
import { buildTemplateFile } from "./helpers/templates";

const projectPageService = new ProjectPageService();

const CONFLICT_MODES: TPageImportConflictMode[] = ["skip", "update", "duplicate"];

type TPreview = {
  fileNames: string[];
  document: TPageTransferDocument;
  sources: string[];
  response: TPageImportResponse;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  workspaceSlug: string;
  projectId: string;
  /** Called after pages were created or updated, to refresh the list. */
  onImported: () => void | Promise<void>;
};

const ACTION_STYLES: Record<TPageImportResult["action"], string> = {
  create: "bg-success-subtle text-success-primary",
  update: "bg-accent-subtle text-accent-primary",
  skip: "bg-layer-3 text-tertiary",
};

export function ImportPagesModal(props: Props) {
  const { isOpen, onClose, workspaceSlug, projectId, onImported } = props;
  const { t } = useTranslation();
  const { maxFileSize } = useFileSize();
  // states
  const [templateFormat, setTemplateFormat] = useState<TPageTransferFormat>("csv");
  const [conflictMode, setConflictMode] = useState<TPageImportConflictMode>("skip");
  const [preview, setPreview] = useState<TPreview | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const reset = () => {
    setPreview(null);
    setFileError(null);
    setConflictMode("skip");
  };

  const handleClose = () => {
    if (isImporting) return;
    onClose();
    setTimeout(reset, 300);
  };

  const fileErrorMessage = useCallback(
    (error: unknown): string => {
      if (error instanceof PageTransferFileError) return t(`pages_transfer.file_errors.${error.code}`, error.params);
      return t("pages_transfer.import.read_error");
    },
    [t]
  );

  const runDryRun = useCallback(
    async (document: TPageTransferDocument, mode: TPageImportConflictMode) =>
      projectPageService.importPages(workspaceSlug, projectId, { ...document, on_conflict: mode, dry_run: true }),
    [projectId, workspaceSlug]
  );

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;
      setIsReading(true);
      setFileError(null);
      try {
        const files = await Promise.all(
          acceptedFiles.map(async (file) => ({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) }))
        );
        const { document, sources } = await parseImportFiles(files);
        const payloadSize = new Blob([JSON.stringify(document)]).size;
        if (payloadSize > maxFileSize) {
          throw new PageTransferFileError("too_large", { size: Math.floor(maxFileSize / 1024 / 1024) });
        }
        const response = await runDryRun(document, conflictMode);
        setPreview({ fileNames: acceptedFiles.map((file) => file.name), document, sources, response });
      } catch (error) {
        setFileError(
          error instanceof PageTransferFileError || error instanceof Error
            ? fileErrorMessage(error)
            : t("pages_transfer.import.validate_error")
        );
      } finally {
        setIsReading(false);
      }
    },
    [conflictMode, fileErrorMessage, maxFileSize, runDryRun, t]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (files) => void onDrop(files),
    accept: IMPORT_ACCEPT,
    multiple: true,
    disabled: isReading,
  });

  const handleConflictModeChange = async (mode: TPageImportConflictMode) => {
    setConflictMode(mode);
    if (!preview) return;
    setIsReading(true);
    try {
      const response = await runDryRun(preview.document, mode);
      setPreview({ ...preview, response });
    } catch {
      setFileError(t("pages_transfer.import.validate_error"));
    } finally {
      setIsReading(false);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const { blob, fileName } = await buildTemplateFile(
        templateFormat,
        (key) => t(`pages_transfer.template.${key}`),
        t("pages_transfer.template.file_name")
      );
      downloadBlob(blob, fileName);
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("pages_transfer.import.template_error_title"),
        message: t("pages_transfer.import.template_error_message"),
      });
    }
  };

  const handleImport = async () => {
    if (!preview) return;
    setIsImporting(true);
    try {
      const response = await projectPageService.importPages(workspaceSlug, projectId, {
        ...preview.document,
        on_conflict: conflictMode,
      });
      await onImported();
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("pages_transfer.import.success_title"),
        message: t("pages_transfer.import.success_message", {
          created: response.created ?? 0,
          updated: response.updated ?? 0,
          skipped: response.skipped ?? 0,
        }),
      });
      onClose();
      setTimeout(reset, 300);
    } catch (error) {
      const body = error as Partial<TPageImportResponse> | undefined;
      if (body?.errors?.length) {
        // The data changed since the preview; show the new errors
        setPreview({ ...preview, response: { valid: false, errors: body.errors, results: [] } });
      } else {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: t("pages_transfer.import.error_title"),
          message: t("pages_transfer.import.error_message"),
        });
      }
    } finally {
      setIsImporting(false);
    }
  };

  const describeError = (error: TPageImportError) => {
    const text = error.code ? t(`pages_transfer.import.errors.${error.code}`, error.params ?? {}) : error.message;
    if (error.index === null || !preview) return text;
    const page = preview.document.pages[error.index];
    const name = typeof page?.name === "string" && page.name.trim() ? page.name.trim() : null;
    const location = name
      ? t("pages_transfer.import.error_location_named", { number: error.index + 1, name })
      : t("pages_transfer.import.error_location", { number: error.index + 1 });
    return `${location}: ${text}`;
  };

  const results = preview?.response.results ?? [];
  const counts = {
    create: results.filter((result) => result.action === "create").length,
    update: results.filter((result) => result.action === "update").length,
    skip: results.filter((result) => result.action === "skip").length,
  };
  const canImport = !!preview?.response.valid && counts.create + counts.update > 0 && !isReading;
  const labelsToCreate = preview?.response.labels_to_create ?? [];

  return (
    <ModalCore isOpen={isOpen} handleClose={handleClose} position={EModalPosition.CENTER} width={EModalWidth.XXXL}>
      <div className="max-h-[80vh] space-y-5 overflow-y-auto p-5">
        <div className="space-y-1">
          <h3 className="text-18 font-medium text-secondary">{t("pages_transfer.import.title")}</h3>
          <p className="text-13 text-tertiary">{t("pages_transfer.import.description")}</p>
        </div>

        {!preview && (
          <>
            <section className="space-y-2 rounded-md border-[0.5px] border-subtle p-4">
              <h4 className="text-13 font-medium text-secondary">{t("pages_transfer.import.template_title")}</h4>
              <p className="text-12 text-tertiary">{t("pages_transfer.import.template_description")}</p>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <PageTransferFormatSelect value={templateFormat} onChange={setTemplateFormat} />
                <Button variant="secondary" size="lg" onClick={() => void handleDownloadTemplate()}>
                  <Download className="size-3.5" />
                  {t("pages_transfer.import.download_template")}
                </Button>
              </div>
            </section>

            <section className="space-y-2">
              <h4 className="text-13 font-medium text-secondary">{t("pages_transfer.import.upload_title")}</h4>
              <div
                {...getRootProps()}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-subtle px-4 py-8 text-center",
                  {
                    "border-accent-strong bg-accent-subtle": isDragActive,
                    "cursor-wait opacity-60": isReading,
                  }
                )}
              >
                <input {...getInputProps()} />
                <FileUp className="size-6 text-tertiary" />
                <p className="text-13 text-secondary">
                  {isReading
                    ? t("pages_transfer.import.reading")
                    : isDragActive
                      ? t("pages_transfer.import.drop_active")
                      : t("pages_transfer.import.drop_idle")}
                </p>
                <p className="text-12 text-tertiary">{t("pages_transfer.import.supported_files")}</p>
              </div>
              {fileError && <p className="text-12 text-danger-primary">{fileError}</p>}
            </section>
          </>
        )}

        {preview && (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 text-13 text-secondary">
                <span className="truncate">{preview.fileNames.join(", ")}</span>
                <button
                  type="button"
                  className="flex-shrink-0 rounded-sm p-0.5 text-tertiary hover:bg-layer-transparent-hover"
                  onClick={reset}
                  disabled={isImporting}
                  aria-label={t("pages_transfer.import.choose_another")}
                  title={t("pages_transfer.import.choose_another")}
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-13 text-secondary">{t("pages_transfer.import.conflict_label")}</span>
                <CustomSelect
                  label={t(`pages_transfer.import.conflict_modes.${conflictMode}`)}
                  value={conflictMode}
                  onChange={(mode: TPageImportConflictMode) => void handleConflictModeChange(mode)}
                  buttonClassName="border-[0.5px] border-subtle"
                  placement="bottom-end"
                  disabled={isReading || isImporting}
                >
                  {CONFLICT_MODES.map((mode) => (
                    <CustomSelect.Option key={mode} value={mode}>
                      <div className="flex flex-col">
                        <span>{t(`pages_transfer.import.conflict_modes.${mode}`)}</span>
                        <span className="text-11 text-tertiary">
                          {t(`pages_transfer.import.conflict_mode_hints.${mode}`)}
                        </span>
                      </div>
                    </CustomSelect.Option>
                  ))}
                </CustomSelect>
              </div>
            </div>

            {!preview.response.valid ? (
              <div className="space-y-1 rounded-md border-[0.5px] border-danger-subtle bg-danger-subtle p-3">
                <p className="text-13 font-medium text-danger-primary">
                  {t("pages_transfer.import.invalid_title", { count: preview.response.errors.length })}
                </p>
                <ul className="max-h-48 list-disc space-y-0.5 overflow-y-auto ps-5 text-12 text-danger-primary">
                  {preview.response.errors.map((error) => (
                    <li key={`${error.index ?? "file"}:${error.field ?? ""}:${error.message}`}>
                      {describeError(error)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <>
                <p className="text-13 text-secondary">
                  {t("pages_transfer.import.summary", {
                    total: results.length,
                    created: counts.create,
                    updated: counts.update,
                    skipped: counts.skip,
                  })}
                </p>
                {labelsToCreate.length > 0 && (
                  <p className="text-12 text-tertiary">
                    {t("pages_transfer.import.labels_to_create", { labels: labelsToCreate.join(", ") })}
                  </p>
                )}
                <div className="max-h-72 overflow-y-auto rounded-md border-[0.5px] border-subtle">
                  <table className="w-full text-start text-12">
                    <thead className="sticky top-0 bg-layer-1 text-tertiary">
                      <tr>
                        <th className="px-3 py-2 text-start font-medium">#</th>
                        <th className="px-3 py-2 text-start font-medium">{t("pages_transfer.columns.name")}</th>
                        <th className="px-3 py-2 text-start font-medium">{t("pages_transfer.columns.access")}</th>
                        <th className="px-3 py-2 text-start font-medium">{t("pages_transfer.columns.labels")}</th>
                        <th className="px-3 py-2 text-start font-medium">{t("pages_transfer.columns.result")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((result) => {
                        const page = preview.document.pages[result.index];
                        const access = page?.access === "private" ? "private" : "public";
                        return (
                          <tr key={result.index} className="border-t-[0.5px] border-subtle text-secondary">
                            <td className="px-3 py-2 text-tertiary">{result.index + 1}</td>
                            <td className="max-w-56 truncate px-3 py-2" title={preview.sources[result.index]}>
                              {result.name}
                            </td>
                            <td className="px-3 py-2">{t(`pages_transfer.access.${access}`)}</td>
                            <td className="max-w-40 truncate px-3 py-2">{(page?.labels ?? []).join(", ")}</td>
                            <td className="px-3 py-2">
                              <span
                                className={cn(
                                  "rounded-sm px-1.5 py-0.5 text-11 font-medium",
                                  ACTION_STYLES[result.action]
                                )}
                              >
                                {t(`pages_transfer.import.actions.${result.action}`)}
                              </span>
                              {result.reason && (
                                <span className="ms-2 text-11 text-tertiary">
                                  {t(`pages_transfer.import.reasons.${result.reason}`)}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {fileError && <p className="text-12 text-danger-primary">{fileError}</p>}
          </section>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 border-t-[0.5px] border-subtle px-5 py-4">
        <Button variant="secondary" size="lg" onClick={handleClose} disabled={isImporting}>
          {t("common.cancel")}
        </Button>
        {preview && (
          <Button variant="primary" size="lg" loading={isImporting} disabled={!canImport} onClick={handleImport}>
            {isImporting
              ? t("pages_transfer.import.importing")
              : t("pages_transfer.import.submit", { count: counts.create + counts.update })}
          </Button>
        )}
      </div>
    </ModalCore>
  );
}
