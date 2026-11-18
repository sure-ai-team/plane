/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useInstance } from "@/hooks/store/use-instance";
import { useUserPermissions } from "@/hooks/store/user";

/**
 * Chat is available when Superadmin has it on and the user is an admin or member
 * of the workspace (guests are excluded, docs/chat/DECISIONS.md D3).
 */
export const useChatAvailability = (workspaceSlug: string | undefined): boolean => {
  const { config } = useInstance();
  const { allowPermissions } = useUserPermissions();
  if (!workspaceSlug) return false;
  if (config?.chat && !config.chat.enabled) return false;
  return allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.WORKSPACE,
    workspaceSlug
  );
};
