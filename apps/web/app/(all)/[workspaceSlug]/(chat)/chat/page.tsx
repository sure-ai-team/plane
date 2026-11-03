/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { MessageSquare } from "lucide-react";
import { useTranslation } from "@plane/i18n";
// components
import { PageHead } from "@/components/core/page-title";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";

function ChatHomePage() {
  const { t } = useTranslation();
  const { currentWorkspace } = useWorkspace();
  const pageTitle = currentWorkspace?.name ? t("chat.page_label", { workspace: currentWorkspace.name }) : undefined;

  return (
    <>
      <PageHead title={pageTitle} />
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center">
        <MessageSquare className="size-8 text-placeholder" strokeWidth={1.5} />
        <h1 className="text-16 font-medium text-primary">{t("chat.thread.no_conversation_title")}</h1>
        <p className="max-w-xs text-13 text-tertiary">{t("chat.thread.no_conversation_body")}</p>
      </div>
    </>
  );
}

export default observer(ChatHomePage);
