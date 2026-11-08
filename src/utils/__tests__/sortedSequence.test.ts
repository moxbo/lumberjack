import { describe, expect, it } from "vitest";
import { SortedStore } from "../sortedSequence";
import { compareByTimestampId } from "../sort";

describe("SortedStore", () => {
  it("isolates speculative forks, including the ID lookup and immutable prefix snapshots", () => {
    const store = new SortedStore();
    store.appendSorted(
      Array.from({ length: 2050 }, (_, _id) => ({ _id, timestamp: _id })),
    );
    const previous = store.publish();
    const abandoned = store.fork();
    abandoned.appendSorted([{ _id: 2050, timestamp: 5.5 }]);
    expect(abandoned.publish().ids.positionOf(2050)).toBe(6);
    expect(previous.get(2050)).toBeUndefined();
    expect(store.publish()).toBe(previous);
    store.appendSorted([{ _id: 2050, timestamp: 3000 }]);
    expect(store.publish().ids.positionOf(2050)).toBe(2050);
    expect(abandoned.publish().ids.positionOf(2050)).toBe(6);
    expect(abandoned.publish().isAppendOf(previous)).toBe(false);
    expect(store.publish().isAppendOf(previous)).toBe(true);
  });

  it("preserves sub-millisecond ordering, missing timestamps, and sparse IDs", () => {
    const store = new SortedStore();
    const initial = [
      { _id: 30, timestamp: "2026-01-01T00:00:00.000200Z" },
      { _id: 9, timestamp: null },
    ];
    store.appendSorted(initial);
    const incoming = [
      { _id: 2_000_000, timestamp: "2026-01-01T00:00:00.000100Z" },
      { _id: 3, timestamp: "invalid" },
      { _id: 7 },
    ].sort(compareByTimestampId);
    store.appendSorted(incoming);
    const expected = [...initial, ...incoming].sort(compareByTimestampId);
    expect([...store.publish()]).toEqual(expected);
    expected.forEach((value, index) => {
      expect(store.publish().ids.positionOf(value._id)).toBe(index);
      expect(store.publish().get(value._id)).toBe(value);
    });
  });

  it("rejects invalid IDs without modifying an existing snapshot", () => {
    const store = new SortedStore();
    store.appendSorted([{ _id: 0 }]);
    const before = store.publish();
    for (const _id of [-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])
      expect(() => store.appendSorted([{ _id }])).toThrow(
        "Invalid metadata ID",
      );
    expect(store.publish()).toBe(before);
  });
});
