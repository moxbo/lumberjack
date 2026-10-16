import { describe, expect, it, vi } from "vitest";
import { MetadataStore } from "../metadataSnapshot";
import type { PagedEntryMetadata } from "../../hooks/useEntryManagement";

function entry(id: number, timestamp = id): PagedEntryMetadata {
  return { _id: id, timestamp, source: "test.log", signature: `entry-${id}` };
}

describe("MetadataStore", () => {
  it("publishes bounded persistent views across monotonic appends and segment boundaries", () => {
    const store = new MetadataStore();
    const empty = store.publish();
    const snapshots = [];
    for (let batch = 0; batch < 5; batch++) {
      store.appendSorted(
        Array.from({ length: 2000 }, (_, index) =>
          entry(batch * 2000 + index + 1),
        ),
      );
      snapshots.push(store.publish());
    }
    expect(empty.length).toBe(0);
    expect(empty.at(0)).toBeUndefined();
    expect(empty.ids.positionOf(1)).toBe(-1);
    for (let index = 0; index < snapshots.length; index++) {
      const snapshot = snapshots[index]!;
      const length = (index + 1) * 2000;
      expect(snapshot.length).toBe(length);
      expect(snapshot.at(-1)?._id).toBe(length);
      expect(snapshot.at(length)).toBeUndefined();
      expect(snapshot.ids.at(length)).toBeUndefined();
      expect(snapshot.ids.positionOf(length + 1)).toBe(-1);
      expect([...snapshot].length).toBe(length);
      expect(snapshot.ids.slice(-2)).toEqual([length - 1, length]);
      expect(snapshot.isAppendOf(empty)).toBe(true);
    }
    expect(store.publish()).toBe(snapshots.at(-1));
  });

  it("does not scan or copy historical metadata or IDs on a 400k append/publication", () => {
    const store = new MetadataStore();
    let historicalReads = 0;
    store.appendSorted(
      Array.from({ length: 400_000 }, (_, index) => ({
        get _id() {
          historicalReads++;
          return index + 1;
        },
        get timestamp() {
          historicalReads++;
          return index;
        },
        source: "test.log",
        signature: `entry-${index}`,
      })),
    );
    const previous = store.publish();
    const incoming = Array.from({ length: 1000 }, (_, index) =>
      entry(400_001 + index),
    );
    historicalReads = 0;
    const slice = vi.spyOn(Array.prototype, "slice");
    const map = vi.spyOn(Array.prototype, "map");
    store.appendSorted(incoming);
    const next = store.publish();
    const sliceCalls = slice.mock.calls.length;
    const mapCalls = map.mock.calls.length;
    slice.mockRestore();
    map.mockRestore();
    expect(sliceCalls).toBe(0);
    expect(mapCalls).toBe(0);
    expect(historicalReads).toBeLessThanOrEqual(4);
    expect(next.isAppendOf(previous)).toBe(true);
    expect(next.ids.isAppendOf(previous.ids)).toBe(true);
    expect(next.length).toBe(401_000);
    expect(previous.length).toBe(400_000);
  });

  it("rebuilds for late timestamps without changing any old view or position", () => {
    const store = new MetadataStore();
    store.appendSorted([entry(1, 10), entry(2, 30)]);
    const previous = store.publish();
    store.appendSorted([entry(3, 20)]);
    const next = store.publish();
    expect([...previous.ids]).toEqual([1, 2]);
    expect([...next.ids]).toEqual([1, 3, 2]);
    expect(previous.ids.positionOf(2)).toBe(1);
    expect(next.ids.positionOf(2)).toBe(2);
    expect(previous.ids.positionOf(3)).toBe(-1);
    expect(next.isAppendOf(previous)).toBe(false);
    store.appendSorted([entry(4, 40)]);
    expect(store.publish().isAppendOf(next)).toBe(true);
    expect([...next.ids]).toEqual([1, 3, 2]);
  });

  it("uses ID tie-breaking for equal timestamps", () => {
    const store = new MetadataStore();
    store.appendSorted([entry(2, 10)]);
    const previous = store.publish();
    store.appendSorted([entry(1, 10)]);
    expect([...store.publish().ids]).toEqual([1, 2]);
    expect([...previous.ids]).toEqual([2]);
  });

  it("starts a new identity on clear even if IDs are reused", () => {
    const store = new MetadataStore();
    store.appendSorted([entry(1), entry(2)]);
    const previous = store.publish();
    store.clear();
    const empty = store.publish();
    store.appendSorted([entry(2, 0), entry(1, 1)]);
    const reused = store.publish();
    expect(empty.length).toBe(0);
    expect([...previous.ids]).toEqual([1, 2]);
    expect([...reused.ids]).toEqual([2, 1]);
    expect(reused.ids.positionOf(1)).toBe(1);
    expect(previous.ids.positionOf(1)).toBe(0);
    expect(reused.isAppendOf(previous)).toBe(false);
    expect(reused.isAppendOf(empty)).toBe(true);
  });

  it("replaces enriched fallback metadata without mutating published payloads", () => {
    const store = new MetadataStore();
    store.appendSorted([entry(1)]);
    const paged = store.publish();
    store.replace(
      paged.map((value) => ({
        ...value,
        message: "recovered",
        mdc: { request: 1 },
      })),
    );
    const fallback = store.publish();
    store.appendSorted([{ ...entry(2), message: "new" }]);
    expect(paged.at(0)?.message).toBeUndefined();
    expect(paged.length).toBe(1);
    expect(fallback.at(0)?.message).toBe("recovered");
    expect(fallback.length).toBe(1);
    expect(store.publish().at(1)?.message).toBe("new");
    expect(fallback.isAppendOf(paged)).toBe(false);
  });

  it("keeps elastic counts bounded and supports array consumer operations", () => {
    const store = new MetadataStore();
    store.appendSorted([{ ...entry(1), source: "elastic://one" }, entry(2)]);
    const previous = store.publish();
    store.appendSorted([{ ...entry(3), source: "elastic://two" }]);
    const next = store.publish();
    expect(previous.elasticCount).toBe(1);
    expect(next.elasticCount).toBe(2);
    expect(next.find((value) => value._id === 2)?._id).toBe(2);
    expect(
      next.filter((value) => value._id > 1).map((value) => value._id),
    ).toEqual([2, 3]);
    expect(
      next.flatMap((value) => (value._id === 2 ? [] : [value._id])),
    ).toEqual([1, 3]);
    expect(next.toArray()).toEqual(
      [entry(1), entry(2), entry(3)].map((value) => ({
        ...value,
        source:
          value._id === 2
            ? "test.log"
            : `elastic://${value._id === 1 ? "one" : "two"}`,
      })),
    );
  });

  it("rejects duplicate IDs without corrupting the old backing", () => {
    const store = new MetadataStore();
    store.appendSorted([entry(1)]);
    const previous = store.publish();
    expect(() => store.appendSorted([entry(2), entry(2)])).toThrow(
      "Duplicate metadata ID",
    );
    expect(() => store.appendSorted([entry(1)])).toThrow(
      "Duplicate metadata ID",
    );
    expect(store.publish()).toBe(previous);
    expect([...previous.ids]).toEqual([1]);
  });
});
