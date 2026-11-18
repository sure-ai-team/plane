/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
// components
import { ChatSearch } from "@/components/chat/search/root";
import { PageHead } from "@/components/core/page-title";
import type { Route } from "./+types/page";

function ChatSearchPage({ params }: Route.ComponentProps) {
  const { t } = useTranslation();
  return (
    <>
      <PageHead title={`${t("chat.search.title")} · ${t("chat.title")}`} />
      <ChatSearch workspaceSlug={params.workspaceSlug} />
    </>
  );
}

export default observer(ChatSearchPage);
