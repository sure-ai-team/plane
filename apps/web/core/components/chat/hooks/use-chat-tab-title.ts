/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef } from "react";

const COUNT_PREFIX = /^\(\d+\+?\)\s/;

/** "(3) Page title": the unread chat count in front of whatever title the page set. */
export const titleWithCount = (title: string, count: number): string => {
  const base = title.replace(COUNT_PREFIX, "");
  if (count <= 0) return base;
  return `(${count > 99 ? "99+" : count}) ${base}`;
};

const iconLinks = () => Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));

/** Draw the current favicon with a red dot in the corner. */
const faviconWithDot = (href: string): Promise<string | null> =>
  new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.addEventListener("load", () => {
      try {
        const size = 32;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        if (!context) return resolve(null);
        context.drawImage(image, 0, 0, size, size);
        context.beginPath();
        context.arc(size - 8, 8, 7, 0, Math.PI * 2);
        context.fillStyle = "#e7000b";
        context.fill();
        context.lineWidth = 2;
        context.strokeStyle = "#ffffff";
        context.stroke();
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(null);
      }
    });
    image.addEventListener("error", () => resolve(null));
    image.src = href;
  });

/**
 * Keeps the unread chat count in the tab title and a dot on the favicon while
 * someone has mentioned you (docs/chat/phase-2/05-notifications.md).
 */
export const useChatTabTitle = (unread: number, hasMentions: boolean) => {
  const unreadRef = useRef(unread);
  unreadRef.current = unread;

  // Title: re-apply whenever the page changes its own title.
  useEffect(() => {
    const apply = () => {
      const next = titleWithCount(document.title, unreadRef.current);
      if (next !== document.title) document.title = next;
    };
    apply();
    const titleElement = document.querySelector("title");
    if (!titleElement) return;
    const observer = new MutationObserver(apply);
    observer.observe(titleElement, { childList: true, characterData: true, subtree: true });
    return () => {
      observer.disconnect();
      document.title = titleWithCount(document.title, 0);
    };
  }, [unread]);

  // Favicon dot for unread mentions.
  useEffect(() => {
    const links = iconLinks();
    if (!hasMentions || links.length === 0) return;
    const originals = links.map((link) => link.href);
    let cancelled = false;
    void faviconWithDot(originals[0]).then((dotted) => {
      if (cancelled || !dotted) return;
      for (const link of links) link.href = dotted;
      return dotted;
    });
    return () => {
      cancelled = true;
      links.forEach((link, index) => {
        link.href = originals[index];
      });
    };
  }, [hasMentions]);
};
