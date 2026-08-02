import { describe, expect, it, vi } from "vitest";
import { PageLruCache } from "../cache";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("PageLruCache", () => {
  it("coalesces concurrent reads for the same page", async () => {
    const page = deferred<ReadonlyMap<number, string>>();
    const loader = vi.fn(() => page.promise);
    const cache = new PageLruCache(loader, { pageSize: 4, maxPages: 2 });

    const first = cache.get(1);
    const second = cache.get(3);
    page.resolve(
      new Map([
        [1, "one"],
        [3, "three"],
      ]),
    );

    await expect(first).resolves.toBe("one");
    await expect(second).resolves.toBe("three");
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cache.getStats()).toMatchObject({
      loads: 1,
      coalescedLoads: 1,
      residentPages: 1,
      residentPayloads: 2,
      maxResidentPayloads: 8,
    });
  });

  it("evicts least recently used pages within the configured bound", async () => {
    const cache = new PageLruCache(
      async (first, last) =>
        new Map(
          Array.from(
            { length: last - first + 1 },
            (_, index) => [first + index, String(first + index)] as const,
          ),
        ),
      { pageSize: 2, maxPages: 2 },
    );

    await cache.get(1);
    await cache.get(3);
    await cache.get(1);
    await cache.get(5);

    expect(cache.getStats()).toMatchObject({
      hits: 1,
      evictions: 1,
      residentPages: 2,
      residentPayloads: 4,
    });
  });

  it("does not let a load started before invalidation repopulate the cache", async () => {
    const oldPage = deferred<ReadonlyMap<number, string>>();
    let call = 0;
    const cache = new PageLruCache(
      () => {
        call++;
        return call === 1
          ? oldPage.promise
          : Promise.resolve(new Map([[1, "new"]]));
      },
      { pageSize: 2, maxPages: 1 },
    );

    const staleRead = cache.get(1);
    cache.invalidate();
    oldPage.resolve(new Map([[1, "old"]]));

    await expect(staleRead).resolves.toBe("old");
    expect(cache.getStats().residentPayloads).toBe(0);
    await expect(cache.get(1)).resolves.toBe("new");
    expect(call).toBe(2);
  });

  it("invalidates only pages containing appended IDs", async () => {
    const loader = vi.fn(
      async (first: number, last: number) =>
        new Map(
          Array.from(
            { length: last - first + 1 },
            (_, index) => [first + index, String(first + index)] as const,
          ),
        ),
    );
    const cache = new PageLruCache(loader, { pageSize: 2, maxPages: 3 });

    await cache.get(1);
    await cache.get(3);
    cache.invalidateIds([4]);
    await cache.get(1);
    await cache.get(3);

    expect(loader).toHaveBeenCalledTimes(3);
    expect(cache.getStats().residentPages).toBe(2);
  });

  it("returns all requested values even when one read exceeds the page bound", async () => {
    const cache = new PageLruCache(async (first) => new Map([[first, first]]), {
      pageSize: 1,
      maxPages: 2,
    });

    await expect(cache.getMany([1, 2, 3])).resolves.toEqual(
      new Map([
        [1, 1],
        [2, 2],
        [3, 3],
      ]),
    );
    expect(cache.getStats().residentPages).toBe(2);
  });
});
