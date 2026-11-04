/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { MessageSquare } from "lucide-react";
import { useTranslation } from "@plane/i18n";
// components
import { ChatNewConversationModal } from "@/components/chat/modals/new-conversation";
import { PageHead } from "@/components/core/page-title";
// hooks
import { useChat } from "@/hooks/store/use-chat";
import { useWorkspace } from "@/hooks/store/use-workspace";
import type { Route } from "./+types/page";

function ChatHomePage({ params }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { currentWorkspace } = useWorkspace();
  const chat = useChat();
  const [newMode, setNewMode] = useState<"direct" | "group" | null>(null);
  // First visit: no conversations at all yet.
  const isFirstVisit =
    chat.conversation.isFetched && chat.conversation.sorted.length === 0 && chat.conversation.archived.length === 0;
  const pageTitle = currentWorkspace?.name ? t("chat.page_label", { workspace: currentWorkspace.name }) : undefined;

  return (
    <>
      <PageHead title={pageTitle} />
      {isFirstVisit ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2.5 p-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-accent-subtle text-accent-primary">
            <MessageSquare className="size-6" strokeWidth={1.75} />
          </span>
          <h1 className="text-16 font-semibold text-primary">{t("chat.states.empty_title")}</h1>
          <p className="max-w-xs text-13 text-tertiary">{t("chat.states.empty_body")}</p>
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={() => setNewMode("direct")}
              className="h-8 rounded-md bg-accent-primary px-3 text-13 font-medium text-on-color hover:bg-accent-primary-hover"
            >
              {t("chat.actions.new_direct")}
            </button>
            <button
              type="button"
              onClick={() => setNewMode("group")}
              className="h-8 rounded-md border border-strong px-3 text-13 font-medium text-primary hover:bg-layer-transparent-hover"
            >
              {t("chat.actions.new_group")}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center">
          <MessageSquare className="size-8 text-placeholder" strokeWidth={1.5} />
          <h1 className="text-16 font-medium text-primary">{t("chat.thread.no_conversation_title")}</h1>
          <p className="max-w-xs text-13 text-tertiary">{t("chat.thread.no_conversation_body")}</p>
        </div>
      )}
      {newMode && (
        <ChatNewConversationModal
          workspaceSlug={params.workspaceSlug}
          isOpen
          initialMode={newMode}
          onClose={() => setNewMode(null)}
        />
      )}
    </>
  );
}

export default observer(ChatHomePage);
