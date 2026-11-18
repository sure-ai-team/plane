/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef } from "react";
// hooks
import { useChat } from "@/hooks/store/use-chat";
import { useAppRouter } from "@/hooks/use-app-router";
// local
import { chatPath, chatSearchPath, neighbourConversation } from "../common/helpers";

/** True when the key press is going into a text field (shortcuts must not fire). */
export const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!target || typeof (target as HTMLElement).closest !== "function") return false;
  const element = target as HTMLElement;
  if (element.isContentEditable) return true;
  return !!element.closest("input, textarea, select, [contenteditable='true'], [role='dialog']");
};

/**
 * Keyboard shortcuts on chat pages (docs/chat/phase-2/04-frontend.md § Power K and shortcuts).
 * Never fires while typing in a field, except the composer's own ↑ and Esc.
 */
export const useChatShortcuts = (workspaceSlug: string, activeConversationId: string | undefined) => {
  const chat = useChat();
  const router = useAppRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const mod = event.metaKey || event.ctrlKey;
      const store = chat.conversation;
      const ordered = [...store.starred, ...store.groups, ...store.directs];

      // Ctrl/Cmd+Shift+F works even from the composer.
      if (mod && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        routerRef.current.push(chatSearchPath(workspaceSlug));
        return;
      }
      if (isTypingTarget(event.target)) return;

      if (event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        const next = neighbourConversation(
          ordered,
          activeConversationId,
          event.key === "ArrowDown" ? 1 : -1,
          event.shiftKey
        );
        if (next) {
          event.preventDefault();
          routerRef.current.push(chatPath(workspaceSlug, next.id));
        }
        return;
      }
      if (mod || event.altKey) return;

      if (event.key === "?") {
        event.preventDefault();
        chat.setShortcutsOpen(true);
      } else if (event.key === "J" && event.shiftKey) {
        event.preventDefault();
        chat.requestJumpToUnread();
      } else if (event.key === "Escape" && activeConversationId) {
        void chat.markRead(activeConversationId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chat, workspaceSlug, activeConversationId]);
};
