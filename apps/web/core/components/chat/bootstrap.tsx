/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { useTranslation } from "@plane/i18n";
// hooks
import { useChat } from "@/hooks/store/use-chat";
import { useMember } from "@/hooks/store/use-member";
import { useUser } from "@/hooks/store/user";
import { useAppRouter } from "@/hooks/use-app-router";
// local
import { chatPath, setChatDateLocale } from "./common/helpers";
import { useChatAvailability } from "./hooks/use-chat-availability";
import { useChatTabTitle } from "./hooks/use-chat-tab-title";
import { prepareChatMedia } from "./media/prepare";

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
  const { t, currentLocale } = useTranslation();
  // Set during render so the first labels already use the app language.
  setChatDateLocale(currentLocale);
  const router = useAppRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  // Desktop notifications use the app's translations and open the message on click.
  useEffect(() => {
    chat.setTranslator(t as (key: string, params?: Record<string, unknown>) => string);
  }, [chat, t]);
  useEffect(() => {
    if (!slug) return;
    chat.notify.setOpenHandler((conversationId, messageId) => {
      // On other pages, open the conversation in a dock window instead of leaving the page.
      if (chat.dock.isShown) {
        chat.dock.open(conversationId);
        void chat.message.jumpToMessage(slug, conversationId, { messageId }).catch(() => undefined);
        return;
      }
      routerRef.current.push(`${chatPath(slug, conversationId)}?m=${messageId}`);
    });
    return () => chat.notify.setOpenHandler(null);
  }, [chat, slug]);

  // Member pickers (new conversation, add members, search "From") read workspace members from the
  // store, which other pages fill but the chat page alone does not. Load them once per workspace.
  const {
    workspace: { getWorkspaceMemberIds, fetchWorkspaceMembers },
  } = useMember();
  const hasMembers = !!slug && getWorkspaceMemberIds(slug).length > 0;
  useEffect(() => {
    if (slug && isAvailable && !hasMembers) void fetchWorkspaceMembers(slug).catch(() => undefined);
  }, [slug, isAvailable, hasMembers, fetchWorkspaceMembers]);

  // Offline: sends wait in a queue and go out when the network returns.
  useEffect(() => {
    const update = () => chat.setNetworkOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [chat]);

  const conversations = chat.conversation.sorted;
  useChatTabTitle(
    isAvailable ? chat.conversation.totalUnread : 0,
    isAvailable && conversations.some((conversation) => (conversation.unread_mention_count ?? 0) > 0)
  );

  useEffect(() => {
    if (!slug || !userId || !isAvailable) return;
    // Thumbnails, posters and waveforms are made in the browser before upload.
    chat.upload.prepare = prepareChatMedia;
    void chat.init(slug);
    return () => chat.teardown();
  }, [chat, slug, userId, isAvailable]);

  return null;
});
