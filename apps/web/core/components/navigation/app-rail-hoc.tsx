/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// hoc/withDockItems.tsx
import React from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { PlaneNewIcon } from "@plane/propel/icons";
import type { AppSidebarItemData } from "@/components/sidebar/sidebar-item";
import { useChatAvailability } from "@/components/chat/hooks/use-chat-availability";
import { useChat } from "@/hooks/store/use-chat";
import { useWorkspacePaths } from "@/hooks/use-workspace-paths";

type WithDockItemsProps = {
  dockItems: (AppSidebarItemData & { shouldRender: boolean })[];
};

export function withDockItems<P extends WithDockItemsProps>(WrappedComponent: React.ComponentType<P>) {
  const ComponentWithDockItems = observer(function ComponentWithDockItems(props: Omit<P, keyof WithDockItemsProps>) {
    const { workspaceSlug } = useParams();
    const { isProjectsPath, isNotificationsPath, isChatPath } = useWorkspacePaths();
    const { t } = useTranslation();
    const chat = useChat();
    const isChatAvailable = useChatAvailability(workspaceSlug?.toString());

    const dockItems: (AppSidebarItemData & { shouldRender: boolean })[] = [
      {
        label: "Projects",
        icon: <PlaneNewIcon className="size-5" />,
        href: `/${workspaceSlug}/`,
        isActive: isProjectsPath && !isNotificationsPath,
        shouldRender: true,
      },
      {
        label: t("chat.nav.rail_label"),
        icon: <MessageSquare className="size-5" strokeWidth={1.75} />,
        href: `/${workspaceSlug}/chat`,
        isActive: isChatPath,
        shouldRender: isChatAvailable,
        badge: chat.conversation.totalUnread,
      },
    ];

    return <WrappedComponent {...(props as P)} dockItems={dockItems} />;
  });

  return ComponentWithDockItems;
}
