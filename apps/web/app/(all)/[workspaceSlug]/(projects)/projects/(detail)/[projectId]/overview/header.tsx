/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { LayoutPanelTop } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Breadcrumbs, Header } from "@plane/ui";
// components
import { CommonProjectBreadcrumbs } from "@/components/breadcrumbs/common";
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
// hooks
import { useProject } from "@/hooks/store/use-project";

export const ProjectOverviewHeader = observer(function ProjectOverviewHeader() {
  const params = useParams();
  const workspaceSlug = params.workspaceSlug?.toString() ?? "";
  const projectId = params.projectId?.toString() ?? "";
  // plane hooks
  const { t } = useTranslation();
  // store hooks
  const { loader } = useProject();

  return (
    <Header>
      <Header.LeftItem>
        <Breadcrumbs isLoading={loader === "init-loader"}>
          <CommonProjectBreadcrumbs workspaceSlug={workspaceSlug} projectId={projectId} />
          <Breadcrumbs.Item
            component={
              <BreadcrumbLink
                label={t("common.overview")}
                href={`/${workspaceSlug}/projects/${projectId}/overview/`}
                icon={<LayoutPanelTop className="size-4 text-tertiary" />}
                isLast
              />
            }
            isLast
          />
        </Breadcrumbs>
      </Header.LeftItem>
    </Header>
  );
});
