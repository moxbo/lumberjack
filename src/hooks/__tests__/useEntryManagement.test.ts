import { describe, expect, it } from "vitest";
import {
  mergeSortedMetadata,
  type PagedEntryMetadata,
} from "../useEntryManagement";

function entry(id: number, timestamp: string): PagedEntryMetadata {
  return {
    _id: id,
    timestamp,
    source: "test.log",
    signature: `entry-${id}`,
  };
}

describe("mergeSortedMetadata", () => {
  it("appends chronological batches without running a full merge", () => {
    const previous = [
      entry(1, "2026-01-01T00:00:00Z"),
      entry(2, "2026-01-01T00:00:01Z"),
    ];
    const incoming = [
      entry(3, "2026-01-01T00:00:02Z"),
      entry(4, "2026-01-01T00:00:03Z"),
    ];

    const merged = mergeSortedMetadata(previous, incoming);

    expect(merged).toBe(previous);
    expect(previous.map((item) => item._id)).toEqual([1, 2, 3, 4]);
    expect(merged.map((item) => item._id)).toEqual([1, 2, 3, 4]);
  });

  it("appends to a 400k chronological dataset without copying it", () => {
    const previous = Array.from({ length: 400_000 }, (_, index) =>
      entry(index + 1, String(index).padStart(12, "0")),
    );
    const incoming = Array.from({ length: 1_000 }, (_, index) =>
      entry(400_001 + index, String(400_000 + index).padStart(12, "0")),
    );

    const startedAt = performance.now();
    const merged = mergeSortedMetadata(previous, incoming);

    expect(merged).toBe(previous);
    expect(merged).toHaveLength(401_000);
    expect(performance.now() - startedAt).toBeLessThan(50);
  });

  it("retains timestamp ordering for out-of-order batches", () => {
    const previous = [
      entry(1, "2026-01-01T00:00:00Z"),
      entry(3, "2026-01-01T00:00:02Z"),
    ];
    const incoming = [entry(2, "2026-01-01T00:00:01Z")];

    const merged = mergeSortedMetadata(previous, incoming);

    expect(merged).not.toBe(previous);
    expect(merged.map((item) => item._id)).toEqual([1, 2, 3]);
  });
});
