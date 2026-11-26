/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { LIVE_BASE_PATH, LIVE_BASE_URL } from "@plane/constants";
import { CollaborativeDocumentEditorWithRef } from "@plane/editor";
import type {
  CollaborationState,
  EditorRefApi,
  TAIMenuProps,
  TDisplayConfig,
  TRealtimeConfig,
  TServerHandler,
} from "@plane/editor";
import type { TSearchEntityRequestPayload, TWebhookConnectionQueryParams } from "@plane/types";
import { EFileAssetType } from "@plane/types";
import { cn, generateRandomColor, hslToHex } from "@plane/utils";
// components
import { EditorMentionsRoot } from "@/components/editor/embeds/mentions";
import { EditorAIMenu } from "@/components/pages/editor/ai/menu";
import type { TEditorBodyHandlers } from "@/components/pages/editor/editor-body";
// hooks
import { useEditorConfig, useEditorMention } from "@/hooks/editor";
import { useExtendedEditorProps } from "@/hooks/pages";
import { EPageStoreType } from "@/hooks/store";
import { useEditorAsset } from "@/hooks/store/use-editor-asset";
import { useMember } from "@/hooks/store/use-member";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useUser } from "@/hooks/store/user";
import { useEditorFlagging } from "@/hooks/use-editor-flagging";
import { usePageFallback } from "@/hooks/use-page-fallback";
import { usePageFilters } from "@/hooks/use-page-filters";
import { useParseEditorContent } from "@/hooks/use-parse-editor-content";
import { useRealtimePageEvents } from "@/hooks/use-realtime-page-events";
// services
import { ProjectPageService } from "@/services/page";
import { WorkspaceService } from "@/services/workspace.service";
// store
import type { TPageInstance } from "@/store/pages/base-page";
// local imports
import { ReadmeContentSkeleton } from "./loader";

const workspaceService = new WorkspaceService();
const projectPageService = new ProjectPageService();

const storeType = EPageStoreType.PROJECT;

/** Hook for the editor container: the README shows the page body only, its title is the tab. */
export const README_EDITOR_CONTAINER_CLASSNAME = "project-readme-editor";

type Props = {
  page: TPageInstance;
  projectId: string;
  workspaceSlug: string;
  /** whether the reader switched to edit mode (the page's own permissions still apply) */
  isEditing: boolean;
};

/**
 * The README body: the same collaborative document editor and live connection
 * the Pages detail route uses (see PageEditorBody), without the page chrome.
 * Read mode is the editor with `editable` off, so both modes share typography
 * and width, and switching keeps the live document instead of reloading it.
 */
export const ProjectReadmeEditor = observer(function ProjectReadmeEditor(props: Props) {
  const { page, projectId, workspaceSlug, isEditing } = props;
  // states
  const [collaborationState, setCollaborationState] = useState<CollaborationState | null>(null);
  // refs
  const editorRef = useRef<EditorRefApi>(null);
  // store hooks
  const { data: currentUser } = useUser();
  const { getWorkspaceBySlug } = useWorkspace();
  const { getUserDetails } = useMember();
  const { uploadEditorAsset, duplicateEditorAsset } = useEditorAsset();
  // derived values
  const {
    id: pageId,
    isContentEditable,
    updateDescription,
    setSyncingStatus,
    editor: { setEditorRef, updateAssetsList },
  } = page;
  const workspaceId = getWorkspaceBySlug(workspaceSlug)?.id ?? "";
  const editable = isEditing && isContentEditable;
  // handlers shared with the realtime events hook
  const fetchEntity = useCallback(
    async (payload: TSearchEntityRequestPayload) =>
      await workspaceService.searchEntity(workspaceSlug, { ...payload, project_id: projectId }),
    [projectId, workspaceSlug]
  );
  const handlers: TEditorBodyHandlers = useMemo(
    () => ({
      fetchEntity,
      // archived / deleted README pages send people back to the overview
      getRedirectionLink: () => `/${workspaceSlug}/projects/${projectId}/overview`,
    }),
    [fetchEntity, projectId, workspaceSlug]
  );
  const fetchDescriptionBinary = useCallback(async () => {
    if (!pageId) return new ArrayBuffer(0);
    return await projectPageService.fetchDescriptionBinary(workspaceSlug, projectId, pageId);
  }, [pageId, projectId, workspaceSlug]);
  // editor helpers
  const { getEditorFileHandlers } = useEditorConfig();
  const { fetchMentions } = useEditorMention({ enableAdvancedMentions: true, searchEntity: fetchEntity });
  const { document: documentEditorExtensions } = useEditorFlagging({ workspaceSlug, projectId, storeType });
  const { getEditorMetaData } = useParseEditorContent({ projectId, workspaceSlug });
  const { fontSize, fontStyle } = usePageFilters();
  const extensionHandlers = useMemo(() => new Map<string, unknown>(), []);
  const extendedEditorProps = useExtendedEditorProps({
    workspaceSlug,
    page,
    storeType,
    fetchEntity,
    getRedirectionLink: handlers.getRedirectionLink,
    extensionHandlers,
    projectId,
  });
  const { updatePageProperties } = useRealtimePageEvents({ storeType, page, getUserDetails, handlers });
  // keeps saving through the API when the live connection drops
  const { isFetchingFallbackBinary } = usePageFallback({
    editorRef,
    fetchPageDescription: fetchDescriptionBinary,
    page,
    collaborationState,
    updatePageDescription: updateDescription,
  });

  const fileHandler = useMemo(
    () =>
      getEditorFileHandlers({
        projectId,
        uploadFile: async (blockId, file) => {
          const { asset_id } = await uploadEditorAsset({
            blockId,
            data: { entity_identifier: pageId ?? "", entity_type: EFileAssetType.PAGE_DESCRIPTION },
            file,
            projectId,
            workspaceSlug,
          });
          return asset_id;
        },
        duplicateFile: async (assetId: string) => {
          const { asset_id } = await duplicateEditorAsset({
            assetId,
            entityId: pageId,
            entityType: EFileAssetType.PAGE_DESCRIPTION,
            projectId,
            workspaceSlug,
          });
          return asset_id;
        },
        workspaceId,
        workspaceSlug,
      }),
    [getEditorFileHandlers, projectId, workspaceId, workspaceSlug, uploadEditorAsset, duplicateEditorAsset, pageId]
  );

  const displayConfig: TDisplayConfig = useMemo(
    () => ({ fontSize, fontStyle, wideLayout: false }),
    [fontSize, fontStyle]
  );

  const webhookConnectionParams: TWebhookConnectionQueryParams = useMemo(
    () => ({ documentType: "project_page", projectId, workspaceSlug }),
    [projectId, workspaceSlug]
  );

  const realtimeConfig: TRealtimeConfig | undefined = useMemo(() => {
    // built from window.location, so only on the client
    if (typeof window === "undefined") return undefined;
    try {
      const liveServerBaseUrl = LIVE_BASE_URL?.trim() || window.location.origin;
      const url = new URL(liveServerBaseUrl);
      url.protocol = window.location.protocol === "https:" ? "wss" : "ws";
      url.pathname = `${LIVE_BASE_PATH}/collaboration`;
      Object.entries(webhookConnectionParams)
        .filter(([_, value]) => value !== undefined && value !== null)
        .forEach(([key, value]) => url.searchParams.set(key, String(value)));
      return { url: url.toString() };
    } catch (error) {
      console.error("Error creating realtime config", error);
      return undefined;
    }
  }, [webhookConnectionParams]);

  const serverHandler: TServerHandler = useMemo(
    () => ({
      onStateChange: (state) => {
        setCollaborationState(state);
        if (state.stage.kind === "disconnected") setSyncingStatus("error");
        else if (state.stage.kind === "synced") setSyncingStatus("synced");
        else setSyncingStatus("syncing");
      },
    }),
    [setSyncingStatus]
  );

  const userConfig = useMemo(
    () => ({
      id: currentUser?.id ?? "",
      name: currentUser?.display_name ?? "",
      color: hslToHex(generateRandomColor(currentUser?.id ?? "")),
    }),
    [currentUser?.display_name, currentUser?.id]
  );

  const getAIMenu = useCallback(
    ({ isOpen, onClose }: TAIMenuProps) => (
      <EditorAIMenu
        editorRef={page.editor.editorRef}
        isOpen={isOpen}
        onClose={onClose}
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
      />
    ),
    [page.editor.editorRef, workspaceId, workspaceSlug]
  );

  const handleEditorReady = useCallback(
    (status: boolean) => {
      if (status && editorRef.current) setEditorRef(editorRef.current);
    },
    [setEditorRef]
  );

  // switching modes recreates the editor, so its ref is shared again afterwards
  useEffect(() => {
    const timer = setTimeout(() => setEditorRef(editorRef.current), 0);
    return () => clearTimeout(timer);
  }, [editable, setEditorRef]);

  useEffect(() => {
    setSyncingStatus("syncing");
  }, [pageId, setSyncingStatus]);

  useEffect(() => () => setEditorRef(null), [setEditorRef]);

  if (!pageId || !realtimeConfig) return <ReadmeContentSkeleton />;

  return (
    <div
      className={cn(
        README_EDITOR_CONTAINER_CLASSNAME,
        // the page title belongs to the Pages view; here the tab names the document
        "[&_.frame-renderer>div:has(>.page-title-editor)]:hidden"
      )}
    >
      <CollaborativeDocumentEditorWithRef
        editable={editable}
        id={pageId}
        fileHandler={fileHandler}
        handleEditorReady={handleEditorReady}
        ref={editorRef}
        containerClassName="h-full p-0 pb-16"
        documentLoaderClassName="w-full"
        displayConfig={displayConfig}
        getEditorMetaData={getEditorMetaData}
        mentionHandler={{
          searchCallback: async (query) => {
            const res = await fetchMentions(query);
            if (!res) throw new Error("Failed in fetching mentions");
            return res;
          },
          // oxlint-disable-next-line no-shadow
          renderComponent: (props) => <EditorMentionsRoot {...props} />,
          getMentionedEntityDetails: (id: string) => ({ display_name: getUserDetails(id)?.display_name ?? "" }),
        }}
        updatePageProperties={updatePageProperties}
        realtimeConfig={realtimeConfig}
        serverHandler={serverHandler}
        user={userConfig}
        disabledExtensions={documentEditorExtensions.disabled}
        flaggedExtensions={documentEditorExtensions.flagged}
        aiHandler={{ menu: getAIMenu }}
        onAssetChange={updateAssetsList}
        extendedEditorProps={extendedEditorProps}
        isFetchingFallbackBinary={isFetchingFallbackBinary}
      />
    </div>
  );
});
