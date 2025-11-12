/**
 * AsyncFileWriter
 * Non-blocking file I/O service with queue management
 * Prevents main thread blocking during file operations
 */

import * as fs from "fs";
import log from "electron-log/main";

interface WriteTask {
  data: string;
  resolve: () => void;
  reject: (error: Error) => void;
}

/**
 * AsyncFileWriter provides non-blocking file writes with automatic queue management
 */
export class AsyncFileWriter {
  private queue: WriteTask[] = [];
  private isWriting = false;
  private filepath: string;
  private bytesWritten = 0;
  private writeCount = 0;

  constructor(filepath: string) {
    this.filepath = filepath;
  }

  /**
   * Queue a write operation
   */
  async write(data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push({ data, resolve, reject });
      this.processQueue();
    });
  }

  /**
   * Process the write queue
   */
  private async processQueue(): Promise<void> {
    if (this.isWriting || this.queue.length === 0) {
      return;
    }

    this.isWriting = true;
    const task = this.queue.shift();

    if (!task) {
      this.isWriting = false;
      return;
    }

    try {
      await fs.promises.appendFile(this.filepath, task.data, "utf8");
      this.bytesWritten += task.data.length;
      this.writeCount++;
      task.resolve();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error("[async-file-writer] Write error:", {
        filepath: this.filepath,
        error: err.message,
        queueSize: this.queue.length,
      });
      task.reject(err);
    } finally {
      this.isWriting = false;
      // Continue processing queue
      if (this.queue.length > 0) {
        this.processQueue();
      }
    }
  }

  /**
   * Get current queue size
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Check if writer is busy
   */
  isBusy(): boolean {
    return this.isWriting || this.queue.length > 0;
  }

  /**
   * Get write statistics
   */
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
      queueSize: this.queue.length,
      isWriting: this.isWriting,
    };
  }

  /**
   * Wait for all pending writes to complete
   */
  async flush(): Promise<void> {
    // Keep processing until queue is empty
    while (this.queue.length > 0 || this.isWriting) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /**
   * Clear the queue without processing
   */
  clearQueue(): void {
    const cleared = this.queue.length;
    this.queue.forEach((task) => {
      task.reject(new Error("Queue cleared"));
    });
    this.queue = [];
    log.warn("[async-file-writer] Queue cleared", {
      filepath: this.filepath,
      tasksCleared: cleared,
    });
  }
}
