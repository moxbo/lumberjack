import { describe, expect, it, vi } from "vitest";
import { AppendBlocks, WindowAppendQueue } from "../WindowAppendQueue";

const values = (blocks: AppendBlocks<number>) => [...blocks.batches(2)].flat();
const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

describe("AppendBlocks", () => {
  it("snapshots fixed-size blocks and retains only the unacknowledged suffix", () => {
    const blocks = new AppendBlocks<number>();
    const entries = Array.from({ length: 2050 }, (_, i) => i);
    blocks.enqueue(entries, 2050);
    entries.fill(-1);
    const drained = blocks.drain();
    blocks.requeue(drained, 1025);
    expect(values(blocks)).toEqual(
      Array.from({ length: 1025 }, (_, i) => i + 1025),
    );
  });

  it("rejects entire overflowing enqueues without dropping old or new prefixes", () => {
    const blocks = new AppendBlocks<number>();
    blocks.enqueue([1, 2, 3], 5);
    expect(() => blocks.enqueue([4, 5, 6], 5)).toThrow("capacity");
    blocks.cap(1);
    expect(values(blocks)).toEqual([1, 2, 3]);
    expect(() => [...blocks.batches(0)]).toThrow("positive integer");
  });
});

describe("WindowAppendQueue", () => {
  it("counts active delivery against count and byte capacity until persisted", async () => {
    const queue = new WindowAppendQueue<number>(() => 4, 8);
    const receipt = queue.enqueue([1, 2], 2);
    const gate = deferred();
    const flush = queue.flush(
      () => gate.promise,
      () => 0,
    );
    await Promise.resolve();
    expect(queue.length).toBe(2);
    expect(queue.bytes).toBe(8);
    await expect(queue.enqueue([3], 3)).rejects.toThrow("capacity");
    const acknowledged = vi.fn();
    void receipt.then(acknowledged);
    await Promise.resolve();
    expect(acknowledged).not.toHaveBeenCalled();
    gate.resolve();
    await Promise.all([flush, receipt]);
    expect(queue.length).toBe(0);
    expect(queue.bytes).toBe(0);
  });

  it("serializes flushes and retries only an explicitly retryable partial suffix", async () => {
    const queue = new WindowAppendQueue<number>();
    const firstReceipt = queue.enqueue([1, 2, 3, 4], 10);
    const gate = deferred();
    const first = queue.flush(
      () => gate.promise,
      () => 2,
    );
    await Promise.resolve();
    const nextReceipt = queue.enqueue([5, 6], 10);
    const deliver = vi.fn(async () => {});
    expect(queue.flush(deliver, () => 0)).toBe(first);
    gate.reject(new Error("retryable failure"));
    await expect(first).rejects.toThrow("retryable");
    expect(deliver).not.toHaveBeenCalled();
    expect(queue.length).toBe(4);
    const received: number[][] = [];
    await queue.flush(
      async (blocks) => {
        received.push(values(blocks));
      },
      () => 0,
    );
    await Promise.all([firstReceipt, nextReceipt]);
    expect(received).toEqual([[3, 4, 5, 6]]);
    expect(queue.bytes).toBe(0);
  });

  it("drains newer admissions in order without accumulating concurrent flush waiters", async () => {
    const queue = new WindowAppendQueue<number>();
    const firstReceipt = queue.enqueue([1]);
    const gate = deferred();
    const received: number[][] = [];
    const flush = queue.flush(
      async (blocks) => {
        received.push(values(blocks));
        await gate.promise;
      },
      () => 0,
    );
    await Promise.resolve();
    const secondReceipt = queue.enqueue([2]);
    for (let i = 0; i < 1000; i++)
      expect(
        queue.flush(
          async () => {},
          () => 0,
        ),
      ).toBe(flush);
    gate.resolve();
    await Promise.all([flush, firstReceipt, secondReceipt]);
    expect(received).toEqual([[1], [2]]);
  });

  it("rejects all unacknowledged receipts on terminal storage failure without replay", async () => {
    const queue = new WindowAppendQueue<number>();
    const accepted = queue.enqueue([1, 2]);
    const rejected = expect(accepted).rejects.toThrow("disk full");
    await expect(
      queue.flush(
        async () => {
          throw new Error("disk full");
        },
        () => 1,
        false,
      ),
    ).rejects.toThrow("disk full");
    await rejected;
    expect(queue.length).toBe(0);
    expect(queue.bytes).toBe(0);
    await expect(queue.enqueue([3])).rejects.toThrow("disposed");
  });

  it("rejects receipts and releases unready windows after a bounded timeout", async () => {
    vi.useFakeTimers();
    try {
      const queue = new WindowAppendQueue<number>(() => 4, 8, 100);
      const receipt = expect(queue.enqueue([1])).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(100);
      await receipt;
      expect(queue.length).toBe(0);
      expect(queue.bytes).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not resurrect a disconnected window or falsely acknowledge its active receipt", async () => {
    const queue = new WindowAppendQueue<number>();
    const receipt = expect(queue.enqueue([1, 2])).rejects.toThrow("disposed");
    const gate = deferred();
    const flush = queue.flush(
      () => gate.promise,
      () => 0,
    );
    await Promise.resolve();
    queue.dispose();
    await receipt;
    gate.reject(new Error("window destroyed"));
    await expect(flush).rejects.toThrow("destroyed");
    expect(queue.length).toBe(0);
    await expect(queue.enqueue([4])).rejects.toThrow("disposed");
  });
});
