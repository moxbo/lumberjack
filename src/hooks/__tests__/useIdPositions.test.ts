import { describe, expect, it, vi } from "vitest";
import { createIdPositions } from "../useIdPositions";
import { MetadataStore } from "../../utils/metadataSnapshot";
import { IdPositionVector } from "../../utils/idPositionVector";

describe("createIdPositions", () => {
  it("reuses the metadata reverse index without scanning IDs", () => {
    const store = new MetadataStore();
    store.appendSorted([
      { _id: 1, timestamp: 1, source: "", signature: "one" },
    ]);
    const previous = store.publish();
    const oldPositions = createIdPositions(previous.ids);
    store.appendSorted([
      { _id: 9000, timestamp: 2, source: "", signature: "two" },
    ]);
    const next = store.publish();
    const read = vi.spyOn(next.ids, "at");
    const scan = vi.spyOn(next.ids, "forEach");
    const positions = createIdPositions(next.ids);
    expect(positions.get(9000)).toBe(1);
    expect(oldPositions.get(9000)).toBe(-1);
    expect(positions.get(1)).toBe(0);
    expect(read).not.toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
  });

  it("rebuilds independent filter/search results even with equal endpoints and length", () => {
    const first = createIdPositions([1, 2, 3, 4]);
    const reordered = createIdPositions([1, 3, 2, 4]);
    const search = createIdPositions([3, 1]);
    const replaced = createIdPositions([1, 5, 6, 4]);
    expect(first.get(2)).toBe(1);
    expect(reordered.get(2)).toBe(2);
    expect(search.get(3)).toBe(0);
    expect(search.get(2)).toBe(-1);
    expect(replaced.get(2)).toBe(-1);
    expect(replaced.get(5)).toBe(1);
    expect(createIdPositions([]).get(1)).toBe(-1);
  });

  it("does not copy allocated position pages when IDs grow", () => {
    const positions = new IdPositionVector();
    positions.set(1, 0);
    const slice = vi.spyOn(Float64Array.prototype, "slice");
    const set = vi.spyOn(Float64Array.prototype, "set");
    positions.set(1_000_000, 1);
    expect(positions.get(1)).toBe(0);
    expect(positions.get(1_000_000)).toBe(1);
    expect(positions.get(-1)).toBe(-1);
    expect(positions.get(NaN)).toBe(-1);
    expect(positions.get(1.5)).toBe(-1);
    expect(slice).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    slice.mockRestore();
    set.mockRestore();
  });
});
