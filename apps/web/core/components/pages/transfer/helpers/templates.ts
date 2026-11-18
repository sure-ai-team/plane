/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TPageTransferFormat } from "@plane/types";
// local imports
import type { TSerializablePage, TSerializedFile } from "./formats";
import { serializePages } from "./formats";

/** English sample text, used when no translator is given (and in tests). */
const TEMPLATE_TEXT_EN = {
  "getting_started.name": "Getting started",
  "getting_started.label": "Docs",
  "getting_started.overview": "Overview",
  "getting_started.intro": "Write the page content here.",
  "getting_started.bold": "Bold text",
  "getting_started.italic": "Italic text",
  "getting_started.link": "A link",
  "getting_started.steps": "Steps",
  "getting_started.step_one": "First step",
  "getting_started.step_two": "Second step",
  "getting_started.task_done": "A finished task",
  "getting_started.task_open": "An open task",
  "getting_started.tip": "Tip: set access to private to keep a page to yourself.",
  "meeting_notes.name": "Weekly meeting notes",
  "meeting_notes.label_meetings": "Meetings",
  "meeting_notes.label_team": "Team",
  "meeting_notes.agenda": "Agenda",
  "meeting_notes.updates": "Updates",
  "meeting_notes.blockers": "Blockers",
  "meeting_notes.decisions": "Decisions",
  "meeting_notes.decisions_hint": "Fill in the decisions made in the meeting.",
} as const;

export type TTemplateTextKey = keyof typeof TEMPLATE_TEXT_EN;

/** Looks up a template string; the import dialog passes a key-prefixed i18n `t`. */
export type TTemplateTranslate = (key: TTemplateTextKey) => string;

const english: TTemplateTranslate = (key) => TEMPLATE_TEXT_EN[key];

const escapeHTML = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Sample pages used to build the downloadable template for every format, so
 * all templates describe the same fields and stay in sync. Field values that
 * the importer reads (access) stay as machine values; text is translated.
 */
export const getTemplatePages = (translate: TTemplateTranslate = english): TSerializablePage[] => {
  const text = (key: TTemplateTextKey) => escapeHTML(translate(key));
  return [
    {
      external_id: "",
      name: translate("getting_started.name"),
      access: "public",
      labels: [translate("getting_started.label")],
      content_html: [
        `<h2>${text("getting_started.overview")}</h2>`,
        `<p>${text("getting_started.intro")}</p>`,
        `<p><strong>${text("getting_started.bold")}</strong>, <em>${text("getting_started.italic")}</em>, `,
        `<code>code</code>, <a href="https://example.com">${text("getting_started.link")}</a></p>`,
        `<h3>${text("getting_started.steps")}</h3>`,
        `<ol><li><p>${text("getting_started.step_one")}</p></li><li><p>${text("getting_started.step_two")}</p></li></ol>`,
        '<ul data-type="taskList">',
        `<li data-type="taskItem" data-checked="true"><p>${text("getting_started.task_done")}</p></li>`,
        `<li data-type="taskItem" data-checked="false"><p>${text("getting_started.task_open")}</p></li>`,
        "</ul>",
        `<blockquote><p>${text("getting_started.tip")}</p></blockquote>`,
      ].join(""),
    },
    {
      external_id: "",
      name: translate("meeting_notes.name"),
      access: "private",
      labels: [translate("meeting_notes.label_meetings"), translate("meeting_notes.label_team")],
      content_html: [
        `<h2>${text("meeting_notes.agenda")}</h2>`,
        `<ul><li><p>${text("meeting_notes.updates")}</p></li><li><p>${text("meeting_notes.blockers")}</p></li></ul>`,
        `<h2>${text("meeting_notes.decisions")}</h2>`,
        `<p>${text("meeting_notes.decisions_hint")}</p>`,
      ].join(""),
    },
  ];
};

/** The English sample pages. */
export const TEMPLATE_PAGES: TSerializablePage[] = getTemplatePages();

export const TEMPLATE_BASE_NAME = "pages-import-template";

export const buildTemplateFile = (
  format: TPageTransferFormat,
  translate?: TTemplateTranslate,
  baseName: string = TEMPLATE_BASE_NAME
): Promise<TSerializedFile> => serializePages(getTemplatePages(translate), format, { baseName });
