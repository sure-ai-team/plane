/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { AlertCircle, Check, Download, MoreHorizontal, Pencil, RefreshCw, RotateCcw, Trash2, X } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { IconButton } from "@plane/propel/icon-button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TProjectSpreadsheet } from "@plane/types";
import { Avatar, CustomMenu } from "@plane/ui";
import { cn, getFileURL } from "@plane/utils";
// hooks
import { useMember } from "@/hooks/store/use-member";
import type { TSpreadsheetUpload } from "@/store/project-spreadsheet/project-spreadsheet.store";
// local imports
import { FileTypeBadge } from "./file-type-badge";
import { SpreadsheetFilePreview } from "./file-preview";
import { formatRelativeTime } from "./helpers/format";
import type { TSpreadsheetPreview } from "./helpers/preview";
import { formatFileSize, normalizeSpreadsheetName } from "./helpers/validation";

const cardClassName =
  "group/card relative flex flex-col overflow-hidden rounded-lg border border-subtle bg-surface-1 transition-[box-shadow,border-color,transform] duration-200 hover:border-strong hover:shadow-raised-100 focus-within:border-strong";

function UploadProgress({ upload }: { upload: TSpreadsheetUpload }) {
  const { t } = useTranslation();
  const isError = upload.status === "error";
  const isReady = upload.status === "ready";
  const width = upload.status === "uploading" ? upload.progress : 100;
  return (
    <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-surface-1/90 px-3 pt-2 pb-2.5 backdrop-blur-sm">
      <div className="flex items-center gap-1.5 text-11 font-medium" aria-live="polite">
        {isError ? (
          <span className="flex items-center gap-1 text-danger-primary">
            <AlertCircle className="size-3" aria-hidden />
            {t("spreadsheet.status.failed")}
          </span>
        ) : isReady ? (
          <span className="flex items-center gap-1 text-success-primary">
            <Check className="size-3" aria-hidden />
            {t("spreadsheet.status.ready")}
          </span>
        ) : (
          <span className="text-secondary">
            {upload.status === "uploading"
              ? t("spreadsheet.status.uploading", { progress: upload.progress })
              : t("spreadsheet.status.processing")}
          </span>
        )}
      </div>
      <div
        className="h-1 overflow-hidden rounded-full bg-layer-3"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={width}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-200",
            isError ? "bg-danger-primary" : isReady ? "bg-success-primary" : "bg-accent-primary",
            upload.status === "processing" && "animate-pulse"
          )}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

type TPendingProps = {
  upload: TSpreadsheetUpload;
  onRetry: (tempId: string) => void;
  onDismiss: (tempId: string) => void;
};

/** Optimistic card for a file that is still uploading (or failed to). */
export const PendingUploadCard = observer(function PendingUploadCard({ upload, onRetry, onDismiss }: TPendingProps) {
  const { t } = useTranslation();
  const isError = upload.status === "error";
  return (
    <div className={cn(cardClassName, "animate-slide-up", isError && "border-danger-subtle")}>
      <div className="relative h-28 border-b border-subtle">
        <SpreadsheetFilePreview preview={undefined} name={upload.name} type={upload.file.type} />
        <UploadProgress upload={upload} />
      </div>
      <div className="flex items-start gap-2.5 p-3">
        <FileTypeBadge name={upload.name} type={upload.file.type} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-13 font-medium text-primary" title={upload.name}>
            {upload.name}
          </p>
          <p className="truncate text-11 text-tertiary">
            {isError && upload.error
              ? t(`spreadsheet.errors.${upload.error.code}`, upload.error.params ?? {})
              : formatFileSize(upload.size)}
          </p>
        </div>
        {isError && (
          <div className="flex flex-shrink-0 items-center gap-0.5">
            <IconButton
              variant="ghost"
              size="base"
              icon={RotateCcw}
              onClick={() => onRetry(upload.tempId)}
              aria-label={t("spreadsheet.actions.retry")}
            />
            <IconButton
              variant="ghost"
              size="base"
              icon={X}
              onClick={() => onDismiss(upload.tempId)}
              aria-label={t("spreadsheet.actions.dismiss")}
            />
          </div>
        )}
      </div>
    </div>
  );
});

type TCardProps = {
  spreadsheet: TProjectSpreadsheet;
  preview: TSpreadsheetPreview | undefined;
  upload: TSpreadsheetUpload | undefined;
  canEdit: boolean;
  downloadUrl: string;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => Promise<void>;
  onReplace: (id: string) => void;
  onDelete: (spreadsheet: TProjectSpreadsheet) => void;
  onRetry: (tempId: string) => void;
};

export const SpreadsheetFileCard = observer(function SpreadsheetFileCard(props: TCardProps) {
  const { spreadsheet, preview, upload, canEdit, downloadUrl, onOpen, onRename, onReplace, onDelete, onRetry } = props;
  const { t, currentLocale } = useTranslation();
  const { getUserDetails } = useMember();
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(spreadsheet.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const userId = spreadsheet.updated_by ?? spreadsheet.created_by;
  const user = userId ? getUserDetails(userId) : undefined;

  useEffect(() => {
    if (isRenaming) {
      inputRef.current?.focus();
      // select the name without the extension
      const dot = spreadsheet.name.lastIndexOf(".");
      inputRef.current?.setSelectionRange(0, dot > 0 ? dot : spreadsheet.name.length);
    }
  }, [isRenaming, spreadsheet.name]);

  const commitRename = async () => {
    const next = normalizeSpreadsheetName(draftName, spreadsheet.name);
    setIsRenaming(false);
    if (next === spreadsheet.name) return;
    try {
      await onRename(spreadsheet.id, next);
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: t("spreadsheet.rename.error") });
    }
  };

  const meta = [
    preview && preview.sheetCount > 1 ? t("spreadsheet.card.sheets", { count: preview.sheetCount }) : null,
    preview ? t("spreadsheet.card.rows", { count: preview.rowCount }) : null,
    formatFileSize(spreadsheet.size),
  ].filter(Boolean);

  const menuItems = [
    {
      key: "rename",
      icon: Pencil,
      label: t("spreadsheet.actions.rename"),
      show: canEdit,
      action: () => {
        setDraftName(spreadsheet.name);
        setIsRenaming(true);
      },
    },
    {
      key: "replace",
      icon: RefreshCw,
      label: t("spreadsheet.actions.replace"),
      show: canEdit,
      action: () => onReplace(spreadsheet.id),
    },
    {
      key: "download",
      icon: Download,
      label: t("spreadsheet.actions.download"),
      show: true,
      action: () => {
        window.location.assign(downloadUrl);
      },
    },
    {
      key: "delete",
      icon: Trash2,
      label: t("spreadsheet.actions.delete"),
      show: canEdit,
      danger: true,
      action: () => onDelete(spreadsheet),
    },
  ];

  return (
    <div className={cardClassName}>
      <button
        type="button"
        onClick={() => onOpen(spreadsheet.id)}
        aria-label={t("spreadsheet.card.open", { name: spreadsheet.name })}
        className="relative block h-28 w-full overflow-hidden border-b border-subtle text-left outline-none focus-visible:ring-2 focus-visible:ring-accent-strong focus-visible:ring-inset"
      >
        <div className="size-full transition-transform duration-200 group-hover/card:scale-[1.02]">
          <SpreadsheetFilePreview preview={preview} name={spreadsheet.name} type={spreadsheet.type} />
        </div>
        {upload && <UploadProgress upload={upload} />}
      </button>
      <div className="flex items-start gap-2.5 p-3 pb-2">
        <FileTypeBadge name={spreadsheet.name} type={spreadsheet.type} />
        <div className="min-w-0 flex-1">
          {isRenaming ? (
            <input
              ref={inputRef}
              value={draftName}
              aria-label={t("spreadsheet.rename.label")}
              onChange={(event) => setDraftName(event.target.value)}
              onBlur={() => void commitRename()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commitRename();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setIsRenaming(false);
                }
              }}
              maxLength={255}
              className="-mx-1 -my-0.5 w-[calc(100%+0.5rem)] rounded-sm border border-accent-strong bg-surface-1 px-1 py-0.5 text-13 font-medium text-primary outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => onOpen(spreadsheet.id)}
              className="block max-w-full truncate rounded-sm text-left text-13 font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent-strong"
              title={spreadsheet.name}
            >
              {spreadsheet.name}
            </button>
          )}
          <p className="truncate text-11 text-tertiary">{meta.join(" · ")}</p>
        </div>
        {upload?.status === "error" ? (
          <IconButton
            variant="ghost"
            size="base"
            icon={RotateCcw}
            onClick={() => onRetry(upload.tempId)}
            aria-label={t("spreadsheet.actions.retry")}
          />
        ) : (
          <CustomMenu
            customButton={
              <span className="flex size-6 items-center justify-center rounded-md text-tertiary transition-colors duration-150 hover:bg-layer-transparent-hover hover:text-primary">
                <MoreHorizontal className="size-4" aria-hidden />
              </span>
            }
            ariaLabel={t("spreadsheet.card.actions")}
            placement="bottom-end"
            closeOnSelect
          >
            {menuItems
              .filter((item) => item.show)
              .map((item) => (
                <CustomMenu.MenuItem
                  key={item.key}
                  onClick={item.action}
                  className={cn("flex items-center gap-2", item.danger && "text-danger-primary")}
                >
                  <item.icon className="size-3.5 flex-shrink-0" aria-hidden />
                  {item.label}
                </CustomMenu.MenuItem>
              ))}
          </CustomMenu>
        )}
      </div>
      <div className="flex items-center gap-1.5 px-3 pb-3 text-11 text-tertiary">
        {user && (
          <Avatar src={getFileURL(user.avatar_url ?? "")} name={user.display_name} size="sm" showTooltip={false} />
        )}
        <span className="truncate">
          {user ? `${user.display_name} · ` : ""}
          {formatRelativeTime(spreadsheet.updated_at, currentLocale)}
        </span>
      </div>
    </div>
  );
});
