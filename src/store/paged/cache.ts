import { estimatePayloadBytes } from "../../utils/estimatePayloadBytes";
import type { PayloadCacheStats } from "./types";

export { estimatePayloadBytes } from "../../utils/estimatePayloadBytes";

export const DEFAULT_MAX_CACHED_BYTES = 64 * 1024 * 1024;

export type PageLoader<T> = (
  firstId: number,
  lastId: number,
) => Promise<ReadonlyMap<number, T>>;

/** Loads exactly the given IDs; results are delivered but never retained. */
export type SparseLoader<T> = (
  ids: readonly number[],
) => Promise<ReadonlyMap<number, T>>;

interface CacheCounters {
  hits: number;
  misses: number;
  loads: number;
  coalescedLoads: number;
  sparseLoads: number;
  sparsePayloads: number;
  evictions: number;
  evictedBytes: number;
  oversizedPages: number;
}

interface CachedPage<T> {
  values: ReadonlyMap<number, T>;
  bytes: number;
}

/**
 * Limits retained decoded pages, not the application's total heap. UI payloads,
 * getMany/export results and caller-held references are outside this budget and
 * must not be mutated while cached. At most one page loader/decode runs at once;
 * that transient page may exceed maxBytes but is still delivered to its callers.
 */
export class PageLruCache<T> {
  readonly pageSize: number;
  readonly maxPages: number;
  readonly maxBytes: number;
  /** Non-resident pages with fewer requested IDs than this use the sparse loader. */
  readonly sparseThreshold: number;

  private generation = 0;
  private residentBytes = 0;
  private loadTail: Promise<void> = Promise.resolve();
  private readonly sparseLoader?: SparseLoader<T>;
  private readonly pages = new Map<number, CachedPage<T>>();
  private readonly pending = new Map<string, Promise<ReadonlyMap<number, T>>>();
  private readonly counters: CacheCounters = {
    hits: 0,
    misses: 0,
    loads: 0,
    coalescedLoads: 0,
    sparseLoads: 0,
    sparsePayloads: 0,
    evictions: 0,
    evictedBytes: 0,
    oversizedPages: 0,
  };

  constructor(
    private readonly loader: PageLoader<T>,
    options: {
      pageSize?: number;
      maxPages?: number;
      maxBytes?: number;
      sparseLoader?: SparseLoader<T>;
      sparseThreshold?: number;
    } = {},
  ) {
    this.pageSize = options.pageSize ?? 256;
    this.maxPages = options.maxPages ?? 32;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_CACHED_BYTES;
    this.sparseLoader = options.sparseLoader;
    this.sparseThreshold =
      options.sparseThreshold ?? Math.floor(this.pageSize / 8);
    if (
      !Number.isSafeInteger(this.sparseThreshold) ||
      this.sparseThreshold < 0
    ) {
      throw new RangeError("sparseThreshold must be a non-negative integer");
    }
    if (!Number.isSafeInteger(this.pageSize) || this.pageSize < 1) {
      throw new RangeError("pageSize must be a positive integer");
    }
    if (!Number.isSafeInteger(this.maxPages) || this.maxPages < 1) {
      throw new RangeError("maxPages must be a positive integer");
    }
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 0) {
      throw new RangeError("maxBytes must be a non-negative safe integer");
    }
  }

  invalidate(): void {
    this.generation++;
    this.pages.clear();
    this.residentBytes = 0;
    this.pending.clear();
  }

  invalidateIds(ids: readonly number[]): void {
    this.generation++;
    this.pending.clear();
    for (const id of ids) {
      this.removePage(this.pageNumber(id));
    }
  }

  async get(id: number): Promise<T | undefined> {
    const page = await this.getPage(id);
    return page.get(id);
  }

  /**
   * Resident pages are served immediately. Filtered views request IDs that are
   * scattered across many pages; decoding a full page per visible row would
   * delay the first paint by seconds, so sparsely requested pages are fetched
   * ID-by-ID (when a sparse loader exists) concurrently with the page loads.
   */
  async getMany(ids: readonly number[]): Promise<Map<number, T>> {
    const result = new Map<number, T>();
    const idsByPage = new Map<number, number[]>();
    for (const id of ids) {
      const pageNumber = this.pageNumber(id);
      const pageIds = idsByPage.get(pageNumber);
      if (pageIds) pageIds.push(id);
      else idsByPage.set(pageNumber, [id]);
    }
    const copy = (page: ReadonlyMap<number, T>, pageIds: readonly number[]) => {
      for (const id of pageIds) {
        const value = page.get(id);
        if (value !== undefined) result.set(id, value);
      }
    };
    const pageLoads: Promise<void>[] = [];
    const sparseIds: number[] = [];
    for (const [pageNumber, pageIds] of idsByPage) {
      const resident = this.touchResident(pageNumber);
      if (resident) {
        copy(resident, pageIds);
      } else if (
        this.sparseLoader &&
        pageIds.length < this.sparseThreshold &&
        !this.pending.has(`${this.generation}:${pageNumber}`)
      ) {
        sparseIds.push(...pageIds);
      } else {
        pageLoads.push(
          this.loadPage(pageNumber).then((page) => copy(page, pageIds)),
        );
      }
    }
    if (sparseIds.length > 0) {
      this.counters.misses += sparseIds.length;
      this.counters.sparseLoads++;
      this.counters.sparsePayloads += sparseIds.length;
      pageLoads.push(
        this.sparseLoader!(sparseIds).then((loaded) => copy(loaded, sparseIds)),
      );
    }
    await Promise.all(pageLoads);
    return result;
  }

  getStats(): PayloadCacheStats {
    let residentPayloads = 0;
    for (const page of this.pages.values())
      residentPayloads += page.values.size;
    return {
      ...this.counters,
      residentPages: this.pages.size,
      residentPayloads,
      maxResidentPayloads: this.pageSize * this.maxPages,
      pageSize: this.pageSize,
      maxPages: this.maxPages,
      residentBytes: this.residentBytes,
      maxBytes: this.maxBytes,
      bytesEstimated: true,
    };
  }

  private pageNumber(id: number): number {
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new RangeError("Payload IDs must be positive safe integers");
    }
    return Math.floor((id - 1) / this.pageSize);
  }

  private async getPage(id: number): Promise<ReadonlyMap<number, T>> {
    return this.loadPage(this.pageNumber(id));
  }

  private touchResident(pageNumber: number): ReadonlyMap<number, T> | null {
    const cached = this.pages.get(pageNumber);
    if (!cached) return null;
    this.counters.hits++;
    this.pages.delete(pageNumber);
    this.pages.set(pageNumber, cached);
    return cached.values;
  }

  private async loadPage(pageNumber: number): Promise<ReadonlyMap<number, T>> {
    const resident = this.touchResident(pageNumber);
    if (resident) return resident;

    this.counters.misses++;
    const generation = this.generation;
    const pendingKey = `${generation}:${pageNumber}`;
    const existing = this.pending.get(pendingKey);
    if (existing) {
      this.counters.coalescedLoads++;
      return existing;
    }

    const firstId = pageNumber * this.pageSize + 1;
    // Queue only request metadata; do not reset admission on invalidation while
    // an old generation is still decoding. The tail never retains page results.
    const load = this.loadTail.then(async () => {
      this.counters.loads++;
      const page = await this.loader(firstId, firstId + this.pageSize - 1);
      if (this.generation === generation) this.store(pageNumber, page);
      return page;
    });
    this.loadTail = load.then(
      () => undefined,
      () => undefined,
    );
    this.pending.set(pendingKey, load);
    try {
      return await load;
    } finally {
      if (this.pending.get(pendingKey) === load) {
        this.pending.delete(pendingKey);
      }
    }
  }

  private store(pageNumber: number, page: ReadonlyMap<number, T>): void {
    const bytes = estimatePayloadBytes(page, this.maxBytes);
    if (bytes > this.maxBytes || page.size > this.pageSize) {
      this.counters.oversizedPages++;
      return;
    }
    this.removePage(pageNumber);
    while (
      this.pages.size >= this.maxPages ||
      this.residentBytes > this.maxBytes - bytes
    ) {
      const oldest = this.pages.keys().next().value as number | undefined;
      if (oldest === undefined) break;
      this.counters.evictedBytes += this.removePage(oldest);
      this.counters.evictions++;
    }
    this.pages.set(pageNumber, { values: page, bytes });
    this.residentBytes += bytes;
  }

  private removePage(pageNumber: number): number {
    const page = this.pages.get(pageNumber);
    if (!page) return 0;
    this.pages.delete(pageNumber);
    this.residentBytes -= page.bytes;
    return page.bytes;
  }
}
