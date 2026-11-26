/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useState } from "react";
import type { TProjectSpreadsheet } from "@plane/types";
// local imports
import { getCacheScope, getWorkbookCacheKey } from "../helpers/cache";
import { SPREADSHEET_PARSE_TIMEOUT_MS } from "../helpers/constants";
import type { TSpreadsheetErrorShape } from "../helpers/errors";
import { SpreadsheetError, toSpreadsheetErrorShape } from "../helpers/errors";
import type { TSpreadsheetPreview } from "../helpers/preview";
import { getSpreadsheetKind } from "../helpers/validation";
import { getSpreadsheetWorkerClient } from "../worker/client";
import type { TLoadedWorkbook } from "../worker/protocol";
import { getProjectSpreadsheetService } from "./use-project-spreadsheets";

export type TDocumentLoadPhase = "cache" | "download" | "parse";

export type TSpreadsheetDocumentState =
  | { status: "loading"; phase: TDocumentLoadPhase }
  | { status: "ready"; key: string; data: TLoadedWorkbook }
  | { status: "error"; error: TSpreadsheetErrorShape };

/**
 * Loads a spreadsheet into the worker: IndexedDB cache first, otherwise
 * download the bytes and parse them off the main thread.
 */
export const useSpreadsheetDocument = (
  workspaceSlug: string,
  projectId: string,
  spreadsheet: TProjectSpreadsheet | undefined,
  onPreview?: (preview: TSpreadsheetPreview) => void
) => {
  const [state, setState] = useState<TSpreadsheetDocumentState>({ status: "loading", phase: "cache" });
  const [attempt, setAttempt] = useState(0);

  const id = spreadsheet?.id;
  const version = spreadsheet?.updated_at;
  const name = spreadsheet?.name;
  const type = spreadsheet?.type;

  useEffect(() => {
    if (!id || !version || !name) return;
    let cancelled = false;
    const client = getSpreadsheetWorkerClient();
    const key = getWorkbookCacheKey(id, version);
    const scope = getCacheScope();
    setState({ status: "loading", phase: "cache" });
    const release = () => void client.request("release", { key }).catch(() => undefined);

    const load = async () => {
      const cached = await client.request("open", { scope, key, assetId: id, version }).catch(() => null);
      if (cancelled) {
        // closed while the cache answered: the cleanup's release may have run first
        if (cached) release();
        return;
      }
      if (cached) {
        setState({ status: "ready", key, data: cached });
        onPreview?.(cached.preview);
        return;
      }
      const kind = getSpreadsheetKind(name, type);
      if (!kind) throw new SpreadsheetError("unsupported_type", { name });
      setState({ status: "loading", phase: "download" });
      let buffer: ArrayBuffer;
      try {
        buffer = await getProjectSpreadsheetService().getContent(workspaceSlug, projectId, id);
      } catch {
        throw new SpreadsheetError("download_failed");
      }
      if (cancelled) return;
      setState({ status: "loading", phase: "parse" });
      // cloned, not transferred, so the request can be re-sent if the worker restarts
      const parsed = await client.request(
        "parse",
        { scope, key, assetId: id, version, kind, buffer, retain: true },
        { timeoutMs: SPREADSHEET_PARSE_TIMEOUT_MS }
      );
      if (cancelled) {
        release();
        return;
      }
      if (!parsed.workbook) throw new SpreadsheetError("unknown");
      setState({ status: "ready", key, data: parsed as TLoadedWorkbook });
      onPreview?.(parsed.preview);
    };

    load().catch((error: unknown) => {
      if (!cancelled) setState({ status: "error", error: toSpreadsheetErrorShape(error) });
    });

    return () => {
      cancelled = true;
      release();
    };
    // onPreview is intentionally not a dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSlug, projectId, id, version, name, type, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  return { state, reload };
};
