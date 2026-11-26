/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { observer } from "mobx-react";
import { useSearchParams } from "react-router";
import useSWR from "swr";
import { FileSpreadsheet, Search, Upload } from "lucide-react";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TProjectSpreadsheet } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { DeleteSpreadsheetModal } from "./delete-modal";
import { PendingUploadCard, SpreadsheetFileCard } from "./file-card";
import { getCachedPreviews } from "./helpers/cache";
import {
  SPREADSHEET_ACCEPT,
  SPREADSHEET_FILE_SEARCH_PARAM,
  SPREADSHEET_MAX_FILE_SIZE,
  SPREADSHEET_SEARCH_THRESHOLD,
} from "./helpers/constants";
import type { TSpreadsheetErrorShape } from "./helpers/errors";
import { getProjectSpreadsheetService, useProjectSpreadsheets } from "./hooks/use-project-spreadsheets";
import { SpreadsheetViewer } from "./viewer/root";

type Props = {
  workspaceSlug: string;
  projectId: string;
};

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

export const ProjectDataFiles = observer(function ProjectDataFiles(props: Props) {
  const { workspaceSlug, projectId } = props;
  const { t } = useTranslation();
  const store = useProjectSpreadsheets();
  const { allowPermissions } = useUserPermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  // refs
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef<string | null>(null);
  const dragDepth = useRef(0);
  // state
  const [isDragging, setIsDragging] = useState(false);
  const [query, setQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<TProjectSpreadsheet | null>(null);
  // derived values
  const canEdit = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug,
    projectId
  );
  const spreadsheets = store.getProjectSpreadsheets(projectId);
  const pendingUploads = store.getPendingUploads(projectId);
  const loader = store.loaderMap[projectId];
  const openFileId = searchParams.get(SPREADSHEET_FILE_SEARCH_PARAM);
  const showSearch = spreadsheets.length > SPREADSHEET_SEARCH_THRESHOLD;
  const service = getProjectSpreadsheetService();

  const { mutate } = useSWR(
    workspaceSlug && projectId ? `PROJECT_DATA_FILES_${workspaceSlug}_${projectId}` : null,
    () => store.fetchSpreadsheets(workspaceSlug, projectId),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  // previews cached from earlier visits
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const previews = await getCachedPreviews();
      if (!cancelled && previews.length) store.setPreviews(previews);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [store]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle || !showSearch) return spreadsheets;
    return spreadsheets.filter((spreadsheet) => spreadsheet.name.toLocaleLowerCase().includes(needle));
  }, [spreadsheets, query, showSearch]);

  const showError = useCallback(
    (error: TSpreadsheetErrorShape) =>
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("spreadsheet.errors.title"),
        message: t(`spreadsheet.errors.${error.code}`, error.params ?? {}),
      }),
    [t]
  );

  const uploadFiles = useCallback(
    (files: FileList | File[] | null | undefined) => {
      if (!files || !canEdit) return;
      for (const file of Array.from(files)) {
        const result = store.uploadSpreadsheet(workspaceSlug, projectId, file);
        if (!result.ok) showError(result.error);
      }
    },
    [canEdit, store, workspaceSlug, projectId, showError]
  );

  const replaceFile = (file: File | undefined) => {
    const targetId = replaceTargetRef.current;
    replaceTargetRef.current = null;
    if (!file || !targetId) return;
    const result = store.replaceSpreadsheet(workspaceSlug, projectId, targetId, file);
    if (!result.ok) showError(result.error);
  };

  const openFile = useCallback(
    (id: string) =>
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set(SPREADSHEET_FILE_SEARCH_PARAM, id);
          return next;
        },
        { preventScrollReset: true }
      ),
    [setSearchParams]
  );

  const closeFile = useCallback(
    () =>
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.delete(SPREADSHEET_FILE_SEARCH_PARAM);
          return next;
        },
        { preventScrollReset: true, replace: true }
      ),
    [setSearchParams]
  );

  const handleRename = useCallback(
    (id: string, name: string) => store.renameSpreadsheet(workspaceSlug, projectId, id, name),
    [store, workspaceSlug, projectId]
  );

  const handleDelete = async (spreadsheet: TProjectSpreadsheet) => {
    await store.deleteSpreadsheet(workspaceSlug, projectId, spreadsheet.id);
    if (openFileId === spreadsheet.id) closeFile();
  };

  // drag & drop anywhere on the section
  const dropHandlers = canEdit
    ? {
        onDragEnter: (event: DragEvent) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          dragDepth.current += 1;
          setIsDragging(true);
        },
        onDragOver: (event: DragEvent) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        },
        onDragLeave: (event: DragEvent) => {
          if (!hasFiles(event)) return;
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setIsDragging(false);
        },
        onDrop: (event: DragEvent) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          dragDepth.current = 0;
          setIsDragging(false);
          uploadFiles(event.dataTransfer.files);
        },
      }
    : {};

  const isLoading = loader === "init-loader" && spreadsheets.length === 0;
  const isEmpty = !isLoading && loader !== "error" && spreadsheets.length === 0 && pendingUploads.length === 0;
  const maxSize = SPREADSHEET_MAX_FILE_SIZE / (1024 * 1024);

  return (
    <>
      <section
        aria-labelledby="project-data-files"
        className="@container relative flex flex-col gap-3"
        {...dropHandlers}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 id="project-data-files" className="text-14 font-semibold text-primary">
              {t("spreadsheet.title")}
            </h2>
            {spreadsheets.length > 0 && (
              <span className="rounded-full bg-layer-1 px-1.5 text-11 font-medium text-tertiary tabular-nums">
                {spreadsheets.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {showSearch && (
              <label className="flex h-7 w-48 items-center gap-1.5 rounded-md border border-subtle bg-surface-1 px-2 transition-colors duration-150 focus-within:border-accent-strong">
                <Search className="size-3.5 flex-shrink-0 text-placeholder" aria-hidden />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("spreadsheet.search_placeholder")}
                  aria-label={t("spreadsheet.search_placeholder")}
                  className="h-full min-w-0 flex-1 bg-transparent text-13 text-primary outline-none placeholder:text-placeholder"
                />
              </label>
            )}
            {canEdit && !isEmpty && (
              <Button
                variant="secondary"
                size="lg"
                prependIcon={<Upload />}
                onClick={() => uploadInputRef.current?.click()}
              >
                {t("spreadsheet.upload")}
              </Button>
            )}
          </div>
        </div>

        {isLoading && (
          <div className="grid grid-cols-1 gap-3 @md:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4" aria-busy>
            {[0, 1, 2].map((index) => (
              <div key={index} className="overflow-hidden rounded-lg border border-subtle">
                <div className="h-28 animate-pulse bg-layer-1" />
                <div className="flex gap-2.5 p-3">
                  <div className="size-8 animate-pulse rounded-md bg-layer-1" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <div className="h-3 w-3/4 animate-pulse rounded-sm bg-layer-1" />
                    <div className="h-2.5 w-1/2 animate-pulse rounded-sm bg-layer-1" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {loader === "error" && spreadsheets.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-subtle px-4 py-8 text-center">
            <p className="text-13 text-secondary">{t("spreadsheet.load_error")}</p>
            <Button variant="secondary" size="base" onClick={() => void mutate()}>
              {t("common.retry")}
            </Button>
          </div>
        )}

        {isEmpty && (
          <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-subtle px-4 py-10 text-center">
            <span className="mb-2 flex size-10 items-center justify-center rounded-lg bg-success-subtle text-success-primary">
              <FileSpreadsheet className="size-5" aria-hidden />
            </span>
            <p className="text-13 font-medium text-secondary">{t("spreadsheet.empty.title")}</p>
            <p className="max-w-sm text-13 text-tertiary">
              {canEdit ? t("spreadsheet.empty.description") : t("spreadsheet.empty.guest_description")}
            </p>
            {canEdit && (
              <>
                <Button
                  variant="primary"
                  size="lg"
                  className="mt-3"
                  prependIcon={<Upload />}
                  onClick={() => uploadInputRef.current?.click()}
                >
                  {t("spreadsheet.upload_files")}
                </Button>
                <p className="mt-1 text-11 text-placeholder">{t("spreadsheet.drop_hint", { size: maxSize })}</p>
              </>
            )}
          </div>
        )}

        {(filtered.length > 0 || pendingUploads.length > 0) && (
          <ul className="grid grid-cols-1 gap-3 @md:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4">
            {pendingUploads.map((upload) => (
              <li key={upload.tempId}>
                <PendingUploadCard upload={upload} onRetry={store.retryUpload} onDismiss={store.dismissUpload} />
              </li>
            ))}
            {filtered.map((spreadsheet) => (
              <li key={spreadsheet.id}>
                <SpreadsheetFileCard
                  spreadsheet={spreadsheet}
                  preview={store.getPreview(spreadsheet)}
                  upload={store.getUploadForSpreadsheet(spreadsheet.id)}
                  canEdit={canEdit}
                  downloadUrl={service.getDownloadUrl(workspaceSlug, projectId, spreadsheet.id)}
                  onOpen={openFile}
                  onRename={handleRename}
                  onReplace={(id) => {
                    replaceTargetRef.current = id;
                    replaceInputRef.current?.click();
                  }}
                  onDelete={setDeleteTarget}
                  onRetry={store.retryUpload}
                />
              </li>
            ))}
          </ul>
        )}

        {showSearch && query.trim() && filtered.length === 0 && (
          <p className="py-6 text-center text-13 text-tertiary">
            {t("spreadsheet.no_results", { query: query.trim() })}
          </p>
        )}

        {/* full-area drop overlay */}
        {canEdit && (
          <div
            aria-hidden={!isDragging}
            className={cn(
              "pointer-events-none absolute -inset-2 z-10 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-accent-strong bg-accent-subtle/80 backdrop-blur-[2px] transition-opacity duration-150",
              isDragging ? "opacity-100" : "opacity-0"
            )}
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-surface-1 text-accent-primary shadow-raised-100">
              <Upload className="size-5" aria-hidden />
            </span>
            <p className="text-14 font-semibold text-accent-primary">{t("spreadsheet.drop_here")}</p>
            <p className="text-12 text-secondary">{t("spreadsheet.drop_hint", { size: maxSize })}</p>
          </div>
        )}

        {canEdit && (
          <>
            <input
              ref={uploadInputRef}
              type="file"
              multiple
              accept={SPREADSHEET_ACCEPT}
              className="hidden"
              onChange={(event) => {
                uploadFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <input
              ref={replaceInputRef}
              type="file"
              accept={SPREADSHEET_ACCEPT}
              className="hidden"
              onChange={(event) => {
                replaceFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </>
        )}
      </section>
      <DeleteSpreadsheetModal
        spreadsheet={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDelete={handleDelete}
      />

      {openFileId && loader === "loaded" && (
        <SpreadsheetViewer
          key={openFileId}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          spreadsheetId={openFileId}
          canEdit={canEdit}
          onClose={closeFile}
        />
      )}
    </>
  );
});
