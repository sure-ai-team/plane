/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback } from "react";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
// hooks
import { useChat } from "@/hooks/store/use-chat";

/** Queue files for upload and explain any that were refused before uploading. */
export const useChatFileIntake = (conversationId: string) => {
  const { t } = useTranslation();
  const chat = useChat();

  return useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const { rejected } = chat.upload.add(conversationId, files);
      if (rejected.length === 0) return;
      const messages = rejected.map(({ file, error }) => {
        if (error.code === "FILE_TOO_LARGE")
          return t("chat.upload.too_large", { name: file.name, limit: error.limit_mb });
        if (error.code === "TOO_MANY_FILES") return t("chat.upload.too_many", { max: error.max });
        return t("chat.upload.type_not_allowed", { name: file.name });
      });
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("chat.upload.rejected_title"),
        message: Array.from(new Set(messages)).join(" "),
      });
    },
    [chat, conversationId, t]
  );
};
