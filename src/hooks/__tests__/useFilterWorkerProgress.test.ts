import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useFilterWorker,
  type FilterOptions,
  type PagedFilterConfig,
} from "../useFilterWorker";
import { MetadataStore } from "../../utils/metadataSnapshot";
import type { FilterStats } from "../../workers/filterWorker";
import {
  filterEntries as utilityFilter,
  filterIsAvailable,
} from "../../utils/typedApi";

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  effects: [] as (() => unknown)[],
}));
vi.mock("preact/hooks", () => ({
  useRef: <T>(value: T) => ({ current: value }),
  useCallback: <T>(callback: T) => callback,
  useState: <T>(initial: T) => {
    const index = hooks.states.length;
    hooks.states.push(initial);
    return [
      initial,
      (value: T | ((previous: T) => T)) => {
        hooks.states[index] =
          typeof value === "function"
            ? (value as (previous: T) => T)(hooks.states[index] as T)
            : value;
      },
    ];
  },
  useEffect: (effect: () => unknown) => hooks.effects.push(effect),
}));
vi.mock("../../utils/typedApi", () => ({
  filterIsAvailable: vi.fn(async () => false),
  filterEntries: vi.fn(),
}));

class TestWorker {
  static instance: TestWorker;
  onmessage?: (event: { data: unknown }) => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    TestWorker.instance = this;
  }
}

const options: FilterOptions = {
  stdFiltersEnabled: false,
  filter: { level: "", logger: "", thread: "", message: "" },
  onlyMarked: false,
  dcFilterEnabled: false,
  dcFilterEntries: [],
  timeFilterEnabled: false,
  navigationSearch: "needle",
};
const entries = [{ _id: 12 }, { _id: 8 }, { _id: 99 }];
const config: PagedFilterConfig = {
  paged: true,
  generation: "filter",
  dataGeneration: 1,
  entryCount: 3,
};
const stats = (total: number, passed = total): FilterStats => ({
  total,
  passed,
  rejectedByOnlyMarked: 0,
  rejectedByLevel: 0,
  rejectedByLogger: 0,
  rejectedByThread: 0,
  rejectedByMessage: total - passed,
  rejectedByTime: 0,
  rejectedByDC: 0,
});
function mount() {
  const hook = useFilterWorker();
  hooks.effects.splice(0).forEach((effect) => effect());
  return hook;
}
function request() {
  return TestWorker.instance.postMessage.mock.lastCall![0];
}
function reply(
  job: ReturnType<typeof request>,
  ids: number[],
  partial = false,
) {
  TestWorker.instance.onmessage?.({
    data: {
      type: "result",
      paged: job.type === "filterPaged",
      requestId: job.requestId,
      generation: job.generation,
      dataGeneration: job.dataGeneration,
      filteredIndices: ids,
      searchMatchIndices: ids.map((_, index) => index),
      searchMatchIds: ids,
      stats: stats(ids.length),
      progress: {
        processed: ids.length,
        total: job.entryCount ?? 5001,
        matches: ids.length,
      },
      partial,
    },
  });
}
const state = () => ({
  ids: hooks.states[0],
  isFiltering: hooks.states[2],
  error: hooks.states[4],
  matches: hooks.states[6],
  progress: hooks.states[7],
});

beforeEach(() => {
  hooks.states = [];
  hooks.effects = [];
  vi.clearAllMocks();
  vi.mocked(filterIsAvailable).mockResolvedValue(false);
  vi.stubGlobal("Worker", TestWorker);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("progressive filter coordination", () => {
  it("preserves the base array across search changes and merges sorted match-only deltas", () => {
    const hook = mount();
    const baseConfig = { ...config, baseGeneration: "base" };
    hook.filterEntries(entries, options, undefined, baseConfig);
    const first = request();
    const baseIds = [99, 12, 8];
    reply(first, baseIds);
    hook.cancelFiltering(true);
    expect(state().ids).toBe(baseIds);
    hook.filterEntries(
      entries,
      { ...options, navigationSearch: "new" },
      undefined,
      { ...baseConfig, generation: "next-search" },
    );
    const second = request();
    expect(second.baseGeneration).toBe(first.baseGeneration);
    expect(second.generation).not.toBe(first.generation);
    expect(second.knownBaseCount).toBe(3);
    expect(state().ids).toBe(baseIds);
    const delta = (indices: number[], partial: boolean) =>
      TestWorker.instance.onmessage?.({
        data: {
          ...second,
          type: "result",
          filteredIndices: [],
          reuseFilteredIndices: true,
          searchMatchesDelta: true,
          searchMatchIndices: indices,
          searchMatchIds: indices.map((index) => baseIds[index]),
          stats: stats(3),
          partial,
          progress: {
            processed: partial ? 2 : 3,
            total: 3,
            matches: partial ? 1 : 2,
          },
        },
      });
    delta([2], true);
    expect(state().ids).toBe(baseIds);
    expect(state().matches).toEqual([8]);
    delta([0], false);
    expect(state().ids).toBe(baseIds);
    expect(state().matches).toEqual([99, 8]);
    expect(hooks.states[1]).toEqual([0, 2]);
    expect(state().isFiltering).toBe(false);
    hook.cancelFiltering();
    hook.filterEntries(
      entries,
      { ...options, navigationSearch: "new" },
      undefined,
      baseConfig,
    );
    expect(request().knownBaseCount).toBeUndefined();
  });

  it.each([
    { databaseName: "rotated-db" },
    { dataGeneration: 2 },
    { baseGeneration: "new-base" },
  ])("clears the base view and rejects stale results on %j", (change) => {
    const hook = mount();
    hook.filterEntries(entries, options, undefined, {
      ...config,
      baseGeneration: "base",
    });
    const old = request();
    reply(old, [12, 8, 99]);
    hook.filterEntries(entries, options, undefined, {
      ...config,
      baseGeneration: "base",
      ...change,
    });
    expect(state().ids).toEqual([]);
    expect(request().knownBaseCount).toBeUndefined();
    reply(old, [99]);
    expect(state().ids).toEqual([]);
  });

  it("applies repeated partial snapshots of one request before its final result", () => {
    const hook = mount();
    hook.filterEntries(entries, options, undefined, config);
    const job = request();
    expect(state().progress).toEqual({ processed: 0, total: 3, matches: 0 });
    reply(job, [12], true);
    expect(state()).toMatchObject({
      ids: [12],
      matches: [12],
      isFiltering: true,
    });
    reply(job, [12, 8], true);
    expect(state().progress).toEqual({ processed: 2, total: 3, matches: 2 });
    reply(job, [12, 8, 99]);
    expect(state()).toMatchObject({ ids: [12, 8, 99], isFiltering: false });
  });

  it("invalidates partials, final results and errors on a new navigation query", () => {
    const hook = mount();
    hook.filterEntries(entries, options, undefined, config);
    const old = request();
    reply(old, [12], true);
    hook.filterEntries(
      entries,
      { ...options, navigationSearch: "different" },
      undefined,
      config,
    );
    const current = request();
    expect(current.generation).not.toBe(old.generation);
    expect(state()).toMatchObject({
      ids: [12],
      matches: [],
      isFiltering: true,
    });
    reply(old, [12, 8], true);
    reply(old, [12, 8, 99]);
    TestWorker.instance.onmessage?.({
      data: { ...old, type: "error", paged: true, message: "obsolete" },
    });
    expect(state()).toMatchObject({
      ids: [12],
      error: null,
      isFiltering: true,
    });
    reply(current, [99]);
    expect(state()).toMatchObject({ ids: [99], isFiltering: false });
  });

  it("continues publishing same-query appends without prematurely completing", () => {
    const hook = mount();
    hook.filterEntries(entries, options, undefined, config);
    const first = request();
    hook.filterEntries([...entries, { _id: 101 }], options, undefined, {
      ...config,
      entryCount: 4,
    });
    const appended = request();
    expect(appended.generation).toBe(first.generation);
    reply(first, [12, 8, 99]);
    expect(state()).toMatchObject({
      ids: [12, 8, 99],
      isFiltering: true,
      progress: { processed: 3, total: 4, matches: 3 },
    });
    reply(appended, [12, 8, 99, 101]);
    expect(state().isFiltering).toBe(false);
    reply(first, [12], true);
    expect(state().ids).toEqual([12, 8, 99, 101]);
  });

  it("cancels explicitly and ignores reused IDs after clearing the dataset", () => {
    const hook = mount();
    hook.filterEntries(entries, options, undefined, config);
    const old = request();
    hook.cancelFiltering();
    expect(request()).toMatchObject({ type: "cancel" });
    reply(old, [12]);
    expect(state()).toMatchObject({
      ids: [],
      matches: [],
      progress: null,
      isFiltering: false,
    });
    hook.filterEntries(entries, options, undefined, {
      ...config,
      dataGeneration: 2,
    });
    const current = request();
    reply(old, [12, 8, 99]);
    expect(state().ids).toEqual([]);
    reply(current, [8]);
    expect(state().matches).toEqual([8]);
  });

  it("invalidates the running scan even when the replacement dataset is empty", () => {
    const hook = mount();
    hook.filterEntries(entries, options, undefined, config);
    const old = request();
    hook.filterEntries([], options, undefined, { ...config, entryCount: 0 });
    expect(request().type).toBe("cancel");
    reply(old, [12]);
    expect(state()).toMatchObject({
      ids: [],
      isFiltering: false,
      progress: { processed: 0, total: 0, matches: 0 },
    });
  });

  it("also rejects obsolete legacy worker results and preserves snapshot appends", () => {
    const store = new MetadataStore();
    store.appendSorted(
      Array.from({ length: 5001 }, (_, i) => ({
        _id: i + 1,
        timestamp: i,
        source: "test",
        signature: `s${i}`,
      })),
    );
    const hook = mount();
    hook.filterEntries(store.publish(), options);
    const old = request();
    hook.filterEntries(store.publish(), {
      ...options,
      navigationSearchMode: "regex",
    });
    const current = request();
    reply(old, [1], true);
    expect(state().ids).toEqual([]);
    store.appendSorted([
      { _id: 5002, timestamp: 6000, source: "test", signature: "last" },
    ]);
    hook.filterEntries(store.publish(), {
      ...options,
      navigationSearchMode: "regex",
    });
    expect(request().generation).toBe(current.generation);
    reply(current, [5001], true);
    expect(state()).toMatchObject({ ids: [5001], isFiltering: true });
  });

  it("keeps local fallback pages cancellable and uses absolute IDs beyond the first page", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("unavailable");
        }
      },
    );
    const hook = mount();
    const rows = Array.from({ length: 6001 }, (_, i) => ({
      message: i === 6000 ? "needle" : "other",
    }));
    hook.filterEntries(rows, options);
    expect(state()).toMatchObject({
      isFiltering: true,
      matches: [],
      progress: { processed: 2000, total: 6001, matches: 0 },
    });
    await vi.runAllTimersAsync();
    expect(state()).toMatchObject({ matches: [6000], isFiltering: false });
    hook.filterEntries(rows, options);
    hook.cancelFiltering();
    await vi.runAllTimersAsync();
    expect(state()).toMatchObject({
      matches: [],
      progress: null,
      isFiltering: false,
    });
  });

  it("does not publish a late utility-process page after cancellation", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("unavailable");
        }
      },
    );
    vi.mocked(filterIsAvailable).mockResolvedValue(true);
    let resolvePage!: (
      value: Awaited<ReturnType<typeof utilityFilter>>,
    ) => void;
    vi.mocked(utilityFilter).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePage = resolve;
        }),
    );
    const hook = mount();
    await Promise.resolve();
    hook.filterEntries(
      Array.from({ length: 6000 }, () => ({ message: "needle" })),
      options,
    );
    expect(utilityFilter).toHaveBeenCalledTimes(1);
    hook.cancelFiltering();
    resolvePage({ ok: true, filteredIndices: [0], stats: stats(2000, 1) });
    await Promise.resolve();
    await Promise.resolve();
    expect(state()).toMatchObject({
      ids: [],
      matches: [],
      progress: null,
      isFiltering: false,
    });
    expect(utilityFilter).toHaveBeenCalledTimes(1);
  });
});
