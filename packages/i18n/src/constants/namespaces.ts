/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export const NAMESPACES = [
  "accessibility",
  "auth",
  "automation",
  "common",
  "chat",
  "cycle",
  "dashboard",
  "editor",
  "empty-state",
  "home",
  "importer",
  "inbox",
  "integration",
  "module",
  "navigation",
  "notification",
  "page",
  "power-k",
  "project",
  "project-overview",
  "project-settings",
  "report",
  "settings",
  "spreadsheet",
  "stickies",
  "template",
  "tour",
  "update",
  "user-work",
  "wiki",
  "work-item",
  "work-item-type",
  "workflow",
  "workspace",
  "workspace-settings",
] as const;

export type TNamespace = (typeof NAMESPACES)[number];

export const DEFAULT_NAMESPACE: TNamespace = "common";
