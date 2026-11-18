/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { ChevronDown, MessageSquare } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import type { TChatWorkItemReference } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { ChatService } from "@/services/chat.service";
// local
import { chatPath, listTimeLabel, userName } from "../common/helpers";
import { useChatAvailability } from "../hooks/use-chat-availability";

const chatService = new ChatService();

type Props = { workspaceSlug: string; projectId: string; issueId: string };

/** Conversations (that I'm in) linking to this work item (docs/chat/phase-2/07-security.md P2-S5). */
export const ChatDiscussedIn = observer(function ChatDiscussedIn({ workspaceSlug, projectId, issueId }: Props) {
  const { t } = useTranslation();
  const isAvailable = useChatAvailability(workspaceSlug);
  const [references, setReferences] = useState<TChatWorkItemReference[]>([]);
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    if (!isAvailable) return;
    let cancelled = false;
    void chatService
      .workItemReferences(workspaceSlug, projectId, issueId)
      .then((rows) => {
        if (!cancelled) setReferences(rows);
        return rows;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isAvailable, workspaceSlug, projectId, issueId]);

  if (!isAvailable || references.length === 0) return null;
  const tr = t as (key: string, params?: Record<string, unknown>) => string;

  return (
    <section
      className="rounded-lg border border-subtle"
      aria-label={t("chat.workitem.discussed_in", { count: references.length })}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-13 font-semibold text-primary"
      >
        <MessageSquare className="size-4 text-secondary" />
        <span className="flex-1">{t("chat.workitem.discussed_in", { count: references.length })}</span>
        <ChevronDown className={cn("size-4 text-tertiary transition-transform", { "-rotate-90": !isOpen })} />
      </button>
      {isOpen &&
        references.map((reference) => {
          const name =
            reference.conversation.type === "direct"
              ? (reference.conversation.direct_user?.display_name ?? "")
              : reference.conversation.name;
          return (
            <Link
              key={reference.conversation_id}
              href={`${chatPath(workspaceSlug, reference.conversation_id)}?m=${reference.latest.message_id}`}
              className="flex items-center gap-3 border-t border-subtle px-3.5 py-2.5 hover:bg-layer-transparent-hover"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-13 font-medium text-primary">{name}</span>
                <span className="truncate text-12 text-tertiary">
                  {userName(reference.latest.sender, tr)}: {reference.latest.snippet}
                </span>
              </span>
              <span className="shrink-0 text-11 text-tertiary">{listTimeLabel(reference.latest.created_at)}</span>
            </Link>
          );
        })}
      <p className="border-t border-subtle px-3.5 py-2 text-11 text-tertiary">{t("chat.workitem.discussed_hint")}</p>
    </section>
  );
});
