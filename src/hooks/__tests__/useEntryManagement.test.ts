/* eslint-disable @typescript-eslint/unbound-method -- Repository methods are mocked and inspected, not invoked unbound. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMetadataPublishDelay,
  useEntryManagement,
} from "../useEntryManagement";
import { pagedLogRepository } from "../../store/paged/session";
import { IPC_BATCH_SIZE } from "../../constants";
import type { IngestionLimits } from "../ingestionBudget";

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  cleanup: undefined as (() => void) | undefined,
}));

// Exercise the actual asynchronous ingestion hook without a DOM test dependency.
vi.mock("preact/hooks", () => ({
  useRef: <T>(initial: T) => {
    const index = hooks.cursor++;
    return (hooks.slots[index] ??= { current: initial }) as { current: T };
  },
  useState: <T>(initial: T | (() => T)) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) {
      hooks.slots[index] =
        typeof initial === "function" ? (initial as () => T)() : initial;
    }
    return [
      hooks.slots[index],
      (next: T | ((previous: T) => T)) => {
        hooks.slots[index] =
          typeof next === "function"
            ? (next as (previous: T) => T)(hooks.slots[index] as T)
            : next;
      },
    ];
  },
  useCallback: <T>(callback: T) => callback,
  useEffect: (effect: () => () => void) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) {
      hooks.slots[index] = true;
      hooks.cleanup = effect();
    }
  },
}));
vi.mock("../../store/paged/session", async () => {
  const { InMemoryLogRepository } =
    await import("../../store/paged/InMemoryLogRepository");
  const repository = new InMemoryLogRepository();
  return {
    pagedLogRepository: {
      databaseName: "test-paged",
      isAvailable: vi.fn(() => true),
      clear: vi.fn(() => repository.clear()),
      destroy: vi.fn(() => repository.destroy()),
      putMany: vi.fn(repository.putMany.bind(repository)),
      findExistingSignatures: vi.fn(
        repository.findExistingSignatures.bind(repository),
      ),
      getPayloads: vi.fn(repository.getPayloads.bind(repository)),
    },
    startPagedSessionLifecycle: () => () => undefined,
  };
});
vi.mock("../../store/loggingStore", () => ({
  LoggingStore: { addEvents: vi.fn(), reset: vi.fn() },
}));
vi.mock("../../renderer/LogRow", () => ({ clearHighlightCache: vi.fn() }));
vi.mock("../../utils/logger", () => ({
  default: { warn: vi.fn(), error: vi.fn() },
}));

function render(ingestionLimits?: Partial<IngestionLimits>) {
  hooks.cursor = 0;
  return useEntryManagement({ marksMap: {}, ingestionLimits });
}

function input(timestamp: number, message = `message-${timestamp}`) {
  return { timestamp, message, source: "test.log" };
}

beforeEach(() => {
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.cleanup = undefined;
  vi.mocked(pagedLogRepository.isAvailable).mockReturnValue(true);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("getMetadataPublishDelay", () => {
  it("reduces render frequency as the dataset grows", () => {
    expect(getMetadataPublishDelay(99_999)).toBe(50);
    expect(getMetadataPublishDelay(100_000)).toBe(100);
    expect(getMetadataPublishDelay(499_999)).toBe(100);
    expect(getMetadataPublishDelay(500_000)).toBe(250);
  });

  describe("useEntryManagement publications", () => {
    it("publishes stable snapshots and preserves metadata/signature lookups", async () => {
      let hook = render();
      const empty = hook.entries;
      await hook.appendEntriesAsync([input(1)]);
      hook = render();
      const first = hook.entries;
      const signature = first.at(0)!.signature;
      expect(hook.getMetadata(1)).toBe(first.at(0));
      expect(hook.getIdsBySignature(signature)).toBe(1);
      await hook.appendEntriesAsync([input(2)]);
      expect(render().entries).toBe(first);
      await vi.advanceTimersByTimeAsync(50);
      hook = render();
      expect(empty.length).toBe(0);
      expect(first.length).toBe(1);
      expect([...first.ids]).toEqual([1]);
      expect([...hook.entries.ids]).toEqual([1, 2]);
      expect(hook.entries.isAppendOf(first)).toBe(true);
    });

    it("reorders late entries and clears pending publications before reusing IDs", async () => {
      let hook = render();
      await hook.appendEntriesAsync([input(10), input(30)]);
      hook = render();
      const previous = hook.entries;
      await hook.appendEntriesAsync([input(20)]);
      await vi.advanceTimersByTimeAsync(50);
      hook = render();
      expect([...hook.entries.ids]).toEqual([1, 3, 2]);
      expect(hook.entries.isAppendOf(previous)).toBe(false);
      await hook.appendEntriesAsync([input(40)]);
      await hook.clearEntries();
      const cleared = render();
      expect(cleared.entries.length).toBe(0);
      expect(cleared.getMetadata(1)).toBeUndefined();
      expect(
        cleared.getIdsBySignature(previous.at(0)!.signature),
      ).toBeUndefined();
      await cleared.appendEntriesAsync([input(100)]);
      await vi.advanceTimersByTimeAsync(50);
      hook = render();
      expect([...hook.entries.ids]).toEqual([1]);
      expect(hook.entries.at(0)?.timestamp).toBe(100);
      expect([...previous.ids]).toEqual([1, 2]);
      expect(hook.entries.isAppendOf(previous)).toBe(false);
    });

    it("pauses on quota without loading history and preserves readable rows and snapshots", async () => {
      let hook = render();
      await hook.appendEntriesAsync([input(1, "old payload")]);
      hook = render();
      const paged = hook.entries;
      expect(paged.at(0)?.message).toBeUndefined();
      vi.spyOn(pagedLogRepository, "putMany").mockRejectedValueOnce(
        new Error("quota"),
      );
      await expect(
        hook.appendEntriesAsync([input(2, "new payload")]),
      ).rejects.toThrow("quota");
      const originalError = render().storageError;
      await expect(hook.appendEntriesAsync([input(3)])).rejects.toThrow(
        "quota",
      );
      expect(render().storageError).not.toBe(originalError);
      expect(render().storageError?.cause).toBe(originalError);
      await vi.advanceTimersByTimeAsync(50);
      hook = render();
      expect(hook.usesPagedStorage).toBe(true);
      expect(hook.repository).toBe(pagedLogRepository);
      expect(pagedLogRepository.putMany).toHaveBeenCalledTimes(2);
      expect(pagedLogRepository.getPayloads).not.toHaveBeenCalled();
      expect(hook.entries).toBe(paged);
      expect(hook.storageError?.message).toContain("quota");
      expect(hook.storageError?.message).toContain("Ingestion is paused");
      expect((await hook.repository.getPayloads([1])).get(1)?.message).toBe(
        "old payload",
      );
      expect(paged.at(0)?.message).toBeUndefined();
      expect(paged.length).toBe(1);
      await hook.clearEntries();
      await hook.appendEntriesAsync([input(4)]);
      expect([...render().entries.ids]).toEqual([1]);
    });

    it("rejects stale producers and does not mix generations when clear races a write", async () => {
      let hook = render();
      await hook.appendEntriesAsync([input(1)]);
      hook = render();
      const paged = hook.entries;
      let releaseWrite!: () => void;
      const writeGate = new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
      const originalPut = pagedLogRepository.putMany.bind(pagedLogRepository);
      let writeStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        writeStarted = resolve;
      });
      vi.spyOn(pagedLogRepository, "putMany").mockImplementationOnce(
        async (entries) => {
          writeStarted();
          await writeGate;
          return originalPut(entries);
        },
      );
      const append = hook
        .appendEntriesAsync([input(2)])
        .catch((error) => error);
      await started;
      const generation = hook.getDataGeneration();
      const clear = hook.clearEntries();
      expect(hook.getDataGeneration()).toBe(generation + 1);
      expect(await append).toBeInstanceOf(Error);
      await expect(hook.appendEntriesAsync([input(99)])).rejects.toThrow(
        "paused",
      );
      releaseWrite();
      await clear;
      await vi.advanceTimersByTimeAsync(100);
      hook = render();
      expect(hook.entries.length).toBe(0);
      expect(hook.usesPagedStorage).toBe(true);
      expect(hook.getMetadata(1)).toBeUndefined();
      expect(paged.length).toBe(1);
      await hook.appendEntriesAsync([input(3)]);
      expect(render().entries.at(0)?.timestamp).toBe(3);
    });

    it("rejects a superseded clear instead of allowing its caller to resume ingestion", async () => {
      const hook = render();
      await hook.appendEntriesAsync([input(1)]);
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      vi.mocked(pagedLogRepository.clear).mockImplementationOnce(async () => {
        started();
        await gate;
      });
      const first = hook.clearEntries().catch((error: unknown) => error);
      await entered;
      const second = hook.clearEntries();
      release();
      expect(await first).toMatchObject({
        message: expect.stringContaining("cancelled"),
      });
      await second;
      await hook.appendEntriesAsync([input(2)]);
      expect([...render().entries.ids]).toEqual([1]);
    });

    it("keeps old metadata and remains paused after a failed clear", async () => {
      let hook = render();
      await hook.appendEntriesAsync([input(1)]);
      hook = render();
      const previous = hook.entries;
      vi.mocked(pagedLogRepository.clear).mockRejectedValueOnce(
        new Error("clear failed"),
      );
      await expect(hook.clearEntries()).rejects.toThrow("clear failed");
      await expect(hook.appendEntriesAsync([input(2)])).rejects.toThrow(
        "clear failed",
      );
      expect(render().entries).toBe(previous);
      expect((await hook.repository.getPayloads([1])).size).toBe(1);
      await hook.clearEntries();
      await hook.appendEntriesAsync([input(3)]);
      expect([...render().entries.ids]).toEqual([1]);
    });

    it.each(["unavailable", "initial clear"])(
      "fails closed during %s initialization",
      async (failure) => {
        if (failure === "unavailable") {
          vi.mocked(pagedLogRepository.isAvailable).mockReturnValue(false);
        } else {
          vi.mocked(pagedLogRepository.clear).mockRejectedValueOnce(
            new Error("initial clear"),
          );
        }
        const hook = render();
        await expect(hook.appendEntriesAsync([input(1)])).rejects.toThrow();
        expect(pagedLogRepository.putMany).not.toHaveBeenCalled();
        expect(pagedLogRepository.getPayloads).not.toHaveBeenCalled();
        expect(render().storageError).toBeInstanceOf(Error);
        expect(render().repository).toBe(pagedLogRepository);
      },
    );

    it("rejects queued producers on a write failure without retrying", async () => {
      const hook = render();
      vi.mocked(pagedLogRepository.putMany).mockRejectedValueOnce(
        new Error("quota"),
      );
      const results = await Promise.allSettled([
        hook.appendEntriesAsync([input(1)]),
        hook.appendEntriesAsync([input(2)]),
        hook.appendEntriesAsync([input(3)]),
      ]);
      expect(results.map((result) => result.status)).toEqual([
        "rejected",
        "rejected",
        "rejected",
      ]);
      expect(pagedLogRepository.putMany).toHaveBeenCalledTimes(1);
      expect(pagedLogRepository.getPayloads).not.toHaveBeenCalled();
    });

    it("pauses on deduplication lookup failures without attempting a write", async () => {
      const hook = render();
      vi.mocked(
        pagedLogRepository.findExistingSignatures,
      ).mockRejectedValueOnce(new Error("lookup failed"));
      await expect(hook.appendEntriesAsync([input(1)])).rejects.toThrow(
        "lookup failed",
      );
      await expect(hook.appendEntriesAsync([input(2)])).rejects.toThrow(
        "lookup failed",
      );
      expect(pagedLogRepository.putMany).not.toHaveBeenCalled();
      expect(pagedLogRepository.getPayloads).not.toHaveBeenCalled();
    });

    it("does not let a stale failed write poison a successful reset", async () => {
      const hook = render();
      await hook.appendEntriesAsync([input(1)]);
      let fail!: (error: Error) => void;
      let started!: () => void;
      const startedPromise = new Promise<void>((resolve) => {
        started = resolve;
      });
      vi.mocked(pagedLogRepository.putMany).mockImplementationOnce(() => {
        started();
        return new Promise((_resolve, reject) => {
          fail = reject;
        });
      });
      const append = hook
        .appendEntriesAsync([input(2)])
        .catch((error) => error);
      await startedPromise;
      const clear = hook.clearEntries();
      fail(new Error("old quota error"));
      await append;
      await clear;
      expect(render().storageError).toBeNull();
      await hook.appendEntriesAsync([input(3)]);
      expect([...render().entries.ids]).toEqual([1]);
    });

    it("bounds all retained producer inputs and releases capacity after completion", async () => {
      const hook = render({ maxEntries: 2 });
      const first = hook.appendEntriesAsync([input(1), input(2)]);
      await expect(hook.appendEntriesAsync([input(3)])).rejects.toThrow(
        "capacity",
      );
      expect(render().storageError?.name).toBe("IngestionBusyError");
      await first;
      await expect(hook.appendEntriesAsync([input(3)])).resolves.toBe(1);
    });

    it("enforces the byte budget even for a single oversized payload and exposes sync failures", async () => {
      const hook = render({ maxBytes: 1024 });
      await expect(
        hook.appendEntriesAsync([input(1, "x".repeat(1024))]),
      ).rejects.toThrow("capacity");
      hook.appendEntries([input(2, "x".repeat(1024))]);
      await Promise.resolve();
      expect(render().storageError?.name).toBe("IngestionBusyError");
      expect(pagedLogRepository.putMany).not.toHaveBeenCalled();
      await expect(hook.appendEntriesAsync([input(3)])).resolves.toBe(1);
    });

    it("shares the byte budget across concurrent producers", async () => {
      const hook = render({ maxBytes: 1200 });
      const first = hook.appendEntriesAsync([input(1, "x".repeat(200))]);
      await expect(
        hook.appendEntriesAsync([input(2, "x".repeat(200))]),
      ).rejects.toThrow("capacity");
      await first;
      await expect(
        hook.appendEntriesAsync([input(2, "x".repeat(200))]),
      ).resolves.toBe(1);
    });

    it("slices only the next transaction and reports progress after each persisted chunk", async () => {
      const hook = render();
      const list = Array.from({ length: IPC_BATCH_SIZE * 2 + 1 }, (_, index) =>
        input(index),
      );
      const slice = vi.spyOn(list, "slice");
      const progress = vi.fn();
      const append = hook.appendEntriesAsync(list, { onProgress: progress });
      expect(slice).toHaveBeenCalledTimes(1);
      expect(progress).not.toHaveBeenCalled();
      await expect(append).resolves.toBe(list.length);
      expect(slice).toHaveBeenCalledTimes(3);
      expect(progress.mock.calls).toEqual([
        [IPC_BATCH_SIZE, list.length],
        [IPC_BATCH_SIZE * 2, list.length],
        [list.length, list.length],
      ]);
      expect(
        vi
          .mocked(pagedLogRepository.putMany)
          .mock.calls.map(([entries]) => entries.length),
      ).toEqual([IPC_BATCH_SIZE, IPC_BATCH_SIZE, 1]);
    });

    it("strips imported IDs before storage so IDs remain dense", async () => {
      const hook = render();
      await hook.appendEntriesAsync([{ ...input(1), id: 200, _id: 700 }]);
      const stored = vi.mocked(pagedLogRepository.putMany).mock
        .calls[0]![0][0]!;
      expect(stored.id).toBeUndefined();
      expect(stored._id).toBeUndefined();
      expect([...render().entries.ids]).toEqual([1]);
    });

    it("does not admit remaining chunks after a progress callback clears the dataset", async () => {
      const hook = render();
      const list = Array.from({ length: IPC_BATCH_SIZE + 1 }, (_, index) =>
        input(index),
      );
      const slice = vi.spyOn(list, "slice");
      let clear!: Promise<void>;
      const append = hook.appendEntriesAsync(list, {
        onProgress: () => {
          clear = hook.clearEntries();
        },
      });
      await expect(append).rejects.toThrow("cleared");
      await clear;
      expect(slice).toHaveBeenCalledTimes(1);
      expect(pagedLogRepository.putMany).toHaveBeenCalledTimes(1);
      await hook.appendEntriesAsync([input(10_000)]);
      expect([...render().entries.ids]).toEqual([1]);
    });

    it("rejects pending ingestion on unmount without publishing or writing", async () => {
      const hook = render();
      const append = hook
        .appendEntriesAsync([input(1)])
        .catch((error) => error);
      hooks.cleanup?.();
      expect(await append).toBeInstanceOf(Error);
      await vi.advanceTimersByTimeAsync(100);
      expect(pagedLogRepository.putMany).not.toHaveBeenCalled();
      expect(render().entries.length).toBe(0);
    });
  });
});
