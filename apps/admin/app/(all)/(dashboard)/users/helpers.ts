/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { SITE_NAME, WEB_BASE_URL } from "@plane/constants";
import type { TBulkUserRole, TBulkUserRowResult } from "@plane/types";

export const ROLE_OPTIONS: { key: TBulkUserRole; label: string }[] = [
  { key: "member", label: "Member" },
  { key: "admin", label: "Admin" },
  { key: "guest", label: "Guest" },
];

export const ACCEPTED_FILE_TYPES = ".xlsx,.csv";

export function getLoginUrl(): string {
  return (WEB_BASE_URL || window.location.origin).replace(/\/+$/, "");
}

export function getFullName(row: Pick<TBulkUserRowResult, "first_name" | "last_name">): string {
  return [row.first_name, row.last_name].filter(Boolean).join(" ");
}

type TCredentials = Pick<TBulkUserRowResult, "first_name" | "email" | "password">;

/** The ready-to-send text an admin pastes into WhatsApp, Teams or similar. */
export function buildCredentialsMessage(row: TCredentials, loginUrl: string, isReset = false): string {
  const greeting = row.first_name ? `Hello ${row.first_name},` : "Hello,";
  return [
    greeting,
    isReset ? `Your ${SITE_NAME} password has been reset.` : `Your ${SITE_NAME} account is ready.`,
    `Sign in: ${loginUrl}`,
    `Email: ${row.email}`,
    `${isReset ? "New" : "Temporary"} password: ${row.password}`,
    "Please change your password from your profile settings after you sign in.",
  ].join("\n");
}

// Cells starting with these characters run as formulas when the CSV is opened in a spreadsheet.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
// Phone numbers are validated as +digits by the server, so they cannot carry a formula.
const PHONE = /^\+\d+$/;

function csvCell(value: string): string {
  const safe = FORMULA_PREFIX.test(value) && !PHONE.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function buildResultsCsv(rows: TBulkUserRowResult[]): string {
  const header = ["email", "first_name", "last_name", "phone", "status", "password", "workspace", "projects", "notes"];
  const lines = rows.map((row) =>
    [
      row.email,
      row.first_name,
      row.last_name,
      row.phone,
      row.status,
      row.password,
      row.workspace,
      row.projects.join(";"),
      row.messages.join(" "),
    ]
      .map(csvCell)
      .join(",")
  );
  // The BOM makes Excel open the file as UTF-8, so Arabic names display correctly.
  return "﻿" + [header.join(","), ...lines].join("\r\n");
}

export function resultsFilename(): string {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return `user-accounts-${stamp}.csv`;
}

export function downloadFile(content: Blob | string, filename: string, type = "text/csv;charset=utf-8") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const ROLE_LABELS: Record<TBulkUserRole, string> = { admin: "Admin", member: "Member", guest: "Guest" };

/** Roles a user can hold in a project, given their workspace role (a project role cannot be higher). */
export function allowedProjectRoles(workspaceRole: TBulkUserRole): TBulkUserRole[] {
  if (workspaceRole === "guest") return ["guest"];
  if (workspaceRole === "member") return ["member", "guest"];
  return ["admin", "member", "guest"];
}

export function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function getErrorMessage(err: unknown, fallback = "Something went wrong. Try again."): string {
  const message = (err as { error?: string } | undefined)?.error;
  return typeof message === "string" && message ? message : fallback;
}
