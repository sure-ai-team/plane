/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { debounce } from "lodash-es";
import { observer } from "mobx-react";
import { Minimize2 } from "lucide-react";
// plane imports
import type { TSticky } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { useSticky } from "@/hooks/use-stickies";
// components
import { STICKY_COLORS_LIST } from "../../editor/sticky-editor/color-palette";
import { StickyDeleteModal } from "../delete-modal";
import { StickySharingHeader } from "../sharing/sharing-header";
import { StickyConflict } from "./conflict";
import { StickyInput } from "./inputs";
import { getRandomStickyColor, useStickyOperations } from "./use-operations";

type TProps = {
  onClose?: () => void;
  workspaceSlug: string;
  projectId?: string;
  className?: string;
  stickyId: string | undefined;
  showToolbar?: boolean;
  isStickiesPage?: boolean;
  handleLayout?: () => void;
};
export const StickyNote = observer(function StickyNote(props: TProps) {
  const {
    onClose,
    workspaceSlug,
    projectId,
    className = "",
    stickyId,
    showToolbar,
    isStickiesPage = false,
    handleLayout,
  } = props;
  // states
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  // store hooks
  const { stickies, conflicts, revisions, markStickyDirty } = useSticky();
  // sticky operations
  const { stickyOperations } = useStickyOperations({ workspaceSlug, projectId });
  // derived values
  const stickyData: Partial<TSticky> | undefined = stickyId
    ? stickies[stickyId]
    : { background_color: getRandomStickyColor() };
  const backgroundColor =
    STICKY_COLORS_LIST.find((c) => c.key === stickyData?.background_color)?.backgroundColor ||
    STICKY_COLORS_LIST[0].backgroundColor;
  const canEdit = !projectId || (!!stickyData?.my_permission && stickyData.my_permission !== "view");
  const canDelete = !projectId || stickyData?.my_permission === "manage";
  const hasConflict = !!stickyId && !!conflicts[stickyId];

  // the note above and below are positioned by its height
  useEffect(() => {
    handleLayout?.();
  }, [canEdit, handleLayout, hasConflict]);

  const handleChange = async (payload: Partial<TSticky>) => {
    if (stickyId) {
      await stickyOperations.update(stickyId, payload);
    } else {
      await stickyOperations.create({
        ...stickyData,
        ...payload,
      });
    }
  };

  // One debounce for the lifetime of the note: recreating it would let an older
  // change be saved after a newer one.
  const handleChangeRef = useRef(handleChange);
  useEffect(() => {
    handleChangeRef.current = handleChange;
  });
  const debouncedFormSave = useMemo(
    () => debounce((payload: Partial<TSticky>) => handleChangeRef.current(payload), 500),
    []
  );

  const handleUpdate = (payload: Partial<TSticky>) => {
    handleLayout?.();
    if (stickyId) markStickyDirty({ workspaceSlug, projectId }, stickyId);
    void debouncedFormSave(payload);
  };

  const handleResolveConflict = async (keep: "mine" | "theirs") => {
    if (!stickyId) return;
    // include, or drop, what has been typed in the last moment
    if (keep === "mine") await debouncedFormSave.flush();
    else debouncedFormSave.cancel();
    await stickyOperations.resolveConflict(stickyId, keep);
  };

  const handleDelete = async () => {
    if (!stickyId) return;
    debouncedFormSave.cancel();
    await stickyOperations.remove(stickyId);
    onClose?.();
  };

  return (
    <>
      <StickyDeleteModal
        isOpen={isDeleteModalOpen}
        handleSubmit={handleDelete}
        handleClose={() => setIsDeleteModalOpen(false)}
      />
      <div
        className={cn("group/sticky flex h-fit w-full flex-col overflow-y-scroll rounded-sm", className)}
        style={{
          backgroundColor,
        }}
      >
        {onClose && (
          <button type="button" className="flex flex-shrink-0 justify-end p-2.5" onClick={onClose}>
            <Minimize2 className="size-4" />
          </button>
        )}
        {projectId && stickyId && stickies[stickyId] && (
          <StickySharingHeader workspaceSlug={workspaceSlug} projectId={projectId} sticky={stickies[stickyId]} />
        )}
        {hasConflict && <StickyConflict handleResolve={handleResolveConflict} />}
        {/* inputs */}
        <div className="-mt-2">
          <StickyInput
            // the editor only reads its content when it mounts
            key={stickyId ? revisions[stickyId] : undefined}
            stickyData={stickyData}
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            handleUpdate={handleUpdate}
            stickyId={stickyId}
            handleDelete={canDelete ? () => setIsDeleteModalOpen(true) : undefined}
            handleChange={handleChange}
            showToolbar={showToolbar}
            isEditable={canEdit}
            isStickiesPage={isStickiesPage}
          />
        </div>
      </div>
    </>
  );
});
