/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef } from "react";
import { observer } from "mobx-react";
import { useSearchParams } from "react-router";
// plane imports
import { useTranslation } from "@plane/i18n";
// components
import { PageHead } from "@/components/core/page-title";
import { ProjectOverviewDetails } from "@/components/project/overview/details";
import { OVERVIEW_TAB_PARAM, parseOverviewTab, withOverviewTab } from "@/components/project/overview/helpers";
import type { TOverviewTab } from "@/components/project/overview/helpers";
import { ProjectOverviewTabs } from "@/components/project/overview/tabs";
// hooks
import { useProject } from "@/hooks/store/use-project";
import type { Route } from "./+types/page";

function ProjectOverviewPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, projectId } = params;
  // refs
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // router
  const [searchParams, setSearchParams] = useSearchParams();
  // plane hooks
  const { t } = useTranslation();
  // store hooks
  const { getProjectById } = useProject();
  // derived values
  const project = getProjectById(projectId);
  const pageTitle = project?.name ? `${project.name} - ${t("common.overview")}` : undefined;
  const activeTab = parseOverviewTab(searchParams.get(OVERVIEW_TAB_PARAM));

  const handleTabChange = (tab: TOverviewTab) => {
    if (tab === activeTab) return;
    setSearchParams(withOverviewTab(searchParams, tab), { replace: true, preventScrollReset: true });
  };

  return (
    <>
      <PageHead title={pageTitle} />
      <div ref={scrollContainerRef} className="vertical-scrollbar scrollbar-md h-full w-full overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-5 pt-5 pb-16 md:px-8 md:pt-8">
          {project && <ProjectOverviewDetails project={project} />}
          <ProjectOverviewTabs
            key={projectId}
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            scrollContainerRef={scrollContainerRef}
          />
        </div>
      </div>
    </>
  );
}

export default observer(ProjectOverviewPage);
