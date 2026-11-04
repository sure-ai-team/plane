/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TChatApiError, TChatPreferences } from "@plane/types";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useChat } from "@/hooks/store/use-chat";

type TToggleKey = "desktop_notifications" | "sound" | "show_preview" | "inbox_mentions";
const TOGGLES: TToggleKey[] = ["desktop_notifications", "sound", "show_preview", "inbox_mentions"];

type Props = { workspaceSlug: string; isOpen: boolean; onClose: () => void };

/**
 * Chat settings for this workspace. Lives in chat rather than profile settings
 * because chat preferences are per workspace and profile settings are not.
 */
export const ChatSettingsModal = observer(function ChatSettingsModal({ workspaceSlug, isOpen, onClose }: Props) {
  const { t } = useTranslation();
  const chat = useChat();
  const preferences = chat.notify.preferences;
  const permission = chat.notify.permission;

  const save = (changes: Partial<TChatPreferences>) =>
    void chat.notify
      .updatePreferences(workspaceSlug, changes)
      .catch((error: TChatApiError) =>
        setToast({ type: TOAST_TYPE.ERROR, title: t("chat.errors.generic"), message: error?.error })
      );

  const toggle = async (key: TToggleKey, value: boolean) => {
    // Turning desktop notifications on asks the browser; only ever from this click.
    if (key === "desktop_notifications" && value && permission === "default") await chat.notify.requestPermission();
    save({ [key]: value });
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} position={EModalPosition.TOP} width={EModalWidth.LG}>
      <div className="flex flex-col gap-1 p-5">
        <h3 className="text-18 font-medium text-primary">{t("chat.prefs.title")}</h3>
        <p className="text-13 text-tertiary">{t("chat.prefs.subtitle")}</p>

        {permission === "denied" && (
          <div
            role="status"
            className="mt-3 flex items-start gap-2 rounded-md bg-warning-subtle px-3 py-2 text-12 text-warning-primary"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>{t("chat.notify.blocked")}</span>
          </div>
        )}
        {permission === "unsupported" && (
          <p className="mt-3 rounded-md bg-layer-1 px-3 py-2 text-12 text-tertiary">{t("chat.notify.unsupported")}</p>
        )}

        <div className="mt-2 flex flex-col">
          {TOGGLES.map((key) => {
            const checked = preferences ? preferences[key] : true;
            return (
              <div key={key} className="flex items-center gap-4 border-b border-subtle py-3 last:border-b-0">
                <div className="flex flex-1 flex-col">
                  <span id={`chat-pref-${key}`} className="text-13 font-medium text-primary">
                    {t(`chat.prefs.${key}`)}
                  </span>
                  <span className="text-12 text-tertiary">{t(`chat.prefs.${key}_description`)}</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={checked}
                  aria-labelledby={`chat-pref-${key}`}
                  onClick={() => void toggle(key, !checked)}
                  className={cn(
                    "relative h-[18px] w-8 shrink-0 rounded-full transition-colors",
                    checked ? "bg-accent-primary" : "bg-layer-3"
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-[2px] size-[14px] rounded-full bg-white transition-all",
                      checked ? "left-[16px]" : "left-[2px]"
                    )}
                  />
                </button>
              </div>
            );
          })}
        </div>
        {permission === "default" && preferences?.desktop_notifications && (
          <button
            type="button"
            onClick={() => void chat.notify.requestPermission()}
            className="mt-2 self-start text-12 font-medium text-accent-primary hover:underline"
          >
            {t("chat.notify.allow")}
          </button>
        )}
      </div>
    </ModalCore>
  );
});
