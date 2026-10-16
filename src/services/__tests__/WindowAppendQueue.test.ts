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
  it("removes only failed-origin blocks after a partially acknowledged prefix", () => {
    const blocks = new AppendBlocks<number>();
    blocks.enqueue([1, 2], 3000, "import");
    blocks.enqueue(
      Array.from({ length: 2050 }, () => -1),
      3000,
      "live",
    );
    blocks.enqueue([3, 4], 3000, "import");
    const drained = blocks.drain();
    expect(drained.failureGroupAt(2)).toBe("live");
    blocks.requeue(drained, 1);
    blocks.removeFailureGroup("live");
    expect(values(blocks)).toEqual([2, 3, 4]);
    expect(blocks.length).toBe(3);
    expect(blocks.failureGroupAt(2)).toBe("import");
    expect(blocks.failureGroupAt(3)).toBeUndefined();
    blocks.enqueue([5], 3000, "live");
    blocks.removeFailureGroup("import");
    expect(values(blocks)).toEqual([5]);
    blocks.removeFailureGroup("live");
    blocks.enqueue([6], 3000, "import");
    expect(values(blocks)).toEqual([6]);
  });

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
  it.each(["import", "live"])(
    "keeps an acknowledged %s receipt successful while rejecting later live receipts",
    async (firstOrigin) => {
      const queue = new WindowAppendQueue<number>();
      const capped = new Error("live cap reached");
      const receipts = [
        queue.enqueue([1, 2], 10, firstOrigin),
        queue.enqueue([3, 4], 10, "live"),
        queue.enqueue([5, 6], 10, "import"),
        queue.enqueue([7], 10, "live"),
      ];
      const outcomes = Promise.allSettled(receipts);
      const attempted: number[][] = [];
      await queue.flush(
        async (blocks) => {
          const batch = values(blocks);
          if (batch.includes(3)) {
            attempted.push(batch.slice(0, 4));
            throw capped;
          }
          attempted.push(batch);
        },
        () => 2,
        false,
        (error) => (error === capped ? "live" : undefined),
      );
      expect(attempted).toEqual([
        [1, 2, 3, 4],
        [5, 6],
      ]);
      expect(await outcomes).toEqual([
        { status: "fulfilled", value: undefined },
        { status: "rejected", reason: capped },
        { status: "fulfilled", value: undefined },
        { status: "rejected", reason: capped },
      ]);
      expect(queue.isDisposed).toBe(false);
      expect(queue.length).toBe(0);
      expect(queue.bytes).toBe(0);
      const restarted = queue.enqueue([8], 10, "live");
      await queue.flush(
        async (blocks) => {
          attempted.push(values(blocks));
        },
        () => 0,
        false,
      );
      await restarted;
      expect(attempted.at(-1)).toEqual([8]);
    },
  );

  it("rejects a partially acknowledged producer without replaying its prefix or corrupting byte accounting", async () => {
    const queue = new WindowAppendQueue<number>(() => 4, 20);
    const capped = new Error("live cap reached after prefix");
    const outcomes = Promise.allSettled([
      queue.enqueue([1, 2, 3, 4], 10, "live"),
      queue.enqueue([5], 10, "import"),
    ]);
    const attempts: number[][] = [];
    await queue.flush(
      async (blocks) => {
        const batch = values(blocks);
        if (batch.includes(1)) {
          attempts.push(batch.slice(0, 4));
          throw capped;
        }
        expect(queue.length).toBe(1);
        expect(queue.bytes).toBe(4);
        attempts.push(batch);
      },
      () => 2,
      false,
      (error) => (error === capped ? "live" : undefined),
    );
    expect(attempts).toEqual([[1, 2, 3, 4], [5]]);
    expect(await outcomes).toEqual([
      { status: "rejected", reason: capped },
      { status: "fulfilled", value: undefined },
    ]);
    expect(queue.length).toBe(0);
    expect(queue.bytes).toBe(0);
  });

  it("also isolates live receipts admitted while the failing delivery is in flight", async () => {
    const queue = new WindowAppendQueue<number>();
    const capped = new Error("live cap reached");
    const gate = deferred();
    const first = queue.enqueue([1, 2], 10, "live");
    const firstResult = Promise.allSettled([first]);
    const delivered: number[][] = [];
    const flushing = queue.flush(
      async (blocks) => {
        const batch = values(blocks);
        if (batch.includes(1)) {
          await gate.promise;
          throw capped;
        }
        delivered.push(batch);
      },
      () => 0,
      false,
      () => "live",
    );
    await Promise.resolve();
    const imported = queue.enqueue([3, 4], 10, "import");
    const lateLive = queue.enqueue([5, 6], 10, "live");
    const lateResults = Promise.allSettled([imported, lateLive]);
    gate.resolve();
    await flushing;
    expect(await firstResult).toEqual([{ status: "rejected", reason: capped }]);
    expect(await lateResults).toEqual([
      { status: "fulfilled", value: undefined },
      { status: "rejected", reason: capped },
    ]);
    expect(delivered).toEqual([[3, 4]]);
    expect(queue.length).toBe(0);
    expect(queue.bytes).toBe(0);
  });

  it("shares count and byte limits across origins and releases only failed receipts", async () => {
    const queue = new WindowAppendQueue<number>((value) => value, 10);
    queue.cap(2);
    const capped = new Error("live cap reached");
    const live = queue.enqueue([6], 2, "live");
    const liveResult = Promise.allSettled([live]);
    const imported = queue.enqueue([4], 2, "import");
    await expect(queue.enqueue([0], 2, "import")).rejects.toThrow("capacity");
    const gate = deferred();
    const received: number[][] = [];
    let delivery = 0;
    const flushing = queue.flush(
      async (blocks) => {
        if (delivery++ === 0) throw capped;
        received.push(values(blocks));
        await gate.promise;
      },
      () => 0,
      false,
      () => "live",
    );
    await vi.waitFor(() => expect(received).toEqual([[4]]));
    expect(await liveResult).toEqual([{ status: "rejected", reason: capped }]);
    expect(queue.length).toBe(1);
    expect(queue.bytes).toBe(4);
    const next = queue.enqueue([6], 2, "import");
    await expect(queue.enqueue([0], 2, "live")).rejects.toThrow("capacity");
    queue.cap(3);
    await expect(queue.enqueue([1], 3, "import")).rejects.toThrow("capacity");
    expect(queue.bytes).toBe(10);
    gate.resolve();
    await Promise.all([flushing, imported, next]);
    expect(received).toEqual([[4], [6]]);
    expect(queue.length).toBe(0);
    expect(queue.bytes).toBe(0);
  });

  it.each(["storage", "misclassified-import"])(
    "keeps %s failures terminal across origins without retrying",
    async (scenario) => {
      const queue = new WindowAppendQueue<number>();
      const failure = new Error("storage failed");
      const outcomes = Promise.allSettled([
        queue.enqueue([1], 10, "import"),
        queue.enqueue([2], 10, "live"),
      ]);
      const deliver = vi.fn(async () => {
        throw failure;
      });
      await expect(
        queue.flush(
          deliver,
          () => 0,
          false,
          () => (scenario === "storage" ? undefined : "live"),
        ),
      ).rejects.toBe(failure);
      expect(deliver).toHaveBeenCalledOnce();
      expect(await outcomes).toEqual([
        { status: "rejected", reason: failure },
        { status: "rejected", reason: failure },
      ]);
      expect(queue.isDisposed).toBe(true);
      expect(queue.length).toBe(0);
      expect(queue.bytes).toBe(0);
    },
  );

  it("does not strand an admission between the final ACK and flush completion", async () => {
    vi.useFakeTimers();
    const queue = new WindowAppendQueue<number>();
    const received: number[][] = [];
    const deliver = async (blocks: AppendBlocks<number>) => {
      received.push(values(blocks));
    };
    const flushIfIdle = () => {
      if (!queue.isFlushing) return queue.flush(deliver, () => 0, false);
      return Promise.resolve();
    };
    try {
      const firstReceipt = queue.enqueue([1]);
      const next = firstReceipt.then(async () => {
        // The source continues through an async persistence callback after ACK.
        await Promise.resolve();
        const receipt = queue.enqueue([2]);
        void flushIfIdle();
        await receipt;
      });
      void next.catch(() => {});
      const flush = flushIfIdle();
      await vi.advanceTimersByTimeAsync(0);
      expect(received).toEqual([[1], [2]]);
      await Promise.all([flush, next]);
      expect(queue.length).toBe(0);
    } finally {
      queue.dispose();
      vi.useRealTimers();
    }
  });

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

  it("defers the receipt deadline while the consumer reports progress", async () => {
    vi.useFakeTimers();
    try {
      const queue = new WindowAppendQueue<number>(() => 4, 8, 100);
      const rejected = vi.fn();
      const resolved = vi.fn();
      void queue.enqueue([1]).then(resolved, rejected);
      await vi.advanceTimersByTimeAsync(80);
      queue.touch();
      await vi.advanceTimersByTimeAsync(80);
      expect(rejected).not.toHaveBeenCalled();
      expect(queue.isDisposed).toBe(false);
      await vi.advanceTimersByTimeAsync(30);
      expect(rejected).toHaveBeenCalledOnce();
      expect(resolved).not.toHaveBeenCalled();
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
