interface EntryBlock<T> {
  entries: readonly T[];
  offset: number;
  next: EntryBlock<T> | null;
}

const BLOCK_SIZE = 1024;

/** Copies only incoming entries; draining and retrying transfer block ownership. */
export class AppendBlocks<T> {
  private head: EntryBlock<T> | null = null;
  private tail: EntryBlock<T> | null = null;
  private newestEnqueueSize = 0;
  length = 0;

  enqueue(entries: readonly T[], maxPending: number): void {
    if (!entries.length) return;
    // Fixed-size blocks avoid retaining an entire old bulk array when capping
    // leaves only a few entries from its end.
    for (let start = 0; start < entries.length; start += BLOCK_SIZE) {
      const block: EntryBlock<T> = {
        entries: entries.slice(start, start + BLOCK_SIZE),
        offset: 0,
        next: null,
      };
      if (this.tail) this.tail.next = block;
      else this.head = block;
      this.tail = block;
    }
    this.newestEnqueueSize = entries.length;
    this.length += entries.length;
    this.cap(maxPending);
  }

  cap(maxPending: number): void {
    // Even an adaptive limit reduction must retain the latest bulk enqueue.
    this.skip(
      Math.max(0, this.length - Math.max(maxPending, this.newestEnqueueSize)),
    );
  }

  private skip(count: number): void {
    let remaining = Math.min(this.length, Math.max(0, count));
    this.length -= remaining;
    this.newestEnqueueSize = Math.min(this.newestEnqueueSize, this.length);
    while (this.head && remaining > 0) {
      const available = this.head.entries.length - this.head.offset;
      if (remaining < available) {
        this.head.offset += remaining;
        remaining = 0;
      } else {
        remaining -= available;
        this.head = this.head.next;
      }
    }
    if (!this.head) this.tail = null;
  }

  drain(): AppendBlocks<T> {
    const drained = new AppendBlocks<T>();
    drained.head = this.head;
    drained.tail = this.tail;
    drained.length = this.length;
    drained.newestEnqueueSize = this.newestEnqueueSize;
    this.head = this.tail = null;
    this.length = 0;
    this.newestEnqueueSize = 0;
    return drained;
  }

  requeue(drained: AppendBlocks<T>, acknowledgedEntries: number): void {
    drained.skip(acknowledgedEntries);
    if (!drained.head || !drained.tail) return;
    if (!this.head) this.newestEnqueueSize = drained.newestEnqueueSize;
    drained.tail.next = this.head;
    this.head = drained.head;
    this.tail ??= drained.tail;
    this.length += drained.length;
    drained.head = drained.tail = null;
    drained.length = 0;
    drained.newestEnqueueSize = 0;
  }

  *batches(batchSize: number): IterableIterator<T[]> {
    if (!Number.isInteger(batchSize) || batchSize < 1) {
      throw new Error("Batch size must be a positive integer");
    }
    let batch: T[] = [];
    for (let block = this.head; block; block = block.next) {
      for (let i = block.offset; i < block.entries.length; i++) {
        batch.push(block.entries[i]!);
        if (batch.length === batchSize) {
          yield batch;
          batch = [];
        }
      }
    }
    if (batch.length) yield batch;
  }
}

/** One in-flight drain per window keeps retry suffixes ahead of newer entries. */
export class WindowAppendQueue<T> {
  private readonly blocks = new AppendBlocks<T>();
  private inFlight: Promise<void> | null = null;
  private disposed = false;

  get length(): number {
    return this.blocks.length;
  }

  enqueue(entries: readonly T[], maxPending: number): void {
    if (!this.disposed) this.blocks.enqueue(entries, maxPending);
  }

  cap(maxPending: number): void {
    this.blocks.cap(maxPending);
  }

  async flush(
    deliver: (blocks: AppendBlocks<T>) => Promise<void>,
    acknowledgedEntries: (error: unknown) => number,
  ): Promise<void> {
    while (this.inFlight) await this.inFlight;
    if (this.disposed || !this.length) return;
    const drained = this.blocks.drain();
    const delivery = Promise.resolve().then(() => deliver(drained));
    this.inFlight = delivery;
    try {
      await delivery;
    } catch (error) {
      if (!this.disposed) {
        this.blocks.requeue(drained, acknowledgedEntries(error));
      }
      throw error;
    } finally {
      this.inFlight = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.blocks.drain();
  }
}
