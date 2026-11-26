/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { SPREADSHEET_QUERY_TIMEOUT_MS } from "../helpers/constants";
import { SpreadsheetError } from "../helpers/errors";
import type { TWorkerRequestMap, TWorkerRequestType, TWorkerResponse } from "./protocol";

type TPending = {
  type: TWorkerRequestType;
  payload: unknown;
  transfer: Transferable[];
  timeoutMs: number;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  /** set once the worker has started the job */
  timer: ReturnType<typeof setTimeout> | null;
};

/** The subset of `Worker` the client uses (so tests can pass a fake). */
export type TWorkerLike = Pick<Worker, "postMessage" | "terminate" | "addEventListener">;

type TWorkerFactory = () => TWorkerLike;

const defaultFactory: TWorkerFactory = () =>
  new Worker(new URL("./spreadsheet.worker.ts", import.meta.url), { type: "module", name: "plane-data-files" });

/**
 * Promise wrapper around the spreadsheet worker.
 *
 * Timeouts count from the moment the worker *starts* a job (it acknowledges
 * with `{ started: true }`), so time spent queued behind another parse doesn't
 * count. A job that overruns can only be stopped by terminating the worker;
 * requests that were merely queued are then re-sent to a fresh worker, and
 * only the ones already running in the old worker fail.
 *
 * Payloads are cloned rather than transferred by default so a queued request
 * can be re-sent.
 */
export class SpreadsheetWorkerClient {
  private worker: TWorkerLike | null = null;
  private nextId = 1;
  private pending = new Map<number, TPending>();

  constructor(private factory: TWorkerFactory = defaultFactory) {}

  private ensureWorker(): TWorkerLike {
    if (this.worker) return this.worker;
    const worker = this.factory();
    worker.addEventListener("message", (event: Event) => {
      if (this.worker !== worker) return;
      this.handleResponse((event as MessageEvent<TWorkerResponse>).data);
    });
    worker.addEventListener("error", (event: Event) => {
      if (this.worker !== worker) return;
      event.preventDefault();
      this.reset(new SpreadsheetError("unknown"));
    });
    this.worker = worker;
    return worker;
  }

  private handleResponse(response: TWorkerResponse) {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    if ("started" in response) {
      if (!pending.timer) pending.timer = setTimeout(() => this.handleTimeout(response.id), pending.timeoutMs);
      return;
    }
    if (pending.timer) clearTimeout(pending.timer);
    this.pending.delete(response.id);
    if (response.ok) pending.resolve(response.result);
    else pending.reject(new SpreadsheetError(response.error.code, response.error.params));
  }

  private handleTimeout(id: number) {
    const timedOut = this.pending.get(id);
    if (!timedOut) return;
    this.pending.delete(id);
    timedOut.reject(new SpreadsheetError("timeout"));
    // whatever the worker is running can't be cancelled; start a fresh one
    this.worker?.terminate();
    this.worker = null;
    const survivors = [...this.pending.entries()];
    this.pending.clear();
    for (const [pendingId, pending] of survivors) {
      if (pending.timer) {
        // it was running in the terminated worker
        clearTimeout(pending.timer);
        pending.reject(new SpreadsheetError("unknown"));
      } else if (pending.transfer.length > 0) {
        // its transferred buffers are gone with the old worker
        pending.reject(new SpreadsheetError("unknown"));
      } else {
        this.send(pendingId, pending);
      }
    }
  }

  private send(id: number, pending: TPending) {
    let worker: TWorkerLike;
    try {
      worker = this.ensureWorker();
    } catch {
      pending.reject(new SpreadsheetError("unknown"));
      return;
    }
    this.pending.set(id, pending);
    worker.postMessage({ id, type: pending.type, payload: pending.payload }, pending.transfer);
  }

  /** Terminates the worker and fails every in-flight request (e.g. on sign-out). */
  reset(error: unknown = new SpreadsheetError("unknown")) {
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  request<K extends TWorkerRequestType>(
    type: K,
    payload: TWorkerRequestMap[K]["input"],
    options: { transfer?: Transferable[]; timeoutMs?: number } = {}
  ): Promise<TWorkerRequestMap[K]["output"]> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.send(id, {
        type,
        payload,
        transfer: options.transfer ?? [],
        timeoutMs: options.timeoutMs ?? SPREADSHEET_QUERY_TIMEOUT_MS,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer: null,
      });
    });
  }
}

let sharedClient: SpreadsheetWorkerClient | null = null;

/** One worker for the whole app, created on first use. */
export const getSpreadsheetWorkerClient = (): SpreadsheetWorkerClient => {
  if (!sharedClient) sharedClient = new SpreadsheetWorkerClient();
  return sharedClient;
};

/** Drops the shared worker and everything it holds in memory (sign-out). */
export const resetSpreadsheetWorkerClient = () => {
  sharedClient?.reset();
  sharedClient = null;
};
