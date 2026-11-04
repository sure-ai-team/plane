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

type TChoiceProps = {
  label: string;
  description: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
};

function ChatChoice({ label, description, value, options, onChange }: TChoiceProps) {
  return (
    <div className="flex flex-col gap-2 border-t border-subtle pt-3 pb-1">
      <div className="flex flex-col">
        <span className="text-13 font-medium text-primary">{label}</span>
        <span className="text-12 text-tertiary">{description}</span>
      </div>
      <div role="radiogroup" aria-label={label} className="flex gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-8 flex-1 rounded-md border px-3 text-13 font-medium",
              value === option.value
                ? "border-accent-strong bg-accent-subtle text-accent-primary"
                : "border-subtle text-secondary hover:bg-layer-transparent-hover"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

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
        <ChatChoice
          label={t("chat.prefs.layout.title")}
          description={t("chat.prefs.layout.description")}
          value={preferences?.message_layout ?? "bubbles"}
          options={[
            { value: "bubbles", label: t("chat.prefs.layout.bubbles") },
            { value: "compact", label: t("chat.prefs.layout.compact") },
          ]}
          onChange={(value) => save({ message_layout: value as TChatPreferences["message_layout"] })}
        />
        {(preferences?.message_layout ?? "bubbles") === "bubbles" && (
          <label className="flex items-center gap-2 py-2 text-13 text-secondary">
            <input
              type="checkbox"
              className="size-4"
              checked={preferences?.bubbles_direct_only ?? true}
              onChange={(event) => save({ bubbles_direct_only: event.target.checked })}
            />
            {t("chat.prefs.layout.direct_only")}
          </label>
        )}
        <ChatChoice
          label={t("chat.prefs.minimize.title")}
          description={t("chat.prefs.minimize.description")}
          value={preferences?.minimize_style ?? "docked"}
          options={[
            { value: "docked", label: t("chat.prefs.minimize.docked") },
            { value: "heads", label: t("chat.prefs.minimize.heads") },
          ]}
          onChange={(value) => save({ minimize_style: value as TChatPreferences["minimize_style"] })}
        />
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
