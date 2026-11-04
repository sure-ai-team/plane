/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "@plane/i18n";
import { EmojiRoot } from "@plane/propel/emoji-icon-picker";
import { Popover } from "@plane/propel/popover";
import { cn } from "@plane/utils";

type Props = {
  /** Content of the trigger button (an icon). */
  children: ReactNode;
  ariaLabel: string;
  onSelect: (emoji: string) => void;
  buttonClassName?: string;
  side?: "top" | "bottom";
  align?: "start" | "end";
};

/**
 * Emoji-only picker shared by reactions and the composer
 * (docs/chat/phase-2/DECISIONS.md P2-D12). Uses the same picker as project
 * and page logos, so emoji look and search the same across the app.
 */
export function ChatEmojiPicker(props: Props) {
  const { children, ariaLabel, onSelect, buttonClassName, side = "top", align = "end" } = props;
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Button aria-label={ariaLabel} className={cn("outline-none", buttonClassName)}>
        {children}
      </Popover.Button>
      <Popover.Panel
        positionerClassName="z-50"
        className="h-80 w-80 overflow-hidden rounded-md border-[0.5px] border-strong bg-surface-1 shadow-raised-200"
        side={side}
        align={align}
        sideOffset={6}
        onKeyDown={(event) => {
          if (event.key === "Escape") setIsOpen(false);
        }}
      >
        {isOpen && (
          <EmojiRoot
            searchPlaceholder={t("chat.picker.search")}
            onChange={(emoji) => {
              onSelect(emoji);
              setIsOpen(false);
            }}
          />
        )}
      </Popover.Panel>
    </Popover>
  );
}
