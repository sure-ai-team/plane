/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { BookOpen, CloudOff } from "lucide-react";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
// hooks
import { useProjectReadme } from "@/hooks/store/use-project-readme";
import { useUserPermissions } from "@/hooks/store/user";
// services
import type { TProjectReadmeTemplate } from "@/services/project/project-readme.service";
// local imports
import { ProjectReadmeDocument } from "./document";
import { ReadmeSkeleton } from "./loader";
import { ProjectReadmeMessage } from "./message";
import { ProjectReadmeTemplates } from "./templates";

type Props = {
  workspaceSlug: string;
  projectId: string;
  /** element that scrolls the overview page, used by the outline */
  scrollContainerRef: React.RefObject<HTMLElement | null>;
};

export const ProjectReadme = observer(function ProjectReadme(props: Props) {
  const { workspaceSlug, projectId, scrollContainerRef } = props;
  // states
  const [isEditing, setIsEditing] = useState(false);
  // plane hooks
  const { t } = useTranslation();
  // store hooks
  const { fetchReadme, createReadme, getReadmePageId, getLoader, getCreatingTemplate } = useProjectReadme();
  const { allowPermissions } = useUserPermissions();
  // derived values
  const canEdit = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug,
    projectId
  );
  const pageId = getReadmePageId(projectId);
  const loader = getLoader(projectId);
  const creatingTemplate = getCreatingTemplate(projectId);

  const { mutate: retry, isValidating } = useSWR(
    `PROJECT_README_${projectId}`,
    () => fetchReadme(workspaceSlug, projectId),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const handleCreate = async (template: TProjectReadmeTemplate) => {
    try {
      await createReadme(workspaceSlug, projectId, template);
      // the reader asked for a README, so it opens ready to write
      setIsEditing(true);
    } catch (error) {
      console.error("Failed to create the project README", error);
      setToast({ type: TOAST_TYPE.ERROR, title: t("project_overview.readme.templates.create_error") });
    }
  };

  if (pageId) {
    return (
      <ProjectReadmeDocument
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        pageId={pageId}
        canEdit={canEdit}
        isEditing={isEditing}
        onEditingChange={setIsEditing}
        scrollContainerRef={scrollContainerRef}
      />
    );
  }

  let content: React.ReactNode;
  if (pageId === null) {
    content = canEdit ? (
      <ProjectReadmeTemplates
        creatingTemplate={creatingTemplate}
        onSelect={(template) => void handleCreate(template)}
      />
    ) : (
      <ProjectReadmeMessage
        icon={BookOpen}
        title={t("project_overview.readme.empty.title")}
        description={t("project_overview.readme.empty.description")}
      />
    );
  } else if (loader === "error") {
    content = (
      <ProjectReadmeMessage
        icon={CloudOff}
        title={t("project_overview.readme.load_error.title")}
        description={t("project_overview.readme.load_error.description")}
        action={
          <Button variant="secondary" size="sm" loading={isValidating} onClick={() => void retry()}>
            {t("project_overview.readme.load_error.retry")}
          </Button>
        }
      />
    );
  } else {
    content = <ReadmeSkeleton />;
  }

  return <div className="mx-auto w-full max-w-[760px]">{content}</div>;
});
