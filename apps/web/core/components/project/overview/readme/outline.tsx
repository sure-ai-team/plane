/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { Link2, ListTree } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Popover } from "@plane/propel/popover";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import { cn, copyTextToClipboard } from "@plane/utils";
// local imports
import type { TReadmeOutline, TReadmeOutlineItem } from "./use-readme-outline";

type TListProps = {
  outline: TReadmeOutline;
  /** called after an item was picked, e.g. to close a popover */
  onNavigate?: () => void;
};

function ReadmeOutlineList(props: TListProps) {
  const { outline, onNavigate } = props;
  // plane hooks
  const { t } = useTranslation();

  const handleCopyLink = async (item: TReadmeOutlineItem) => {
    try {
      await copyTextToClipboard(outline.getSectionLink(item));
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("project_overview.outline.link_copied") });
    } catch (error) {
      console.error("Failed to copy the section link", error);
    }
  };

  if (outline.items.length === 0)
    return <p className="text-12 leading-relaxed text-tertiary">{t("project_overview.outline.empty")}</p>;

  return (
    <ul className="flex flex-col border-l border-subtle">
      {outline.items.map((item) => {
        const isActive = item.id === outline.activeId;
        return (
          <li key={`${item.index}-${item.id}`} className="group/outline relative flex items-center">
            <a
              href={`#${encodeURIComponent(item.id)}`}
              aria-current={isActive ? "location" : undefined}
              onClick={(event) => {
                event.preventDefault();
                outline.scrollTo(item);
                onNavigate?.();
              }}
              className={cn(
                "-ml-px block min-w-0 flex-1 truncate border-l-2 border-transparent py-1 pr-7 text-13 text-tertiary transition-colors hover:text-primary",
                {
                  "border-accent-strong font-medium text-accent-primary hover:text-accent-primary": isActive,
                  "text-12": item.depth > 0,
                }
              )}
              style={{ paddingLeft: `${12 + item.depth * 12}px` }}
            >
              {item.text}
            </a>
            <Tooltip tooltipContent={t("project_overview.outline.copy_link", { section: item.text })}>
              <button
                type="button"
                aria-label={t("project_overview.outline.copy_link", { section: item.text })}
                onClick={() => void handleCopyLink(item)}
                className="absolute right-0 grid size-6 place-items-center rounded-sm text-tertiary opacity-0 transition-opacity group-hover/outline:opacity-100 hover:bg-layer-transparent-hover hover:text-primary focus-visible:opacity-100"
              >
                <Link2 className="size-3.5" aria-hidden />
              </button>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}

/** "On this page" list for the right rail. */
export const ReadmeOutline = observer(function ReadmeOutline(props: { outline: TReadmeOutline }) {
  const { outline } = props;
  // plane hooks
  const { t } = useTranslation();

  return (
    <nav aria-labelledby="project-readme-outline" className="flex flex-col gap-2.5">
      <h2 id="project-readme-outline" className="text-12 font-semibold tracking-wide text-secondary uppercase">
        {t("project_overview.outline.title")}
      </h2>
      <div className="vertical-scrollbar scrollbar-sm max-h-[calc(100vh-240px)] overflow-y-auto">
        <ReadmeOutlineList outline={outline} />
      </div>
    </nav>
  );
});

/** Compact "Contents" button used instead of the rail on narrow screens. */
export const ReadmeOutlinePopover = observer(function ReadmeOutlinePopover(props: { outline: TReadmeOutline }) {
  const { outline } = props;
  // plane hooks
  const { t } = useTranslation();
  // states
  const [isOpen, setIsOpen] = useState(false);

  if (outline.items.length === 0) return null;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Button className="flex h-7 items-center gap-1.5 rounded-md border border-subtle px-2 text-12 font-medium text-secondary hover:bg-layer-transparent-hover hover:text-primary">
        <ListTree className="size-3.5" aria-hidden />
        {t("project_overview.outline.contents")}
      </Popover.Button>
      <Popover.Panel
        positionerClassName="z-30"
        side="bottom"
        align="start"
        sideOffset={6}
        className="vertical-scrollbar scrollbar-sm max-h-[60vh] w-72 overflow-y-auto rounded-lg border border-subtle bg-surface-1 p-3 shadow-raised-200"
      >
        <nav aria-label={t("project_overview.outline.title")}>
          <ReadmeOutlineList outline={outline} onNavigate={() => setIsOpen(false)} />
        </nav>
      </Popover.Panel>
    </Popover>
  );
});
