import { describe, expect, it, vi } from "vitest";
import { MetadataStore } from "../utils/metadataSnapshot";
import {
  anchoredScrollOffset,
  searchMatchPositions,
  shouldNavigateCommittedSearch,
} from "./progressiveSearch";

describe("progressive search navigation", () => {
  it("maps stable matches to the displayed, unfiltered snapshot", () => {
    const store = new MetadataStore();
    store.appendSorted(
      [40, 8, 22].map((_id, timestamp) => ({
        _id,
        timestamp,
        source: "test",
        signature: String(_id),
      })),
    );
    const ids = store.publish().ids;
    expect(searchMatchPositions([22, 40], (id) => ids.positionOf(id))).toEqual([
      0, 2,
    ]);
    expect(ids.slice()).toEqual([40, 8, 22]);
  });

  it("ignores matches absent from the current view and keeps navigation sorted", () => {
    expect(searchMatchPositions([9, 2, 7], (id) => [2, 9].indexOf(id))).toEqual(
      [0, 1],
    );
  });

  it("does not impose the former 50k match cap", () => {
    const ids = Array.from({ length: 50_001 }, (_, index) => index);
    expect(searchMatchPositions(ids, (id) => id)).toHaveLength(50_001);
  });

  it("never navigates old query results when Enter commits new text", () => {
    expect(shouldNavigateCommittedSearch("new", "old")).toBe(false);
    expect(shouldNavigateCommittedSearch("", "old")).toBe(false);
    expect(shouldNavigateCommittedSearch("   ", "   ")).toBe(false);
    expect(shouldNavigateCommittedSearch("same", "same")).toBe(true);
  });
});

describe("progressive viewport anchoring", () => {
  it("preserves the top stable ID and pixel offset when earlier rows arrive", () => {
    const previous = [20, 30, 40];
    const next = [1, 2, 20, 30, 40];
    expect(
      anchoredScrollOffset(previous, 43, (id) => next.indexOf(id), 36),
    ).toBe(115);
  });

  it("keeps an immutable snapshot valid after an append without copying it", () => {
    const store = new MetadataStore();
    const entry = (_id: number) => ({
      _id,
      timestamp: _id,
      source: "test",
      signature: String(_id),
    });
    store.appendSorted([entry(1), entry(2)]);
    const previous = store.publish().ids;
    store.appendSorted([entry(3)]);
    const next = store.publish().ids;
    const slice = vi.spyOn(previous, "slice");
    const iterator = vi.spyOn(previous, Symbol.iterator);
    expect(
      anchoredScrollOffset(previous, 41, (id) => next.positionOf(id), 36),
    ).toBe(41);
    expect(previous.length).toBe(2);
    expect(slice).not.toHaveBeenCalled();
    expect(iterator).not.toHaveBeenCalled();
  });

  it("does not invent an anchor for missing or empty results", () => {
    expect(anchoredScrollOffset([], 0, () => -1, 36)).toBeNull();
    expect(anchoredScrollOffset([5], 2, () => -1, 36)).toBeNull();
  });
});
