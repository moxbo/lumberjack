import * as fs from "fs";

export interface FileWriterQueueLimits {
  maxQueuedBytes?: number;
  maxQueuedWrites?: number;
}

export class FileWriterBackpressureError extends Error {
  constructor() {
    super("File writer queue is full; await pending writes before retrying");
    this.name = "FileWriterBackpressureError";
  }
}

/**
 * Writes resolve only after appendFile completes. Await write() for backpressure.
 * Queue limits are opt-in: synchronous producers keep the historical lossless
 * admission behavior by default. At explicit limits, excess writes reject.
 * A single oversized write is allowed only when no other write is pending.
 */
export class AsyncFileWriter {
  protected filepath: string;
  private tail: Promise<void> = Promise.resolve();
  private pendingOperations = 0;
  private pendingWrites = 0;
  private pendingBytes = 0;
  private isWriting = false;
  private bytesWritten = 0;
  private writeCount = 0;
  private generation = 0;
  private accepting = true;
  private closePromise: Promise<void> | null = null;
  private firstFailure: Error | null = null;
  private readonly maxQueuedBytes: number;
  private readonly maxQueuedWrites: number;

  constructor(filepath: string, limits: FileWriterQueueLimits = {}) {
    this.filepath = filepath;
    this.maxQueuedBytes = limits.maxQueuedBytes ?? Infinity;
    this.maxQueuedWrites = limits.maxQueuedWrites ?? Infinity;
    if (this.maxQueuedBytes <= 0 || this.maxQueuedWrites < 1) {
      throw new Error("File writer queue limits must be positive");
    }
  }

  protected enqueueOperation(operation: () => Promise<void>): Promise<void> {
    if (!this.accepting) {
      return Promise.reject(new Error("File writer is closed"));
    }
    return this.enqueue(operation);
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    this.pendingOperations++;
    const result = this.tail.then(operation);
    this.tail = result.then(
      () => {
        this.pendingOperations--;
      },
      (error: unknown) => {
        this.pendingOperations--;
        this.firstFailure ??=
          error instanceof Error ? error : new Error(String(error));
      },
    );
    return result;
  }

  write(data: string): Promise<void> {
    if (!this.accepting) {
      return Promise.reject(new Error("File writer is closed"));
    }
    const bytes = Buffer.byteLength(data, "utf8");
    if (
      this.pendingWrites >= this.maxQueuedWrites ||
      (this.pendingWrites > 0 &&
        this.pendingBytes + bytes > this.maxQueuedBytes)
    ) {
      const error = new FileWriterBackpressureError();
      this.firstFailure ??= error;
      return Promise.reject(error);
    }
    this.pendingWrites++;
    this.pendingBytes += bytes;
    const generation = this.generation;
    return this.enqueue(async () => {
      try {
        if (generation !== this.generation) {
          throw new Error("File writer queue cleared");
        }
        this.isWriting = true;
        await this.writeData(data, bytes);
      } finally {
        this.isWriting = false;
        this.pendingWrites--;
        this.pendingBytes -= bytes;
      }
    });
  }

  protected async writeData(data: string, bytes: number): Promise<void> {
    await fs.promises.appendFile(this.filepath, data, "utf8");
    this.bytesWritten += bytes;
    this.writeCount++;
  }

  getQueueSize(): number {
    return this.pendingWrites - Number(this.isWriting);
  }

  isBusy(): boolean {
    return this.pendingOperations > 0;
  }

  getStats(): {
    filepath: string;
    bytesWritten: number;
    writeCount: number;
    queueSize: number;
    isWriting: boolean;
  } {
    return {
      filepath: this.filepath,
      bytesWritten: this.bytesWritten,
      writeCount: this.writeCount,
      queueSize: this.getQueueSize(),
      isWriting: this.isWriting,
    };
  }

  private async reportFailures(): Promise<void> {
    const error = this.firstFailure;
    this.firstFailure = null;
    if (error) throw error;
  }

  /** A barrier for all operations submitted before this call, including errors. */
  flush(): Promise<void> {
    // Do not record the barrier's own error again.
    const result = this.tail.then(() => this.reportFailures());
    this.tail = result.catch(() => {});
    return result;
  }

  /** Stop admission immediately, then drain all previously accepted operations. */
  close(): Promise<void> {
    if (!this.closePromise) {
      this.accepting = false;
      this.closePromise = this.flush();
    }
    return this.closePromise;
  }

  /** Cancel queued (not active) writes with explicit promise rejections. */
  clearQueue(): void {
    this.generation++;
  }
}
