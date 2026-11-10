/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "@plane/utils";

export type TBackupTabItem<T extends string> = {
  key: T;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
};

type Props<T extends string> = {
  tabs: TBackupTabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the tab list. */
  label: string;
  children: ReactNode;
};

const tabId = (key: string) => `backup-tab-${key}`;
const panelId = (key: string) => `backup-panel-${key}`;

/**
 * Underline tabs, matching the platform's other section tabs (e.g. Archives): one row that
 * scrolls sideways on narrow screens, the active tab marked by an accent underline.
 * Keyboard: arrow keys move between tabs, Home/End jump to the ends (WAI-ARIA tabs pattern).
 */
export function BackupTabs<T extends string>(props: Props<T>) {
  const { tabs, value, onChange, label, children } = props;
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const list = useRef<HTMLDivElement | null>(null);
  // Which edges hide tabs off-screen (narrow screens): those edges fade out as a hint.
  const [hidden, setHidden] = useState({ start: false, end: false });

  useEffect(() => {
    const node = list.current;
    if (!node) return;
    const update = () => {
      const start = node.scrollLeft > 1;
      const end = node.scrollLeft + node.clientWidth < node.scrollWidth - 1;
      setHidden((current) => (current.start === start && current.end === end ? current : { start, end }));
    };
    update();
    node.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => {
      node.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);

  const fade = 24;
  const maskImage =
    hidden.start || hidden.end
      ? `linear-gradient(to right, ${hidden.start ? "transparent" : "black"}, black ${fade}px, black calc(100% - ${fade}px), ${hidden.end ? "transparent" : "black"})`
      : undefined;

  const select = (key: T, focus = false) => {
    onChange(key);
    const button = buttons.current[key];
    button?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (focus) button?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.key === value);
    const moves: Record<string, number> = {
      ArrowRight: (index + 1) % tabs.length,
      ArrowLeft: (index - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    select(tabs[moves[event.key]].key, true);
  };

  return (
    <div className="flex flex-col">
      <div
        ref={list}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        style={{ maskImage, WebkitMaskImage: maskImage }}
        className="flex w-full items-end gap-1 overflow-x-auto border-b border-subtle [scrollbar-width:none]"
      >
        {tabs.map(({ key, label: tabLabel, Icon }) => {
          const selected = key === value;
          return (
            <button
              key={key}
              ref={(node) => {
                buttons.current[key] = node;
              }}
              type="button"
              role="tab"
              id={tabId(key)}
              aria-selected={selected}
              aria-controls={panelId(key)}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(key)}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-13 font-medium whitespace-nowrap transition-colors outline-none",
                "focus-visible:rounded-t-md focus-visible:bg-layer-transparent-hover",
                selected
                  ? "border-accent-strong text-accent-primary"
                  : "border-transparent text-tertiary hover:border-subtle hover:text-secondary"
              )}
            >
              <Icon className="size-4 shrink-0" />
              {tabLabel}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={panelId(value)} aria-labelledby={tabId(value)} tabIndex={0} className="outline-none">
        {children}
      </div>
    </div>
  );
}
