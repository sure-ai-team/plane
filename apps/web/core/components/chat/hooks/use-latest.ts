/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Returns a stable function that always calls the latest `fn`.
 *
 * The editor binds its Enter shortcut once, when the editor is created, so a plain
 * inline handler keeps the state from that render (e.g. an old draft) forever.
 */
export const useLatestCallback = <A extends unknown[], R>(fn: (...args: A) => R) => {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
};
