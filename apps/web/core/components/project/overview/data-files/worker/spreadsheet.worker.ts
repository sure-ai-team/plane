/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/// <reference lib="webworker" />

import { toSpreadsheetErrorShape } from "../helpers/errors";
import { createWorkerHandlers } from "./handlers";
import type { TWorkerRequest, TWorkerResponse } from "./protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const handlers = createWorkerHandlers();

scope.addEventListener("message", async (event: MessageEvent<TWorkerRequest>) => {
  const request = event.data;
  try {
    const handler = handlers[request.type] as (
      payload: unknown
    ) => Promise<{ result: unknown; transfer?: Transferable[] }>;
    const { result, transfer } = await handler(request.payload);
    const response: TWorkerResponse = { id: request.id, ok: true, result };
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker's postMessage takes no targetOrigin
    scope.postMessage(response, transfer ?? []);
  } catch (error) {
    const response: TWorkerResponse = { id: request.id, ok: false, error: toSpreadsheetErrorShape(error) };
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker's postMessage takes no targetOrigin
    scope.postMessage(response);
  }
});
