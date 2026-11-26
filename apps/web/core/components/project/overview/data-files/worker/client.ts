/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { SPREADSHEET_QUERY_TIMEOUT_MS } from "../helpers/constants";
import { SpreadsheetError } from "../helpers/errors";
import type { TWorkerRequestMap, TWorkerRequestType, TWorkerResponse } from "./protocol";

type TPending = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

type TWorkerFactory = () => Worker;

const defaultFactory: TWorkerFactory = () =>
  new Worker(new URL("./spreadsheet.worker.ts", import.meta.url), { type: "module", name: "plane-data-files" });

/**
 * Promise wrapper around the spreadsheet worker. A request that exceeds its
 * timeout terminates the worker (a stuck parse can't be interrupted any other
 * way); the next request transparently starts a fresh one.
 */
export class SpreadsheetWorkerClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, TPending>();

  constructor(private factory: TWorkerFactory = defaultFactory) {}

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = this.factory();
    worker.addEventListener("message", (event: MessageEvent<TWorkerResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(response.id);
      if (response.ok) pending.resolve(response.result);
      else pending.reject(new SpreadsheetError(response.error.code, response.error.params));
    });
    worker.addEventListener("error", (event) => {
      event.preventDefault();
      this.reset(new SpreadsheetError("unknown"));
    });
    this.worker = worker;
    return worker;
  }

  /** Terminates the worker and fails every in-flight request. */
  reset(error: unknown = new SpreadsheetError("unknown")) {
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  request<K extends TWorkerRequestType>(
    type: K,
    payload: TWorkerRequestMap[K]["input"],
    options: { transfer?: Transferable[]; timeoutMs?: number } = {}
  ): Promise<TWorkerRequestMap[K]["output"]> {
    let worker: Worker;
    try {
      worker = this.ensureWorker();
    } catch {
      return Promise.reject(new SpreadsheetError("unknown"));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new SpreadsheetError("timeout"));
        // whatever the worker is doing can't be cancelled; start over
        this.reset(new SpreadsheetError("timeout"));
      }, options.timeoutMs ?? SPREADSHEET_QUERY_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      worker.postMessage({ id, type, payload }, options.transfer ?? []);
    });
  }
}

let sharedClient: SpreadsheetWorkerClient | null = null;

/** One worker for the whole app, created on first use. */
export const getSpreadsheetWorkerClient = (): SpreadsheetWorkerClient => {
  if (!sharedClient) sharedClient = new SpreadsheetWorkerClient();
  return sharedClient;
};
