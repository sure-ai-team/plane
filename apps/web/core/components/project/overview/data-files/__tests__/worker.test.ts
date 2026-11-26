/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { strToU8 } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TParsedWorkbook } from "@plane/types";
import { SPREADSHEET_PARSE_TIMEOUT_MS } from "../helpers/constants";
import { SpreadsheetError } from "../helpers/errors";
import type { TSpreadsheetPreview } from "../helpers/preview";
import { SpreadsheetWorkerClient } from "../worker/client";
import type { TWorkerLike } from "../worker/client";
import { createWorkerHandlers } from "../worker/handlers";
import type { TCacheAdapter, THandlerContext } from "../worker/handlers";
import type { TViewQuery, TWorkerResponse } from "../worker/protocol";

const SCOPE = "user-1";
const CSV = "City,Pop\nOslo,700\nParis,2100\nRome,2800\n";
const csvBuffer = (text = CSV) => strToU8(text).buffer as ArrayBuffer;

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const createCache = () => {
  const workbooks = new Map<string, TParsedWorkbook>();
  const previews: TSpreadsheetPreview[] = [];
  const calls: string[] = [];
  const adapter: TCacheAdapter = {
    getWorkbook: vi.fn(async (scope, key) => {
      calls.push(`get:${scope}:${key}`);
      return workbooks.get(`${scope}|${key}`) ?? null;
    }),
    putWorkbook: vi.fn(async (scope, key, workbook) => {
      calls.push(`put:${scope}:${key}`);
      workbooks.set(`${scope}|${key}`, workbook);
    }),
    putPreview: vi.fn(async (_scope, preview) => {
      previews.push(preview);
    }),
    rekeyWorkbook: vi.fn(async (scope, from, to) => {
      calls.push(`rekey:${scope}:${from}->${to}`);
      const found = workbooks.get(`${scope}|${from}`);
      if (found) {
        workbooks.delete(`${scope}|${from}`);
        workbooks.set(`${scope}|${to}`, found);
      }
    }),
  };
  return { workbooks, previews, calls, adapter };
};

const context = (): THandlerContext & { started: ReturnType<typeof vi.fn> } => {
  const started = vi.fn();
  return { onStart: started, started };
};

const parsePayload = (key: string, overrides: Partial<{ retain: boolean; buffer: ArrayBuffer }> = {}) => ({
  scope: SCOPE,
  key,
  assetId: key.split(":")[0],
  version: key.split(":")[1] ?? "",
  kind: "csv" as const,
  buffer: overrides.buffer ?? csvBuffer(),
  retain: overrides.retain ?? true,
});

const viewQuery = (key: string, overrides: Partial<TViewQuery> = {}): TViewQuery => ({
  key,
  sheet: 0,
  headerRow: true,
  filters: [],
  sort: null,
  ...overrides,
});

describe("worker handlers", () => {
  it("parses, caches per user, queries, searches, computes stats and exports", async () => {
    const cache = createCache();
    const handlers = createWorkerHandlers(cache.adapter);

    expect(
      (await handlers.open({ scope: SCOPE, key: "f:1", assetId: "f", version: "1" }, context())).result
    ).toBeNull();
    const parsed = await handlers.parse(parsePayload("f:1"), context());
    expect(parsed.result.workbook?.sheets[0].rows).toHaveLength(4);
    expect("columnTypes" in parsed.result && parsed.result.columnTypes).toEqual([["text", "number"]]);
    expect(cache.workbooks.has(`${SCOPE}|f:1`)).toBe(true);
    expect(cache.previews).toHaveLength(1);

    const query = viewQuery("f:1", {
      filters: [{ id: "1", column: 1, operator: "gt", value: "1000" }],
      sort: { column: 1, direction: "desc" },
    });
    const { result: queried, transfer } = await handlers.query(query, context());
    expect(Array.from(queried.view)).toEqual([3, 2]);
    expect(transfer).toHaveLength(1);
    expect(Array.from((await handlers.search({ ...query, term: "par" }, context())).result.matches)).toEqual([1, 0]);
    expect((await handlers["column-stats"]({ ...query, column: 1 }, context())).result.numeric?.sum).toBe(4900);
    expect((await handlers.export(query, context())).result.csv).toBe("﻿City,Pop\r\nRome,2800\r\nParis,2100\r\n");

    await handlers.release({ key: "f:1" }, context());
    await expect(handlers.query(query, context())).rejects.toBeInstanceOf(SpreadsheetError);
    // a different user doesn't see this user's cache
    expect(
      (await handlers.open({ scope: "user-2", key: "f:1", assetId: "f", version: "1" }, context())).result
    ).toBeNull();
    expect(
      (await handlers.open({ scope: SCOPE, key: "f:1", assetId: "f", version: "1" }, context())).result
    ).not.toBeNull();
  });

  it("does not keep a cache hit whose viewer closed while IndexedDB was answering", async () => {
    const cache = createCache();
    const handlers = createWorkerHandlers(cache.adapter);
    await handlers.parse(parsePayload("f:1", { retain: false }), context());
    const lookup = deferred<TParsedWorkbook | null>();
    vi.mocked(cache.adapter.getWorkbook).mockImplementationOnce(() => lookup.promise);

    const opening = handlers.open({ scope: SCOPE, key: "f:1", assetId: "f", version: "1" }, context());
    await handlers.release({ key: "f:1" }, context());
    lookup.resolve(cache.workbooks.get(`${SCOPE}|f:1`) ?? null);
    expect((await opening).result).toBeNull();
    // nothing was retained in memory
    await expect(handlers.query(viewQuery("f:1"), context())).rejects.toBeInstanceOf(SpreadsheetError);
  });

  it("does not retain a parse released while it ran", async () => {
    const handlers = createWorkerHandlers(createCache().adapter);
    const parsing = handlers.parse(parsePayload("f:1"), context());
    await handlers.release({ key: "f:1" }, context());
    expect((await parsing).result.workbook).toBeNull();
    await expect(handlers.query(viewQuery("f:1"), context())).rejects.toBeInstanceOf(SpreadsheetError);
  });

  it("shares one parse between concurrent requests for the same key", async () => {
    const cache = createCache();
    const handlers = createWorkerHandlers(cache.adapter);
    const [warm, open] = await Promise.all([
      handlers.parse(parsePayload("f:1", { retain: false }), context()),
      handlers.parse(parsePayload("f:1", { retain: true }), context()),
    ]);
    expect(cache.adapter.putWorkbook).toHaveBeenCalledTimes(1);
    expect(warm.result.workbook).toBeNull();
    expect(open.result.workbook?.sheets).toHaveLength(1);
    // a later parse of a retained key reuses the in-memory document
    await handlers.parse(parsePayload("f:1"), context());
    expect(cache.adapter.putWorkbook).toHaveBeenCalledTimes(1);
  });

  it("runs parses one at a time and signals start only when each begins", async () => {
    const cache = createCache();
    const handlers = createWorkerHandlers(cache.adapter);
    const firstStore = deferred<void>();
    vi.mocked(cache.adapter.putWorkbook).mockImplementationOnce(() => firstStore.promise);
    const first = context();
    const second = context();
    const a = handlers.parse(parsePayload("a:1"), first);
    const b = handlers.parse(parsePayload("b:1"), second);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(first.started).toHaveBeenCalledTimes(1);
    // still queued behind the first parse
    expect(second.started).not.toHaveBeenCalled();
    firstStore.resolve();
    await Promise.all([a, b]);
    expect(second.started).toHaveBeenCalledTimes(1);
  });

  it("keeps the queue going after a failed parse", async () => {
    const handlers = createWorkerHandlers(createCache().adapter);
    const bad = handlers.parse({ ...parsePayload("x:1"), kind: "xlsx", buffer: csvBuffer("not a zip") }, context());
    const good = handlers.parse(parsePayload("y:1"), context());
    await expect(bad).rejects.toMatchObject({ code: "corrupt" });
    expect((await good).result.workbook).not.toBeNull();
  });

  it("re-keys the document and cache after a rename", async () => {
    const cache = createCache();
    const handlers = createWorkerHandlers(cache.adapter);
    await handlers.parse(parsePayload("f:1"), context());
    await handlers.rekey({ scope: SCOPE, from: "f:1", to: "f:2" }, context());
    expect(cache.calls).toContain(`rekey:${SCOPE}:f:1->f:2`);
    // in memory under the new key, no re-parse needed
    expect(
      (await handlers.open({ scope: SCOPE, key: "f:2", assetId: "f", version: "2" }, context())).result
    ).not.toBeNull();
    expect(cache.adapter.getWorkbook).not.toHaveBeenCalledWith(SCOPE, "f:2");
    await expect(handlers.query(viewQuery("f:1"), context())).rejects.toBeInstanceOf(SpreadsheetError);
  });

  it("computes selection stats and text over the view in the worker", async () => {
    const handlers = createWorkerHandlers(createCache().adapter);
    await handlers.parse(parsePayload("f:1"), context());
    const query = viewQuery("f:1", { sort: { column: 1, direction: "desc" } });
    const bounds = { top: 0, bottom: 1, left: 0, right: 1 };
    expect((await handlers["selection-stats"]({ ...query, bounds }, context())).result).toEqual({
      count: 4,
      numericCount: 2,
      sum: 4900,
      avg: 2450,
    });
    expect((await handlers["selection-text"]({ ...query, bounds }, context())).result.text).toBe(
      "Rome\t2800\nParis\t2100"
    );
  });
});

/** A fake Worker that records messages and lets the test answer them. */
class FakeWorker implements TWorkerLike {
  messages: { id: number; type: string; payload: unknown }[] = [];
  terminated = false;
  private target = new EventTarget();

  postMessage = (message: unknown) => {
    this.messages.push(message as { id: number; type: string; payload: unknown });
  };
  terminate = () => {
    this.terminated = true;
  };
  addEventListener = ((type: string, listener: EventListener) =>
    this.target.addEventListener(type, listener)) as TWorkerLike["addEventListener"];

  respond(response: TWorkerResponse) {
    const event = new Event("message") as Event & { data: TWorkerResponse };
    Object.defineProperty(event, "data", { value: response });
    this.target.dispatchEvent(event);
  }
}

describe("worker client", () => {
  let workers: FakeWorker[];
  let client: SpreadsheetWorkerClient;

  beforeEach(() => {
    vi.useFakeTimers();
    workers = [];
    client = new SpreadsheetWorkerClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const parse = (key: string) =>
    client.request("parse", parsePayload(key), { timeoutMs: SPREADSHEET_PARSE_TIMEOUT_MS });

  it("starts the timeout when the worker starts the job, not when it is queued", async () => {
    const pending = parse("a:1");
    const id = workers[0].messages[0].id;
    // queued for longer than the timeout: still fine
    vi.advanceTimersByTime(SPREADSHEET_PARSE_TIMEOUT_MS * 2);
    workers[0].respond({ id, started: true });
    vi.advanceTimersByTime(SPREADSHEET_PARSE_TIMEOUT_MS - 1);
    workers[0].respond({ id, ok: true, result: "done" });
    await expect(pending).resolves.toBe("done");
    expect(workers).toHaveLength(1);
  });

  it("on timeout restarts the worker, re-sends queued requests and fails only running ones", async () => {
    const slow = parse("slow:1");
    const running = client.request("release", { key: "k" });
    const queued = parse("queued:1");
    const [slowMessage, runningMessage, queuedMessage] = workers[0].messages;
    workers[0].respond({ id: slowMessage.id, started: true });
    workers[0].respond({ id: runningMessage.id, started: true });

    vi.advanceTimersByTime(SPREADSHEET_PARSE_TIMEOUT_MS);
    await expect(slow).rejects.toMatchObject({ code: "timeout" });
    await expect(running).rejects.toMatchObject({ code: "unknown" });
    expect(workers[0].terminated).toBe(true);

    // the queued parse went to a fresh worker with the same id and payload
    expect(workers).toHaveLength(2);
    expect(workers[1].messages).toEqual([queuedMessage]);
    workers[1].respond({ id: queuedMessage.id, started: true });
    workers[1].respond({ id: queuedMessage.id, ok: true, result: "parsed" });
    await expect(queued).resolves.toBe("parsed");
  });

  it("fails queued requests whose buffers were transferred to the old worker", async () => {
    const slow = parse("slow:1");
    const buffer = new ArrayBuffer(8);
    const transferred = client.request("parse", parsePayload("t:1"), { transfer: [buffer] });
    workers[0].respond({ id: workers[0].messages[0].id, started: true });
    vi.advanceTimersByTime(SPREADSHEET_PARSE_TIMEOUT_MS);
    await expect(slow).rejects.toMatchObject({ code: "timeout" });
    await expect(transferred).rejects.toMatchObject({ code: "unknown" });
  });

  it("maps worker errors and ignores messages from a terminated worker", async () => {
    const failing = client.request("release", { key: "k" });
    workers[0].respond({ id: workers[0].messages[0].id, ok: false, error: { code: "corrupt" } });
    await expect(failing).rejects.toMatchObject({ code: "corrupt" });

    const pending = client.request("release", { key: "k" });
    const old = workers[0];
    client.reset();
    await expect(pending).rejects.toBeInstanceOf(SpreadsheetError);
    old.respond({ id: old.messages[1].id, ok: true, result: null });
  });
});
