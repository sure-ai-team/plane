/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TLogoProps } from "../common";

/** File formats a project's pages can be imported from and exported to. */
export type TPageTransferFormat = "json" | "markdown" | "html" | "csv" | "xlsx";

export type TPageTransferAccess = "public" | "private";

/** One page in the canonical import/export payload (format version 1). */
export type TPageTransferItem = {
  external_id?: string | null;
  name: string;
  access?: TPageTransferAccess;
  labels?: string[];
  content_html?: string;
  logo_props?: TLogoProps | Record<string, unknown> | null;
};

export type TPageTransferDocument = {
  version: 1;
  pages: TPageTransferItem[];
};

/** Extra, informational fields present on exported pages. */
export type TPageExportItem = TPageTransferItem & {
  external_id: string;
  access: TPageTransferAccess;
  labels: string[];
  content_html: string;
  archived: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export type TPageExportType = "all" | "public" | "private" | "archived";

export type TPageExportResponse = {
  version: 1;
  exported_at: string;
  project: { id: string; name: string; identifier: string };
  pages: TPageExportItem[];
};

export type TPageImportConflictMode = "skip" | "update" | "duplicate";

export type TPageImportErrorCode =
  | "page_not_object"
  | "name_required"
  | "name_too_long"
  | "access_invalid"
  | "labels_not_list"
  | "label_not_text"
  | "label_too_long"
  | "too_many_labels"
  | "external_id_not_text"
  | "external_id_too_long"
  | "duplicate_external_id"
  | "logo_not_object"
  | "logo_invalid"
  | "logo_too_large"
  | "content_not_text"
  | "content_invalid"
  | "payload_not_object"
  | "unsupported_version"
  | "pages_not_list"
  | "no_pages"
  | "too_many_pages"
  | "invalid_conflict_mode";

export type TPageImportError = {
  /** Index of the page in the payload, or null for errors about the whole file. */
  index: number | null;
  field: string | null;
  /** Stable code to translate; older servers may not send it. */
  code?: TPageImportErrorCode;
  params?: Record<string, string | number>;
  /** English fallback. */
  message: string;
};

export type TPageImportAction = "create" | "update" | "skip";

export type TPageImportSkipReason =
  | "already_exists"
  | "locked"
  | "archived"
  | "matches_page_already_in_this_import"
  | "access_unchanged_not_owner";

export type TPageImportResult = {
  index: number;
  name: string;
  action: TPageImportAction;
  reason: TPageImportSkipReason | null;
  page_id: string | null;
};

export type TPageImportRequest = TPageTransferDocument & {
  on_conflict: TPageImportConflictMode;
  dry_run?: boolean;
};

export type TPageImportResponse = {
  valid: boolean;
  errors: TPageImportError[];
  results: TPageImportResult[];
  /** Dry run only. */
  labels_to_create?: string[];
  /** Real import only. */
  created?: number;
  updated?: number;
  skipped?: number;
  labels_created?: string[];
};
