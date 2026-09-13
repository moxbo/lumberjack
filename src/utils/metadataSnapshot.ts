import { compareByTimestampId } from "./sort";
import type { PagedEntryMetadata } from "../hooks/useEntryManagement";
import { IdPositionVector } from "./idPositionVector";

/** Array operations shared by native arrays and bounded, append-only views. */
export interface ReadonlySequence<T> extends Iterable<T> {
  readonly length: number;
  at(index: number): T | undefined;
  slice(start?: number, end?: number): T[];
  indexOf(value: T, fromIndex?: number): number;
  map<U>(callback: (value: T, index: number) => U): U[];
  filter(callback: (value: T, index: number) => unknown): T[];
  find(callback: (value: T, index: number) => unknown): T | undefined;
  flatMap<U>(callback: (value: T, index: number) => U | readonly U[]): U[];
  forEach(callback: (value: T, index: number) => void): void;
}

abstract class BoundedSequence<T> implements ReadonlySequence<T> {
  abstract readonly length: number;
  abstract at(index: number): T | undefined;

  *[Symbol.iterator](): IterableIterator<T> {
    for (let index = 0; index < this.length; index++) yield this.at(index)!;
  }

  slice(start = 0, end = this.length): T[] {
    const normalize = (index: number) =>
      Math.min(
        this.length,
        Math.max(
          0,
          index < 0 ? this.length + Math.trunc(index) : Math.trunc(index),
        ),
      );
    const result: T[] = [];
    for (let index = normalize(start); index < normalize(end); index++) {
      result.push(this.at(index)!);
    }
    return result;
  }

  indexOf(value: T, fromIndex = 0): number {
    for (
      let index = Math.max(
        0,
        fromIndex < 0 ? this.length + fromIndex : fromIndex,
      );
      index < this.length;
      index++
    ) {
      if (this.at(index) === value) return index;
    }
    return -1;
  }

  map<U>(callback: (value: T, index: number) => U): U[] {
    const result: U[] = [];
    this.forEach((value, index) => result.push(callback(value, index)));
    return result;
  }

  filter(callback: (value: T, index: number) => unknown): T[] {
    const result: T[] = [];
    this.forEach((value, index) => {
      if (callback(value, index)) result.push(value);
    });
    return result;
  }

  find(callback: (value: T, index: number) => unknown): T | undefined {
    for (let index = 0; index < this.length; index++) {
      const value = this.at(index)!;
      if (callback(value, index)) return value;
    }
    return undefined;
  }

  flatMap<U>(callback: (value: T, index: number) => U | readonly U[]): U[] {
    const result: U[] = [];
    this.forEach((value, index) => {
      const mapped = callback(value, index);
      if (Array.isArray(mapped)) result.push(...mapped);
      else result.push(mapped as U);
    });
    return result;
  }

  forEach(callback: (value: T, index: number) => void): void {
    for (let index = 0; index < this.length; index++)
      callback(this.at(index)!, index);
  }

  toArray(): T[] {
    return this.slice();
  }
}

const SEGMENT_SIZE = 4096;

/** Existing slots are write-once; only a new backing may reorder or replace them. */
class MetadataBacking {
  readonly segments: PagedEntryMetadata[][] = [];
  readonly positions = new IdPositionVector();
  length = 0;
  elasticCount = 0;

  append(entries: readonly PagedEntryMetadata[]): void {
    const incomingIds = new Set<number>();
    for (const entry of entries) {
      if (!Number.isSafeInteger(entry._id) || entry._id < 0) {
        throw new Error(`Invalid metadata ID: ${entry._id}`);
      }
      if (this.positions.get(entry._id) >= 0 || incomingIds.has(entry._id)) {
        throw new Error(`Duplicate metadata ID: ${entry._id}`);
      }
      incomingIds.add(entry._id);
    }
    for (const entry of entries) {
      const segmentIndex = Math.floor(this.length / SEGMENT_SIZE);
      const segment =
        this.segments[segmentIndex] ?? (this.segments[segmentIndex] = []);
      segment.push(entry);
      this.positions.set(entry._id, this.length++);
      if (entry.source.startsWith("elastic://")) this.elasticCount++;
    }
  }

  at(index: number): PagedEntryMetadata | undefined {
    return this.segments[Math.floor(index / SEGMENT_SIZE)]?.[
      index % SEGMENT_SIZE
    ];
  }
}

export class EntryIdSnapshot extends BoundedSequence<number> {
  constructor(
    private readonly backing: MetadataBacking,
    readonly length: number,
  ) {
    super();
  }

  at(index: number): number | undefined {
    if (index < 0) index += this.length;
    if (!Number.isInteger(index) || index < 0 || index >= this.length)
      return undefined;
    return this.backing.at(index)?._id;
  }

  positionOf(id: number): number {
    const position = this.backing.positions.get(id);
    return position < this.length ? position : -1;
  }

  override indexOf(id: number, fromIndex = 0): number {
    const position = this.positionOf(id);
    const start = Math.max(
      0,
      fromIndex < 0 ? this.length + fromIndex : fromIndex,
    );
    return position >= start ? position : -1;
  }

  /** Identity of the write-once backing proves the entire prefix, not just its ends. */
  isAppendOf(previous: EntryIdSnapshot): boolean {
    return this.backing === previous.backing && this.length >= previous.length;
  }
}

export class MetadataSnapshot extends BoundedSequence<PagedEntryMetadata> {
  readonly ids: EntryIdSnapshot;
  readonly elasticCount: number;

  constructor(
    private readonly backing: MetadataBacking,
    readonly length: number,
  ) {
    super();
    this.ids = new EntryIdSnapshot(backing, length);
    this.elasticCount = backing.elasticCount;
  }

  at(index: number): PagedEntryMetadata | undefined {
    if (index < 0) index += this.length;
    if (!Number.isInteger(index) || index < 0 || index >= this.length)
      return undefined;
    return this.backing.at(index);
  }

  isAppendOf(previous: MetadataSnapshot): boolean {
    return this.backing === previous.backing && this.length >= previous.length;
  }
}

/**
 * Publications are O(1) bounded views, never copies of the historical prefix.
 * Appends write only beyond every published view's bound. Reorder, clear and
 * payload enrichment replace the backing, keeping all old views stable.
 */
export class MetadataStore {
  private backing = new MetadataBacking();
  private published: MetadataSnapshot | undefined;

  get length(): number {
    return this.backing.length;
  }

  publish(): MetadataSnapshot {
    if (!this.published || this.published.length !== this.length) {
      this.published = new MetadataSnapshot(this.backing, this.length);
    }
    return this.published;
  }

  appendSorted(incoming: readonly PagedEntryMetadata[]): void {
    if (!incoming.length) return;
    const last = this.backing.at(this.length - 1);
    if (!last || compareByTimestampId(last, incoming[0]!) <= 0) {
      this.backing.append(incoming);
      return;
    }
    const merged: PagedEntryMetadata[] = [];
    let previousIndex = 0;
    let incomingIndex = 0;
    while (previousIndex < this.length && incomingIndex < incoming.length) {
      const previous = this.backing.at(previousIndex)!;
      if (compareByTimestampId(previous, incoming[incomingIndex]!) <= 0) {
        merged.push(previous);
        previousIndex++;
      } else {
        merged.push(incoming[incomingIndex++]!);
      }
    }
    while (previousIndex < this.length)
      merged.push(this.backing.at(previousIndex++)!);
    while (incomingIndex < incoming.length)
      merged.push(incoming[incomingIndex++]!);
    this.replace(merged);
  }

  replace(entries: readonly PagedEntryMetadata[]): void {
    const backing = new MetadataBacking();
    backing.append(entries);
    this.backing = backing;
    this.published = undefined;
  }

  clear(): void {
    this.replace([]);
  }
}
