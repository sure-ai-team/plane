/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
// hooks
import { useChat } from "@/hooks/store/use-chat";

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** The rows of the sheet: translation key and keys to press (Ctrl shows as ⌘ on Mac). */
export const CHAT_SHORTCUTS: Array<{ key: string; keys: string[] }> = [
  { key: "previous_next", keys: ["Alt", "↑ ↓"] },
  { key: "next_unread", keys: ["Alt", "Shift", "↓"] },
  { key: "jump_conversation", keys: ["Ctrl", "K"] },
  { key: "search", keys: ["Ctrl", "Shift", "F"] },
  { key: "edit_last", keys: ["↑"] },
  { key: "mark_read", keys: ["Esc"] },
  { key: "jump_unread", keys: ["Shift", "J"] },
  { key: "new_line", keys: ["Shift", "Enter"] },
  { key: "show_shortcuts", keys: ["?"] },
];

export const ChatShortcutsModal = observer(function ChatShortcutsModal() {
  const { t } = useTranslation();
  const chat = useChat();
  const tr = t as (key: string) => string;
  const close = () => chat.setShortcutsOpen(false);

  return (
    <ModalCore
      isOpen={chat.isShortcutsOpen}
      handleClose={close}
      position={EModalPosition.CENTER}
      width={EModalWidth.LG}
    >
      <div className="flex flex-col gap-3 p-5">
        <h3 className="text-18 font-medium text-primary">{t("chat.shortcuts.title")}</h3>
        <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
          {CHAT_SHORTCUTS.map((row) => (
            <div key={row.key} className="flex items-center justify-between gap-3 border-b border-subtle py-2">
              <dt className="text-13 text-primary">{tr(`chat.shortcuts.${row.key}`)}</dt>
              <dd className="flex gap-1">
                {row.keys.map((key) => (
                  <kbd
                    key={key}
                    className="min-w-5 rounded-sm border border-b-2 border-strong bg-surface-1 px-1.5 text-center text-11 font-medium text-secondary"
                  >
                    {key === "Ctrl" && isMac() ? "⌘" : key}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </ModalCore>
  );
});
