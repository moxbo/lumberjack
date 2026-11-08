import type { PagedEntryMetadata } from "../hooks/useEntryManagement";
import { BoundedSequence } from "./readonlySequence";
import { SortedStore, type SortedSnapshot } from "./sortedSequence";

export type { ReadonlySequence } from "./readonlySequence";
export { EntryIdSnapshot } from "./sortedSequence";

export class MetadataSnapshot extends BoundedSequence<PagedEntryMetadata> {
  readonly ids;
  readonly length: number;

  constructor(
    private readonly snapshot: SortedSnapshot<PagedEntryMetadata>,
    readonly elasticCount: number,
  ) {
    super();
    this.ids = snapshot.ids;
    this.length = snapshot.length;
  }

  at(index: number): PagedEntryMetadata | undefined {
    return this.snapshot.at(index);
  }

  override *[Symbol.iterator](): IterableIterator<PagedEntryMetadata> {
    yield* this.snapshot;
  }

  isAppendOf(previous: MetadataSnapshot): boolean {
    return this.snapshot.isAppendOf(previous.snapshot);
  }
}

export class MetadataStore {
  private store = new SortedStore<PagedEntryMetadata>();
  private elasticCount = 0;
  private published: MetadataSnapshot | undefined;

  get length(): number {
    return this.store.length;
  }

  publish(): MetadataSnapshot {
    return (this.published ??= new MetadataSnapshot(
      this.store.publish(),
      this.elasticCount,
    ));
  }

  appendSorted(incoming: readonly PagedEntryMetadata[]): void {
    if (!incoming.length) return;
    this.store.appendSorted(incoming);
    for (const entry of incoming)
      if (entry.source.startsWith("elastic://")) this.elasticCount++;
    this.published = undefined;
  }

  replace(entries: readonly PagedEntryMetadata[]): void {
    const store = new SortedStore<PagedEntryMetadata>();
    store.appendSorted(entries);
    this.store = store;
    this.elasticCount = 0;
    for (const entry of entries)
      if (entry.source.startsWith("elastic://")) this.elasticCount++;
    this.published = undefined;
  }

  clear(): void {
    this.replace([]);
  }
}
