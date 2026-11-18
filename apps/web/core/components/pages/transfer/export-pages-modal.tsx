/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TPageExportType, TPageTransferFormat } from "@plane/types";
import { CustomSelect, EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
// hooks
import { useParseEditorContent } from "@/hooks/use-parse-editor-content";
// services
import { ProjectPageService } from "@/services/page";
// local imports
import { PageTransferFormatSelect } from "./format-select";
import { downloadBlob } from "./helpers/download";
import { PageTransferFileError, serializePages } from "./helpers/formats";

const projectPageService = new ProjectPageService();

const EXPORT_SCOPES: TPageExportType[] = ["all", "public", "private", "archived"];

type Props = {
  isOpen: boolean;
  onClose: () => void;
  workspaceSlug: string;
  projectId: string;
  projectIdentifier?: string;
  /** Preselected scope, e.g. the tab the user is looking at. */
  defaultScope?: TPageExportType;
};

export function ExportPagesModal(props: Props) {
  const { isOpen, onClose, workspaceSlug, projectId, projectIdentifier, defaultScope = "all" } = props;
  const { t } = useTranslation();
  const [format, setFormat] = useState<TPageTransferFormat>("json");
  const [scope, setScope] = useState<TPageExportType>(defaultScope);
  const [isExporting, setIsExporting] = useState(false);
  const { getEditorMetaData } = useParseEditorContent({ projectId, workspaceSlug });

  const handleClose = () => {
    if (isExporting) return;
    onClose();
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await projectPageService.exportPages(workspaceSlug, projectId, { type: scope });
      if (response.pages.length === 0) {
        setToast({
          type: TOAST_TYPE.INFO,
          title: t("pages_transfer.export.empty_title"),
          message: t("pages_transfer.export.empty_message"),
        });
        return;
      }
      const baseName = `${projectIdentifier || response.project.identifier || "pages"}-pages${scope === "all" ? "" : `-${scope}`}`;
      const { blob, fileName } = await serializePages(response.pages, format, {
        baseName,
        getMarkdownMetaData: getEditorMetaData,
        jsonExtras: { exported_at: response.exported_at, project: response.project },
      });
      downloadBlob(blob, fileName);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("pages_transfer.export.success_title"),
        message: t("pages_transfer.export.success_message", { count: response.pages.length }),
      });
      onClose();
    } catch (error) {
      const message =
        error instanceof PageTransferFileError
          ? t(`pages_transfer.file_errors.${error.code}`, error.params)
          : t("pages_transfer.export.error_message");
      setToast({ type: TOAST_TYPE.ERROR, title: t("pages_transfer.export.error_title"), message });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={handleClose} position={EModalPosition.CENTER} width={EModalWidth.LG}>
      <div className="space-y-5 p-5">
        <div className="space-y-1">
          <h3 className="text-18 font-medium text-secondary">{t("pages_transfer.export.title")}</h3>
          <p className="text-13 text-tertiary">{t("pages_transfer.export.description")}</p>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex-shrink-0 text-13 text-secondary">{t("pages_transfer.export.format_label")}</span>
            <PageTransferFormatSelect value={format} onChange={setFormat} disabled={isExporting} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="flex-shrink-0 text-13 text-secondary">{t("pages_transfer.export.scope_label")}</span>
            <CustomSelect
              label={t(`pages_transfer.export.scopes.${scope}`)}
              value={scope}
              onChange={(value: TPageExportType) => setScope(value)}
              buttonClassName="border-[0.5px] border-subtle"
              placement="bottom-end"
              disabled={isExporting}
            >
              {EXPORT_SCOPES.map((option) => (
                <CustomSelect.Option key={option} value={option}>
                  {t(`pages_transfer.export.scopes.${option}`)}
                </CustomSelect.Option>
              ))}
            </CustomSelect>
          </div>
          {(format === "markdown" || format === "html") && (
            <p className="text-12 text-tertiary">{t("pages_transfer.export.zip_hint")}</p>
          )}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t-[0.5px] border-subtle px-5 py-4">
        <Button variant="secondary" size="lg" onClick={handleClose} disabled={isExporting}>
          {t("common.cancel")}
        </Button>
        <Button variant="primary" size="lg" loading={isExporting} onClick={handleExport}>
          {isExporting ? t("pages_transfer.export.exporting") : t("pages_transfer.export.submit")}
        </Button>
      </div>
    </ModalCore>
  );
}
