/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { Bell, BellOff, BellRing, Check, ChevronDown, Moon } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Popover } from "@plane/propel/popover";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TChatApiError, TChatConversation, TChatNotifyLevel } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { useChat } from "@/hooks/store/use-chat";
import { defaultNotifyLevel } from "@/store/chat";
// local
import { chatDateLocale, snoozeUntil } from "../common/helpers";

const LEVELS: TChatNotifyLevel[] = ["all", "mentions", "off"];
const ICONS = { all: BellRing, mentions: Bell, off: BellOff };

type Props = { workspaceSlug: string; conversation: TChatConversation };

export const ChatNotifyLevel = observer(function ChatNotifyLevel({ workspaceSlug, conversation }: Props) {
  const { t } = useTranslation();
  const chat = useChat();
  const [isOpen, setIsOpen] = useState(false);
  const level = conversation.notify_level ?? (conversation.is_muted ? "off" : defaultNotifyLevel(conversation));
  const snoozedUntil =
    conversation.snoozed_until && new Date(conversation.snoozed_until).getTime() > Date.now()
      ? new Date(conversation.snoozed_until)
      : null;
  const Icon = snoozedUntil ? Moon : ICONS[level];

  const update = (payload: Parameters<typeof chat.conversation.updateMySettings>[2]) =>
    void chat.conversation
      .updateMySettings(workspaceSlug, conversation.id, payload)
      .catch((error: TChatApiError) =>
        setToast({ type: TOAST_TYPE.ERROR, title: t("chat.errors.generic"), message: error?.error })
      );

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Button
        aria-label={t("chat.notify.button_label", { level: t(`chat.notify.level.${level}`) })}
        className="flex h-7 items-center gap-1 rounded-md border border-subtle px-2 text-12 font-medium text-secondary hover:bg-layer-transparent-hover"
      >
        <Icon className="size-3.5" />
        <span className="hidden xl:inline">
          {snoozedUntil ? t("chat.notify.snoozed_short") : t(`chat.notify.level.${level}`)}
        </span>
        <ChevronDown className="size-3" />
      </Popover.Button>
      <Popover.Panel
        positionerClassName="z-50"
        side="bottom"
        align="end"
        sideOffset={6}
        className="w-72 rounded-lg border border-subtle bg-surface-1 p-1.5 shadow-raised-200"
      >
        <div role="radiogroup" aria-label={t("chat.notify.title")} className="flex flex-col">
          {LEVELS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={level === option}
              onClick={() => update({ notify_level: option })}
              className={cn(
                "flex items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-layer-transparent-hover",
                { "bg-accent-subtle": level === option }
              )}
            >
              <span className="mt-0.5 flex size-4 items-center justify-center">
                {level === option && <Check className="size-3.5 text-accent-primary" />}
              </span>
              <span className="flex flex-col">
                <span className="text-13 font-medium text-primary">{t(`chat.notify.level.${option}`)}</span>
                <span className="text-12 text-tertiary">{t(`chat.notify.level_description.${option}`)}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="mt-1 flex flex-col gap-1.5 border-t border-subtle px-2.5 pt-2 pb-1">
          {snoozedUntil ? (
            <div className="flex items-center justify-between gap-2 text-12">
              <span className="text-secondary">
                {t("chat.notify.snoozed_until", {
                  time: snoozedUntil.toLocaleString(chatDateLocale(), {
                    weekday: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                })}
              </span>
              <button
                type="button"
                className="font-medium text-accent-primary hover:underline"
                onClick={() => update({ snoozed_until: null })}
              >
                {t("chat.notify.unsnooze")}
              </button>
            </div>
          ) : (
            <>
              <span className="text-12 font-medium text-secondary">{t("chat.notify.snooze")}</span>
              <div className="flex flex-wrap gap-1.5">
                {(["1h", "8h", "tomorrow"] as const).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => update({ snoozed_until: snoozeUntil(preset) })}
                    className="h-6 rounded-md border border-subtle px-2 text-12 text-secondary hover:bg-layer-transparent-hover"
                  >
                    {t(`chat.notify.snooze_${preset}`)}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </Popover.Panel>
    </Popover>
  );
});
