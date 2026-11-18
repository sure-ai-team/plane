/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { TPageTransferFormat } from "@plane/types";
import { parseCSV, toCSV } from "./csv";
import {
  EXCEL_CELL_LIMIT,
  PageTransferFileError,
  detectFileKind,
  parseImportFiles,
  parseMarkdownPage,
  rowsToPages,
  serializePages,
  toSafeFileName,
} from "./formats";
import type { TSerializablePage } from "./formats";
import { parseFrontMatter, stringifyFrontMatter } from "./front-matter";
import { buildHTMLPage, parseHTMLPage } from "./html-document";
import { htmlToMarkdown, markdownToHTML } from "./markdown";
import { TEMPLATE_PAGES, buildTemplateFile } from "./templates";

// exceljs is lazy-loaded; the first import can take a few seconds
const XLSX_TIMEOUT = 30_000;

const file = (name: string, content: string) => ({ name, data: strToU8(content) });

const blobBytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

const expectFileError = async (promise: Promise<unknown>, code: string) => {
  await expect(promise).rejects.toBeInstanceOf(PageTransferFileError);
  await expect(promise).rejects.toMatchObject({ code });
};

describe("csv", () => {
  it("parses quotes, embedded commas and line breaks", () => {
    const rows = parseCSV('﻿name,content\r\n"A, b","line 1\nline ""2"""\r\nplain,\r\n\r\n');
    expect(rows).toEqual([
      ["name", "content"],
      ["A, b", 'line 1\nline "2"'],
      ["plain", ""],
    ]);
  });

  it("round-trips through toCSV", () => {
    const rows = [
      ["a", "b"],
      ['quote " here', "multi\nline"],
      [" padded ", "مرحبا"],
    ];
    expect(parseCSV(toCSV(rows))).toEqual(rows);
  });

  it("adds a byte order mark for spreadsheet apps", () => {
    expect(toCSV([["a"]]).startsWith("﻿")).toBe(true);
  });
});

describe("front matter", () => {
  it("reads strings, inline lists and block lists", () => {
    const { data, body } = parseFrontMatter(
      [
        "---",
        'title: "Hello: world"',
        "access: private",
        "labels: [A, 'B']",
        "tags:",
        "  - x",
        "  - y",
        "# comment",
        "---",
        "Body",
      ].join("\n")
    );
    expect(data).toEqual({ title: "Hello: world", access: "private", labels: ["A", "B"], tags: ["x", "y"] });
    expect(body).toBe("Body");
  });

  it("returns the whole text when there is no front matter", () => {
    expect(parseFrontMatter("# Title\ntext")).toEqual({ data: {}, body: "# Title\ntext" });
  });

  it("round-trips values that need quoting", () => {
    const text = stringifyFrontMatter({ title: "Q: why #1?", labels: ["a, b", "c"], skipped: undefined });
    const { data } = parseFrontMatter(`${text}\nbody`);
    expect(data).toEqual({ title: "Q: why #1?", labels: ["a, b", "c"] });
  });
});

describe("markdown", () => {
  it("converts GFM task lists to editor task lists", () => {
    const html = markdownToHTML("- [x] done\n- [ ] todo\n- plain");
    expect(html).toContain('<ul data-type="taskList">');
    expect(html).toContain('<li data-type="taskItem" data-checked="true">done</li>');
    expect(html).toContain('<li data-type="taskItem" data-checked="false">todo</li>');
  });

  it("converts headings, emphasis and tables", () => {
    const html = markdownToHTML("## Title\n\n**bold** _it_\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<h2>Title</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<table>");
  });

  it("returns an empty paragraph for empty input", () => {
    expect(markdownToHTML("")).toBe("<p></p>");
  });

  it("converts HTML back to Markdown", () => {
    expect(htmlToMarkdown("<h2>Title</h2><p><strong>bold</strong></p>")).toBe("## Title\n\n**bold**");
  });

  it("uses front matter for page fields", () => {
    const page = parseMarkdownPage(
      "---\ntitle: Runbook\naccess: Private\nlabels: Ops, Infra\nexternal_id: rb-1\n---\n# Heading stays\n\nText",
      "folder/ignored.md"
    );
    expect(page).toMatchObject({ name: "Runbook", access: "private", labels: ["Ops", "Infra"], external_id: "rb-1" });
    expect(page.content_html).toContain("<h1>Heading stays</h1>");
  });

  it("falls back to the first heading, then the file name", () => {
    const fromHeading = parseMarkdownPage("# From heading\n\nBody", "x.md");
    expect(fromHeading.name).toBe("From heading");
    expect(fromHeading.content_html).not.toContain("<h1>");
    expect(parseMarkdownPage("Just text", "docs/my-notes.md").name).toBe("my-notes");
  });
});

describe("html", () => {
  it("reads title and plane meta tags", () => {
    const parsed = parseHTMLPage(
      buildHTMLPage({
        name: "A <b> page",
        access: "private",
        labels: ["x", "y"],
        external_id: "ext",
        content_html: "<p>Hi</p>",
      })
    );
    expect(parsed).toEqual({
      title: "A <b> page",
      access: "private",
      labels: ["x", "y"],
      external_id: "ext",
      content_html: "<p>Hi</p>",
    });
  });

  it("handles plain HTML from other tools", () => {
    const parsed = parseHTMLPage("<html><body><h1>Doc</h1><p>Body</p><script>x()</script></body></html>");
    expect(parsed.title).toBe("Doc");
    expect(parsed.content_html).toBe("<p>Body</p>");
    expect(parsed.access).toBeNull();
    expect(parsed.labels).toBeNull();
  });

  it("handles fragments without a body", () => {
    expect(parseHTMLPage("<p>Only a fragment</p>").content_html).toContain("Only a fragment");
  });
});

describe("spreadsheet rows", () => {
  it("maps header aliases and converts markdown content", () => {
    const pages = rowsToPages([
      ["Title", "Visibility", "Labels", "Content", "External ID"],
      ["Doc", "PRIVATE", "a, b,", "**hi**", "e1"],
    ]);
    expect(pages).toEqual([
      {
        external_id: "e1",
        name: "Doc",
        access: "private",
        labels: ["a", "b"],
        content_html: "<p><strong>hi</strong></p>",
      },
    ]);
  });

  it("prefers a content_html column", () => {
    const [page] = rowsToPages([
      ["name", "content_markdown", "content_html"],
      ["Doc", "ignored", "<p>raw</p>"],
    ]);
    expect(page.content_html).toBe("<p>raw</p>");
  });

  it("requires a name column", () => {
    expect(() => rowsToPages([["labels"], ["x"]])).toThrow(PageTransferFileError);
  });
});

describe("parseImportFiles", () => {
  it("detects file kinds by extension", () => {
    expect(detectFileKind("a.MD")).toBe("markdown");
    expect(detectFileKind("a.htm")).toBe("html");
    expect(detectFileKind("a.docx")).toBeNull();
  });

  it("accepts JSON objects and bare arrays", async () => {
    const fromObject = await parseImportFiles([file("a.json", JSON.stringify({ version: 1, pages: [{ name: "A" }] }))]);
    const fromArray = await parseImportFiles([file("b.json", JSON.stringify([{ name: "B" }]))]);
    expect(fromObject.document.pages[0].name).toBe("A");
    expect(fromArray.document.pages[0].name).toBe("B");
  });

  it("reports bad files with codes", async () => {
    await expectFileError(parseImportFiles([file("a.json", "{nope")]), "invalid_json");
    await expectFileError(parseImportFiles([file("a.json", '{"x":1}')]), "invalid_json_shape");
    await expectFileError(parseImportFiles([file("a.docx", "")]), "unsupported_file");
    await expectFileError(parseImportFiles([file("a.zip", "not a zip")]), "invalid_zip");
  });

  it("reads Markdown and HTML pages from a zip, ignoring other files", async () => {
    const zip = zipSync({
      "b/first.md": strToU8("# First\n\n1"),
      "a/second.html": strToU8("<title>Second</title><p>2</p>"),
      "__MACOSX/a/._first.md": strToU8("junk"),
      "notes.txt": strToU8("ignored"),
    });
    const { document, sources } = await parseImportFiles([{ name: "pages.zip", data: zip }]);
    expect(document.pages.map((page) => page.name)).toEqual(["First", "Second"]);
    expect(sources).toEqual(["pages.zip", "pages.zip"]);
  });

  it("rejects a zip without pages", async () => {
    await expectFileError(parseImportFiles([{ name: "x.zip", data: zipSync({ "a.txt": strToU8("x") }) }]), "empty_zip");
  });

  it("combines several files", async () => {
    const { document, sources } = await parseImportFiles([file("a.md", "# A"), file("b.csv", "name\nB\nC")]);
    expect(document.pages.map((page) => page.name)).toEqual(["A", "B", "C"]);
    expect(sources).toEqual(["a.md", "b.csv", "b.csv"]);
  });
});

const SAMPLE: TSerializablePage[] = [
  {
    external_id: "p-1",
    name: "Alpha / Beta",
    access: "private",
    labels: ["One", "Two"],
    content_html: "<h2>Heading</h2><p><strong>Bold</strong> text</p>",
  },
  { external_id: null, name: "Alpha / Beta", access: "public", labels: [], content_html: "<p>Second</p>" },
];

describe("serializePages round trips", () => {
  const roundTrip = async (format: TPageTransferFormat, pages = SAMPLE) => {
    const { blob, fileName } = await serializePages(pages, format, { baseName: "Project X" });
    const parsed = await parseImportFiles([{ name: fileName, data: await blobBytes(blob) }]);
    return { fileName, pages: parsed.document.pages };
  };

  it.each<TPageTransferFormat>(["json", "markdown", "html", "csv", "xlsx"])(
    "keeps page fields in %s",
    async (format) => {
      const { pages } = await roundTrip(format);
      expect(pages).toHaveLength(2);
      expect(pages[0]).toMatchObject({
        external_id: "p-1",
        name: "Alpha / Beta",
        access: "private",
        labels: ["One", "Two"],
      });
      expect(pages[0].content_html).toContain("<h2>Heading</h2>");
      expect(pages[0].content_html).toContain("<strong>Bold</strong>");
      expect(pages[1]).toMatchObject({ name: "Alpha / Beta", access: "public" });
      expect(pages[1].external_id ?? null).toBeNull();
    },
    XLSX_TIMEOUT
  );

  it("names files after the project and zips multi-page Markdown/HTML", async () => {
    expect((await roundTrip("json")).fileName).toBe("Project-X.json");
    expect((await roundTrip("markdown")).fileName).toBe("Project-X-markdown.zip");
    expect((await roundTrip("markdown", [SAMPLE[0]])).fileName).toBe("Alpha-Beta.md");
  });

  it("gives duplicate page names unique file names inside the zip", async () => {
    const { blob } = await serializePages(SAMPLE, "html", { baseName: "p" });
    expect(Object.keys(unzipSync(await blobBytes(blob))).toSorted()).toEqual(["Alpha-Beta-2.html", "Alpha-Beta.html"]);
  });

  it(
    "refuses Excel cells over the limit",
    async () => {
      const long = { name: "Long", content_html: `<p>${"x".repeat(EXCEL_CELL_LIMIT + 1)}</p>` };
      await expectFileError(serializePages([long], "xlsx", { baseName: "p" }), "xlsx_cell_too_long");
    },
    XLSX_TIMEOUT
  );
});

describe("templates", () => {
  it.each<TPageTransferFormat>(["json", "markdown", "html", "csv", "xlsx"])(
    "%s template parses back into the sample pages",
    async (format) => {
      const { blob, fileName } = await buildTemplateFile(format);
      const { document } = await parseImportFiles([{ name: fileName, data: await blobBytes(blob) }]);
      expect(document.pages.map((page) => page.name).toSorted()).toEqual(
        TEMPLATE_PAGES.map((page) => page.name).toSorted()
      );
      const notes = document.pages.find((page) => page.name === "Weekly meeting notes");
      expect(notes).toMatchObject({ access: "private", labels: ["Meetings", "Team"] });
    },
    XLSX_TIMEOUT
  );
});

describe("toSafeFileName", () => {
  it("keeps letters from any script and strips path characters", () => {
    expect(toSafeFileName("ملاحظات/الاجتماع: ١")).toBe("ملاحظات-الاجتماع-١");
    expect(toSafeFileName("../..")).toBe("page");
  });
});
