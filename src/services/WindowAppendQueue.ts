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
  length = 0;

  enqueue(entries: readonly T[], maxPending: number): void {
    if (!entries.length) return;
    if (this.length + entries.length > maxPending) {
      throw new Error(
        "Append queue capacity exceeded; retry after pending delivery",
      );
    }
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
    this.length += entries.length;
  }

  cap(maxPending: number): void {
    // Limits affect admission only; accepted entries must never be discarded.
    void maxPending;
  }

  private skip(count: number): void {
    let remaining = Math.min(this.length, Math.max(0, count));
    this.length -= remaining;
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
    this.head = this.tail = null;
    this.length = 0;
    return drained;
  }

  requeue(drained: AppendBlocks<T>, acknowledgedEntries: number): void {
    drained.skip(acknowledgedEntries);
    if (!drained.head || !drained.tail) return;
    drained.tail.next = this.head;
    this.head = drained.head;
    this.tail ??= drained.tail;
    this.length += drained.length;
    drained.head = drained.tail = null;
    drained.length = 0;
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
  private pendingCount = 0;
  private pendingBytes = 0;
  private limit = 8192;
  private receipts: Array<{
    remaining: number;
    bytes: number;
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(
    private readonly sizeOf: (entry: T) => number = () => 1,
    private readonly maxBytes = 32 * 1024 * 1024,
    private readonly timeoutMs = 30_000,
  ) {}

  get length(): number {
    return this.pendingCount;
  }

  get bytes(): number {
    return this.pendingBytes;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  get isFlushing(): boolean {
    return this.inFlight !== null;
  }

  enqueue(entries: readonly T[], maxPending = this.limit): Promise<void> {
    if (this.disposed)
      return Promise.reject(new Error("Window queue disposed"));
    if (!entries.length) return Promise.resolve();
    const bytes = entries.reduce((sum, entry) => sum + this.sizeOf(entry), 0);
    if (
      this.pendingCount + entries.length > Math.min(maxPending, this.limit) ||
      this.pendingBytes + bytes > this.maxBytes
    ) {
      return Promise.reject(
        new Error(
          "Window append capacity exceeded; retry after pending delivery",
        ),
      );
    }
    this.blocks.enqueue(entries, Infinity);
    this.pendingCount += entries.length;
    this.pendingBytes += bytes;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.dispose(new Error("Window append delivery timed out"));
      }, this.timeoutMs);
      this.receipts.push({
        remaining: entries.length,
        bytes,
        resolve,
        reject,
        timer,
      });
    });
  }

  cap(maxPending: number): void {
    this.limit = Math.min(8192, maxPending);
  }

  private acknowledge(count: number): void {
    while (count > 0 && this.receipts.length) {
      const receipt = this.receipts[0]!;
      const acknowledged = Math.min(count, receipt.remaining);
      receipt.remaining -= acknowledged;
      this.pendingCount -= acknowledged;
      count -= acknowledged;
      if (receipt.remaining) break;
      this.receipts.shift();
      this.pendingBytes -= receipt.bytes;
      clearTimeout(receipt.timer);
      receipt.resolve();
    }
  }

  flush(
    deliver: (blocks: AppendBlocks<T>) => Promise<void>,
    acknowledgedEntries: (error: unknown) => number,
    retry = true,
  ): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.disposed || !this.blocks.length) return Promise.resolve();
    this.inFlight = Promise.resolve()
      .then(async () => {
        while (!this.disposed && this.blocks.length) {
          const drained = this.blocks.drain();
          try {
            await deliver(drained);
            this.acknowledge(drained.length);
            // Let an awaiting producer submit its next chunk before deciding
            // that this drain is complete.
            await Promise.resolve();
          } catch (error) {
            const count = Math.min(
              drained.length,
              Math.max(0, acknowledgedEntries(error)),
            );
            this.acknowledge(count);
            if (retry && !this.disposed) this.blocks.requeue(drained, count);
            else
              this.dispose(
                error instanceof Error ? error : new Error(String(error)),
              );
            throw error;
          }
        }
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  dispose(error = new Error("Window queue disposed")): void {
    this.disposed = true;
    this.blocks.drain();
    this.pendingBytes = this.pendingCount = 0;
    for (const receipt of this.receipts) {
      clearTimeout(receipt.timer);
      receipt.reject(error);
    }
    this.receipts = [];
  }
}
