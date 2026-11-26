/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef, useState } from "react";
import { observer } from "mobx-react";
import { Check, Clipboard, ExternalLink, FileUp, Pencil } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { AlertModalCore, Avatar, CustomMenu } from "@plane/ui";
import { calculateTimeAgo, cn, getFileURL, renderFormattedDate } from "@plane/utils";
// components
import { parseFrontMatter } from "@/components/pages/transfer/helpers/front-matter";
import { markdownToHTML } from "@/components/pages/transfer/helpers/markdown";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { useAppRouter } from "@/hooks/use-app-router";
// store
import type { TPageInstance } from "@/store/pages/base-page";
// local imports
import { ReadmeOutlinePopover } from "./outline";
import type { TReadmeOutline } from "./use-readme-outline";

const MARKDOWN_ACCEPT = ".md,.markdown,text/markdown";

type TPendingImport = { fileName: string; html: string };

type Props = {
  page: TPageInstance;
  workspaceSlug: string;
  projectId: string;
  canEdit: boolean;
  isEditing: boolean;
  onEditingChange: (isEditing: boolean) => void;
  outline: TReadmeOutline;
};

/** Live save state shown while editing, e.g. "Editing · Saved". */
const ReadmeEditingStatus = observer(function ReadmeEditingStatus(props: { page: TPageInstance }) {
  const { page } = props;
  // plane hooks
  const { t } = useTranslation();
  // derived values
  const status = page.isSyncingWithServer;
  const label =
    status === "error"
      ? t("project_overview.readme.status.offline")
      : status === "syncing"
        ? t("project_overview.readme.status.saving")
        : t("project_overview.readme.status.saved");

  return (
    <span className="flex items-center gap-1.5 text-12 text-tertiary" role="status" aria-live="polite">
      <span
        className={cn("size-1.5 flex-shrink-0 rounded-full", {
          "bg-success-primary": status === "synced",
          "animate-pulse bg-warning-primary": status === "syncing",
          "bg-danger-primary": status === "error",
        })}
        aria-hidden
      />
      <span className="font-medium text-secondary">{t("project_overview.readme.status.editing")}</span>
      <span aria-hidden>·</span>
      <span className="max-w-[220px] truncate">{label}</span>
    </span>
  );
});

export const ProjectReadmeHeader = observer(function ProjectReadmeHeader(props: Props) {
  const { page, workspaceSlug, projectId, canEdit, isEditing, onEditingChange, outline } = props;
  // states
  const [pendingImport, setPendingImport] = useState<TPendingImport | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  // refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  // plane hooks
  const { t } = useTranslation();
  // store hooks
  const { getUserDetails } = useMember();
  const router = useAppRouter();
  // derived values
  const editorRef = page.editor.editorRef;
  const editor = page.updated_by ? getUserDetails(page.updated_by) : undefined;
  const updatedAt = page.updated_at ? new Date(page.updated_at) : undefined;
  const pageLink = `/${workspaceSlug}/projects/${projectId}/pages/${page.id}`;

  const handleCopyMarkdown = () => {
    if (!editorRef) return;
    editorRef.copyMarkdownToClipboard();
    setToast({ type: TOAST_TYPE.SUCCESS, title: t("project_overview.readme.menu.copied") });
  };

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // allow picking the same file again later
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const { body } = parseFrontMatter(text);
      setPendingImport({ fileName: file.name, html: markdownToHTML(body.trim()) });
    } catch (error) {
      console.error("Failed to read the Markdown file", error);
      setToast({ type: TOAST_TYPE.ERROR, title: t("project_overview.readme.import.error") });
    }
  };

  const handleConfirmImport = () => {
    if (!pendingImport || !editorRef) return;
    setIsImporting(true);
    try {
      // same replacement the version history uses when restoring a version
      editorRef.clearEditor();
      editorRef.setEditorValue(pendingImport.html);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("project_overview.readme.import.success", { fileName: pendingImport.fileName }),
      });
      setPendingImport(null);
    } catch (error) {
      console.error("Failed to import Markdown into the README", error);
      setToast({ type: TOAST_TYPE.ERROR, title: t("project_overview.readme.import.error") });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-subtle pb-3">
      <div className="flex min-w-0 items-center gap-2 text-12 text-tertiary">
        {editor && (
          <>
            <Avatar name={editor.display_name} src={getFileURL(editor.avatar_url)} size="sm" showTooltip={false} />
            <span className="truncate">
              {t("project_overview.readme.last_edited", { name: editor.display_name })}
              {updatedAt && (
                <>
                  <span aria-hidden> · </span>
                  <time
                    dateTime={updatedAt.toISOString()}
                    title={renderFormattedDate(updatedAt, "MMM dd, yyyy, hh:mm a")}
                  >
                    {calculateTimeAgo(updatedAt)}
                  </time>
                </>
              )}
            </span>
          </>
        )}
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        <div className="lg:hidden">
          <ReadmeOutlinePopover outline={outline} />
        </div>
        {isEditing && <ReadmeEditingStatus page={page} />}
        {canEdit &&
          (isEditing ? (
            <Button variant="primary" size="sm" prependIcon={<Check />} onClick={() => onEditingChange(false)}>
              {t("project_overview.readme.done")}
            </Button>
          ) : (
            <Button variant="secondary" size="sm" prependIcon={<Pencil />} onClick={() => onEditingChange(true)}>
              {t("project_overview.readme.edit")}
            </Button>
          ))}
        <CustomMenu ellipsis placement="bottom-end" closeOnSelect ariaLabel={t("project_overview.readme.menu.label")}>
          <CustomMenu.MenuItem onClick={handleCopyMarkdown} disabled={!editorRef}>
            <span className="flex items-center gap-2">
              <Clipboard className="size-3.5" aria-hidden />
              {t("project_overview.readme.menu.copy_markdown")}
            </span>
          </CustomMenu.MenuItem>
          {canEdit && (
            <CustomMenu.MenuItem onClick={() => fileInputRef.current?.click()} disabled={!editorRef}>
              <span className="flex items-center gap-2">
                <FileUp className="size-3.5" aria-hidden />
                {t("project_overview.readme.menu.import_markdown")}
              </span>
            </CustomMenu.MenuItem>
          )}
          <CustomMenu.MenuItem onClick={() => router.push(pageLink)}>
            <span className="flex items-center gap-2">
              <ExternalLink className="size-3.5" aria-hidden />
              {t("project_overview.readme.menu.open_in_pages")}
            </span>
          </CustomMenu.MenuItem>
        </CustomMenu>
        {canEdit && (
          <input
            ref={fileInputRef}
            type="file"
            accept={MARKDOWN_ACCEPT}
            className="hidden"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => void handleFileSelected(event)}
          />
        )}
      </div>
      <AlertModalCore
        isOpen={!!pendingImport}
        handleClose={() => setPendingImport(null)}
        handleSubmit={handleConfirmImport}
        isSubmitting={isImporting}
        variant="primary"
        title={t("project_overview.readme.import.confirm_title")}
        content={t("project_overview.readme.import.confirm_description", { fileName: pendingImport?.fileName ?? "" })}
        primaryButtonText={{
          default: t("project_overview.readme.import.confirm_button"),
          loading: t("project_overview.readme.import.confirm_loading"),
        }}
      />
    </div>
  );
});
