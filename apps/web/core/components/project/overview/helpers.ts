/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

/** Search param that holds the active overview tab, e.g. `?tab=data`. */
export const OVERVIEW_TAB_PARAM = "tab";

export const OVERVIEW_TABS = ["readme", "data"] as const;

export type TOverviewTab = (typeof OVERVIEW_TABS)[number];

export const DEFAULT_OVERVIEW_TAB: TOverviewTab = "readme";

const isOverviewTab = (value: string): value is TOverviewTab => (OVERVIEW_TABS as readonly string[]).includes(value);

/** Reads the tab from the `tab` search param. Unknown or missing values fall back to the README. */
export const parseOverviewTab = (value: string | null | undefined): TOverviewTab => {
  const normalized = value?.trim().toLowerCase() ?? "";
  return isOverviewTab(normalized) ? normalized : DEFAULT_OVERVIEW_TAB;
};

/**
 * Returns the search params with the tab applied. The default tab is left out
 * so the plain overview URL stays clean; other params (and the hash) are kept.
 */
export const withOverviewTab = (current: URLSearchParams, tab: TOverviewTab): URLSearchParams => {
  const next = new URLSearchParams(current);
  if (tab === DEFAULT_OVERVIEW_TAB) next.delete(OVERVIEW_TAB_PARAM);
  else next.set(OVERVIEW_TAB_PARAM, tab);
  return next;
};

// ---------------------------------------------------------------------------
// README outline
// ---------------------------------------------------------------------------

/** The part of the editor's heading marking the outline needs. */
export type THeadingLike = {
  level: number;
  text: string;
};

export type TOutlineItem<T extends THeadingLike = THeadingLike> = {
  /** position of the heading among all the document's headings (matches DOM order) */
  index: number;
  /** URL-safe, unique anchor for the heading */
  id: string;
  text: string;
  /** indentation relative to the shallowest heading in the document, starting at 0 */
  depth: number;
  heading: T;
};

/** Headings deeper than this are left out of the outline to keep it scannable. */
export const OUTLINE_MAX_LEVEL = 3;

/** Whether two heading lists have the same levels and text, in the same order. */
export const areHeadingsEqual = (a: readonly THeadingLike[], b: readonly THeadingLike[]): boolean =>
  a.length === b.length &&
  a.every((heading, index) => heading.level === b[index].level && heading.text === b[index].text);

/** Turns heading text into an anchor id. Keeps letters and digits of any script. */
export const slugifyHeading = (text: string): string => {
  const slug = text
    .normalize("NFKD")
    // drop accents from Latin letters only; other scripts keep their marks
    .replace(/([a-z])\p{Mn}+/giu, "$1")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
};

/** Builds the outline from the editor's headings: drops empty / too-deep ones and gives each a unique id. */
export const buildOutline = <T extends THeadingLike>(headings: readonly T[]): TOutlineItem<T>[] => {
  const visible = headings
    .map((heading, index) => ({ heading, index, text: heading.text.trim() }))
    .filter(({ heading, text }) => text.length > 0 && heading.level <= OUTLINE_MAX_LEVEL);
  if (visible.length === 0) return [];

  const minLevel = Math.min(...visible.map(({ heading }) => heading.level));
  const used = new Map<string, number>();

  return visible.map(({ heading, index, text }) => {
    const base = slugifyHeading(text);
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    return {
      index,
      id: seen === 0 ? base : `${base}-${seen + 1}`,
      text,
      depth: Math.max(0, heading.level - minLevel),
      heading,
    };
  });
};

/**
 * Scroll-spy: given each outline heading's top edge relative to the top of the
 * scroll viewport (in outline order), returns the index of the item being read.
 * That is the last heading scrolled past `offset`; the first one before any is.
 * Returns -1 when there are no headings.
 */
export const getActiveOutlineIndex = (headingTops: readonly number[], offset: number): number => {
  if (headingTops.length === 0) return -1;
  let active = 0;
  headingTops.forEach((top, index) => {
    if (top <= offset) active = index;
  });
  return active;
};

/** Reads the section id from a location hash like `#getting-started`. */
export const parseSectionHash = (hash: string | null | undefined): string | null => {
  if (!hash) return null;
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};
