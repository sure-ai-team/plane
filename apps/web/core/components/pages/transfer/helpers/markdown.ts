/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Element, ElementContent, Root, RootContent } from "hast";
import { toHtml } from "hast-util-to-html";
import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import rehypeParse from "rehype-parse";
import { unified } from "unified";
// plane imports
import { convertHTMLToMarkdown } from "@plane/utils";

export const isRemoteImage = (src: unknown): src is string => typeof src === "string" && /^https?:\/\//i.test(src);

// "[x] text" at the start of a list item, or a lone "[x]" (the text then
// follows in the next paragraph, as older editor Markdown exports wrote it)
const TASK_PREFIX_RE = /^\[([ xX])\](?:\s+|$)/;

const markEnclosingBulletList = (tokens: Token[], from: number) => {
  let depth = 0;
  for (let j = from; j >= 0; j--) {
    const token = tokens[j];
    if (token.type === "bullet_list_close") depth += 1;
    if (token.type === "bullet_list_open") {
      if (depth === 0) {
        token.attrSet("data-type", "taskList");
        return;
      }
      depth -= 1;
    }
  }
};

/**
 * markdown-it has no GFM task lists. Turn "- [ ] item" / "- [x] item" into
 * the HTML the page editor uses for task lists:
 *   <ul data-type="taskList"><li data-type="taskItem" data-checked="true">…</li></ul>
 */
const taskListPlugin = (md: MarkdownIt) => {
  md.core.ruler.after("inline", "plane_task_lists", (state) => {
    const tokens: Token[] = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      const inline = tokens[i];
      if (
        inline.type !== "inline" ||
        tokens[i - 1].type !== "paragraph_open" ||
        tokens[i - 2].type !== "list_item_open"
      )
        continue;
      const match = TASK_PREFIX_RE.exec(inline.content);
      if (!match) continue;

      const listItem = tokens[i - 2];
      listItem.attrSet("data-type", "taskItem");
      listItem.attrSet("data-checked", match[1] === " " ? "false" : "true");

      // Strip "[ ] " from the first text child
      const firstText = inline.children?.find((child) => child.type === "text");
      if (firstText) firstText.content = firstText.content.replace(TASK_PREFIX_RE, "");
      inline.content = inline.content.replace(TASK_PREFIX_RE, "");

      // A lone "[x]" paragraph renders nothing; the text is in the next paragraph
      if (inline.content.trim() === "") {
        inline.children = [];
        tokens[i - 1].hidden = true;
        if (tokens[i + 1]?.type === "paragraph_close") tokens[i + 1].hidden = true;
      }

      markEnclosingBulletList(tokens, i - 3);
    }
    return true;
  });
};

/** markdown-it ends code block content with a newline; the editor would keep it as an extra empty line. */
const trimCodeBlockPlugin = (md: MarkdownIt) => {
  md.core.ruler.push("plane_trim_code_blocks", (state) => {
    for (const token of state.tokens) {
      if (token.type === "fence" || token.type === "code_block") token.content = token.content.replace(/\n$/, "");
    }
    return true;
  });
};

const escapeAttribute = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The editor only reads images as <image-component>; plain <img> would be dropped. */
const imageComponentPlugin = (md: MarkdownIt) => {
  const fallback = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, index, options, env, self) => {
    const src = tokens[index].attrGet("src") ?? "";
    if (!isRemoteImage(src)) return fallback ? fallback(tokens, index, options, env, self) : "";
    return `<image-component src="${escapeAttribute(src)}"></image-component>`;
  };
};

const markdownParser = new MarkdownIt({ html: true, linkify: true, breaks: false })
  .use(taskListPlugin)
  .use(trimCodeBlockPlugin)
  .use(imageComponentPlugin);

/** Converts Markdown to HTML. The server sanitizes the result before saving it. */
export const markdownToHTML = (markdown: string): string => {
  const html = markdownParser.render(markdown ?? "").trim();
  return html || "<p></p>";
};

export type TMarkdownMetaData = Parameters<typeof convertHTMLToMarkdown>[0]["metaData"];

const EMPTY_META_DATA: TMarkdownMetaData = { file_assets: [], user_mentions: [] };

const isElement = (node: RootContent | ElementContent): node is Element => node.type === "element";

/** Inline content of a task item: the item's paragraphs unwrapped, joined by spaces. */
const taskItemInlineContent = (item: Element): ElementContent[] => {
  const body = item.children.find((child) => isElement(child) && child.tagName === "div") as Element | undefined;
  const blocks = (body ?? item).children.filter(
    (child) => !(isElement(child) && (child.tagName === "label" || child.tagName === "input"))
  );
  const inline: ElementContent[] = [];
  for (const block of blocks) {
    const parts = isElement(block) && block.tagName === "p" ? block.children : [block];
    if (parts.length === 0) continue;
    if (inline.length > 0) inline.push({ type: "text", value: " " });
    inline.push(...parts);
  }
  return inline;
};

const findCheckbox = (node: Element): Element | undefined => {
  for (const child of node.children) {
    if (!isElement(child)) continue;
    if (child.tagName === "input" && child.properties?.type === "checkbox") return child;
    const nested = child.tagName === "label" ? findCheckbox(child) : undefined;
    if (nested) return nested;
  }
  return undefined;
};

/**
 * The editor writes a checked item as a bare `data-checked` attribute (and a
 * checked checkbox); an unchecked one as data-checked="false".
 */
const isTaskItemChecked = (item: Element): boolean => {
  const checkbox = findCheckbox(item);
  if (checkbox) return Boolean(checkbox.properties?.checked);
  const value = item.properties?.dataChecked;
  return value === true || value === "" || String(value).toLowerCase() === "true";
};

/**
 * Rewrites editor-specific HTML that the HTML→Markdown converter would drop
 * or misread into plain HTML it understands:
 * - task items (editor shape or bare) → <li><input type="checkbox" checked> text</li> ("- [x] text")
 * - <div data-type="horizontalRule"> → <hr> ("---")
 * - <image-component src="https://…"> → <img src> ("![](…)"); asset-id images
 *   are left for the converter, which resolves them through the metadata
 */
const normalizeForMarkdown = (html: string): string => {
  const tree = unified().use(rehypeParse, { fragment: true }).parse(html) as Root;
  let changed = false;
  const visit = (node: Root | Element) => {
    node.children.forEach((child, index) => {
      if (!isElement(child)) return;
      if (child.tagName === "li" && child.properties?.dataType === "taskItem") {
        const checked = isTaskItemChecked(child);
        child.children = [
          { type: "element", tagName: "input", properties: { type: "checkbox", checked }, children: [] },
          { type: "text", value: " " },
          ...taskItemInlineContent(child),
        ];
        child.properties = {};
        changed = true;
        return;
      }
      if (child.tagName === "div" && child.properties?.dataType === "horizontalRule") {
        node.children[index] = { type: "element", tagName: "hr", properties: {}, children: [] };
        changed = true;
        return;
      }
      if (child.tagName === "image-component" && isRemoteImage(child.properties?.src)) {
        node.children[index] = {
          type: "element",
          tagName: "img",
          // The converter skips images without alt text
          properties: { src: child.properties.src, alt: String(child.properties.alt || "image") },
          children: [],
        };
        changed = true;
        return;
      }
      visit(child);
    });
  };
  visit(tree);
  return changed ? toHtml(tree) : html;
};

/** Converts page HTML to GitHub-flavoured Markdown using the editor's converter. */
export const htmlToMarkdown = (html: string, metaData: TMarkdownMetaData = EMPTY_META_DATA): string =>
  convertHTMLToMarkdown({ description_html: normalizeForMarkdown(html || "<p></p>"), metaData }).trim();

/**
 * If the Markdown starts with a level-1 heading, return its text as a title
 * and the rest of the document without it.
 */
export const takeLeadingH1 = (markdown: string): { title: string | null; body: string } => {
  const match = /^\s*#[ \t]+(.+?)[ \t]*#*[ \t]*(?:\r?\n|$)/.exec(markdown);
  if (!match) return { title: null, body: markdown };
  return { title: match[1].trim(), body: markdown.slice(match[0].length) };
};
