import type { PayloadCacheStats } from "./types";

export type PageLoader<T> = (
  firstId: number,
  lastId: number,
) => Promise<ReadonlyMap<number, T>>;

interface CacheCounters {
  hits: number;
  misses: number;
  loads: number;
  coalescedLoads: number;
  evictions: number;
}

export class PageLruCache<T> {
  readonly pageSize: number;
  readonly maxPages: number;

  private generation = 0;
  private readonly pages = new Map<number, ReadonlyMap<number, T>>();
  private readonly pending = new Map<string, Promise<ReadonlyMap<number, T>>>();
  private readonly counters: CacheCounters = {
    hits: 0,
    misses: 0,
    loads: 0,
    coalescedLoads: 0,
    evictions: 0,
  };

  constructor(
    private readonly loader: PageLoader<T>,
    options: { pageSize?: number; maxPages?: number } = {},
  ) {
    this.pageSize = options.pageSize ?? 256;
    this.maxPages = options.maxPages ?? 32;
    if (!Number.isSafeInteger(this.pageSize) || this.pageSize < 1) {
      throw new RangeError("pageSize must be a positive integer");
    }
    if (!Number.isSafeInteger(this.maxPages) || this.maxPages < 1) {
      throw new RangeError("maxPages must be a positive integer");
    }
  }

  invalidate(): void {
    this.generation++;
    this.pages.clear();
    this.pending.clear();
  }

  invalidateIds(ids: readonly number[]): void {
    this.generation++;
    this.pending.clear();
    for (const id of ids) {
      this.pages.delete(this.pageNumber(id));
    }
  }

  async get(id: number): Promise<T | undefined> {
    const page = await this.getPage(id);
    return page.get(id);
  }

  async getMany(ids: readonly number[]): Promise<Map<number, T>> {
    const result = new Map<number, T>();
    const idsByPage = new Map<number, number[]>();
    for (const id of ids) {
      const pageNumber = this.pageNumber(id);
      const pageIds = idsByPage.get(pageNumber);
      if (pageIds) pageIds.push(id);
      else idsByPage.set(pageNumber, [id]);
    }
    for (const [pageNumber, pageIds] of idsByPage) {
      const page = await this.loadPage(pageNumber);
      for (const id of pageIds) {
        const value = page.get(id);
        if (value !== undefined) result.set(id, value);
      }
    }
    return result;
  }

  getStats(): PayloadCacheStats {
    let residentPayloads = 0;
    for (const page of this.pages.values()) residentPayloads += page.size;
    return {
      ...this.counters,
      residentPages: this.pages.size,
      residentPayloads,
      maxResidentPayloads: this.pageSize * this.maxPages,
      pageSize: this.pageSize,
      maxPages: this.maxPages,
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

  private async loadPage(pageNumber: number): Promise<ReadonlyMap<number, T>> {
    const cached = this.pages.get(pageNumber);
    if (cached) {
      this.counters.hits++;
      this.pages.delete(pageNumber);
      this.pages.set(pageNumber, cached);
      return cached;
    }

    this.counters.misses++;
    const generation = this.generation;
    const pendingKey = `${generation}:${pageNumber}`;
    const existing = this.pending.get(pendingKey);
    if (existing) {
      this.counters.coalescedLoads++;
      return existing;
    }

    const firstId = pageNumber * this.pageSize + 1;
    this.counters.loads++;
    const load = this.loader(firstId, firstId + this.pageSize - 1).then(
      (page) => {
        if (this.generation === generation) this.store(pageNumber, page);
        return page;
      },
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
    this.pages.delete(pageNumber);
    this.pages.set(pageNumber, page);
    while (this.pages.size > this.maxPages) {
      const oldest = this.pages.keys().next().value as number | undefined;
      if (oldest === undefined) break;
      this.pages.delete(oldest);
      this.counters.evictions++;
    }
  }
}
