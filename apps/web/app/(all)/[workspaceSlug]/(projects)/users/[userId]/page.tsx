/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
// components
import { UsersRestricted } from "@/components/users-work/common/restricted";
import { USER_WORK_TABS, UserWorkRoot } from "@/components/users-work/person/root";
// hooks
import { useUserPermissions } from "@/hooks/store/user";
import type { Route } from "./+types/page";

function UserWorkPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, userId, tab } = params;
  const { allowPermissions } = useUserPermissions();
  const isAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE);
  const activeTab = USER_WORK_TABS.find((entry) => entry === tab) ?? "overview";

  if (!isAdmin) return <UsersRestricted />;
  // Another person starts from scratch: nothing of the previous one may stay on screen.
  return <UserWorkRoot key={userId} workspaceSlug={workspaceSlug} userId={userId} tab={activeTab} />;
}

export default observer(UserWorkPage);
