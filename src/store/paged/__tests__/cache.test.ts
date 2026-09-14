import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MAX_CACHED_BYTES, PageLruCache } from "../cache";
import { estimatePayloadBytes } from "../../../utils/estimatePayloadBytes";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
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

  it("preserves page defaults and adds a conservative byte default", () => {
    const cache = new PageLruCache(async () => new Map());
    expect(cache.getStats()).toMatchObject({
      pageSize: 256,
      maxPages: 32,
      maxResidentPayloads: 8192,
      maxBytes: 64 * 1024 * 1024,
      residentBytes: 0,
      bytesEstimated: true,
      evictedBytes: 0,
      oversizedPages: 0,
    });
    expect(cache.maxBytes).toBe(DEFAULT_MAX_CACHED_BYTES);
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid byte budget %s",
    (maxBytes) => {
      expect(
        () => new PageLruCache(async () => new Map(), { maxBytes }),
      ).toThrow(RangeError);
    },
  );

  it("evicts by payload weight before the page limit and accounts bytes", async () => {
    const values = ["a", "b", "x".repeat(100)];
    const page = (id: number) => new Map([[id, values[id - 1]!]]);
    const smallBytes = estimatePayloadBytes(page(1));
    const largeBytes = estimatePayloadBytes(page(3));
    const cache = new PageLruCache(async (id) => page(id), {
      pageSize: 1,
      maxPages: 10,
      maxBytes: smallBytes + largeBytes,
    });
    await cache.get(1);
    await cache.get(2);
    await cache.get(1);
    await cache.get(3);
    expect(cache.getStats()).toMatchObject({
      residentPages: 2,
      residentBytes: smallBytes + largeBytes,
      evictions: 1,
      evictedBytes: smallBytes,
    });
    const loads = cache.getStats().loads;
    await cache.get(1);
    expect(cache.getStats().loads).toBe(loads);
    await cache.get(2);
    expect(cache.getStats().loads).toBe(loads + 1);
  });

  it("admits an exact budget match but not a page one byte larger", async () => {
    const page = new Map([[1, "exact"]]);
    const bytes = estimatePayloadBytes(page);
    const exact = new PageLruCache(async () => page, { maxBytes: bytes });
    const under = new PageLruCache(async () => page, { maxBytes: bytes - 1 });
    await expect(exact.get(1)).resolves.toBe("exact");
    await expect(under.get(1)).resolves.toBe("exact");
    expect(exact.getStats().residentBytes).toBe(bytes);
    expect(under.getStats()).toMatchObject({
      residentBytes: 0,
      residentPages: 0,
      oversizedPages: 1,
      evictions: 0,
    });
  });

  it("delivers giant pages without evicting useful pages or losing getMany results", async () => {
    const giant = "x".repeat(1024 * 1024);
    const loader = vi.fn(
      async (id: number) => new Map([[id, id === 2 ? giant : "small"]]),
    );
    const cache = new PageLruCache(loader, {
      pageSize: 1,
      maxBytes: 512,
    });
    await expect(cache.getMany([1, 2, 3])).resolves.toEqual(
      new Map([
        [1, "small"],
        [2, giant],
        [3, "small"],
      ]),
    );
    const bytes = cache.getStats().residentBytes;
    await cache.get(1);
    await expect(cache.get(2)).resolves.toBe(giant);
    expect(loader).toHaveBeenCalledTimes(4);
    expect(cache.getStats()).toMatchObject({
      residentBytes: bytes,
      residentPages: 2,
      evictions: 0,
      oversizedPages: 2,
    });
  });

  it("supports disabling retention with a zero byte budget", async () => {
    const cache = new PageLruCache(async () => new Map([[1, "one"]]), {
      maxBytes: 0,
    });
    await expect(cache.get(1)).resolves.toBe("one");
    await expect(cache.get(1)).resolves.toBe("one");
    expect(cache.getStats()).toMatchObject({
      loads: 2,
      residentBytes: 0,
      residentPages: 0,
    });
  });

  it("updates bytes on repeated ID invalidation and full invalidation", async () => {
    const page = new Map([[1, "one"]]);
    const bytes = estimatePayloadBytes(page);
    const cache = new PageLruCache(async (id) => new Map([[id, "one"]]), {
      pageSize: 1,
      maxBytes: bytes * 2,
    });
    await cache.getMany([1, 2]);
    expect(cache.getStats().residentBytes).toBe(bytes * 2);
    cache.invalidateIds([1, 1]);
    expect(cache.getStats().residentBytes).toBe(bytes);
    cache.invalidate();
    expect(cache.getStats()).toMatchObject({
      residentBytes: 0,
      residentPages: 0,
      evictions: 0,
      evictedBytes: 0,
    });
  });

  it("admits only one of 32 concurrent page loads and coalesces queued reads", async () => {
    const pages = Array.from({ length: 32 }, () =>
      deferred<ReadonlyMap<number, string>>(),
    );
    const loader = vi.fn((id: number) => pages[id - 1]!.promise);
    const cache = new PageLruCache(loader, { pageSize: 1, maxBytes: 256 });
    const reads = pages.map((_, index) => cache.get(index + 1));
    const duplicate = cache.get(32);
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);
    for (let index = 0; index < pages.length; index++) {
      expect(loader).toHaveBeenCalledTimes(index + 1);
      pages[index]!.resolve(new Map([[index + 1, "x".repeat(1000)]]));
      await reads[index];
      expect(cache.getStats().residentBytes).toBeLessThanOrEqual(256);
    }
    await Promise.all(reads);
    await expect(duplicate).resolves.toBe("x".repeat(1000));
    expect(cache.getStats()).toMatchObject({
      loads: 32,
      coalescedLoads: 1,
      oversizedPages: 32,
      residentPages: 0,
    });
  });

  it.each(["all", "ids"])(
    "keeps admission and byte accounting correct across %s invalidation in flight",
    async (mode) => {
      const old = deferred<ReadonlyMap<number, string>>();
      const fresh = deferred<ReadonlyMap<number, string>>();
      const loader = vi
        .fn()
        .mockImplementationOnce(() => old.promise)
        .mockImplementationOnce(() => fresh.promise);
      const cache = new PageLruCache<string>(loader, { maxBytes: 256 });
      const staleRead = cache.get(1);
      await Promise.resolve();
      if (mode === "all") cache.invalidate();
      else cache.invalidateIds([1]);
      const newRead = cache.get(1);
      const coalesced = cache.get(1);
      await Promise.resolve();
      expect(loader).toHaveBeenCalledTimes(1);
      old.resolve(new Map([[1, "old"]]));
      await expect(staleRead).resolves.toBe("old");
      expect(cache.getStats().residentBytes).toBe(0);
      fresh.resolve(new Map([[1, "new"]]));
      await expect(newRead).resolves.toBe("new");
      await expect(coalesced).resolves.toBe("new");
      expect(cache.getStats().residentBytes).toBe(
        estimatePayloadBytes(new Map([[1, "new"]])),
      );
      expect(loader).toHaveBeenCalledTimes(2);
    },
  );

  it("releases failed admission, rejects coalesced callers and permits retry", async () => {
    const failed = deferred<ReadonlyMap<number, string>>();
    const loader = vi
      .fn()
      .mockImplementationOnce(() => failed.promise)
      .mockImplementation(async (id: number) => new Map([[id, "ok"]]));
    const cache = new PageLruCache<string>(loader, {
      pageSize: 1,
      maxBytes: 256,
    });
    const first = cache.get(1);
    const same = cache.get(1);
    const queued = cache.get(2);
    const rejected = Promise.allSettled([first, same]);
    failed.reject(new Error("decode failed"));
    expect(await rejected).toMatchObject([
      { status: "rejected", reason: new Error("decode failed") },
      { status: "rejected", reason: new Error("decode failed") },
    ]);
    await expect(queued).resolves.toBe("ok");
    await expect(cache.get(1)).resolves.toBe("ok");
    expect(cache.getStats()).toMatchObject({ loads: 3, coalescedLoads: 1 });
    expect(cache.getStats().residentBytes).toBeLessThanOrEqual(256);
  });

  it("recovers from a synchronous loader exception", async () => {
    const loader = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("sync");
      })
      .mockResolvedValue(new Map([[1, "ok"]]));
    const cache = new PageLruCache<string>(loader);
    await expect(cache.get(1)).rejects.toThrow("sync");
    await expect(cache.get(1)).resolves.toBe("ok");
  });
});

describe("estimatePayloadBytes", () => {
  it("includes string and container overhead without stringifying", () => {
    expect(estimatePayloadBytes(new Map([[1, "abc"]]))).toBe(
      64 + 32 + 8 + 24 + 6,
    );
    const stringify = vi.spyOn(JSON, "stringify");
    const value = {
      message: "x".repeat(100000),
      mdc: { detail: "y".repeat(50000) },
    };
    expect(estimatePayloadBytes(value)).toBeGreaterThan(300000);
    expect(stringify).not.toHaveBeenCalled();
    stringify.mockRestore();
  });

  it("counts shared object identities once, including cycles", () => {
    const shared: Record<string, unknown> = { detail: "x".repeat(1000) };
    shared.self = shared;
    const sharedPage = new Map([
      [1, shared],
      [2, shared],
    ]);
    const singleBytes = estimatePayloadBytes(new Map([[1, shared]]));
    expect(estimatePayloadBytes(sharedPage)).toBe(singleBytes + 32 + 8);
    expect(
      estimatePayloadBytes(
        new Map([
          [1, { ...shared }],
          [2, { ...shared }],
        ]),
      ),
    ).toBeGreaterThan(estimatePayloadBytes(sharedPage));
    expect(estimatePayloadBytes(sharedPage, singleBytes)).toBe(Infinity);
  });

  it("counts backing buffers once across typed array views", () => {
    const buffer = new ArrayBuffer(4096);
    const values = new Map([
      [1, new Uint8Array(buffer)],
      [2, new Uint8Array(buffer)],
    ]);
    expect(estimatePayloadBytes(values)).toBe(
      64 + 2 * (32 + 8 + 64) + 64 + 4096,
    );
  });

  it("traverses deeply nested payloads iteratively with bounded early exit", () => {
    let value: unknown = "deep";
    for (let index = 0; index < 20000; index++) value = { child: value };
    expect(estimatePayloadBytes(value)).toBeGreaterThan(1000000);
    expect(estimatePayloadBytes(value, 1024)).toBe(Infinity);
  });

  it("fails closed on accessors and unsupported objects without calling them", () => {
    const getter = vi.fn(() => "secret");
    const object = Object.defineProperty({}, "detail", {
      enumerable: true,
      get: getter,
    });
    expect(estimatePayloadBytes(object)).toBe(Infinity);
    expect(getter).not.toHaveBeenCalled();
    expect(estimatePayloadBytes(new WeakMap())).toBe(Infinity);
    expect(estimatePayloadBytes(1n)).toBe(Infinity);
  });
});
