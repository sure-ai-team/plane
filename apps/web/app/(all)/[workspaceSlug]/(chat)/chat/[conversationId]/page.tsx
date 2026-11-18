/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
// components
import { ChatThread } from "@/components/chat/thread/root";
import { PageHead } from "@/components/core/page-title";
// hooks
import { useChat } from "@/hooks/store/use-chat";
import type { Route } from "./+types/page";

function ChatConversationPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, conversationId } = params;
  const { t } = useTranslation();
  const chat = useChat();
  const conversation = chat.conversation.getById(conversationId);
  const title = conversation ? `${chat.conversation.displayName(conversation)} · ${t("chat.title")}` : t("chat.title");

  return (
    <>
      <PageHead title={title} />
      <ChatThread workspaceSlug={workspaceSlug} conversationId={conversationId} />
    </>
  );
}

export default observer(ChatConversationPage);
