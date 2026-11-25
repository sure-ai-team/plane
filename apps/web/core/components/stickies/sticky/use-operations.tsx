/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useMemo } from "react";
// plane types
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TSticky, TStickyScope, TStickySharing } from "@plane/types";
// plane utils
import { isCommentEmpty } from "@plane/utils";
// components
import { STICKY_COLORS_LIST } from "@/components/editor/sticky-editor/color-palette";
// hooks
import { useUser } from "@/hooks/store/user";
import { useSticky } from "@/hooks/use-stickies";

export type TOperations = {
  create: (data?: Partial<TSticky>) => Promise<void>;
  update: (stickyId: string, data: Partial<TSticky>) => Promise<void>;
  remove: (stickyId: string) => Promise<void>;
  resolveConflict: (stickyId: string, keep: "mine" | "theirs") => Promise<void>;
  /** resolves to whether it was saved */
  updateSharing: (stickyId: string, sharing: TStickySharing) => Promise<boolean>;
  updatePosition: (sourceId: string, destinationId: string, edge: "left" | "right") => Promise<void>;
};

type TProps = TStickyScope;

export const getRandomStickyColor = (): string => {
  const randomIndex = Math.floor(Math.random() * STICKY_COLORS_LIST.length);
  return STICKY_COLORS_LIST[randomIndex].key;
};

export const useStickyOperations = (props: TProps) => {
  const { workspaceSlug, projectId } = props;
  // store hooks
  const {
    stickies,
    getStickyIds,
    createSticky,
    updateSticky,
    resolveConflict,
    updateSharing,
    deleteSticky,
    updateStickyPosition,
  } = useSticky();
  const { data: currentUser } = useUser();
  // derived values
  const currentUserId = currentUser?.id;
  const scope: TStickyScope = useMemo(() => ({ workspaceSlug, projectId }), [workspaceSlug, projectId]);
  const { t } = useTranslation();

  const isValid = useCallback(
    (data: Partial<TSticky>) => {
      if (data.name && data.name.length > 100) {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: t("stickies.toasts.not_updated.title"),
          message: t("stickies.toasts.errors.wrong_name"),
        });
        return false;
      }
      return true;
    },
    [t]
  );

  const stickyOperations: TOperations = useMemo(
    () => ({
      create: async (data?: Partial<TSticky>) => {
        try {
          const payload: Partial<TSticky> = {
            background_color: getRandomStickyColor(),
            ...data,
          };
          // check if the user's latest sticky is empty; in a project, other people's do not count
          const latestStickyId = getStickyIds(scope).find(
            (stickyId) => !projectId || stickies[stickyId]?.owner === currentUserId
          );
          const latestSticky = latestStickyId ? stickies[latestStickyId] : undefined;
          if (latestSticky && (!latestSticky.description_html || isCommentEmpty(latestSticky.description_html))) {
            setToast({
              message: t("stickies.toasts.errors.already_exists"),
              type: TOAST_TYPE.WARNING,
              title: t("stickies.toasts.not_created.title"),
            });
            return;
          }
          if (!workspaceSlug) throw new Error("Missing required fields");
          if (!isValid(payload)) return;
          await createSticky(scope, payload);
          setToast({
            type: TOAST_TYPE.SUCCESS,
            title: t("stickies.toasts.created.title"),
            message: t("stickies.toasts.created.message"),
          });
        } catch (error: any) {
          console.error("Error in creating sticky:", error);
          setToast({
            type: TOAST_TYPE.ERROR,
            title: t("stickies.toasts.not_created.title"),
            message: error?.data?.error ?? t("stickies.toasts.not_created.message"),
          });
        }
      },
      update: async (stickyId: string, data: Partial<TSticky>) => {
        try {
          if (!workspaceSlug) throw new Error("Missing required fields");
          if (!isValid(data)) return;
          await updateSticky(scope, stickyId, data);
        } catch (error) {
          console.error("Error in updating sticky:", error);
          setToast({
            type: TOAST_TYPE.ERROR,
            title: t("stickies.toasts.not_updated.title"),
            message: t("stickies.toasts.not_updated.message"),
          });
        }
      },
      remove: async (stickyId: string) => {
        try {
          if (!workspaceSlug) throw new Error("Missing required fields");
          await deleteSticky(scope, stickyId);
          setToast({
            type: TOAST_TYPE.SUCCESS,
            title: t("stickies.toasts.removed.title"),
            message: t("stickies.toasts.removed.message"),
          });
        } catch (error) {
          console.error("Error in removing sticky:", error);
          setToast({
            type: TOAST_TYPE.ERROR,
            title: t("stickies.toasts.not_removed.title"),
            message: t("stickies.toasts.not_removed.message"),
          });
        }
      },
      resolveConflict: async (stickyId: string, keep: "mine" | "theirs") => {
        try {
          await resolveConflict(scope, stickyId, keep);
        } catch (error) {
          console.error("Error in resolving sticky conflict:", error);
          setToast({
            type: TOAST_TYPE.ERROR,
            title: t("stickies.toasts.not_updated.title"),
            message: t("stickies.toasts.not_updated.message"),
          });
        }
      },
      updateSharing: async (stickyId: string, sharing: TStickySharing) => {
        try {
          await updateSharing(scope, stickyId, sharing);
          setToast({
            type: TOAST_TYPE.SUCCESS,
            title: t("stickies.sharing.toasts.updated"),
          });
          return true;
        } catch (error) {
          console.error("Error in sharing sticky:", error);
          setToast({
            type: TOAST_TYPE.ERROR,
            title: t("stickies.sharing.toasts.not_updated.title"),
            message: t("stickies.sharing.toasts.not_updated.message"),
          });
          return false;
        }
      },
      updatePosition: async (sourceId: string, destinationId: string, edge: "left" | "right") => {
        try {
          if (!workspaceSlug) throw new Error("Missing required fields");
          await updateStickyPosition(scope, sourceId, destinationId, edge);
        } catch (error) {
          console.error("Error in updating sticky position:", error);
          setToast({
            type: TOAST_TYPE.ERROR,
            title: t("stickies.toasts.not_updated.title"),
            message: t("stickies.toasts.not_updated.message"),
          });
        }
      },
    }),
    [
      createSticky,
      currentUserId,
      deleteSticky,
      getStickyIds,
      isValid,
      projectId,
      resolveConflict,
      scope,
      stickies,
      t,
      updateSharing,
      updateSticky,
      updateStickyPosition,
      workspaceSlug,
    ]
  );

  return {
    stickyOperations,
  };
};
