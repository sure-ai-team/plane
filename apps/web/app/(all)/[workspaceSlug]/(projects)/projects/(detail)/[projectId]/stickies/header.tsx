/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { MultipleStickyIcon } from "@plane/propel/icons";
import { Breadcrumbs, Header } from "@plane/ui";
// components
import { CommonProjectBreadcrumbs } from "@/components/breadcrumbs/common";
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { StickySearch } from "@/components/stickies/modal/search";
import { useStickyOperations } from "@/components/stickies/sticky/use-operations";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";
import { useSticky } from "@/hooks/use-stickies";

export const ProjectStickiesHeader = observer(function ProjectStickiesHeader() {
  const params = useParams();
  const workspaceSlug = params.workspaceSlug?.toString() ?? "";
  const projectId = params.projectId?.toString() ?? "";
  // plane hooks
  const { t } = useTranslation();
  // store hooks
  const { loader } = useProject();
  const { allowPermissions } = useUserPermissions();
  const { getList } = useSticky();
  // sticky operations
  const { stickyOperations } = useStickyOperations({ workspaceSlug, projectId });
  // derived values
  const { isCreating } = getList({ workspaceSlug, projectId });
  const canCreateSticky = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug,
    projectId
  );

  return (
    <Header>
      <Header.LeftItem>
        <Breadcrumbs isLoading={loader === "init-loader"}>
          <CommonProjectBreadcrumbs workspaceSlug={workspaceSlug} projectId={projectId} />
          <Breadcrumbs.Item
            component={
              <BreadcrumbLink
                label={t("sidebar.stickies")}
                href={`/${workspaceSlug}/projects/${projectId}/stickies/`}
                icon={<MultipleStickyIcon className="size-4 text-tertiary" />}
                isLast
              />
            }
            isLast
          />
        </Breadcrumbs>
      </Header.LeftItem>
      <Header.RightItem>
        <StickySearch key={projectId} workspaceSlug={workspaceSlug} projectId={projectId} />
        {canCreateSticky && (
          <Button variant="primary" size="lg" onClick={() => void stickyOperations.create()} loading={isCreating}>
            {t("stickies.add")}
          </Button>
        )}
      </Header.RightItem>
    </Header>
  );
});
