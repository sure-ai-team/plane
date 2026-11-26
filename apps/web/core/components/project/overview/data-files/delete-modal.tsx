/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TProjectSpreadsheet } from "@plane/types";
import { AlertModalCore } from "@plane/ui";

type Props = {
  spreadsheet: TProjectSpreadsheet | null;
  onClose: () => void;
  onDelete: (spreadsheet: TProjectSpreadsheet) => Promise<void>;
};

export function DeleteSpreadsheetModal({ spreadsheet, onClose, onDelete }: Props) {
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!spreadsheet) return;
    setIsSubmitting(true);
    try {
      await onDelete(spreadsheet);
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("spreadsheet.delete.success") });
      onClose();
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: t("spreadsheet.delete.error") });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AlertModalCore
      isOpen={!!spreadsheet}
      handleClose={onClose}
      handleSubmit={() => void handleSubmit()}
      isSubmitting={isSubmitting}
      title={t("spreadsheet.delete.title")}
      content={t("spreadsheet.delete.content", { name: spreadsheet?.name ?? "" })}
      primaryButtonText={{ loading: t("spreadsheet.delete.deleting"), default: t("spreadsheet.actions.delete") }}
    />
  );
}
