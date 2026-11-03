/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// hooks
import { useChat } from "@/hooks/store/use-chat";
import { useUser } from "@/hooks/store/user";
// local
import { useChatAvailability } from "./hooks/use-chat-availability";

/**
 * Mounted once per workspace. Connects the chat socket and loads the conversation
 * list so the app-rail badge is live everywhere; the chat screens load on demand.
 */
export const ChatBootstrap = observer(function ChatBootstrap() {
  const { workspaceSlug } = useParams();
  const slug = workspaceSlug?.toString();
  const chat = useChat();
  const { data: currentUser } = useUser();
  const isAvailable = useChatAvailability(slug);
  const userId = currentUser?.id;

  useEffect(() => {
    if (!slug || !userId || !isAvailable) return;
    void chat.init(slug);
    return () => chat.teardown();
  }, [chat, slug, userId, isAvailable]);

  return null;
});
