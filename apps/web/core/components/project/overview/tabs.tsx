/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { BookOpen, Sheet } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Tabs } from "@plane/propel/tabs";
// components
import { ProjectDataFiles } from "@/components/project/overview/data-files";
// local imports
import { parseOverviewTab } from "./helpers";
import type { TOverviewTab } from "./helpers";
import { ProjectPinnedStickies } from "./pinned-stickies";
import { ProjectReadme } from "./readme/root";

type Props = {
  workspaceSlug: string;
  projectId: string;
  activeTab: TOverviewTab;
  onTabChange: (tab: TOverviewTab) => void;
  /** element that scrolls the overview page */
  scrollContainerRef: React.RefObject<HTMLElement | null>;
};

export const ProjectOverviewTabs = observer(function ProjectOverviewTabs(props: Props) {
  const { workspaceSlug, projectId, activeTab, onTabChange, scrollContainerRef } = props;
  // plane hooks
  const { t } = useTranslation();

  return (
    <Tabs value={activeTab} onValueChange={(value) => onTabChange(parseOverviewTab(String(value)))} className="h-auto">
      {/* stays in view while the README scrolls, like a document toolbar */}
      <div className="sticky top-0 z-20 -mx-5 border-b border-subtle bg-surface-1 px-5 py-2.5 md:-mx-8 md:px-8">
        <Tabs.List className="w-fit" aria-label={t("project_overview.tabs.label")}>
          <Tabs.Trigger value="readme" className="h-7 gap-1.5 px-3">
            <BookOpen className="size-3.5" aria-hidden />
            {t("project_overview.tabs.readme")}
          </Tabs.Trigger>
          <Tabs.Trigger value="data" className="h-7 gap-1.5 px-3">
            <Sheet className="size-3.5" aria-hidden />
            {t("project_overview.tabs.data")}
          </Tabs.Trigger>
        </Tabs.List>
      </div>
      <Tabs.Content value="readme" className="flex flex-col gap-12 pt-8">
        <ProjectReadme workspaceSlug={workspaceSlug} projectId={projectId} scrollContainerRef={scrollContainerRef} />
        <div className="border-t border-subtle pt-8">
          <ProjectPinnedStickies workspaceSlug={workspaceSlug} projectId={projectId} />
        </div>
      </Tabs.Content>
      <Tabs.Content value="data" className="pt-8">
        <ProjectDataFiles workspaceSlug={workspaceSlug} projectId={projectId} />
      </Tabs.Content>
    </Tabs>
  );
});
