/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { Copy, Eye, EyeOff, MessageSquareText } from "lucide-react";
// plane imports
import { Badge } from "@plane/propel/badge";
import type { TBadgeVariant } from "@plane/propel/badge";
import { Button } from "@plane/propel/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@plane/propel/table";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TBulkUserRowResult, TBulkUserRowStatus } from "@plane/types";
// local
import { buildCredentialsMessage, getFullName } from "./helpers";

type Props = {
  rows: TBulkUserRowResult[];
  isPreview: boolean;
  loginUrl: string;
  /** The file's row number; meaningless for users added one by one. */
  showRowNumber?: boolean;
};

const STATUS_BADGE: Record<TBulkUserRowStatus, { variant: TBadgeVariant; label: string; previewLabel: string }> = {
  created: { variant: "success", label: "Created", previewLabel: "Will be created" },
  existing: { variant: "warning", label: "Already exists", previewLabel: "Already exists" },
  error: { variant: "danger", label: "Failed", previewLabel: "Error" },
};

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    setToast({ type: TOAST_TYPE.SUCCESS, title: `${what} copied` });
  } catch {
    setToast({ type: TOAST_TYPE.ERROR, title: "Could not copy", message: "Your browser blocked clipboard access." });
  }
}

export function BulkUserResultsTable(props: Props) {
  const { rows, isPreview, loginUrl, showRowNumber = true } = props;
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const hasPasswords = !isPreview && rows.some((row) => row.password);
  const allRevealed = hasPasswords && rows.filter((row) => row.password).every((row) => revealed.has(row.line));

  const toggleRow = (line: number) =>
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });

  const toggleAll = () =>
    setRevealed(allRevealed ? new Set() : new Set(rows.filter((row) => row.password).map((row) => row.line)));

  return (
    <div className="flex flex-col gap-2">
      {hasPasswords && (
        <div className="flex justify-end">
          <Button variant="ghost" size="base" onClick={toggleAll} prependIcon={allRevealed ? <EyeOff /> : <Eye />}>
            {allRevealed ? "Hide all passwords" : "Show all passwords"}
          </Button>
        </div>
      )}
      <div className="rounded-md border border-subtle">
        <Table>
          <TableHeader>
            <TableRow>
              {showRowNumber && <TableHead className="w-14">Row</TableHead>}
              <TableHead>User</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>Status</TableHead>
              {!isPreview && <TableHead>Temporary password</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const badge = STATUS_BADGE[row.status];
              const name = getFullName(row);
              const isRevealed = revealed.has(row.line);
              return (
                <TableRow key={row.line} className="border-b border-subtle align-top last:border-b-0">
                  {showRowNumber && <TableCell className="text-tertiary">{row.line}</TableCell>}
                  <TableCell>
                    <div className="text-primary">{name || row.email || "(no email)"}</div>
                    {name && <div className="text-11 text-tertiary">{row.email}</div>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-secondary" dir="ltr">
                    {row.phone || "-"}
                  </TableCell>
                  <TableCell className="text-secondary">
                    {row.workspace ? (
                      <>
                        <div>{row.workspace}</div>
                        {row.projects.length > 0 && (
                          <div className="text-11 text-tertiary">{row.projects.join(", ")}</div>
                        )}
                      </>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell className="max-w-64">
                    <Badge variant={badge.variant}>{isPreview ? badge.previewLabel : badge.label}</Badge>
                    {row.messages.map((message) => (
                      <div
                        key={message}
                        className={row.status === "error" ? "text-11 text-danger-primary" : "text-11 text-tertiary"}
                      >
                        {message}
                      </div>
                    ))}
                  </TableCell>
                  {!isPreview && (
                    <TableCell>
                      {row.password ? (
                        <div className="flex items-center gap-1">
                          <code className="font-mono min-w-36 rounded-sm bg-layer-1 px-1.5 py-0.5 text-12" dir="ltr">
                            {isRevealed ? row.password : "••••••••••••••••"}
                          </code>
                          <Button
                            variant="ghost"
                            size="base"
                            aria-label={isRevealed ? "Hide password" : "Show password"}
                            onClick={() => toggleRow(row.line)}
                          >
                            {isRevealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="base"
                            aria-label="Copy password"
                            onClick={() => void copyText(row.password, "Password")}
                          >
                            <Copy className="size-3.5" />
                          </Button>
                          <Button
                            variant="secondary"
                            size="base"
                            prependIcon={<MessageSquareText />}
                            onClick={() => void copyText(buildCredentialsMessage(row, loginUrl), "Message")}
                          >
                            Copy message
                          </Button>
                        </div>
                      ) : (
                        <span className="text-tertiary">-</span>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
