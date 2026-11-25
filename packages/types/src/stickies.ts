/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TLogoProps } from "./common";

/** Who, besides its owner, a project sticky is shared with. */
export enum EStickyAccess {
  PRIVATE = 0,
  MEMBERS = 1,
  PROJECT = 2,
}

export type TStickyPermission = "view" | "edit";

/** What the current user may do; "manage" is edit plus share, pin and delete. */
export type TStickyUserPermission = TStickyPermission | "manage";

export type TStickyShare = {
  member_id: string;
  permission: TStickyPermission;
};

/** The complete sharing state of a sticky; saving it replaces the previous one. */
export type TStickySharing = {
  access: EStickyAccess;
  project_permission: TStickyPermission;
  members: TStickyShare[];
};

export type TSticky = {
  created_at?: string | undefined;
  created_by?: string | undefined;
  background_color?: string | null | undefined;
  description?: object | undefined;
  description_html?: string | undefined;
  id: string;
  logo_props: TLogoProps | undefined;
  name?: string;
  sort_order: number | undefined;
  updated_at?: string | undefined;
  updated_by?: string | undefined;
  workspace: string | undefined;
  owner?: string;
  // project stickies only
  project?: string | null;
  access?: EStickyAccess;
  project_permission?: TStickyPermission;
  shares?: TStickyShare[];
  my_permission?: TStickyUserPermission;
  pinned_at?: string | null;
  pinned_by?: string | null;
  content_version?: number;
};

/** Personal stickies of a workspace, or the stickies of one of its projects. */
export type TStickyScope = {
  workspaceSlug: string;
  projectId?: string;
};
