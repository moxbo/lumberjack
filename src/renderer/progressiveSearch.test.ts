import { describe, expect, it, vi } from "vitest";
import { MetadataStore } from "../utils/metadataSnapshot";
import { BoundedSequence, MappedSequence } from "../utils/readonlySequence";
import {
  anchoredScrollOffset,
  adjacentSearchMatch,
  searchMatchIndex,
  searchMatchPositions,
  shouldNavigateCommittedSearch,
} from "./progressiveSearch";

describe("progressive search navigation", () => {
  it("projects 1.5 million ordered matches lazily and navigates with logarithmic position lookups", () => {
    class Matches extends BoundedSequence<number> {
      readonly length = 1_500_000;
      at(index: number) {
        return index >= 0 && index < this.length ? index : undefined;
      }
    }
    const positionOf = vi.fn((id: number) => id * 2);
    const positions = new MappedSequence(new Matches(), positionOf);
    expect(positionOf).not.toHaveBeenCalled();
    expect(searchMatchIndex(positions, 2_999_996)).toBe(1_499_998);
    expect(adjacentSearchMatch(positions, 2_999_996, 1)).toBe(2_999_998);
    expect(positionOf.mock.calls.length).toBeLessThan(50);
  });

  it("keeps navigation boundaries and finds adjacent matches from nonmatching rows", () => {
    const matches = [2, 6, 10];
    expect(adjacentSearchMatch(matches, -1, 1)).toBe(2);
    expect(adjacentSearchMatch(matches, -1, -1)).toBe(10);
    expect(adjacentSearchMatch(matches, 6, 1)).toBe(10);
    expect(adjacentSearchMatch(matches, 6, -1)).toBe(2);
    expect(adjacentSearchMatch(matches, 7, 1)).toBe(10);
    expect(adjacentSearchMatch(matches, 7, -1)).toBe(6);
    expect(adjacentSearchMatch(matches, 10, 1)).toBe(10);
    expect(adjacentSearchMatch(matches, 2, -1)).toBe(2);
    expect(adjacentSearchMatch([], 0, 1)).toBeUndefined();
    expect(searchMatchIndex(matches, 6)).toBe(1);
    expect(searchMatchIndex(matches, 7)).toBe(-1);
    expect(searchMatchIndex([], 0)).toBe(-1);
  });

  it("locates the counter and adjacent results among a million matches with logarithmic reads", () => {
    let reads = 0;
    const matches = new Proxy<number[]>([], {
      get(target, key, receiver) {
        if (key === "length") return 1_000_000;
        if (typeof key === "string" && /^\d+$/.test(key)) {
          reads++;
          return Number(key) * 2;
        }
        return Reflect.get(target, key, receiver);
      },
    });
    expect(searchMatchIndex(matches, 1_999_996)).toBe(999_998);
    expect(adjacentSearchMatch(matches, 1_999_996, 1)).toBe(1_999_998);
    expect(adjacentSearchMatch(matches, 1_999_996, -1)).toBe(1_999_994);
    expect(reads).toBeLessThan(70);
  });

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
    const store = new MetadataStore();
    store.appendSorted(
      [9, 2, 7].map((_id, timestamp) => ({
        _id,
        timestamp,
        source: "",
        signature: String(_id),
      })),
    );
    expect(
      searchMatchPositions(store.publish().ids, (id) => [2, 9].indexOf(id)),
    ).toEqual([0, 1]);
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
