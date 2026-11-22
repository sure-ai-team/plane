/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * A deliberately small front matter dialect for page Markdown files:
 *
 *   ---
 *   title: Onboarding
 *   access: private
 *   labels: HR, Docs          (or [HR, Docs], or one "- HR" item per line)
 *   external_id: onboarding
 *   ---
 *
 * Only flat "key: value" pairs and simple lists are supported, which is all
 * the page fields need. Values may be wrapped in single or double quotes.
 */

export type TFrontMatter = Record<string, string | string[]>;

const FRONT_MATTER_RE = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

const unquote = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      const inner = trimmed.slice(1, -1);
      return first === '"' ? inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\") : inner.replace(/''/g, "'");
    }
  }
  return trimmed;
};

const parseInlineList = (value: string): string[] =>
  value
    .slice(1, -1)
    .split(",")
    .map((item) => unquote(item))
    .filter((item) => item !== "");

export const parseFrontMatter = (input: string): { data: TFrontMatter; body: string } => {
  const match = FRONT_MATTER_RE.exec(input);
  if (!match) return { data: {}, body: input.replace(/^﻿/, "") };

  const data: TFrontMatter = {};
  let listKey: string | null = null;

  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && listKey) {
      const current = data[listKey];
      const items = Array.isArray(current) ? current : [];
      const value = unquote(listItem[1]);
      if (value) items.push(value);
      data[listKey] = items;
      continue;
    }

    const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!pair) continue;
    const key = pair[1].toLowerCase();
    const value = pair[2].trim();
    if (value === "") {
      // Possibly the start of a "- item" list
      listKey = key;
      data[key] = [];
    } else if (value.startsWith("[") && value.endsWith("]")) {
      listKey = null;
      data[key] = parseInlineList(value);
    } else {
      listKey = null;
      data[key] = unquote(value);
    }
  }

  return { data, body: input.slice(match[0].length) };
};

const quoteIfNeeded = (value: string): string =>
  /^[\s"'[\]{}#&*!|>%@`-]|[:#]\s|\s$|^$/.test(value) || /[\r\n]/.test(value)
    ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ")}"`
    : value;

export const stringifyFrontMatter = (data: Record<string, string | string[] | null | undefined>): string => {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.some((item) => item.includes(","))) {
        // Inline lists are split on commas, so fall back to one item per line
        lines.push(`${key}:`, ...value.map((item) => `  - ${quoteIfNeeded(item)}`));
      } else {
        lines.push(`${key}: [${value.map(quoteIfNeeded).join(", ")}]`);
      }
    } else {
      lines.push(`${key}: ${quoteIfNeeded(value)}`);
    }
  }
  return `---\n${lines.join("\n")}\n---\n`;
};

/** Reads a front matter value that may be a single string or a list. */
export const frontMatterList = (value: string | string[] | undefined): string[] | undefined => {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

export const frontMatterString = (value: string | string[] | undefined): string | undefined => {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.join(", ") : value;
};
