import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMetadataPublishDelay,
  useEntryManagement,
} from "../useEntryManagement";
import { pagedLogRepository } from "../../store/paged/session";

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
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
  useEffect: () => undefined,
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

function render() {
  hooks.cursor = 0;
  return useEntryManagement({ marksMap: {} });
}

function input(timestamp: number, message = `message-${timestamp}`) {
  return { timestamp, message, source: "test.log" };
}

beforeEach(() => {
  hooks.slots = [];
  hooks.cursor = 0;
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
      hook.clearEntries();
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

    it("recovers payloads on storage failure without enriching old snapshots", async () => {
      let hook = render();
      await hook.appendEntriesAsync([input(1, "old payload")]);
      hook = render();
      const paged = hook.entries;
      expect(paged.at(0)?.message).toBeUndefined();
      vi.spyOn(pagedLogRepository, "putMany").mockRejectedValueOnce(
        new Error("quota"),
      );
      await hook.appendEntriesAsync([input(2, "new payload")]);
      await vi.advanceTimersByTimeAsync(50);
      hook = render();
      expect(hook.usesPagedStorage).toBe(false);
      expect(hook.entries.at(0)?.message).toBe("old payload");
      expect(hook.entries.at(1)?.message).toBe("new payload");
      expect(hook.getMetadata(1)?.message).toBe("old payload");
      expect(paged.at(0)?.message).toBeUndefined();
      expect(paged.length).toBe(1);
      expect(hook.entries.isAppendOf(paged)).toBe(false);
    });

    it("does not republish recovered old data when clear races a storage fallback", async () => {
      let hook = render();
      await hook.appendEntriesAsync([input(1)]);
      hook = render();
      const paged = hook.entries;
      let releaseRecovery!: () => void;
      const recoveryGate = new Promise<void>((resolve) => {
        releaseRecovery = resolve;
      });
      const originalGetPayloads =
        pagedLogRepository.getPayloads.bind(pagedLogRepository);
      let recoveryStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        recoveryStarted = resolve;
      });
      vi.spyOn(pagedLogRepository, "getPayloads").mockImplementationOnce(
        async (ids) => {
          recoveryStarted();
          await recoveryGate;
          return originalGetPayloads(ids);
        },
      );
      vi.spyOn(pagedLogRepository, "putMany").mockRejectedValueOnce(
        new Error("quota"),
      );
      const append = hook.appendEntriesAsync([input(2)]);
      await started;
      const generation = hook.getDataGeneration();
      hook.clearEntries();
      expect(hook.getDataGeneration()).toBe(generation + 1);
      releaseRecovery();
      expect(await append).toBe(0);
      await vi.advanceTimersByTimeAsync(100);
      hook = render();
      expect(hook.entries.length).toBe(0);
      expect(hook.usesPagedStorage).toBe(true);
      expect(hook.getMetadata(1)).toBeUndefined();
      expect(paged.length).toBe(1);
      await hook.appendEntriesAsync([input(3)]);
      expect(render().entries.at(0)?.timestamp).toBe(3);
    });
  });
});
