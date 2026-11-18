/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { observer } from "mobx-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
// constants
import { EPageAccess } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
// plane types
import { Button } from "@plane/propel/button";
import { PageIcon } from "@plane/propel/icons";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TPage, TPageNavigationTabs } from "@plane/types";
// plane ui
import { Breadcrumbs, Header } from "@plane/ui";
// helpers
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
// hooks
import { useProject } from "@/hooks/store/use-project";
// plane web imports
import { CommonProjectBreadcrumbs } from "@/components/breadcrumbs/common";
import { EPageStoreType, usePageStore } from "@/hooks/store";
import { ExportPagesModal, ImportPagesModal } from "@/components/pages/transfer";

export const PagesListHeader = observer(function PagesListHeader() {
  // states
  const [isCreatingPage, setIsCreatingPage] = useState(false);
  // router
  const router = useRouter();
  const { workspaceSlug, projectId } = useParams();
  const searchParams = useSearchParams();
  const pageType = searchParams.get("type");
  // store hooks
  const { currentProjectDetails, loader } = useProject();
  const { canCurrentUserCreatePage, createPage, fetchPagesList } = usePageStore(EPageStoreType.PROJECT);
  const { t } = useTranslation();
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const currentTab: TPageNavigationTabs | undefined =
    pageType === "public" || pageType === "private" || pageType === "archived" ? pageType : undefined;
  // handle page create
  const handleCreatePage = async () => {
    setIsCreatingPage(true);

    const payload: Partial<TPage> = {
      access: pageType === "private" ? EPageAccess.PRIVATE : EPageAccess.PUBLIC,
    };

    await createPage(payload)
      // oxlint-disable-next-line promise/always-return
      .then((res) => {
        const pageId = `/${workspaceSlug}/projects/${currentProjectDetails?.id}/pages/${res?.id}`;
        router.push(pageId);
      })
      .catch((err) => {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: "Error!",
          message: err?.data?.error || "Page could not be created. Please try again.",
        });
      })
      .finally(() => setIsCreatingPage(false));
  };

  return (
    <Header>
      <Header.LeftItem>
        <Breadcrumbs isLoading={loader === "init-loader"}>
          <CommonProjectBreadcrumbs workspaceSlug={workspaceSlug?.toString()} projectId={projectId?.toString()} />
          <Breadcrumbs.Item
            component={
              <BreadcrumbLink
                label="Pages"
                href={`/${workspaceSlug}/projects/${currentProjectDetails?.id}/pages/`}
                icon={<PageIcon className="h-4 w-4 text-tertiary" />}
                isLast
              />
            }
            isLast
          />
        </Breadcrumbs>
      </Header.LeftItem>
      <Header.RightItem>
        {canCurrentUserCreatePage && (
          <Button variant="secondary" size="lg" onClick={() => setIsImportModalOpen(true)}>
            <Upload className="size-3.5" />
            {t("pages_transfer.import.button")}
          </Button>
        )}
        <Button variant="secondary" size="lg" onClick={() => setIsExportModalOpen(true)}>
          <Download className="size-3.5" />
          {t("pages_transfer.export.button")}
        </Button>
        {canCurrentUserCreatePage && (
          <Button variant="primary" size="lg" onClick={handleCreatePage} loading={isCreatingPage}>
            {isCreatingPage ? "Adding" : "Add page"}
          </Button>
        )}
      </Header.RightItem>
      {workspaceSlug && projectId && (
        <>
          <ImportPagesModal
            isOpen={isImportModalOpen}
            onClose={() => setIsImportModalOpen(false)}
            workspaceSlug={workspaceSlug.toString()}
            projectId={projectId.toString()}
            onImported={async () => {
              await fetchPagesList(workspaceSlug.toString(), projectId.toString(), currentTab);
            }}
          />
          <ExportPagesModal
            isOpen={isExportModalOpen}
            onClose={() => setIsExportModalOpen(false)}
            workspaceSlug={workspaceSlug.toString()}
            projectId={projectId.toString()}
            projectIdentifier={currentProjectDetails?.identifier}
            defaultScope={currentTab ?? "all"}
          />
        </>
      )}
    </Header>
  );
});
