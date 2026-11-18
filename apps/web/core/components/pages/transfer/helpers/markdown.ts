/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
// plane imports
import { convertHTMLToMarkdown } from "@plane/utils";

const TASK_PREFIX_RE = /^\[([ xX])\]\s+/;

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

      // Mark the enclosing bullet list
      let depth = 0;
      for (let j = i - 3; j >= 0; j--) {
        const token = tokens[j];
        if (token.type === "bullet_list_close") depth += 1;
        if (token.type === "bullet_list_open") {
          if (depth === 0) {
            token.attrSet("data-type", "taskList");
            break;
          }
          depth -= 1;
        }
      }
    }
    return true;
  });
};

const markdownParser = new MarkdownIt({ html: true, linkify: true, breaks: false }).use(taskListPlugin);

/** Converts Markdown to HTML. The server sanitizes the result before saving it. */
export const markdownToHTML = (markdown: string): string => {
  const html = markdownParser.render(markdown ?? "").trim();
  return html || "<p></p>";
};

export type TMarkdownMetaData = Parameters<typeof convertHTMLToMarkdown>[0]["metaData"];

const EMPTY_META_DATA: TMarkdownMetaData = { file_assets: [], user_mentions: [] };

/** Converts page HTML to GitHub-flavoured Markdown using the editor's converter. */
export const htmlToMarkdown = (html: string, metaData: TMarkdownMetaData = EMPTY_META_DATA): string =>
  convertHTMLToMarkdown({ description_html: html || "<p></p>", metaData }).trim();

/**
 * If the Markdown starts with a level-1 heading, return its text as a title
 * and the rest of the document without it.
 */
export const takeLeadingH1 = (markdown: string): { title: string | null; body: string } => {
  const match = /^\s*#[ \t]+(.+?)[ \t]*#*[ \t]*(?:\r?\n|$)/.exec(markdown);
  if (!match) return { title: null, body: markdown };
  return { title: match[1].trim(), body: markdown.slice(match[0].length) };
};
