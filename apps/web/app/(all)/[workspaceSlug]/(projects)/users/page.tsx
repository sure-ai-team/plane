/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useSearchParams } from "next/navigation";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
// components
import { PageHead } from "@/components/core/page-title";
import { NeglectedItems } from "@/components/users-work/team/neglected-items";
import { UsersRestricted } from "@/components/users-work/common/restricted";
import { TeamWorkRoot } from "@/components/users-work/team/root";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useUserPermissions } from "@/hooks/store/user";
import type { Route } from "./+types/page";

function UsersPage({ params }: Route.ComponentProps) {
  const { workspaceSlug } = params;
  const { t } = useTranslation();
  const view = useSearchParams().get("view");
  const { currentWorkspace } = useWorkspace();
  const { allowPermissions } = useUserPermissions();
  const isAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE);
  const title = currentWorkspace?.name ? t("users_work.page_title", { workspace: currentWorkspace.name }) : undefined;

  return (
    <>
      <PageHead title={title} />
      {!isAdmin ? (
        <UsersRestricted />
      ) : view === "unassigned" || view === "orphaned" ? (
        <NeglectedItems key={view} workspaceSlug={workspaceSlug} bucket={view} />
      ) : (
        <TeamWorkRoot workspaceSlug={workspaceSlug} />
      )}
    </>
  );
}

export default observer(UsersPage);
