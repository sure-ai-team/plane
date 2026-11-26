/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// plane imports
import type { EditorRefApi, IMarking } from "@plane/editor";
// local imports
import { areHeadingsEqual, buildOutline, getActiveOutlineIndex, parseSectionHash } from "../helpers";
import type { TOutlineItem } from "../helpers";

/** Space kept above a heading scrolled to (the sticky tab bar sits there). */
export const OUTLINE_SCROLL_OFFSET = 96;

const HEADING_SELECTOR =
  ".ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6";

export type TReadmeOutlineItem = TOutlineItem<IMarking>;

type TArgs = {
  editorRef: EditorRefApi | null;
  /** element that contains the README editor */
  contentRef: React.RefObject<HTMLElement | null>;
  /** element that scrolls the overview page */
  scrollContainerRef: React.RefObject<HTMLElement | null>;
};

export type TReadmeOutline = {
  items: TReadmeOutlineItem[];
  activeId: string | undefined;
  scrollTo: (item: TReadmeOutlineItem) => void;
  getSectionLink: (item: TReadmeOutlineItem) => string;
};

/**
 * Outline of the README built from the editor's headings, with scroll-spy and
 * scrolling within the overview's own scroll container. Headings are matched
 * to their DOM nodes by document order, which is how the editor lists them.
 */
export const useReadmeOutline = ({ editorRef, contentRef, scrollContainerRef }: TArgs): TReadmeOutline => {
  const [headings, setHeadings] = useState<IMarking[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const hasHandledHash = useRef(false);

  useEffect(() => {
    if (!editorRef) {
      setHeadings([]);
      return;
    }
    const update = (next: IMarking[]) =>
      // the editor reports headings on every change; only re-render when they differ
      setHeadings((current) => (areHeadingsEqual(current, next) ? current : [...next]));
    update(editorRef.getHeadings() ?? []);
    return editorRef.onHeadingChange(update);
  }, [editorRef]);

  const items = useMemo(() => buildOutline(headings), [headings]);

  const getHeadingElement = useCallback(
    (item: TReadmeOutlineItem): HTMLElement | undefined => {
      const elements = contentRef.current?.querySelectorAll<HTMLElement>(HEADING_SELECTOR);
      return elements?.[item.index];
    },
    [contentRef]
  );

  const scrollTo = useCallback(
    (item: TReadmeOutlineItem, behavior: ScrollBehavior = "smooth") => {
      const container = scrollContainerRef.current;
      const element = getHeadingElement(item);
      if (!container || !element) return;
      const top =
        container.scrollTop +
        element.getBoundingClientRect().top -
        container.getBoundingClientRect().top -
        OUTLINE_SCROLL_OFFSET +
        8;
      container.scrollTo({ top, behavior });
      // reflect the section in the URL without a navigation
      window.history.replaceState(window.history.state, "", `#${encodeURIComponent(item.id)}`);
    },
    [getHeadingElement, scrollContainerRef]
  );

  const getSectionLink = useCallback((item: TReadmeOutlineItem) => {
    const { origin, pathname, search } = window.location;
    return `${origin}${pathname}${search}#${encodeURIComponent(item.id)}`;
  }, []);

  // scroll-spy
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || items.length === 0) {
      setActiveIndex(-1);
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const containerTop = container.getBoundingClientRect().top;
      const tops = items.map((item) => {
        const element = getHeadingElement(item);
        return element ? element.getBoundingClientRect().top - containerTop : Number.POSITIVE_INFINITY;
      });
      // at the very bottom the last sections may never reach the offset
      const isAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 2;
      setActiveIndex(
        isAtBottom && container.scrollTop > 0 ? items.length - 1 : getActiveOutlineIndex(tops, OUTLINE_SCROLL_OFFSET)
      );
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    container.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      container.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [items, getHeadingElement, scrollContainerRef]);

  // deep link: scroll to the section named in the hash once the headings are known
  useEffect(() => {
    if (hasHandledHash.current || items.length === 0) return;
    const sectionId = parseSectionHash(window.location.hash);
    if (!sectionId) {
      hasHandledHash.current = true;
      return;
    }
    // the heading may not have synced yet; try again when the outline changes
    const target = items.find((item) => item.id === sectionId);
    if (!target) return;
    // let the editor finish laying out the document first
    const timer = window.setTimeout(() => {
      hasHandledHash.current = true;
      scrollTo(target, "auto");
    }, 100);
    return () => window.clearTimeout(timer);
  }, [items, scrollTo]);

  return {
    items,
    activeId: activeIndex >= 0 ? items[activeIndex]?.id : undefined,
    scrollTo,
    getSectionLink,
  };
};
