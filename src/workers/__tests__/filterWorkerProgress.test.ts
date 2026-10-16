import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectionRecord } from "../../store/paged";
import type {
  FilterErrorResponse,
  FilterOptions,
  FilterResponse,
  PagedFilterRequest,
  WorkerRequest,
} from "../filterWorker";

const { openDatabase } = vi.hoisted(() => ({ openDatabase: vi.fn() }));
vi.mock("../../store/paged", () => ({
  openPagedDatabase: openDatabase,
  PROJECTION_STORE_NAME: "projections",
}));

interface PageLoad {
  first: number;
  last: number;
  database: string;
  release(records: ProjectionRecord[]): void;
  fail(): void;
}

const options = (overrides: Partial<FilterOptions> = {}): FilterOptions => ({
  stdFiltersEnabled: true,
  filter: { level: "", logger: "", thread: "", message: "" },
  onlyMarked: false,
  dcFilterEnabled: false,
  dcFilterEntries: [],
  timeFilterEnabled: false,
  navigationSearch: "needle",
  ...overrides,
});

function projection(id: number, message = "needle"): ProjectionRecord {
  return {
    id,
    timestamp: "2026-01-01T00:00:00Z",
    message,
    level: "INFO",
    logger: "app",
    thread: "main",
    source: "file.log",
    mdc: null,
    service: null,
    traceId: null,
    signature: `sig-${id}`,
    _mark: null,
  };
}

const request = (
  overrides: Partial<PagedFilterRequest> = {},
): PagedFilterRequest => ({
  type: "filterPaged",
  options: options(),
  requestId: 1,
  generation: "query-1",
  dataGeneration: "data-1",
  databaseName: "logs",
  entryCount: 6,
  pageSize: 2,
  markedSignatures: [],
  ...overrides,
});

async function until(check: () => boolean): Promise<void> {
  for (let index = 0; index < 2_000; index++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Worker did not reach expected state");
}

describe("worker progressive message protocol", () => {
  let scope: {
    onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
    postMessage(message: FilterResponse | FilterErrorResponse): void;
  };
  let messages: Array<FilterResponse | FilterErrorResponse>;
  let loads: PageLoad[];
  let clock: number;
  let close: ReturnType<typeof vi.fn>;
  let autoPage: ((load: PageLoad) => ProjectionRecord[]) | undefined;
  let onResponse:
    ((message: FilterResponse | FilterErrorResponse) => void) | undefined;

  function send(data: WorkerRequest): void {
    scope.onmessage!({ data } as MessageEvent<WorkerRequest>);
  }
  function results(): FilterResponse[] {
    return messages.filter(
      (message): message is FilterResponse => message.type === "result",
    );
  }
  function final(id: number): FilterResponse | undefined {
    return results().find(
      (message) => message.requestId === id && !message.partial,
    );
  }

  beforeEach(async () => {
    vi.resetModules();
    messages = [];
    loads = [];
    clock = 0;
    autoPage = undefined;
    onResponse = undefined;
    close = vi.fn();
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    vi.stubGlobal("IDBKeyRange", {
      bound: (lower: number, upper: number) => ({ lower, upper }),
    });
    openDatabase.mockReset();
    openDatabase.mockImplementation(async (_version, database: string) => ({
      close,
      transaction: () => ({
        objectStore: () => ({
          getAll: (range: { lower: number; upper: number }) => {
            const cursorRequest = {
              result: null as unknown,
              error: new Error("page failed"),
              onsuccess: null as (() => void) | null,
              onerror: null as (() => void) | null,
            };
            const load: PageLoad = {
              first: range.lower,
              last: range.upper,
              database,
              release(records) {
                queueMicrotask(() => {
                  cursorRequest.result = records;
                  cursorRequest.onsuccess!();
                });
              },
              fail() {
                queueMicrotask(() => cursorRequest.onerror!());
              },
            };
            loads.push(load);
            if (autoPage) load.release(autoPage(load));
            return cursorRequest;
          },
        }),
      }),
    }));
    scope = {
      onmessage: null,
      postMessage(message) {
        messages.push(message);
        onResponse?.(message);
      },
    };
    vi.stubGlobal("self", scope);
    await import("../filterWorker");
  });

  afterEach(() => {
    send({ type: "cancel", requestId: Number.MAX_SAFE_INTEGER });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("publishes sorted immutable cumulative snapshots before loading later pages", async () => {
    send(request());
    await until(() => loads.length === 1);
    onResponse = (message) => {
      if (message.type === "result" && message.progress?.processed === 2) {
        expect(loads).toHaveLength(1);
      }
    };
    loads[0]!.release([
      { ...projection(1, "other"), timestamp: "2026-01-01T00:00:02Z" },
      projection(2),
    ]);
    await until(() => loads.length === 2);
    const first = results()[0]!;
    expect(first.filteredIndices).toEqual([2, 1]);
    expect(first.searchMatchIds).toEqual([2]);
    expect(first.progress).toEqual({ processed: 2, total: 6, matches: 1 });
    clock = 101;
    loads[1]!.release([projection(3), projection(4)]);
    await until(() => loads.length === 3);
    expect(results()).toHaveLength(2);
    expect(results()[1]!.filteredIndices).toEqual([2, 3, 4, 1]);
    clock = 202;
    loads[2]!.release([projection(5), projection(6)]);
    await until(() => !!final(1));
    expect(first.filteredIndices).toEqual([2, 1]);
    expect(first.stats.total).toBe(2);
    expect(final(1)).toMatchObject({
      filteredIndices: [2, 3, 4, 5, 6, 1],
      searchMatchIds: [2, 3, 4, 5, 6],
      searchMatchIndices: [0, 1, 2, 3, 4],
      progress: { processed: 6, total: 6, matches: 5 },
      generation: "query-1",
      dataGeneration: "data-1",
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("continues through empty/nonmatching pages with monotonic zero-match progress", async () => {
    send(
      request({
        options: options({
          filter: { level: "ERROR", logger: "", thread: "", message: "" },
        }),
      }),
    );
    for (let index = 0; index < 3; index++) {
      await until(() => loads.length > index);
      clock = index * 101;
      loads[index]!.release(
        index === 1
          ? []
          : [projection(index * 2 + 1), projection(index * 2 + 2)],
      );
    }
    await until(() => !!final(1));
    expect(results().map((message) => message.progress)).toEqual([
      { processed: 2, total: 6, matches: 0 },
      { processed: 4, total: 6, matches: 0 },
      { processed: 6, total: 6, matches: 0 },
      { processed: 6, total: 6, matches: 0 },
    ]);
    expect(final(1)!.filteredIndices).toEqual([]);
  });

  it("uses bounded ID ranges and never includes entries appended after the request", async () => {
    autoPage = ({ first, last }) =>
      Array.from({ length: last - first + 1 }, (_, index) =>
        projection(first + index),
      );
    send(request({ entryCount: 5 }));
    await until(() => !!final(1));
    expect(loads.map(({ first, last }) => [first, last])).toEqual([
      [1, 2],
      [3, 4],
      [5, 5],
    ]);
    expect(final(1)!.progress).toEqual({ processed: 5, total: 5, matches: 5 });
  });

  it("cancels active and queued jobs and suppresses stale errors", async () => {
    send(request());
    await until(() => loads.length === 1);
    send(request({ requestId: 2, entryCount: 8 }));
    send({ type: "cancel", requestId: 2 });
    loads[0]!.fail();
    await until(() => close.mock.calls.length === 1);
    autoPage = ({ first, last }) =>
      Array.from({ length: last - first + 1 }, (_, index) =>
        projection(first + index, "other"),
      );
    send(request({ requestId: 3, generation: "query-2", entryCount: 2 }));
    await until(() => !!final(3));
    expect(messages.every((message) => message.requestId === 3)).toBe(true);
    expect(loads).toHaveLength(2);
  });

  it("skips IndexedDB pages without candidates during navigation-only search", async () => {
    autoPage = ({ first, last }) =>
      Array.from({ length: last - first + 1 }, (_, index) => ({
        ...projection(first + index, "needle"),
        level: first + index === 5 ? "ERROR" : "INFO",
      }));
    const baseOptions = options({
      filter: { level: "ERROR", logger: "", thread: "", message: "" },
    });
    send(request({ baseGeneration: "base", options: baseOptions }));
    await until(() => !!final(1));
    expect(final(1)!.filteredIndices).toEqual([5]);
    const priorLoads = loads.length;
    send(
      request({
        requestId: 2,
        baseGeneration: "base",
        generation: "new-search",
        knownBaseCount: 6,
        options: { ...baseOptions, navigationSearch: "needle OR absent" },
      }),
    );
    await until(() => !!final(2));
    expect(loads.slice(priorLoads).map((page) => page.first)).toEqual([5]);
    expect(
      results()
        .filter((r) => r.requestId === 2)
        .flatMap((r) => r.searchMatchIds ?? []),
    ).toEqual([5]);
    expect(final(2)!.progress?.processed).toBe(6);
  });

  it.each([
    { generation: "query-2" },
    { dataGeneration: "data-2" },
    { databaseName: "other-db" },
  ])(
    "invalidates an in-flight page on identity change %j",
    async (identity) => {
      send(request());
      await until(() => loads.length === 1);
      send(request({ requestId: 2, ...identity, entryCount: 2 }));
      loads[0]!.release([projection(1), projection(2)]);
      await until(() => loads.length === 2);
      loads[1]!.release([projection(1, "other"), projection(2, "other")]);
      await until(() => !!final(2));
      expect(messages.every((message) => message.requestId === 2)).toBe(true);
      expect(final(2)!.searchMatchIds).toEqual([]);
    },
  );

  it("reset invalidates in-flight reads and compact/transferred caches", async () => {
    send(request());
    await until(() => loads.length === 1);
    loads[0]!.release([projection(1), projection(2)]);
    await until(() => loads.length === 2);
    send({ type: "resetProjections" });
    messages.length = 0;
    send(request({ requestId: 2, dataGeneration: "data-2", entryCount: 2 }));
    loads[1]!.release([projection(3), projection(4)]);
    await until(() => loads.length === 3);
    loads[2]!.release([projection(1, "other"), projection(2, "other")]);
    await until(() => !!final(2));
    expect(messages.every((message) => message.requestId === 2)).toBe(true);
    expect(final(2)!.searchMatchIds).toEqual([]);
    expect(loads[2]!.first).toBe(1);
  });

  it("finishes an active same-query append scan then runs only the latest queued prefix", async () => {
    send(request({ entryCount: 4 }));
    await until(() => loads.length === 1);
    send(request({ requestId: 2, entryCount: 6 }));
    loads[0]!.release([projection(1), projection(2)]);
    await until(() => loads.length === 2);
    send(request({ requestId: 3, entryCount: 8 }));
    loads[1]!.release([projection(3), projection(4)]);
    await until(() => loads.length === 3);
    expect(final(1)!.progress).toEqual({ processed: 4, total: 4, matches: 4 });
    expect(loads[2]!.first).toBe(5);
    loads[2]!.release([projection(5), projection(6)]);
    await until(() => loads.length === 4);
    loads[3]!.release([projection(7), projection(8)]);
    await until(() => !!final(3));
    expect(final(3)!.filteredIndices).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(results().some((message) => message.requestId === 2)).toBe(false);
  });

  it("uses transferred pages without IDB and rescans navigation on a new query", async () => {
    send({
      type: "transferProjections",
      records: [projection(1), projection(2, "other"), projection(3)],
      databaseName: "logs",
      dataGeneration: "data-1",
    });
    send(request({ entryCount: 2 }));
    await until(() => !!final(1));
    expect(openDatabase).not.toHaveBeenCalled();
    send(
      request({
        requestId: 2,
        generation: "query-2",
        entryCount: 3,
        options: options({ navigationSearch: "other" }),
      }),
    );
    await until(() => !!final(2));
    expect(final(2)!.searchMatchIds).toEqual([2]);
    expect(final(2)!.filteredIndices).toEqual([1, 2, 3]);
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it("reuses completed base predicates and sorting and sends only incremental navigation matches", async () => {
    const levelRead = vi.fn(() => "INFO");
    autoPage = ({ first, last }) => {
      clock += 101;
      return Array.from({ length: last - first + 1 }, (_, index) => ({
        ...projection(
          first + index,
          first + index === 3 ? "different" : "needle",
        ),
        get level() {
          return levelRead();
        },
        timestamp: 7 - first - index,
      }));
    };
    const baseOptions = options({
      filter: { level: "INFO", logger: "app", thread: "", message: "" },
    });
    send(request({ options: baseOptions, baseGeneration: "base" }));
    await until(() => !!final(1));
    expect(levelRead).toHaveBeenCalledTimes(6);
    expect(final(1)!.filteredIndices).toEqual([6, 5, 4, 3, 2, 1]);
    levelRead.mockClear();
    const sort = await import("../../utils/sort");
    const comparisons = vi.spyOn(sort, "compareByTimestampId");
    send(
      request({
        requestId: 2,
        generation: "search-2",
        baseGeneration: "base",
        knownBaseCount: 6,
        options: { ...baseOptions, navigationSearch: "different" },
      }),
    );
    await until(() => !!final(2));
    const updates = results().filter((result) => result.requestId === 2);
    expect(levelRead).not.toHaveBeenCalled();
    expect(comparisons).not.toHaveBeenCalled();
    expect(
      updates.every(
        (result) => result.reuseFilteredIndices && result.searchMatchesDelta,
      ),
    ).toBe(true);
    expect(updates.every((result) => result.filteredIndices.length === 0)).toBe(
      true,
    );
    expect(updates.flatMap((result) => result.searchMatchIds ?? [])).toEqual([
      3,
    ]);
    expect(updates.flatMap((result) => result.searchMatchIndices)).toEqual([3]);
    expect(updates.map((result) => result.progress?.processed)).toEqual([
      2, 4, 6, 6,
    ]);
    expect(final(2)!.progress?.matches).toBe(1);
    const reads = loads.length;
    send(
      request({
        requestId: 3,
        generation: "search-3",
        baseGeneration: "base",
        knownBaseCount: 6,
        options: { ...baseOptions, navigationSearch: "" },
      }),
    );
    await until(() => !!final(3));
    expect(loads).toHaveLength(reads);
    expect(final(3)!.filteredIndices).toEqual([]);
    expect(final(3)!.searchMatchIds).toEqual([]);
    expect(final(3)!.progress).toEqual({ processed: 6, total: 6, matches: 6 });
  });

  it.each([
    {
      options: options({
        filter: { level: "ERROR", logger: "", thread: "", message: "" },
      }),
    },
    {
      options: options({
        timeFilterEnabled: true,
        timeFilterFrom: "2027-01-01",
      }),
    },
    {
      options: options({
        dcFilterEnabled: true,
        dcFilterEntries: [{ key: "a", value: "b", active: true }],
      }),
    },
    { markedSignatures: ["sig-2"] },
    { baseGeneration: "new-base" },
    { dataGeneration: "new-data" },
    { databaseName: "new-db" },
    { entryCount: 2 },
  ])("invalidates completed base reuse on %j", async (change) => {
    autoPage = ({ first, last }) =>
      Array.from({ length: last - first + 1 }, (_, index) =>
        projection(first + index),
      );
    const initial = request({
      baseGeneration: "base",
      options: options({ onlyMarked: true }),
      markedSignatures: ["sig-1"],
    });
    send(initial);
    await until(() => !!final(1));
    send({ ...initial, requestId: 2, knownBaseCount: 6, ...change });
    await until(() => !!final(2));
    expect(final(2)!.reuseFilteredIndices).not.toBe(true);
    expect(loads[3]!.first).toBe(1);
  });

  it("search changes across an append filter only the tail and rescan old search matches", async () => {
    const levelRead = vi.fn(() => "INFO");
    autoPage = ({ first, last }) =>
      Array.from({ length: last - first + 1 }, (_, index) => ({
        ...projection(first + index, (first + index) % 2 === 1 ? "old" : "new"),
        get level() {
          return levelRead();
        },
      }));
    const baseOptions = options({
      navigationSearch: "old",
      filter: { level: "INFO", logger: "", thread: "", message: "" },
    });
    send(
      request({ entryCount: 2, baseGeneration: "base", options: baseOptions }),
    );
    await until(() => !!final(1));
    levelRead.mockClear();
    send(
      request({
        requestId: 2,
        entryCount: 4,
        generation: "search-2",
        baseGeneration: "base",
        knownBaseCount: 2,
        options: { ...baseOptions, navigationSearch: "new" },
      }),
    );
    await until(() => !!final(2));
    expect(levelRead).toHaveBeenCalledTimes(2);
    const updates = results().filter((result) => result.requestId === 2);
    expect(
      updates.filter((result) => !result.reuseFilteredIndices).at(-1)
        ?.filteredIndices,
    ).toEqual([1, 2, 3, 4]);
    expect(updates.flatMap((result) => result.searchMatchIds ?? [])).toEqual([
      2, 4,
    ]);
  });

  it("rehydrates the base once after renderer cancellation and rejects cancelled navigation deltas", async () => {
    autoPage = ({ first, last }) =>
      Array.from({ length: last - first + 1 }, (_, index) =>
        projection(first + index),
      );
    send(request({ baseGeneration: "base" }));
    await until(() => !!final(1));
    send({ type: "cancel", requestId: 2 });
    autoPage = undefined;
    send(
      request({
        requestId: 3,
        baseGeneration: "base",
        generation: "new",
        options: options({ navigationSearch: "other" }),
      }),
    );
    await until(() => loads.length === 4);
    expect(
      results().filter((result) => result.requestId === 3)[0]!.filteredIndices,
    ).toHaveLength(6);
    send({ type: "cancel", requestId: 3 });
    loads[3]!.release([projection(1), projection(2)]);
    await until(() => close.mock.calls.length === 2);
    expect(results().filter((result) => result.requestId === 3)).toHaveLength(
      1,
    );
  });

  it("reports errors with both identities", async () => {
    send(request());
    await until(() => loads.length === 1);
    loads[0]!.fail();
    await until(() => messages.length === 1);
    expect(messages[0]).toMatchObject({
      type: "error",
      generation: "query-1",
      dataGeneration: "data-1",
      requestId: 1,
    });
  });

  it("falls back per incomplete transferred page and does not build a cold text cache", async () => {
    send({
      type: "transferProjections",
      records: [projection(1)],
      databaseName: "logs",
      dataGeneration: "data-1",
    });
    autoPage = ({ first, last }) =>
      Array.from({ length: last - first + 1 }, (_, index) =>
        projection(first + index, first + index === 2 ? "other" : "needle"),
      );
    send(request({ entryCount: 4 }));
    await until(() => !!final(1));
    expect(loads.map(({ first, last }) => [first, last])).toEqual([
      [1, 2],
      [3, 4],
    ]);
    send(
      request({
        requestId: 2,
        generation: "query-2",
        entryCount: 4,
        options: options({ navigationSearch: "other" }),
      }),
    );
    await until(() => !!final(2));
    expect(loads).toHaveLength(4);
    expect(final(2)!.searchMatchIds).toEqual([2]);
    const worker = await import("../filterWorker");
    expect(worker._getTransferredProjectionCache()!.count).toBe(1);
  });

  it("bounds transferred text retention and recovers oversized records through IDB", async () => {
    // One shared string exercises the byte budget without allocating a GB.
    const message = "x".repeat(2 * 1024 * 1024);
    send({
      type: "transferProjections",
      records: Array.from({ length: 30 }, (_, index) =>
        projection(index + 1, message),
      ),
      databaseName: "logs",
      dataGeneration: "data-1",
    });
    const worker = await import("../filterWorker");
    expect(worker._getTransferredProjectionCache()!.count).toBeLessThan(30);
    autoPage = ({ first, last }) =>
      Array.from({ length: last - first + 1 }, (_, index) =>
        projection(first + index, message),
      );
    send(
      request({
        entryCount: 30,
        options: options({ navigationSearch: "", stdFiltersEnabled: false }),
      }),
    );
    await until(() => !!final(1));
    expect(loads.length).toBeGreaterThan(0);
    expect(final(1)!.progress).toEqual({
      processed: 30,
      total: 30,
      matches: 30,
    });
  });

  it("scans one million synthetic records without retaining a full message cache", async () => {
    autoPage = ({ first, last }) => {
      clock += 0.5;
      return Array.from({ length: last - first + 1 }, (_, index) => {
        const id = first + index;
        return projection(id, id === 900_001 ? "needle" : "other");
      });
    };
    const baselineStart = Date.now();
    send(request({ entryCount: 1_000_000, pageSize: 2_000 }));
    await until(() => !!final(1));
    const baselineMs = Date.now() - baselineStart;
    expect(loads).toHaveLength(500);
    expect(final(1)!.searchMatchIds).toEqual([900_001]);
    expect(final(1)!.searchMatchIndices).toEqual([900_000]);
    expect(final(1)!.filteredIndices).toHaveLength(1_000_000);
    expect(final(1)!.progress).toEqual({
      processed: 1_000_000,
      total: 1_000_000,
      matches: 1,
    });
    expect(results().length).toBeGreaterThan(2);
    expect(results().length).toBeLessThan(10);
    const worker = await import("../filterWorker");
    expect(worker._getTransferredProjectionCache()).toBeNull();
    const fullPayloadIds = results().reduce(
      (sum, result) => sum + result.filteredIndices.length,
      0,
    );
    const searchStart = Date.now();
    send(
      request({
        requestId: 2,
        generation: "search-only",
        baseGeneration: "query-1",
        knownBaseCount: 1_000_000,
        entryCount: 1_000_000,
        pageSize: 2_000,
        options: options({ navigationSearch: "needle OR absent" }),
      }),
    );
    await until(() => !!final(2));
    const searchMs = Date.now() - searchStart;
    const updates = results().filter((result) => result.requestId === 2);
    expect(updates.flatMap((result) => result.searchMatchIds ?? [])).toEqual([
      900_001,
    ]);
    expect(
      updates.reduce((sum, result) => sum + result.filteredIndices.length, 0),
    ).toBe(0);
    expect(final(2)!.progress?.processed).toBe(1_000_000);
    expect(worker._getTransferredProjectionCache()).toBeNull();
    console.warn(
      `[perf] 1m synthetic paged: full=${baselineMs}ms navigation=${searchMs}ms; base IDs sent=${fullPayloadIds}->0`,
    );
  }, 20_000);

  it("legacy set/append scans are progressive, scoped and do not starve", async () => {
    const entries = Array.from({ length: 4_001 }, (_, index) => ({
      ...projection(index + 1),
      _id: index + 1,
    }));
    send({ type: "setEntries", entries, dataGeneration: 1 });
    onResponse = (message) => {
      if (
        message.type === "result" &&
        message.requestId === 1 &&
        message.partial &&
        message.progress?.processed === 2_000
      ) {
        send({
          type: "appendEntries",
          entries: [{ ...projection(4_002), _id: 4_002 }],
          dataGeneration: 1,
        });
        send({
          type: "filter",
          options: options(),
          generation: "q",
          dataGeneration: 1,
          requestId: 2,
        });
      }
    };
    send({
      type: "filter",
      options: options(),
      generation: "q",
      dataGeneration: 1,
      requestId: 1,
    });
    await until(() => !!final(2));
    expect(final(1)!.progress?.total).toBe(4_001);
    expect(final(2)!.progress).toEqual({
      processed: 4_002,
      total: 4_002,
      matches: 4_002,
    });
    expect(results()[0]!.filteredIndices).toHaveLength(2_000);
  });

  it("legacy setEntries and new query cancel old scans between pages", async () => {
    let switched = false;
    onResponse = (message) => {
      if (!switched && message.type === "result" && message.partial) {
        switched = true;
        send({
          type: "setEntries",
          entries: [{ ...projection(99, "replacement"), _id: 99 }],
          dataGeneration: 2,
        });
        send({
          type: "filter",
          options: options({ navigationSearch: "replacement" }),
          generation: "new",
          dataGeneration: 2,
          requestId: 2,
        });
      }
    };
    send({
      type: "filter",
      entries: Array.from({ length: 10_000 }, (_, index) =>
        projection(index + 1),
      ),
      options: options(),
      requestId: 1,
      generation: "old",
      dataGeneration: 1,
    });
    await until(() => !!final(2));
    expect(final(1)).toBeUndefined();
    expect(final(2)).toMatchObject({
      filteredIndices: [99],
      searchMatchIds: [99],
      generation: "new",
      dataGeneration: 2,
    });
  });
});
