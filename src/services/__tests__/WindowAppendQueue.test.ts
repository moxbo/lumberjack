import { describe, expect, it, vi } from "vitest";
import { AppendBlocks, WindowAppendQueue } from "../WindowAppendQueue";

const values = (blocks: AppendBlocks<number>) => [...blocks.batches(2)].flat();

describe("AppendBlocks", () => {
  it("snapshots incoming arrays and retries across fixed-size block boundaries", () => {
    const blocks = new AppendBlocks<number>();
    const entries = Array.from({ length: 2050 }, (_, i) => i);
    blocks.enqueue(entries, 10);
    entries.fill(-1);
    const drained = blocks.drain();
    blocks.requeue(drained, 1025);
    expect(values(blocks)).toEqual(
      Array.from({ length: 1025 }, (_, i) => i + 1025),
    );
  });

  it("caps only old overflow across block boundaries", () => {
    const blocks = new AppendBlocks<number>();
    blocks.enqueue([1, 2, 3], 5);
    blocks.enqueue([4, 5], 5);
    blocks.enqueue([6, 7, 8], 5);
    expect(blocks.length).toBe(5);
    expect([...blocks.batches(2)]).toEqual([[4, 5], [6, 7], [8]]);
  });

  it("never caps the current bulk batch, including adaptive limit reductions", () => {
    const blocks = new AppendBlocks<number>();
    blocks.enqueue([0], 2);
    const bulk = Array.from({ length: 150_000 }, (_, i) => i + 1);
    blocks.enqueue(bulk, 2);
    blocks.cap(1);
    expect(blocks.length).toBe(bulk.length);
    expect(values(blocks)).toEqual(bulk);
    blocks.enqueue([150_001], 2);
    expect(values(blocks)).toEqual([150_000, 150_001]);
  });

  it("drains without losing new enqueues and prepends only the unacked suffix", () => {
    const blocks = new AppendBlocks<number>();
    blocks.enqueue([1, 2, 3], 10);
    blocks.enqueue([4, 5, 6], 10);
    const drained = blocks.drain();
    expect(blocks.length).toBe(0);
    blocks.enqueue([7, 8], 2);
    blocks.requeue(drained, 4);
    expect(values(blocks)).toEqual([5, 6, 7, 8]);
    expect(drained.length).toBe(0);
    const retry = blocks.drain();
    blocks.requeue(retry, 1);
    expect(values(blocks)).toEqual([6, 7, 8]);
  });

  it("handles full acknowledgement, empty blocks and invalid batch sizes", () => {
    const blocks = new AppendBlocks<number>();
    blocks.enqueue([], 1);
    blocks.enqueue([1, 2], 1);
    blocks.requeue(blocks.drain(), 2);
    expect(blocks.length).toBe(0);
    expect(values(blocks)).toEqual([]);
    expect(() => [...blocks.batches(0)]).toThrow("positive integer");
    blocks.enqueue([3], 1);
    expect(values(blocks)).toEqual([3]);
  });
});

describe("WindowAppendQueue", () => {
  it("serializes concurrent flushes and retries only the partial-ACK suffix", async () => {
    const queue = new WindowAppendQueue<number>();
    queue.enqueue([1, 2, 3, 4], 2);
    let reject!: (error: Error) => void;
    const pending = new Promise<void>((_, fail) => {
      reject = fail;
    });
    const firstDelivery = vi.fn(() => pending);
    const first = queue.flush(firstDelivery, () => 2);
    await Promise.resolve();
    queue.enqueue([5, 6], 2);
    const secondDelivery = vi.fn(async () => {});
    const second = queue.flush(secondDelivery, () => 0);
    reject(new Error("ACK timeout"));
    await expect(first).rejects.toThrow("ACK timeout");
    await expect(second).rejects.toThrow("ACK timeout");
    expect(secondDelivery).not.toHaveBeenCalled();
    const received: number[][] = [];
    await queue.flush(
      async (blocks) => {
        received.push(values(blocks));
      },
      () => 0,
    );
    expect(received).toEqual([[3, 4, 5, 6]]);
    expect(queue.length).toBe(0);
  });

  it("awaits newer entries after a successful in-flight flush", async () => {
    const queue = new WindowAppendQueue<number>();
    queue.enqueue([1], 10);
    let resolve!: () => void;
    const pending = new Promise<void>((done) => {
      resolve = done;
    });
    const received: number[][] = [];
    const first = queue.flush(
      async (blocks) => {
        received.push(values(blocks));
        await pending;
      },
      () => 0,
    );
    await Promise.resolve();
    queue.enqueue([2], 10);
    const second = queue.flush(
      async (blocks) => {
        received.push(values(blocks));
      },
      () => 0,
    );
    resolve();
    await Promise.all([first, second]);
    expect(received).toEqual([[1], [2]]);
  });

  it("does not resurrect a disposed window queue after a failed delivery", async () => {
    const queue = new WindowAppendQueue<number>();
    queue.enqueue([1, 2], 10);
    await expect(
      queue.flush(
        async () => {
          queue.enqueue([3], 10);
          queue.dispose();
          throw new Error("window destroyed");
        },
        () => 0,
      ),
    ).rejects.toThrow("window destroyed");
    queue.enqueue([4], 10);
    const deliver = vi.fn(async () => {});
    await queue.flush(deliver, () => 0);
    expect(queue.length).toBe(0);
    expect(deliver).not.toHaveBeenCalled();
  });
});
