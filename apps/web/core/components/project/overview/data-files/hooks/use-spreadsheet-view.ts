/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { SPREADSHEET_SEARCH_DEBOUNCE_MS } from "../helpers/constants";
import type { TSpreadsheetFilter, TSpreadsheetSort } from "../helpers/query";
import { getSpreadsheetWorkerClient } from "../worker/client";
import type { TViewQuery } from "../worker/protocol";

export type TViewState = {
  view: Uint32Array | null;
  isComputing: boolean;
  failed: boolean;
};

/** Asks the worker for the filtered + sorted row order whenever the query changes. */
export const useSpreadsheetView = (
  key: string | null,
  sheet: number,
  headerRow: boolean,
  filters: TSpreadsheetFilter[],
  sort: TSpreadsheetSort
): TViewState & { query: TViewQuery | null } => {
  const [state, setState] = useState<TViewState>({ view: null, isComputing: false, failed: false });
  const sequence = useRef(0);
  const [query, setQuery] = useState<TViewQuery | null>(null);

  useEffect(() => {
    if (!key) return;
    const next: TViewQuery = { key, sheet, headerRow, filters, sort };
    const current = ++sequence.current;
    setState((previous) => ({ ...previous, isComputing: true, failed: false }));
    const run = async () => {
      let view: Uint32Array;
      try {
        ({ view } = await getSpreadsheetWorkerClient().request("query", next));
      } catch {
        if (current === sequence.current) setState({ view: null, isComputing: false, failed: true });
        return;
      }
      if (current !== sequence.current) return;
      setState({ view, isComputing: false, failed: false });
      setQuery(next);
    };
    void run();
  }, [key, sheet, headerRow, filters, sort]);

  return { ...state, query };
};

export type TSearchState = {
  /** flat [viewPosition, column] pairs */
  matches: Uint32Array;
  truncated: boolean;
  isSearching: boolean;
};

const EMPTY_MATCHES = new Uint32Array(0);

/** Debounced search over the current view, run in the worker. */
export const useSpreadsheetSearch = (query: TViewQuery | null, term: string): TSearchState => {
  const [state, setState] = useState<TSearchState>({ matches: EMPTY_MATCHES, truncated: false, isSearching: false });
  const sequence = useRef(0);

  useEffect(() => {
    const current = ++sequence.current;
    if (!query || !term.trim()) {
      setState({ matches: EMPTY_MATCHES, truncated: false, isSearching: false });
      return;
    }
    setState((previous) => ({ ...previous, isSearching: true }));
    const run = async () => {
      let next: TSearchState;
      try {
        const { matches, truncated } = await getSpreadsheetWorkerClient().request("search", { ...query, term });
        next = { matches, truncated, isSearching: false };
      } catch {
        next = { matches: EMPTY_MATCHES, truncated: false, isSearching: false };
      }
      if (current === sequence.current) setState(next);
    };
    const timer = setTimeout(() => void run(), SPREADSHEET_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, term]);

  return state;
};
