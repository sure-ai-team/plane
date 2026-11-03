/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useCallback, useMemo } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { useChatAvailability } from "@/components/chat/hooks/use-chat-availability";
import useLocalStorage from "@/hooks/use-local-storage";
import { AppRailVisibilityContext } from "./context";
import type { IAppRailVisibilityContext } from "./types";

interface AppRailVisibilityProviderProps {
  children: React.ReactNode;
  isEnabled?: boolean; // Allow override, default false
}

/**
 * AppRailVisibilityProvider - manages app rail visibility state
 * Base provider that accepts isEnabled as a prop
 */
export const AppRailVisibilityProvider = observer(function AppRailVisibilityProvider({
  children,
  isEnabled: isEnabledProp = false,
}: AppRailVisibilityProviderProps) {
  const { workspaceSlug } = useParams();
  // Chat lives on the app rail, so the rail turns on whenever Chat is available to this user.
  const isChatAvailable = useChatAvailability(workspaceSlug?.toString());
  const isEnabled = isEnabledProp || isChatAvailable;

  // User preference from localStorage
  const { storedValue: isCollapsed, setValue: setIsCollapsed } = useLocalStorage<boolean>(
    `APP_RAIL_${workspaceSlug}`,
    false // Default: not collapsed (app rail visible)
  );

  const toggleAppRail = useCallback(() => {
    setIsCollapsed(!isCollapsed);
  }, [isCollapsed, setIsCollapsed]);

  // Compute final visibility: enabled and not collapsed
  const shouldRenderAppRail = isEnabled && !isCollapsed;

  const value: IAppRailVisibilityContext = useMemo(
    () => ({
      isEnabled,
      isCollapsed: isCollapsed ?? false,
      shouldRenderAppRail,
      toggleAppRail,
    }),
    [isEnabled, isCollapsed, shouldRenderAppRail, toggleAppRail]
  );

  return <AppRailVisibilityContext.Provider value={value}>{children}</AppRailVisibilityContext.Provider>;
});
