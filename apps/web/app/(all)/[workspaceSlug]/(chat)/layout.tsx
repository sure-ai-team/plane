/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import { Outlet } from "react-router";
import { useParams, usePathname } from "next/navigation";
import { cn } from "@plane/utils";
// components
import { useChatAvailability } from "@/components/chat/hooks/use-chat-availability";
import { useChatShortcuts } from "@/components/chat/hooks/use-chat-shortcuts";
import { ChatShortcutsModal } from "@/components/chat/modals/shortcuts";
import { ChatSidebar } from "@/components/chat/sidebar/root";
// hooks
import { useAppRouter } from "@/hooks/use-app-router";
import { useUserPermissions } from "@/hooks/store/user";

function ChatLayout() {
  const { workspaceSlug, conversationId } = useParams();
  const slug = workspaceSlug?.toString() ?? "";
  const router = useAppRouter();
  const pathname = usePathname();
  // On phones the list and the content are separate screens.
  const showsContent = !!conversationId || /\/chat\/search\/?$/.test(pathname ?? "");
  const isAvailable = useChatAvailability(slug);
  const { workspaceUserInfo } = useUserPermissions();
  // Only decide once the user's workspace role has loaded.
  const isRoleKnown = !!workspaceUserInfo?.[slug];
  useChatShortcuts(slug, conversationId?.toString());

  useEffect(() => {
    if (isRoleKnown && !isAvailable) router.replace(`/${slug}/`);
  }, [isRoleKnown, isAvailable, router, slug]);

  if (!isAvailable) return null;

  return (
    <div className="relative flex h-full w-full overflow-hidden rounded-lg border border-subtle bg-surface-1">
      <div
        className={cn("h-full w-full shrink-0 border-r border-subtle md:block md:w-[260px]", {
          "hidden md:block": showsContent,
        })}
      >
        <ChatSidebar workspaceSlug={slug} activeConversationId={conversationId?.toString()} />
      </div>
      <main className={cn("relative h-full min-w-0 flex-1", { "hidden md:flex": !showsContent, flex: showsContent })}>
        <Outlet />
      </main>
      <ChatShortcutsModal />
    </div>
  );
}

export default observer(ChatLayout);
