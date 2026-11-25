/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
// components
import { PageHead } from "@/components/core/page-title";
import { ProjectOverviewDetails } from "@/components/project/overview/details";
import { ProjectPinnedStickies } from "@/components/project/overview/pinned-stickies";
// hooks
import { useProject } from "@/hooks/store/use-project";
import type { Route } from "./+types/page";

function ProjectOverviewPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, projectId } = params;
  // plane hooks
  const { t } = useTranslation();
  // store hooks
  const { getProjectById } = useProject();
  // derived values
  const project = getProjectById(projectId);
  const pageTitle = project?.name ? `${project.name} - ${t("common.overview")}` : undefined;

  return (
    <>
      <PageHead title={pageTitle} />
      <div className="vertical-scrollbar scrollbar-md h-full w-full overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 p-5 md:p-8">
          {project && <ProjectOverviewDetails project={project} />}
          <ProjectPinnedStickies key={projectId} workspaceSlug={workspaceSlug} projectId={projectId} />
        </div>
      </div>
    </>
  );
}

export default observer(ProjectOverviewPage);
