import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFilterWorker, type FilterOptions } from "../useFilterWorker";
import { MetadataStore } from "../../utils/metadataSnapshot";
import type { PagedEntryMetadata } from "../useEntryManagement";

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
      (value: T) => {
        hooks.states[index] = value;
      },
    ];
  },
  useEffect: (effect: () => unknown) => {
    hooks.effects.push(effect);
  },
}));
vi.mock("../../utils/typedApi", () => ({
  filterIsAvailable: vi.fn(async () => false),
  filterEntries: vi.fn(),
}));

const postMessage = vi.fn();
const options: FilterOptions = {
  stdFiltersEnabled: false,
  filter: { level: "", logger: "", thread: "", message: "" },
  onlyMarked: false,
  dcFilterEnabled: false,
  dcFilterEntries: [],
  timeFilterEnabled: false,
};
const entry = (id: number, timestamp = id): PagedEntryMetadata => ({
  _id: id,
  timestamp,
  source: "test.log",
  signature: `signature-${id}`,
  message: `message-${id}`,
});
function mount() {
  const hook = useFilterWorker();
  hooks.effects.splice(0).forEach((effect) => effect());
  return hook;
}
beforeEach(() => {
  hooks.states = [];
  hooks.effects = [];
  vi.clearAllMocks();
  vi.stubGlobal(
    "Worker",
    class {
      postMessage = postMessage;
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("filter worker snapshot integration", () => {
  it("transfers only appended metadata and resets for changed middle entries", () => {
    const hook = mount();
    const store = new MetadataStore();
    store.appendSorted(
      Array.from({ length: 5001 }, (_, index) => entry(index + 1)),
    );
    const first = store.publish();
    hook.filterEntries(first, options);
    expect(postMessage.mock.calls.map(([message]) => message.type)).toEqual([
      "setEntries",
      "filter",
    ]);
    expect(postMessage.mock.calls[0]?.[0].entries).toHaveLength(5001);

    postMessage.mockClear();
    store.appendSorted([entry(5002)]);
    hook.filterEntries(store.publish(), options);
    expect(postMessage.mock.calls.map(([message]) => message.type)).toEqual([
      "appendEntries",
      "filter",
    ]);
    expect(
      postMessage.mock.calls[0]?.[0].entries.map(
        (value: { _id: number }) => value._id,
      ),
    ).toEqual([5002]);

    postMessage.mockClear();
    const reordered = first.slice();
    reordered.splice(2500, 0, entry(6000, 2500.5));
    store.replace([...reordered, entry(5002)]);
    hook.filterEntries(store.publish(), options);
    expect(postMessage.mock.calls[0]?.[0].type).toBe("setEntries");
    expect(postMessage.mock.calls[0]?.[0].entries).toHaveLength(5003);
  });

  it("does not infer unchanged array prefixes from matching endpoints", () => {
    const hook = mount();
    const original = Array.from({ length: 5001 }, (_, index) =>
      entry(index + 1),
    );
    hook.filterEntries(original, options);
    postMessage.mockClear();
    const changed = original.slice();
    changed[2500] = entry(6000, 2501);
    hook.filterEntries(changed, options);
    expect(postMessage.mock.calls[0]?.[0].type).toBe("setEntries");
    expect(postMessage.mock.calls[0]?.[0].entries[2500]._id).toBe(6000);
  });

  it("filters small snapshots synchronously with stable IDs and search positions", () => {
    const hook = mount();
    const store = new MetadataStore();
    store.appendSorted([entry(9, 1), entry(2, 2)]);
    hook.filterEntries(store.publish(), {
      ...options,
      navigationSearch: "message-2",
    });
    expect(hooks.states[0]).toEqual([9, 2]);
    expect(hooks.states[1]).toEqual([1]);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("transfers complete resets in bounded pages", () => {
    const hook = mount();
    const store = new MetadataStore();
    store.appendSorted(
      Array.from({ length: 50002 }, (_, index) => entry(index + 1)),
    );
    hook.filterEntries(store.publish(), options);
    expect(postMessage.mock.calls.map(([message]) => message.type)).toEqual([
      "setEntries",
      "appendEntries",
      "filter",
    ]);
    expect(postMessage.mock.calls[0]?.[0].entries).toHaveLength(50000);
    expect(postMessage.mock.calls[1]?.[0].entries).toHaveLength(2);
  });
});
