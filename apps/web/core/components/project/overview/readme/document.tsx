/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { FileX2, Lock } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
// hooks
import { EPageStoreType, usePage, usePageStore } from "@/hooks/store";
import { useProjectReadme } from "@/hooks/store/use-project-readme";
// local imports
import { ProjectReadmeEditor } from "./editor";
import { ProjectReadmeHeader } from "./header";
import { ReadmeSkeleton } from "./loader";
import { ReadmeOutline } from "./outline";
import { ProjectReadmeMessage } from "./message";
import { useReadmeOutline } from "./use-readme-outline";

const storeType = EPageStoreType.PROJECT;

type Props = {
  workspaceSlug: string;
  projectId: string;
  pageId: string;
  canEdit: boolean;
  isEditing: boolean;
  onEditingChange: (isEditing: boolean) => void;
  scrollContainerRef: React.RefObject<HTMLElement | null>;
};

/** The README page: header row, document, and the "On this page" rail. */
export const ProjectReadmeDocument = observer(function ProjectReadmeDocument(props: Props) {
  const { workspaceSlug, projectId, pageId, canEdit, isEditing, onEditingChange, scrollContainerRef } = props;
  // refs
  const contentRef = useRef<HTMLDivElement>(null);
  const holdTimerRef = useRef<number | undefined>(undefined);
  // states
  const [heldHeight, setHeldHeight] = useState<number | undefined>(undefined);
  // plane hooks
  const { t } = useTranslation();
  // store hooks
  const { fetchPageDetails } = usePageStore(storeType);
  const page = usePage({ pageId, storeType });
  const { fetchReadme } = useProjectReadme();
  // same cache key as the Pages detail route, so both views share one fetch
  const { error } = useSWR(`PAGE_DETAILS_${pageId}`, () => fetchPageDetails(workspaceSlug, projectId, pageId), {
    revalidateIfStale: true,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });
  const outline = useReadmeOutline({
    editorRef: page?.editor.editorRef ?? null,
    contentRef,
    scrollContainerRef,
  });

  // switching modes recreates the editor; hold the current height so nothing below it jumps
  const handleEditingChange = useCallback(
    (next: boolean) => {
      const height = contentRef.current?.offsetHeight;
      if (height) {
        setHeldHeight(height);
        window.clearTimeout(holdTimerRef.current);
        holdTimerRef.current = window.setTimeout(() => setHeldHeight(undefined), 400);
      }
      onEditingChange(next);
    },
    [onEditingChange]
  );

  useEffect(() => () => window.clearTimeout(holdTimerRef.current), []);

  const isArchivedOrDeleted = !!page?.archived_at || !!page?.deleted_at;
  const isUnavailable =
    (!!error && !page?.id) || (!!page?.id && (!page.canCurrentUserAccessPage || isArchivedOrDeleted));
  // guests can only open pages when the project shares all features with them
  const isGuestWithoutAccess = isUnavailable && !canEdit && !isArchivedOrDeleted;

  // the page was loaded once and has since gone from the store (deleted live)
  const hadPageRef = useRef(false);
  if (page?.id) hadPageRef.current = true;
  const isRemoved = hadPageRef.current && !page?.id;

  // an archived or deleted README is unlinked by the server; ask again so the template picker comes back
  useEffect(() => {
    if (!isUnavailable && !isRemoved) return;
    fetchReadme(workspaceSlug, projectId).catch((err) => console.error("Failed to refresh the project README", err));
  }, [isUnavailable, isRemoved, fetchReadme, workspaceSlug, projectId]);

  const rail = (
    <aside className="hidden lg:block">
      <div className="sticky top-20">{page?.id && !isUnavailable && <ReadmeOutline outline={outline} />}</div>
    </aside>
  );

  let body: React.ReactNode;
  if (isGuestWithoutAccess) {
    body = (
      <ProjectReadmeMessage
        icon={Lock}
        title={t("project_overview.readme.guest_unavailable.title")}
        description={t("project_overview.readme.guest_unavailable.description")}
      />
    );
  } else if (isUnavailable) {
    body = (
      <ProjectReadmeMessage
        icon={FileX2}
        title={t("project_overview.readme.unavailable.title")}
        description={t("project_overview.readme.unavailable.description")}
      />
    );
  } else if (!page?.id) {
    body = <ReadmeSkeleton />;
  } else {
    const isPageEditable = canEdit && page.isContentEditable;
    body = (
      <div className="flex flex-col gap-6">
        <ProjectReadmeHeader
          page={page}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          canEdit={isPageEditable}
          isEditing={isEditing && isPageEditable}
          onEditingChange={handleEditingChange}
          outline={outline}
        />
        <div ref={contentRef} style={heldHeight ? { minHeight: heldHeight } : undefined}>
          <ProjectReadmeEditor
            key={page.id}
            page={page}
            projectId={projectId}
            workspaceSlug={workspaceSlug}
            isEditing={isEditing && isPageEditable}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_240px]">
      <article aria-label={t("project_overview.tabs.readme")} className="mx-auto w-full max-w-[760px] min-w-0">
        {body}
      </article>
      {rail}
    </div>
  );
});
