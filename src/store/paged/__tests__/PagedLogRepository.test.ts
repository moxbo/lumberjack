/* eslint-disable @typescript-eslint/unbound-method -- Mock methods are inspected, never called unbound. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAX_CACHED_BYTES, estimatePayloadBytes } from "../cache";
import { PAYLOAD_STORE_NAME, PROJECTION_STORE_NAME } from "../indexedDb";
import * as indexedDb from "../indexedDb";
import {
  PagedLogRepository,
  type PagedLogRepositoryOptions,
} from "../PagedLogRepository";
import * as compression from "../payloadCompression";
import {
  hydratePagedRecord,
  preparePagedRecord,
  type PreparedPagedRecord,
} from "../types";

// Exercise the real page read/hydration and cache wiring without a browser IDB.
function fixture(
  records: PreparedPagedRecord[],
  options: PagedLogRepositoryOptions,
) {
  const stores = new Map<string, Map<number, { id: number }>>([
    [
      PAYLOAD_STORE_NAME,
      new Map(records.map((item) => [item.payload.id, item.payload])),
    ],
    [
      PROJECTION_STORE_NAME,
      new Map(records.map((item) => [item.projection.id, item.projection])),
    ],
  ]);
  const makeTransaction = (stores: Map<string, Map<number, { id: number }>>) =>
    vi.fn(() => {
      let pending = 0;
      const tx = {
        oncomplete: null as (() => void) | null,
        objectStore(name: string) {
          const store = stores.get(name)!;
          const finish = () => {
            if (--pending === 0) tx.oncomplete?.();
          };
          const write = (operation: () => void) => {
            pending++;
            queueMicrotask(() => {
              operation();
              finish();
            });
            return {};
          };
          return {
            put: (record: { id: number }) =>
              write(() => store.set(record.id, record)),
            clear: () => write(() => store.clear()),
            openCursor: (range: { lower: number; upper: number }) => {
              pending++;
              const entries = [...store.values()].filter(
                (record) =>
                  record.id >= range.lower && record.id <= range.upper,
              );
              let index = 0;
              const request = {
                result: null as {
                  value: { id: number };
                  continue: () => void;
                } | null,
                onsuccess: null as (() => void) | null,
              };
              const advance = () => {
                const value = entries[index++];
                request.result = value
                  ? {
                      value,
                      continue: () => queueMicrotask(advance),
                    }
                  : null;
                request.onsuccess?.();
                if (!value) finish();
              };
              queueMicrotask(advance);
              return request;
            },
          };
        },
      };
      return tx;
    });
  const transaction = makeTransaction(stores);
  const db = { transaction, close: vi.fn() } as unknown as IDBDatabase;
  const factory = {
    deleteDatabase: vi.fn(() => {
      const request = { onsuccess: null as (() => void) | null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    }),
  } as unknown as IDBFactory;
  const repository = new PagedLogRepository({
    indexedDbFactory: factory,
    ...options,
  });
  (repository as unknown as { db: IDBDatabase }).db = db;
  const open = vi.spyOn(indexedDb, "openPagedDatabase").mockImplementation(
    async () =>
      ({
        close: vi.fn(),
        transaction: makeTransaction(
          new Map([
            [PAYLOAD_STORE_NAME, new Map()],
            [PROJECTION_STORE_NAME, new Map()],
          ]),
        ),
      }) as unknown as IDBDatabase,
  );
  vi.stubGlobal("IDBKeyRange", {
    bound: (lower: number, upper: number) => ({ lower, upper }),
  });
  return { repository, transaction, open, factory, db };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PagedLogRepository byte cache", () => {
  it("keeps the original database and readable cached records when replacement preparation fails", async () => {
    const { repository, open, db, transaction } = fixture(
      [
        preparePagedRecord(
          { timestamp: null, message: "retained", source: "test" },
          1,
        ),
      ],
      {},
    );
    const originalName = repository.databaseName;
    await repository.getPayload(1);
    const stats = repository.getCacheStats();
    open.mockRejectedValueOnce(new Error("replacement failed"));
    await expect(repository.clear()).rejects.toThrow("replacement failed");
    expect(repository.databaseName).toBe(originalName);
    expect(db.close).not.toHaveBeenCalled();
    await expect(repository.getPayload(1)).resolves.toMatchObject({
      message: "retained",
    });
    expect(repository.getCacheStats().residentBytes).toBe(stats.residentBytes);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("switches only after preparation commits and serializes writes into the new dense-ID dataset", async () => {
    const { repository, open, db } = fixture([], {});
    await repository.putMany([
      { timestamp: null, message: "old", source: "test" },
    ]);
    const originalName = repository.databaseName;
    const prepare = open.getMockImplementation()!;
    let release!: (db: IDBDatabase) => void;
    open.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const clear = repository.clear();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(repository.databaseName).toBe(originalName);
    expect(db.close).not.toHaveBeenCalled();
    const write = repository.putMany([
      { timestamp: null, message: "new", source: "test" },
    ]);
    release(await prepare());
    await clear;
    expect(repository.databaseName).not.toBe(originalName);
    await expect(write).resolves.toEqual([1]);
    await expect(repository.getPayload(1)).resolves.toMatchObject({
      message: "new",
    });
    expect(db.close).toHaveBeenCalledOnce();
  });

  it("does not turn a committed clear into failure when retired database cleanup fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { repository, factory } = fixture([], {});
    vi.mocked(factory.deleteDatabase).mockImplementationOnce(() => {
      const request = {
        onerror: null as (() => void) | null,
        error: new Error("cleanup failed"),
      };
      queueMicrotask(() => request.onerror?.());
      return request as unknown as IDBOpenDBRequest;
    });
    const originalName = repository.databaseName;
    await expect(repository.clear()).resolves.toBeUndefined();
    expect(repository.databaseName).not.toBe(originalName);
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        "Reclaiming retired log storage failed; will retry:",
        originalName,
        expect.any(Error),
      ),
    );
    await repository.putMany([
      { timestamp: null, message: "new", source: "test" },
    ]);
    await expect(repository.getPayload(1)).resolves.toMatchObject({
      message: "new",
    });
    await repository.destroy();
    expect(
      vi
        .mocked(factory.deleteDatabase)
        .mock.calls.filter(([name]) => name === originalName),
    ).toHaveLength(2);
  });

  it("exposes default and injected byte limits without opening storage", () => {
    expect(new PagedLogRepository().getCacheStats()).toMatchObject({
      maxBytes: DEFAULT_MAX_CACHED_BYTES,
      pageSize: 256,
      maxPages: 32,
      residentBytes: 0,
      bytesEstimated: true,
    });
    expect(
      new PagedLogRepository({ maxCachedBytes: 1024 }).getCacheStats().maxBytes,
    ).toBe(1024);
  });

  it("budgets decompressed canonical fields, not their compressed storage size", async () => {
    const record = preparePagedRecord(
      {
        timestamp: "2026-09-14",
        message: "preview",
        source: "test",
        _fullMessage: "complete ".repeat(20000),
        stackTrace: "at example.method\n".repeat(20000),
        mdc: { context: "x".repeat(10000) },
      },
      1,
    );
    const expected = hydratePagedRecord(
      record.payload.entry,
      record.projection,
    );
    record.payload.entry = await compression.compressPayloadEntry(
      record.payload.entry,
      1,
    );
    expect(
      (record.payload.entry as compression.StoredPayloadEntry)._compressedHeavy!
        .data.byteLength,
    ).toBeLessThan(4096);
    const { repository } = fixture([record], {
      pageSize: 1,
      maxCachedBytes: 4096,
    });
    await expect(repository.getPayload(1)).resolves.toEqual(expected);
    await expect(repository.getPayload(1)).resolves.toEqual(expected);
    expect(repository.getCacheStats()).toMatchObject({
      loads: 2,
      oversizedPages: 2,
      residentBytes: 0,
      residentPages: 0,
    });
  });

  it("admits at the exact decoded threshold and releases bytes on close", async () => {
    const record = preparePagedRecord(
      {
        timestamp: null,
        message: "small",
        source: "test",
      },
      1,
    );
    const expected = hydratePagedRecord(
      record.payload.entry,
      record.projection,
    );
    const maxCachedBytes = estimatePayloadBytes(new Map([[1, expected]]));
    const { repository, transaction } = fixture([record], {
      pageSize: 1,
      maxCachedBytes,
    });
    await repository.getPayload(1);
    await repository.getPayload(1);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(repository.getCacheStats().residentBytes).toBe(maxCachedBytes);
    repository.close();
    expect(repository.getCacheStats().residentBytes).toBe(0);
  });

  it("invalidates changed IDs after writes and clears all retained bytes", async () => {
    const input = { timestamp: null, message: "old", source: "test" };
    const record = preparePagedRecord(input, 1);
    const { repository } = fixture([record], {
      pageSize: 1,
      maxCachedBytes: 4096,
    });
    await repository.getPayload(1);
    expect(repository.getCacheStats().residentBytes).toBeGreaterThan(0);
    await repository.putMany([{ ...input, id: 1, message: "new" }]);
    expect(repository.getCacheStats().residentBytes).toBe(0);
    await expect(repository.getPayload(1)).resolves.toMatchObject({
      message: "new",
    });
    await repository.clear();
    expect(repository.getCacheStats().residentBytes).toBe(0);
    await expect(repository.getPayload(1)).resolves.toBeUndefined();
  });

  it("holds admission until every decoder settles after one fails", async () => {
    const records = [1, 2, 3].map((id) =>
      preparePagedRecord(
        {
          timestamp: null,
          message: String(id),
          source: "test",
        },
        id,
      ),
    );
    const { repository, transaction } = fixture(records, {
      pageSize: 2,
      maxCachedBytes: 4096,
    });
    let release!: (value: PreparedPagedRecord["payload"]["entry"]) => void;
    const slow = new Promise<PreparedPagedRecord["payload"]["entry"]>(
      (resolve) => {
        release = resolve;
      },
    );
    let started!: () => void;
    const decodingStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.spyOn(compression, "decompressPayloadEntry").mockImplementation(
      (entry) => {
        if (entry._id === 1) return Promise.reject(new Error("decode failed"));
        if (entry._id === 2) {
          started();
          return slow;
        }
        return Promise.resolve(entry);
      },
    );
    const first = repository.getPayload(1);
    const failed = expect(first).rejects.toThrow("decode failed");
    const next = repository.getPayload(3);
    await decodingStarted;
    await Promise.resolve();
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(repository.getCacheStats().residentBytes).toBe(0);
    release(records[1]!.payload.entry);
    await failed;
    await expect(next).resolves.toMatchObject({ _id: 3 });
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(repository.getCacheStats()).toMatchObject({
      residentPages: 1,
      residentPayloads: 1,
    });
    expect(repository.getCacheStats().residentBytes).toBeLessThanOrEqual(4096);
  });
});
