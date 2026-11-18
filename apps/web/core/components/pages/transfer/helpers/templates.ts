/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TPageTransferFormat } from "@plane/types";
// local imports
import type { TSerializablePage, TSerializedFile } from "./formats";
import { serializePages } from "./formats";

/**
 * Sample pages used to build the downloadable template for every format, so
 * all templates describe the same fields and stay in sync.
 */
export const TEMPLATE_PAGES: TSerializablePage[] = [
  {
    external_id: "",
    name: "Getting started",
    access: "public",
    labels: ["Docs"],
    content_html: [
      "<h2>Overview</h2>",
      "<p>Write the page content here. <strong>Bold</strong>, <em>italic</em>, <code>code</code> and ",
      '<a href="https://example.com">links</a> are supported.</p>',
      "<h3>Steps</h3>",
      "<ol><li><p>First step</p></li><li><p>Second step</p></li></ol>",
      '<ul data-type="taskList">',
      '<li data-type="taskItem" data-checked="true"><p>A finished task</p></li>',
      '<li data-type="taskItem" data-checked="false"><p>An open task</p></li>',
      "</ul>",
      "<blockquote><p>Tip: set access to private to keep a page to yourself.</p></blockquote>",
    ].join(""),
  },
  {
    external_id: "",
    name: "Weekly meeting notes",
    access: "private",
    labels: ["Meetings", "Team"],
    content_html: [
      "<h2>Agenda</h2>",
      "<ul><li><p>Updates</p></li><li><p>Blockers</p></li></ul>",
      "<h2>Decisions</h2>",
      "<p>Fill in the decisions made in the meeting.</p>",
    ].join(""),
  },
];

export const TEMPLATE_BASE_NAME = "pages-import-template";

export const buildTemplateFile = (format: TPageTransferFormat): Promise<TSerializedFile> =>
  serializePages(TEMPLATE_PAGES, format, { baseName: TEMPLATE_BASE_NAME });
