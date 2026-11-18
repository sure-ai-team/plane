/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Element, ElementContent, Root, RootContent } from "hast";
import { toHtml } from "hast-util-to-html";
import { toText } from "hast-util-to-text";
import rehypeParse from "rehype-parse";
import { unified } from "unified";
// plane imports
import type { TPageTransferAccess } from "@plane/types";

/**
 * One page per HTML file:
 *
 *   <!doctype html>
 *   <html>
 *     <head>
 *       <meta charset="utf-8" />
 *       <title>Onboarding</title>
 *       <meta name="plane:access" content="public" />
 *       <meta name="plane:labels" content="HR, Docs" />
 *       <meta name="plane:external_id" content="onboarding" />
 *     </head>
 *     <body>…page content…</body>
 *   </html>
 *
 * Plain HTML from other tools works too: the title falls back to the first
 * <h1> and then to the file name, and missing meta tags use defaults.
 */

export type TParsedHTMLPage = {
  title: string | null;
  access: string | null;
  labels: string[] | null;
  external_id: string | null;
  content_html: string;
};

const META_PREFIX = "plane:";

const escapeHTML = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const isElement = (node: RootContent | ElementContent | Root): node is Element => node.type === "element";

const findAll = (node: Root | Element, predicate: (element: Element) => boolean, found: Element[] = []): Element[] => {
  for (const child of node.children) {
    if (isElement(child)) {
      if (predicate(child)) found.push(child);
      findAll(child, predicate, found);
    }
  }
  return found;
};

const findFirst = (node: Root | Element, predicate: (element: Element) => boolean): Element | undefined =>
  findAll(node, predicate)[0];

const removeNode = (parent: Root | Element, target: Element): boolean => {
  const index = parent.children.indexOf(target);
  if (index >= 0) {
    parent.children.splice(index, 1);
    return true;
  }
  return parent.children.some((child) => isElement(child) && removeNode(child, target));
};

const propString = (element: Element, name: string): string | null => {
  const value = element.properties?.[name];
  if (value === undefined || value === null) return null;
  return Array.isArray(value) ? value.join(" ") : String(value);
};

/** Content elements that carry no text or media are treated as empty. */
const hasContent = (element: Element): boolean =>
  toText(element).trim() !== "" ||
  findAll(element, (child) => ["img", "video", "iframe", "image-component", "hr"].includes(child.tagName)).length > 0;

export const parseHTMLPage = (html: string): TParsedHTMLPage => {
  const tree = unified().use(rehypeParse, { fragment: false }).parse(html) as Root;

  const meta: Record<string, string> = {};
  for (const element of findAll(tree, (el) => el.tagName === "meta")) {
    const name = propString(element, "name");
    const content = propString(element, "content");
    if (name && content !== null && name.toLowerCase().startsWith(META_PREFIX)) {
      meta[name.slice(META_PREFIX.length).toLowerCase()] = content;
    }
  }

  const titleElement = findFirst(tree, (el) => el.tagName === "title");
  let title = titleElement ? toText(titleElement).trim() || null : null;

  const body = findFirst(tree, (el) => el.tagName === "body");
  const container: Root | Element = body ?? tree;

  if (!title) {
    const heading = findFirst(container, (el) => el.tagName === "h1");
    if (heading) {
      title = toText(heading).trim() || null;
      removeNode(container, heading);
    }
  }

  const contentChildren = container.children.filter(
    (child) => !(isElement(child) && ["head", "script", "style", "title", "meta", "link"].includes(child.tagName))
  );
  const content = toHtml({ type: "root", children: contentChildren } as Root).trim();
  const contentIsEmpty = !body ? content === "" : !hasContent(body);

  return {
    title,
    access: meta.access ?? null,
    labels:
      meta.labels !== undefined
        ? meta.labels
            .split(",")
            .map((label) => label.trim())
            .filter(Boolean)
        : null,
    external_id: meta.external_id ?? null,
    content_html: contentIsEmpty ? "<p></p>" : content,
  };
};

export const buildHTMLPage = (page: {
  name: string;
  access: TPageTransferAccess;
  labels: string[];
  external_id?: string | null;
  content_html: string;
}): string => {
  const metaTags = [
    `<meta name="${META_PREFIX}access" content="${escapeHTML(page.access)}" />`,
    `<meta name="${META_PREFIX}labels" content="${escapeHTML(page.labels.join(", "))}" />`,
    page.external_id ? `<meta name="${META_PREFIX}external_id" content="${escapeHTML(page.external_id)}" />` : null,
  ].filter(Boolean);

  return [
    "<!doctype html>",
    "<html>",
    "  <head>",
    '    <meta charset="utf-8" />',
    `    <title>${escapeHTML(page.name)}</title>`,
    ...metaTags.map((tag) => `    ${tag}`),
    "  </head>",
    "  <body>",
    page.content_html || "<p></p>",
    "  </body>",
    "</html>",
    "",
  ].join("\n");
};
