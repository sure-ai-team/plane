/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useContext } from "react";
// context
import { StoreContext } from "@/lib/store-context";
import type { IProjectReadmeStore } from "@/store/project-readme/project-readme.store";

export const useProjectReadme = (): IProjectReadmeStore => {
  const context = useContext(StoreContext);
  if (context === undefined) throw new Error("useProjectReadme must be used within StoreProvider");
  return context.projectReadme;
};
