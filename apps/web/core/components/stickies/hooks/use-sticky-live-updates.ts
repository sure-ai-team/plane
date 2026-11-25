/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef } from "react";
// plane imports
import { LIVE_BASE_PATH, LIVE_BASE_URL } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TStickyScope } from "@plane/types";
// hooks
import { useSticky } from "@/hooks/use-stickies";
// services
import { buildLiveSocketUrl, ChatSocket } from "@/services/chat-socket";
import { createLiveTransport } from "@/services/live-transport";
import { StickyLiveUpdates } from "@/services/sticky-live-updates";

/** Shows what other people change while the stickies of a project are on screen. */
export const useStickyLiveUpdates = (scope: TStickyScope) => {
  const { workspaceSlug, projectId, isPinned } = scope;
  // plane hooks
  const { t } = useTranslation();
  // store hooks
  const { fetchStickies, handleRemoteChange } = useSticky();

  // `t` is a new function on every render, which must not reconnect
  const showUnavailableRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    showUnavailableRef.current = () =>
      void setToast({ type: TOAST_TYPE.WARNING, title: t("stickies.sharing.unavailable") });
  });

  useEffect(() => {
    if (!projectId) return;
    const liveScope = { workspaceSlug, projectId };
    const liveUpdates = new StickyLiveUpdates({
      workspaceSlug,
      projectId,
      createSocket: (listeners) =>
        new ChatSocket({
          url: (slug) => buildLiveSocketUrl(LIVE_BASE_URL, LIVE_BASE_PATH, "stickies", slug),
          createTransport: createLiveTransport,
          ...listeners,
        }),
      onChange: (stickyId, updatedAt) => {
        void handleRemoteChange(liveScope, stickyId, updatedAt).then((hasLostChanges) => {
          if (hasLostChanges) showUnavailableRef.current();
          return undefined;
        });
      },
      onMissed: () => void fetchStickies({ ...liveScope, isPinned }),
      isHidden: () => document.hidden,
    });
    liveUpdates.start();
    document.addEventListener("visibilitychange", liveUpdates.handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", liveUpdates.handleVisibility);
      liveUpdates.stop();
    };
  }, [fetchStickies, handleRemoteChange, isPinned, projectId, workspaceSlug]);
};
