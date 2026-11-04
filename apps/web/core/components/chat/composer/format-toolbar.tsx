/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useState } from "react";
import type { EditorRefApi } from "@plane/editor";
import { TOOLBAR_ITEMS } from "@plane/editor";
import { useTranslation } from "@plane/i18n";
import { Tooltip } from "@plane/propel/tooltip";
import { cn } from "@plane/utils";

/** The comment editor's formatting items, minus ones chat doesn't use (images, to-dos, alignment). */
const ITEMS = Object.values(TOOLBAR_ITEMS.lite)
  .flat()
  .filter((item) => !["image", "to-do-list", "text-align", "underline"].includes(item.itemKey));

type Props = { editorRef: EditorRefApi | null };

/** Bold, italic, strike, lists, quote and code for the chat composer (P2 04-frontend.md § Composer). */
export function ChatFormatToolbar({ editorRef }: Props) {
  const { t } = useTranslation();
  const [active, setActive] = useState<Record<string, boolean>>({});

  const refresh = useCallback(() => {
    if (!editorRef) return;
    const next: Record<string, boolean> = {};
    for (const item of ITEMS) {
      // @ts-expect-error item.extraProps is typed per command; the editor accepts it as-is (same as comments).
      next[item.renderKey] = editorRef.isMenuItemActive({ itemKey: item.itemKey, ...item.extraProps });
    }
    setActive(next);
  }, [editorRef]);

  useEffect(() => {
    if (!editorRef) return;
    const unsubscribe = editorRef.onStateChange(refresh);
    refresh();
    return () => unsubscribe();
  }, [editorRef, refresh]);

  return (
    <div
      role="toolbar"
      aria-label={t("chat.composer.formatting")}
      className="flex items-center gap-0.5 border-b border-subtle px-2 py-1"
    >
      {ITEMS.map((item) => (
        <Tooltip
          key={item.renderKey}
          tooltipContent={item.shortcut ? `${item.name} (${item.shortcut.join("+")})` : item.name}
        >
          <button
            type="button"
            aria-label={item.name}
            aria-pressed={!!active[item.renderKey]}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              // @ts-expect-error see above
              editorRef?.executeMenuItemCommand({ itemKey: item.itemKey, ...item.extraProps });
              refresh();
            }}
            className={cn(
              "flex size-7 items-center justify-center rounded-sm text-secondary hover:bg-layer-transparent-hover",
              { "bg-layer-transparent-active text-primary": active[item.renderKey] }
            )}
          >
            <item.icon className="size-3.5" />
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
