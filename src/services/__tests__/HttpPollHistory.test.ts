import { describe, expect, it, vi } from "vitest";
import { MAX_SEEN_ENTRIES, prepareHttpPollBatch } from "../HttpPollHistory";

vi.mock("electron-log/main", () => ({ default: { debug: vi.fn() } }));

const entry = (id: number) => ({
  timestamp: null,
  source: "test",
  message: String(id),
});

describe("HTTP poll deduplication", () => {
  it("stages only new keys without scanning the acknowledged history", () => {
    const known = entry(1);
    const other = entry(2);
    const seen = prepareHttpPollBatch([known], new Set()).commit();
    const iterate = vi.spyOn(seen, Symbol.iterator);
    expect(prepareHttpPollBatch([known, known], seen).fresh).toEqual([]);

    const mixed = [known, other, other, known];
    const batch = prepareHttpPollBatch(mixed, seen);
    expect(batch.fresh).toEqual([other]);
    expect(seen.size).toBe(1);
    // An unacknowledged batch must not suppress a subsequent delivery.
    expect(prepareHttpPollBatch(mixed, seen).fresh).toEqual([other]);
    expect(batch.commit()).toBe(seen);
    expect(seen.size).toBe(2);
    expect(prepareHttpPollBatch(mixed, seen).fresh).toEqual([]);
    expect(iterate).not.toHaveBeenCalled();
  });

  it("applies FIFO eviction within a batch but publishes it only on commit", () => {
    const limit = MAX_SEEN_ENTRIES;
    const seen = prepareHttpPollBatch(
      Array.from({ length: limit }, (_, id) => entry(id)),
      new Set(),
    ).commit();
    const oldest = entry(0);
    const newest = entry(limit);
    const lastEvicted = entry(limit / 2);
    const firstRetained = entry(limit / 2 + 1);
    const mixed = [oldest, newest, oldest, lastEvicted, firstRetained, newest];
    const batch = prepareHttpPollBatch(mixed, seen);
    expect(batch.fresh).toEqual([newest, oldest, lastEvicted]);
    expect(seen.size).toBe(limit);
    expect(prepareHttpPollBatch([lastEvicted, newest], seen).fresh).toEqual([
      newest,
    ]);
    const committed = batch.commit();
    expect(committed.size).toBe(limit / 2 + 2);
    expect(prepareHttpPollBatch([...mixed, entry(1)], committed).fresh).toEqual(
      [entry(1)],
    );
  });
});
