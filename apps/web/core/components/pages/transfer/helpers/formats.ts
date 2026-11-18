/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
// plane imports
import type { TPageTransferAccess, TPageTransferDocument, TPageTransferFormat, TPageTransferItem } from "@plane/types";
// local imports
import { parseCSV, toCSV } from "./csv";
import { frontMatterList, frontMatterString, parseFrontMatter, stringifyFrontMatter } from "./front-matter";
import { buildHTMLPage, parseHTMLPage } from "./html-document";
import type { TMarkdownMetaData } from "./markdown";
import { htmlToMarkdown, markdownToHTML, takeLeadingH1 } from "./markdown";

// ---------------------------------------------------------------------------
// errors

export type TPageTransferErrorCode =
  | "unsupported_file"
  | "invalid_json"
  | "invalid_json_shape"
  | "empty_file"
  | "empty_zip"
  | "invalid_zip"
  | "invalid_xlsx"
  | "missing_name_column"
  | "xlsx_cell_too_long"
  | "too_large";

/** A problem with the uploaded/exported file itself, with an i18n-friendly code. */
export class PageTransferFileError extends Error {
  code: TPageTransferErrorCode;
  params: Record<string, string | number>;

  constructor(code: TPageTransferErrorCode, params: Record<string, string | number> = {}) {
    super(code);
    this.name = "PageTransferFileError";
    this.code = code;
    this.params = params;
  }
}

// ---------------------------------------------------------------------------
// file types

export const PAGE_TRANSFER_FORMATS: TPageTransferFormat[] = ["json", "markdown", "html", "csv", "xlsx"];

export const IMPORT_ACCEPT: Record<string, string[]> = {
  "application/json": [".json"],
  "text/markdown": [".md", ".markdown"],
  "text/html": [".html", ".htm"],
  "text/csv": [".csv"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/zip": [".zip"],
};

const MIME_TYPES: Record<TPageTransferFormat | "zip", string> = {
  json: "application/json",
  markdown: "text/markdown;charset=utf-8",
  html: "text/html;charset=utf-8",
  csv: "text/csv;charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
};

type TFileKind = TPageTransferFormat | "zip";

const extensionOf = (fileName: string): string => {
  const match = /\.([^./\\]+)$/.exec(fileName);
  return match ? match[1].toLowerCase() : "";
};

export const detectFileKind = (fileName: string): TFileKind | null => {
  switch (extensionOf(fileName)) {
    case "json":
      return "json";
    case "md":
    case "markdown":
      return "markdown";
    case "html":
    case "htm":
      return "html";
    case "csv":
      return "csv";
    case "xlsx":
      return "xlsx";
    case "zip":
      return "zip";
    default:
      return null;
  }
};

const baseNameOf = (fileName: string): string => {
  const name = fileName.split(/[/\\]/).pop() ?? fileName;
  return name.replace(/\.[^.]+$/, "");
};

const decodeText = (data: Uint8Array): string => strFromU8(data).replace(/^﻿/, "");

// ---------------------------------------------------------------------------
// shared field helpers

const normalizeAccess = (value: string | null | undefined): TPageTransferAccess | undefined => {
  if (value === null || value === undefined || value.trim() === "") return undefined;
  const normalized = value.trim().toLowerCase();
  // Unknown values are passed through so the server reports them per page
  return normalized as TPageTransferAccess;
};

const nonEmpty = (value: string | null | undefined): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

// ---------------------------------------------------------------------------
// parsing (file -> canonical document)

export type TImportSourceFile = { name: string; data: Uint8Array };

export type TParsedImport = {
  document: TPageTransferDocument;
  /** Which file each page came from, for the preview. */
  sources: string[];
};

const parseJSON = (text: string): TPageTransferItem[] => {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new PageTransferFileError("invalid_json");
  }
  if (Array.isArray(data)) return data as TPageTransferItem[];
  if (data && typeof data === "object" && Array.isArray((data as { pages?: unknown }).pages)) {
    return (data as { pages: TPageTransferItem[] }).pages;
  }
  throw new PageTransferFileError("invalid_json_shape");
};

export const parseMarkdownPage = (text: string, fileName: string): TPageTransferItem => {
  const { data, body } = parseFrontMatter(text);
  let name = nonEmpty(frontMatterString(data.title)) ?? nonEmpty(frontMatterString(data.name));
  let content = body;
  if (!name) {
    const { title, body: rest } = takeLeadingH1(body);
    if (title) {
      name = title;
      content = rest;
    }
  }
  return {
    external_id: nonEmpty(frontMatterString(data.external_id)) ?? null,
    name: name ?? baseNameOf(fileName),
    access: normalizeAccess(frontMatterString(data.access)),
    labels: frontMatterList(data.labels) ?? [],
    content_html: markdownToHTML(content.trim()),
  };
};

const parseHTMLFile = (text: string, fileName: string): TPageTransferItem => {
  const parsed = parseHTMLPage(text);
  return {
    external_id: nonEmpty(parsed.external_id) ?? null,
    name: nonEmpty(parsed.title) ?? baseNameOf(fileName),
    access: normalizeAccess(parsed.access),
    labels: parsed.labels ?? [],
    content_html: parsed.content_html,
  };
};

const COLUMN_ALIASES: Record<string, string> = {
  external_id: "external_id",
  externalid: "external_id",
  id: "external_id",
  name: "name",
  title: "name",
  page: "name",
  access: "access",
  visibility: "access",
  labels: "labels",
  label: "labels",
  content_markdown: "content_markdown",
  content: "content_markdown",
  markdown: "content_markdown",
  content_html: "content_html",
  html: "content_html",
};

const normalizeHeader = (header: string): string | null =>
  COLUMN_ALIASES[
    header
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_")
  ] ?? null;

/** Turns spreadsheet rows (first row = headers) into pages. */
export const rowsToPages = (rows: string[][]): TPageTransferItem[] => {
  if (rows.length === 0) throw new PageTransferFileError("empty_file");
  const columns = rows[0].map(normalizeHeader);
  if (!columns.includes("name")) throw new PageTransferFileError("missing_name_column");

  return rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    columns.forEach((column, index) => {
      if (column && record[column] === undefined) record[column] = cells[index] ?? "";
    });
    const html = nonEmpty(record.content_html);
    const markdown = nonEmpty(record.content_markdown);
    return {
      external_id: nonEmpty(record.external_id) ?? null,
      name: (record.name ?? "").trim(),
      access: normalizeAccess(record.access),
      labels: (record.labels ?? "")
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean),
      content_html: html ?? (markdown ? markdownToHTML(markdown) : "<p></p>"),
    };
  });
};

const cellToString = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const cell = value as {
      richText?: { text: string }[];
      text?: unknown;
      result?: unknown;
      hyperlink?: string;
      error?: string;
    };
    if (Array.isArray(cell.richText)) return cell.richText.map((part) => part.text).join("");
    if (cell.text !== undefined) return cellToString(cell.text);
    if (cell.result !== undefined) return cellToString(cell.result);
    if (cell.hyperlink) return cell.hyperlink;
    if (cell.error) return "";
  }
  return String(value);
};

const loadExcel = async () => (await import("exceljs")).default;

const parseXLSX = async (data: Uint8Array): Promise<TPageTransferItem[]> => {
  const ExcelJS = await loadExcel();
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  } catch {
    throw new PageTransferFileError("invalid_xlsx");
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new PageTransferFileError("empty_file");

  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    // row.values is 1-indexed
    const values = row.values as unknown[];
    for (let column = 1; column < values.length; column++) cells.push(cellToString(values[column]));
    if (cells.some((cell) => cell.trim() !== "")) rows.push(cells);
  });
  return rowsToPages(rows);
};

const parseSingleFile = async (kind: TFileKind, file: TImportSourceFile): Promise<TPageTransferItem[]> => {
  switch (kind) {
    case "json":
      return parseJSON(decodeText(file.data));
    case "markdown":
      return [parseMarkdownPage(decodeText(file.data), file.name)];
    case "html":
      return [parseHTMLFile(decodeText(file.data), file.name)];
    case "csv":
      return rowsToPages(parseCSV(decodeText(file.data)));
    case "xlsx":
      return parseXLSX(file.data);
    case "zip":
      return parseZip(file.data);
  }
};

const isIgnoredZipEntry = (path: string): boolean =>
  path.endsWith("/") ||
  path.split("/").some((segment) => segment.startsWith(".") || segment === "__MACOSX") ||
  !["markdown", "html", "json"].includes(detectFileKind(path) ?? "");

const parseZip = async (data: Uint8Array): Promise<TPageTransferItem[]> => {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data, { filter: (file) => !isIgnoredZipEntry(file.name) });
  } catch {
    throw new PageTransferFileError("invalid_zip");
  }
  // Keep the archive's own order, so an exported zip re-imports in export order
  const paths = Object.keys(entries);
  if (paths.length === 0) throw new PageTransferFileError("empty_zip");

  // Promise.all keeps results in input order
  const parsed = await Promise.all(
    paths.map((path) => {
      const kind = detectFileKind(path);
      return kind ? parseSingleFile(kind, { name: path, data: entries[path] }) : Promise.resolve([]);
    })
  );
  return parsed.flat();
};

/** Reads uploaded files into one canonical import document. */
export const parseImportFiles = async (files: TImportSourceFile[]): Promise<TParsedImport> => {
  const kinds = files.map((file) => {
    const kind = detectFileKind(file.name);
    if (!kind) throw new PageTransferFileError("unsupported_file", { name: file.name });
    return kind;
  });
  // Promise.all keeps results in input order
  const parsed = await Promise.all(files.map((file, index) => parseSingleFile(kinds[index], file)));
  const pages = parsed.flat();
  const sources = parsed.flatMap((filePages, index) => filePages.map(() => files[index].name));
  if (pages.length === 0) throw new PageTransferFileError("empty_file");
  return { document: { version: 1, pages }, sources };
};

// ---------------------------------------------------------------------------
// serializing (canonical pages -> file)

export type TSerializablePage = {
  external_id?: string | null;
  name: string;
  access?: TPageTransferAccess;
  labels?: string[];
  content_html?: string;
  logo_props?: TPageTransferItem["logo_props"];
};

export type TSerializeOptions = {
  /** Used to name the downloaded file, e.g. the project identifier. */
  baseName: string;
  /** Resolves mentions/assets when converting HTML to Markdown. */
  getMarkdownMetaData?: (html: string) => TMarkdownMetaData;
  /** Extra top-level fields for the JSON format (e.g. exported_at, project). */
  jsonExtras?: Record<string, unknown>;
};

export type TSerializedFile = { blob: Blob; fileName: string };

export const EXCEL_CELL_LIMIT = 32767;
export const SPREADSHEET_COLUMNS = ["external_id", "name", "access", "labels", "content_markdown"] as const;

const MAX_FILE_NAME_LENGTH = 80;

export const toSafeFileName = (value: string, fallback = "page"): string => {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, MAX_FILE_NAME_LENGTH);
  return cleaned || fallback;
};

const uniqueFileNames = (names: string[], extension: string): string[] => {
  const used = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const count = used.get(key) ?? 0;
    used.set(key, count + 1);
    return `${count === 0 ? name : `${name}-${count + 1}`}.${extension}`;
  });
};

const normalizePage = (page: TSerializablePage) => ({
  external_id: page.external_id ?? null,
  name: page.name,
  access: page.access ?? "public",
  labels: page.labels ?? [],
  content_html: page.content_html || "<p></p>",
  logo_props: page.logo_props ?? null,
});

export const pageToMarkdownFile = (
  page: TSerializablePage,
  options: Pick<TSerializeOptions, "getMarkdownMetaData">
) => {
  const normalized = normalizePage(page);
  const metaData = options.getMarkdownMetaData?.(normalized.content_html);
  const frontMatter = stringifyFrontMatter({
    title: normalized.name,
    access: normalized.access,
    labels: normalized.labels,
    external_id: normalized.external_id ?? undefined,
  });
  return `${frontMatter}\n${htmlToMarkdown(normalized.content_html, metaData)}\n`;
};

const zipFiles = (files: { name: string; content: string }[]): Uint8Array =>
  zipSync(Object.fromEntries(files.map((file) => [file.name, strToU8(file.content)])), { level: 6 });

const toBlob = (data: string | Uint8Array, type: string): Blob =>
  new Blob([typeof data === "string" ? data : (data as BlobPart)], { type });

const serializePerPageFiles = (
  pages: TSerializablePage[],
  extension: "md" | "html",
  render: (page: TSerializablePage) => string,
  format: TPageTransferFormat,
  baseName: string
): TSerializedFile => {
  const names = uniqueFileNames(
    pages.map((page) => toSafeFileName(page.name)),
    extension
  );
  if (pages.length === 1) {
    return { blob: toBlob(render(pages[0]), MIME_TYPES[format]), fileName: names[0] };
  }
  const zipped = zipFiles(pages.map((page, index) => ({ name: names[index], content: render(page) })));
  return {
    blob: toBlob(zipped, MIME_TYPES.zip),
    fileName: `${baseName}-${extension === "md" ? "markdown" : "html"}.zip`,
  };
};

export const pagesToRows = (
  pages: TSerializablePage[],
  getMarkdownMetaData?: TSerializeOptions["getMarkdownMetaData"]
): string[][] => [
  [...SPREADSHEET_COLUMNS],
  ...pages.map((page) => {
    const normalized = normalizePage(page);
    return [
      normalized.external_id ?? "",
      normalized.name,
      normalized.access,
      normalized.labels.join(", "),
      htmlToMarkdown(normalized.content_html, getMarkdownMetaData?.(normalized.content_html)),
    ];
  }),
];

const buildXLSX = async (rows: string[][]): Promise<Uint8Array> => {
  for (let index = 1; index < rows.length; index++) {
    if (rows[index].some((cell) => cell.length > EXCEL_CELL_LIMIT)) {
      throw new PageTransferFileError("xlsx_cell_too_long", { name: rows[index][1], limit: EXCEL_CELL_LIMIT });
    }
  }
  const ExcelJS = await loadExcel();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Pages", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { key: "external_id", width: 24 },
    { key: "name", width: 32 },
    { key: "access", width: 10 },
    { key: "labels", width: 24 },
    { key: "content_markdown", width: 80 },
  ];
  rows.forEach((row) => sheet.addRow(row));
  sheet.getRow(1).font = { bold: true };
  sheet.getColumn(5).alignment = { wrapText: true, vertical: "top" };
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
};

/** Writes pages to a downloadable file in the requested format. */
export const serializePages = async (
  pages: TSerializablePage[],
  format: TPageTransferFormat,
  options: TSerializeOptions
): Promise<TSerializedFile> => {
  const baseName = toSafeFileName(options.baseName, "pages");
  switch (format) {
    case "json": {
      const document = { version: 1, ...options.jsonExtras, pages: pages.map(normalizePage) };
      return {
        blob: toBlob(JSON.stringify(document, null, 2) + "\n", MIME_TYPES.json),
        fileName: `${baseName}.json`,
      };
    }
    case "markdown":
      return serializePerPageFiles(pages, "md", (page) => pageToMarkdownFile(page, options), format, baseName);
    case "html":
      return serializePerPageFiles(pages, "html", (page) => buildHTMLPage(normalizePage(page)), format, baseName);
    case "csv":
      return {
        blob: toBlob(toCSV(pagesToRows(pages, options.getMarkdownMetaData)), MIME_TYPES.csv),
        fileName: `${baseName}.csv`,
      };
    case "xlsx":
      return {
        blob: toBlob(await buildXLSX(pagesToRows(pages, options.getMarkdownMetaData)), MIME_TYPES.xlsx),
        fileName: `${baseName}.xlsx`,
      };
  }
};
