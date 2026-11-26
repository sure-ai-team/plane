/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { FileSpreadsheet, FileText } from "lucide-react";
import { cn } from "@plane/utils";
import { getSpreadsheetKind } from "./helpers/validation";

type Props = { name: string; type?: string; size?: "sm" | "md" };

/** Small colored badge: green for Excel, blue for CSV. */
export function FileTypeBadge({ name, type, size = "md" }: Props) {
  const kind = getSpreadsheetKind(name, type);
  const Icon = kind === "csv" ? FileText : FileSpreadsheet;
  return (
    <span
      className={cn(
        "flex flex-shrink-0 items-center justify-center rounded-md",
        size === "sm" ? "size-7" : "size-8",
        kind === "csv" ? "bg-accent-subtle text-accent-primary" : "bg-success-subtle text-success-primary"
      )}
      aria-hidden
    >
      <Icon className={size === "sm" ? "size-4" : "size-4.5"} />
    </span>
  );
}
