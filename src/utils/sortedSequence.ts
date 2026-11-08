import { BoundedSequence } from "./readonlySequence";
import { compareByTimestampId } from "./sort";

export interface SortedEntry {
  _id: number;
  timestamp?: unknown;
}

const PAGE_SIZE = 1024;
type Page<T> = readonly T[];

interface SortedData<T extends SortedEntry> {
  pages: readonly Page<T>[];
  starts: readonly number[];
  byId: ReadonlyMap<number, Page<T | undefined>>;
  length: number;
  lineage: object;
}

function lowerBound(
  length: number,
  before: (index: number) => boolean,
): number {
  let low = 0;
  let high = length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (before(mid)) low = mid + 1;
    else high = mid;
  }
  return low;
}

function positionOf<T extends SortedEntry>(
  data: SortedData<T>,
  id: number,
): number {
  if (!Number.isSafeInteger(id) || id < 0) return -1;
  const entry = data.byId.get(Math.floor(id / PAGE_SIZE))?.[id % PAGE_SIZE];
  if (!entry) return -1;
  const pageIndex = lowerBound(data.pages.length, (index) => {
    const page = data.pages[index]!;
    return compareByTimestampId(page[page.length - 1]!, entry) < 0;
  });
  const page = data.pages[pageIndex];
  if (!page) return -1;
  const offset = lowerBound(
    page.length,
    (index) => compareByTimestampId(page[index]!, entry) < 0,
  );
  return page[offset] === entry ? data.starts[pageIndex]! + offset : -1;
}

function entryAt<T extends SortedEntry>(
  data: SortedData<T>,
  index: number,
): T | undefined {
  if (index < 0) index += data.length;
  if (!Number.isInteger(index) || index < 0 || index >= data.length)
    return undefined;
  const pageIndex =
    lowerBound(data.starts.length, (page) => data.starts[page]! <= index) - 1;
  return data.pages[pageIndex]![index - data.starts[pageIndex]!];
}

export class EntryIdSnapshot<
  T extends SortedEntry = SortedEntry,
> extends BoundedSequence<number> {
  readonly length: number;

  constructor(private readonly data: SortedData<T>) {
    super();
    this.length = data.length;
  }

  at(index: number): number | undefined {
    return entryAt(this.data, index)?._id;
  }

  positionOf(id: number): number {
    return positionOf(this.data, id);
  }

  override indexOf(id: number, fromIndex = 0): number {
    const position = this.positionOf(id);
    const start = Math.max(
      0,
      fromIndex < 0 ? this.length + fromIndex : fromIndex,
    );
    return position >= start ? position : -1;
  }

  override *[Symbol.iterator](): IterableIterator<number> {
    for (const page of this.data.pages)
      for (const entry of page) yield entry._id;
  }

  isAppendOf(previous: EntryIdSnapshot): boolean {
    return (
      this.data.lineage === previous.data.lineage &&
      this.length >= previous.length
    );
  }
}

export class SortedSnapshot<T extends SortedEntry> extends BoundedSequence<T> {
  readonly length: number;
  readonly ids: EntryIdSnapshot<T>;

  constructor(private readonly data: SortedData<T>) {
    super();
    this.length = data.length;
    this.ids = new EntryIdSnapshot(data);
  }

  at(index: number): T | undefined {
    return entryAt(this.data, index);
  }

  get(id: number): T | undefined {
    return this.data.byId.get(Math.floor(id / PAGE_SIZE))?.[id % PAGE_SIZE];
  }

  override *[Symbol.iterator](): IterableIterator<T> {
    for (const page of this.data.pages) yield* page;
  }

  isAppendOf(previous: SortedSnapshot<T>): boolean {
    return this.ids.isAppendOf(previous.ids);
  }
}

/** Copy-on-write row/ID pages: insertion copies directories and affected pages, not historical rows. */
export class SortedStore<T extends SortedEntry> {
  private data: SortedData<T> = {
    pages: [],
    starts: [],
    byId: new Map(),
    length: 0,
    lineage: {},
  };
  private published: SortedSnapshot<T> | undefined;

  get length(): number {
    return this.data.length;
  }

  publish(): SortedSnapshot<T> {
    return (this.published ??= new SortedSnapshot(this.data));
  }

  fork(): SortedStore<T> {
    const fork = new SortedStore<T>();
    fork.data = { ...this.data, lineage: {} };
    return fork;
  }

  appendSorted(incoming: readonly T[]): void {
    if (!incoming.length) return;
    const ids = new Set<number>();
    for (const entry of incoming) {
      const id = entry._id;
      if (!Number.isSafeInteger(id) || id < 0)
        throw new Error(`Invalid metadata ID: ${id}`);
      if (
        ids.has(id) ||
        this.data.byId.get(Math.floor(id / PAGE_SIZE))?.[id % PAGE_SIZE]
      )
        throw new Error(`Duplicate metadata ID: ${id}`);
      ids.add(id);
    }

    const pages: Page<T>[] = [];
    const appendPages = (
      values: readonly T[],
      start = 0,
      balance = false,
    ): void => {
      const remaining = values.length - start;
      const size =
        balance && remaining
          ? Math.ceil(remaining / Math.ceil(remaining / PAGE_SIZE))
          : PAGE_SIZE;
      for (let offset = start; offset < values.length;) {
        const page: T[] = [];
        const end = Math.min(values.length, offset + size);
        while (offset < end) page.push(values[offset++]!);
        pages.push(page);
      }
    };
    const lastPage = this.data.pages[this.data.pages.length - 1];
    const last = lastPage?.[lastPage.length - 1];
    const monotonic = !last || compareByTimestampId(last, incoming[0]!) <= 0;
    let next = 0;
    if (monotonic) {
      for (const page of this.data.pages) pages.push(page);
      if (lastPage && lastPage.length < PAGE_SIZE) {
        const tail: T[] = [];
        for (const entry of lastPage) tail.push(entry);
        while (tail.length < PAGE_SIZE && next < incoming.length)
          tail.push(incoming[next++]!);
        pages[pages.length - 1] = tail;
      }
    } else {
      for (const page of this.data.pages) {
        if (
          next === incoming.length ||
          compareByTimestampId(page[page.length - 1]!, incoming[next]!) < 0
        ) {
          pages.push(page);
          continue;
        }
        const end =
          next +
          lowerBound(
            incoming.length - next,
            (index) =>
              compareByTimestampId(
                incoming[next + index]!,
                page[page.length - 1]!,
              ) <= 0,
          );
        const merged: T[] = [];
        let previous = 0;
        while (previous < page.length && next < end) {
          if (compareByTimestampId(page[previous]!, incoming[next]!) <= 0)
            merged.push(page[previous++]!);
          else merged.push(incoming[next++]!);
        }
        while (previous < page.length) merged.push(page[previous++]!);
        while (next < end) merged.push(incoming[next++]!);
        appendPages(merged, 0, true);
      }
    }
    appendPages(incoming, next);

    const byId = new Map(this.data.byId);
    const changed = new Map<number, Array<T | undefined>>();
    for (const entry of incoming) {
      const pageIndex = Math.floor(entry._id / PAGE_SIZE);
      let page = changed.get(pageIndex);
      if (!page) {
        page = [];
        const previous = byId.get(pageIndex);
        if (previous)
          for (let index = 0; index < previous.length; index++)
            page[index] = previous[index];
        changed.set(pageIndex, page);
        byId.set(pageIndex, page);
      }
      page[entry._id % PAGE_SIZE] = entry;
    }
    const starts: number[] = [];
    let length = 0;
    for (const page of pages) {
      starts.push(length);
      length += page.length;
    }
    this.data = {
      pages,
      starts,
      byId,
      length,
      lineage: monotonic ? this.data.lineage : {},
    };
    this.published = undefined;
  }
}
