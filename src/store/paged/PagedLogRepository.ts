import { PageLruCache } from "./cache";
import { IndexedDbUnavailableError, toPagedWriteError } from "./errors";
import {
  getStorageEstimate,
  isIndexedDbAvailable,
  openPagedDatabase,
  PAGED_DB_NAME,
  PAYLOAD_STORE_NAME,
  PROJECTION_STORE_NAME,
  requestPersistentStorage,
} from "./indexedDb";
import {
  hydratePagedRecord,
  preparePagedRecord,
  type CanonicalLogEntry,
  type PagedLogEntry,
  type PagedRepositoryStatus,
  type PayloadCacheStats,
  type PayloadRecord,
  type ProjectionRecord,
  type ProjectionScanOptions,
} from "./types";

export interface PagedLogRepositoryOptions {
  pageSize?: number;
  maxCachedPages?: number;
  indexedDbFactory?: IDBFactory;
  databaseName?: string;
}

function transactionDone(
  transaction: IDBTransaction,
  operationError: () => unknown = () => transaction.error,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      if (error) {
        reject(
          error instanceof Error
            ? error
            : new Error("IndexedDB transaction failed", { cause: error }),
        );
      } else {
        resolve();
      }
    };
    transaction.oncomplete = () => finish();
    transaction.onerror = () =>
      finish(
        operationError() ??
          transaction.error ??
          new Error("Transaction failed"),
      );
    transaction.onabort = () =>
      finish(
        operationError() ??
          transaction.error ??
          new DOMException("Transaction aborted", "AbortError"),
      );
  });
}

export class PagedLogRepository {
  readonly databaseName: string;
  private db: IDBDatabase | null = null;
  private initPromise: Promise<IDBDatabase> | null = null;
  private nextId = 1;
  private initialized = false;
  private lifecycleGeneration = 0;
  private mutationTail: Promise<void> = Promise.resolve();
  private readonly signatureKeys = new Set<string>();
  private signaturesLoaded = false;
  private signatureLoadPromise: Promise<void> | null = null;
  private readonly factory?: IDBFactory;
  private readonly payloadCache: PageLruCache<CanonicalLogEntry>;

  constructor(options: PagedLogRepositoryOptions = {}) {
    this.factory = options.indexedDbFactory;
    this.databaseName = options.databaseName ?? PAGED_DB_NAME;
    this.payloadCache = new PageLruCache(
      (firstId, lastId) => this.loadPayloadPage(firstId, lastId),
      {
        pageSize: options.pageSize,
        maxPages: options.maxCachedPages,
      },
    );
  }

  isAvailable(): boolean {
    return this.factory !== undefined || isIndexedDbAvailable();
  }

  async init(): Promise<void> {
    await this.getDb();
  }

  async putMany(entries: readonly PagedLogEntry[]): Promise<number[]> {
    if (entries.length === 0) return [];
    return this.runMutation(async () => {
      const db = await this.getDb();
      const ids = entries.map((entry) => {
        const supplied = entry.id ?? entry._id;
        if (supplied !== undefined) {
          if (!Number.isSafeInteger(supplied) || supplied < 1) {
            throw new RangeError(
              "Paged log entry IDs must be positive safe integers",
            );
          }
          this.nextId = Math.max(this.nextId, supplied + 1);
          return supplied;
        }
        return this.nextId++;
      });
      const records = entries.map((entry, index) =>
        preparePagedRecord(entry, ids[index]!),
      );
      const transaction = db.transaction(
        [PAYLOAD_STORE_NAME, PROJECTION_STORE_NAME],
        "readwrite",
      );
      let requestError: unknown;
      const done = transactionDone(
        transaction,
        () => requestError ?? transaction.error,
      );
      try {
        const payloads = transaction.objectStore(PAYLOAD_STORE_NAME);
        const projections = transaction.objectStore(PROJECTION_STORE_NAME);
        for (const record of records) {
          const payloadRequest = payloads.put(record.payload);
          payloadRequest.onerror = () => {
            requestError = payloadRequest.error;
          };
          const projectionRequest = projections.put(record.projection);
          projectionRequest.onerror = () => {
            requestError = projectionRequest.error;
          };
        }
      } catch (error) {
        transaction.abort();
        await done.catch(() => undefined);
        throw toPagedWriteError(error);
      }
      try {
        await done;
      } catch (error) {
        throw toPagedWriteError(error);
      }
      for (const record of records) {
        this.signatureKeys.add(
          `${record.projection.source}\0${record.projection.signature}`,
        );
      }
      this.payloadCache.invalidateIds(ids);
      return ids;
    });
  }

  async getPayload(id: number): Promise<CanonicalLogEntry | undefined> {
    await this.getDb();
    return this.payloadCache.get(id);
  }

  async getPayloads(
    ids: readonly number[],
  ): Promise<Map<number, CanonicalLogEntry>> {
    if (ids.length === 0) return new Map();
    await this.getDb();
    return this.payloadCache.getMany(ids);
  }

  async getProjection(id: number): Promise<ProjectionRecord | undefined> {
    const db = await this.getDb();
    return this.getOne<ProjectionRecord>(db, PROJECTION_STORE_NAME, id);
  }

  async getProjections(
    ids: readonly number[],
  ): Promise<Map<number, ProjectionRecord>> {
    if (ids.length === 0) return new Map();
    const db = await this.getDb();
    const transaction = db.transaction(PROJECTION_STORE_NAME, "readonly");
    const store = transaction.objectStore(PROJECTION_STORE_NAME);
    const output = new Map<number, ProjectionRecord>();
    let requestError: unknown;
    const done = transactionDone(
      transaction,
      () => requestError ?? transaction.error,
    );
    for (const id of ids) {
      const request = store.get(id);
      request.onsuccess = () => {
        const record = request.result as ProjectionRecord | undefined;
        if (record) output.set(id, record);
      };
      request.onerror = () => {
        requestError = request.error;
      };
    }
    await done;
    return output;
  }

  async findExistingSignatures(
    candidates: readonly { source: string; signature: string }[],
  ): Promise<Set<string>> {
    if (candidates.length === 0) return new Set();
    await this.ensureSignatureCache();
    const output = new Set<string>();
    for (const candidate of candidates) {
      const key = `${candidate.source}\0${candidate.signature}`;
      if (this.signatureKeys.has(key)) output.add(key);
    }
    return output;
  }

  async *scanProjectionPages(
    options: ProjectionScanOptions = {},
  ): AsyncGenerator<ProjectionRecord[], void> {
    const pageSize = options.pageSize ?? this.payloadCache.pageSize;
    if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
      throw new RangeError("Projection scan pageSize must be positive");
    }
    const direction = options.direction ?? "next";
    let afterId = options.afterId;
    while (true) {
      const page = await this.readProjectionPage(pageSize, direction, afterId);
      if (page.length === 0) return;
      yield page;
      afterId = page[page.length - 1]!.id;
      if (page.length < pageSize) return;
    }
  }

  async scanProjections(
    callback: (
      page: readonly ProjectionRecord[],
    ) => void | boolean | Promise<void | boolean>,
    options: ProjectionScanOptions = {},
  ): Promise<void> {
    for await (const page of this.scanProjectionPages(options)) {
      if ((await callback(page)) === false) return;
    }
  }

  async count(): Promise<number> {
    const db = await this.getDb();
    const transaction = db.transaction(PAYLOAD_STORE_NAME, "readonly");
    const request = transaction.objectStore(PAYLOAD_STORE_NAME).count();
    let result = 0;
    let requestError: unknown;
    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => {
      requestError = request.error;
    };
    await transactionDone(transaction, () => requestError ?? transaction.error);
    return result;
  }

  async getStatus(): Promise<PagedRepositoryStatus> {
    const count = await this.count();
    return {
      initialized: this.initialized,
      available: this.isAvailable(),
      count,
      cache: this.getCacheStats(),
      storage: await getStorageEstimate(),
    };
  }

  getCacheStats(): PayloadCacheStats {
    return this.payloadCache.getStats();
  }

  async clear(): Promise<void> {
    this.payloadCache.invalidate();
    await this.runMutation(async () => {
      const db = await this.getDb();
      const transaction = db.transaction(
        [PAYLOAD_STORE_NAME, PROJECTION_STORE_NAME],
        "readwrite",
      );
      let requestError: unknown;
      const payloadRequest = transaction
        .objectStore(PAYLOAD_STORE_NAME)
        .clear();
      payloadRequest.onerror = () => {
        requestError = payloadRequest.error;
      };
      const projectionRequest = transaction
        .objectStore(PROJECTION_STORE_NAME)
        .clear();
      projectionRequest.onerror = () => {
        requestError = projectionRequest.error;
      };
      try {
        await transactionDone(
          transaction,
          () => requestError ?? transaction.error,
        );
      } catch (error) {
        throw toPagedWriteError(error);
      }
      this.nextId = 1;
      this.signatureKeys.clear();
      this.signaturesLoaded = true;
      this.signatureLoadPromise = null;
      this.payloadCache.invalidate();
    });
  }

  close(): void {
    this.lifecycleGeneration++;
    this.payloadCache.invalidate();
    this.db?.close();
    this.db = null;
    this.initPromise = null;
    this.initialized = false;
  }

  async destroy(): Promise<void> {
    await this.runMutation(async () => {
      this.close();
      const factory =
        this.factory ?? (isIndexedDbAvailable() ? indexedDB : undefined);
      if (!factory) throw new IndexedDbUnavailableError();
      await new Promise<void>((resolve, reject) => {
        const request = factory.deleteDatabase(this.databaseName);
        request.onsuccess = () => resolve();
        request.onerror = () =>
          reject(
            new IndexedDbUnavailableError(
              "Unable to delete paged log database",
              { cause: request.error },
            ),
          );
        request.onblocked = () =>
          reject(
            new IndexedDbUnavailableError(
              "Deleting paged log database is blocked by another connection",
            ),
          );
      });
      this.signatureKeys.clear();
      this.signaturesLoaded = false;
      this.signatureLoadPromise = null;
    });
  }

  private async getDb(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    if (!this.isAvailable()) throw new IndexedDbUnavailableError();
    if (this.initPromise) return this.initPromise;

    const generation = this.lifecycleGeneration;
    const initialization = this.initializeDatabase(generation);
    this.initPromise = initialization;
    try {
      return await initialization;
    } catch (error) {
      if (this.initPromise === initialization) this.initPromise = null;
      throw error;
    }
  }

  private async initializeDatabase(generation: number): Promise<IDBDatabase> {
    const db = await openPagedDatabase(this.factory, this.databaseName);
    try {
      const nextId = await this.findNextId(db);
      if (generation !== this.lifecycleGeneration) {
        throw new IndexedDbUnavailableError(
          "IndexedDB repository was closed during initialization",
        );
      }
      this.nextId = nextId;
      this.db = db;
      this.initialized = true;
      void requestPersistentStorage();
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  }

  private runMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async findNextId(db: IDBDatabase): Promise<number> {
    const transaction = db.transaction(PAYLOAD_STORE_NAME, "readonly");
    const request = transaction
      .objectStore(PAYLOAD_STORE_NAME)
      .openKeyCursor(null, "prev");
    let nextId = 1;
    let requestError: unknown;
    request.onsuccess = () => {
      const key = request.result?.key;
      if (typeof key === "number") nextId = key + 1;
    };
    request.onerror = () => {
      requestError = request.error;
    };
    await transactionDone(transaction, () => requestError ?? transaction.error);
    return nextId;
  }

  private async getOne<T>(
    db: IDBDatabase,
    storeName: string,
    id: number,
  ): Promise<T | undefined> {
    const transaction = db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).get(id);
    let result: T | undefined;
    let requestError: unknown;
    request.onsuccess = () => {
      result = request.result as T | undefined;
    };
    request.onerror = () => {
      requestError = request.error;
    };
    await transactionDone(transaction, () => requestError ?? transaction.error);
    return result;
  }

  private async ensureSignatureCache(): Promise<void> {
    if (this.signaturesLoaded) return;
    if (this.signatureLoadPromise) return this.signatureLoadPromise;

    const load = (async () => {
      const db = await this.getDb();
      const transaction = db.transaction(PROJECTION_STORE_NAME, "readonly");
      const request = transaction
        .objectStore(PROJECTION_STORE_NAME)
        .openCursor();
      let requestError: unknown;
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const projection = cursor.value as ProjectionRecord;
        this.signatureKeys.add(`${projection.source}\0${projection.signature}`);
        cursor.continue();
      };
      request.onerror = () => {
        requestError = request.error;
      };
      await transactionDone(
        transaction,
        () => requestError ?? transaction.error,
      );
      this.signaturesLoaded = true;
    })();
    this.signatureLoadPromise = load;
    try {
      await load;
    } finally {
      if (this.signatureLoadPromise === load) this.signatureLoadPromise = null;
    }
  }

  private async loadPayloadPage(
    firstId: number,
    lastId: number,
  ): Promise<ReadonlyMap<number, CanonicalLogEntry>> {
    const db = await this.getDb();
    if (typeof IDBKeyRange === "undefined") {
      throw new IndexedDbUnavailableError("IDBKeyRange is unavailable");
    }
    const transaction = db.transaction(
      [PAYLOAD_STORE_NAME, PROJECTION_STORE_NAME],
      "readonly",
    );
    const range = IDBKeyRange.bound(firstId, lastId);
    const payloadRequest = transaction
      .objectStore(PAYLOAD_STORE_NAME)
      .openCursor(range);
    const projectionRequest = transaction
      .objectStore(PROJECTION_STORE_NAME)
      .openCursor(range);
    const payloads = new Map<number, PayloadRecord["entry"]>();
    const projections = new Map<number, ProjectionRecord>();
    const output = new Map<number, CanonicalLogEntry>();
    let requestError: unknown;
    payloadRequest.onsuccess = () => {
      const cursor = payloadRequest.result;
      if (!cursor) return;
      const record = cursor.value as PayloadRecord;
      payloads.set(record.id, record.entry);
      cursor.continue();
    };
    payloadRequest.onerror = () => {
      requestError = payloadRequest.error;
    };
    projectionRequest.onsuccess = () => {
      const cursor = projectionRequest.result;
      if (!cursor) return;
      const record = cursor.value as ProjectionRecord;
      projections.set(record.id, record);
      cursor.continue();
    };
    projectionRequest.onerror = () => {
      requestError = projectionRequest.error;
    };
    await transactionDone(transaction, () => requestError ?? transaction.error);
    for (const [id, payload] of payloads) {
      const projection = projections.get(id);
      if (!projection) {
        throw new Error(`Projection missing for paged log entry ${id}`);
      }
      output.set(id, hydratePagedRecord(payload, projection));
    }
    return output;
  }

  private async readProjectionPage(
    pageSize: number,
    direction: "next" | "prev",
    afterId?: number,
  ): Promise<ProjectionRecord[]> {
    const db = await this.getDb();
    if (afterId !== undefined && typeof IDBKeyRange === "undefined") {
      throw new IndexedDbUnavailableError("IDBKeyRange is unavailable");
    }
    const range =
      afterId === undefined
        ? null
        : direction === "next"
          ? IDBKeyRange.lowerBound(afterId, true)
          : IDBKeyRange.upperBound(afterId, true);
    const transaction = db.transaction(PROJECTION_STORE_NAME, "readonly");
    const request = transaction
      .objectStore(PROJECTION_STORE_NAME)
      .openCursor(range, direction);
    const output: ProjectionRecord[] = [];
    let requestError: unknown;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || output.length >= pageSize) return;
      output.push(cursor.value as ProjectionRecord);
      if (output.length < pageSize) cursor.continue();
    };
    request.onerror = () => {
      requestError = request.error;
    };
    await transactionDone(transaction, () => requestError ?? transaction.error);
    return output;
  }
}
