/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/// <reference lib="webworker" />

import { toSpreadsheetErrorShape } from "../helpers/errors";
import { createWorkerHandlers } from "./handlers";
import type { THandlerContext } from "./handlers";
import type { TWorkerRequest, TWorkerResponse } from "./protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const handlers = createWorkerHandlers();

const post = (response: TWorkerResponse, transfer: Transferable[] = []) =>
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker's postMessage takes no targetOrigin
  scope.postMessage(response, transfer);

scope.addEventListener("message", async (event: MessageEvent<TWorkerRequest>) => {
  const request = event.data;
  let started = false;
  const context: THandlerContext = {
    onStart: () => {
      if (started) return;
      started = true;
      post({ id: request.id, started: true });
    },
  };
  try {
    const handler = handlers[request.type] as (
      payload: unknown,
      handlerContext: THandlerContext
    ) => Promise<{ result: unknown; transfer?: Transferable[] }>;
    const { result, transfer } = await handler(request.payload, context);
    post({ id: request.id, ok: true, result }, transfer ?? []);
  } catch (error) {
    post({ id: request.id, ok: false, error: toSpreadsheetErrorShape(error) });
  }
});
