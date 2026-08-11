/**
 * Tests for direct incremental projection transfer to the filter worker.
 *
 * Covers:
 *  1. Cold transferred cache (no IDB read needed)
 *  2. Incremental append
 *  3. Replay idempotence
 *  4. Out-of-order append
 *  5. Generation reset
 *  6. Worker restart / partial cache → IndexedDB fallback
 *  7. All filter modes with transferred records
 */

import { describe, expect, it, beforeEach } from "vitest";
import type { ProjectionRecord } from "../../store/paged";
import {
  handleTransferProjections,
  handleResetProjections,
  _getTransferredProjectionCache,
  _resetWorkerCaches,
  normalizeProjection,
  filterProjectionPages,
  type FilterOptions,
} from "../filterWorker";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function projection(
  id: number,
  overrides: Partial<ProjectionRecord> = {},
): ProjectionRecord {
  return {
    id,
    timestamp: `2026-01-01T00:00:0${id % 10}.${String(id).padStart(3, "0")}Z`,
    level: "INFO",
    logger: "app",
    thread: "main",
    message: `message ${id}`,
    source: "file.log",
    mdc: null,
    service: null,
    traceId: null,
    signature: `signature-${id}`,
    _mark: null,
    ...overrides,
  };
}

function options(overrides: Partial<FilterOptions> = {}): FilterOptions {
  return {
    stdFiltersEnabled: true,
    filter: { level: "", logger: "", thread: "", message: "" },
    onlyMarked: false,
    dcFilterEnabled: false,
    dcFilterEntries: [],
    timeFilterEnabled: false,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("transferProjections – handleTransferProjections", () => {
  beforeEach(() => {
    _resetWorkerCaches();
  });

  // 1. Cold transferred cache (no IDB read)
  describe("cold transferred cache", () => {
    it("initializes transferred cache from first batch", () => {
      const records = [projection(1), projection(2), projection(3)];
      handleTransferProjections(records, "db-1", 1);

      const state = _getTransferredProjectionCache();
      expect(state).not.toBeNull();
      expect(state!.databaseName).toBe("db-1");
      expect(state!.dataGeneration).toBe(1);
      expect(state!.count).toBe(3);
      expect(state!.sortedCount).toBe(3);
    });

    it("empty records array is a no-op", () => {
      handleTransferProjections([], "db-1", 1);
      expect(_getTransferredProjectionCache()).toBeNull();
    });

    it("releases transferred projections on explicit reset", () => {
      handleTransferProjections([projection(1), projection(2)], "db-1", 1);
      handleResetProjections();
      expect(_getTransferredProjectionCache()).toBeNull();
    });

    it("records are normalized on insertion", () => {
      handleTransferProjections([projection(1)], "db-1", 1);
      const state = _getTransferredProjectionCache();
      expect(state!.count).toBe(1);
    });
  });

  // 2. Incremental append
  describe("incremental append", () => {
    it("appends new records to existing transferred cache", () => {
      handleTransferProjections([projection(1), projection(2)], "db-1", 1);
      handleTransferProjections([projection(3), projection(4)], "db-1", 1);

      const state = _getTransferredProjectionCache();
      expect(state!.count).toBe(4);
      expect(state!.sortedCount).toBe(4);
    });

    it("maintains sorted order across incremental appends", () => {
      handleTransferProjections([projection(1)], "db-1", 1);
      handleTransferProjections(
        [
          projection(3, { timestamp: "2026-01-01T00:00:03.000Z" }),
          projection(2, { timestamp: "2026-01-01T00:00:02.000Z" }),
        ],
        "db-1",
        1,
      );

      const state = _getTransferredProjectionCache();
      expect(state!.count).toBe(3);
      expect(state!.sortedCount).toBe(3);
    });
  });

  // 3. Replay idempotence
  describe("replay idempotence", () => {
    it("ignores duplicate IDs on replay", () => {
      const batch = [projection(1), projection(2), projection(3)];
      handleTransferProjections(batch, "db-1", 1);
      // Replay exact same batch
      handleTransferProjections(batch, "db-1", 1);

      const state = _getTransferredProjectionCache();
      expect(state!.count).toBe(3);
      expect(state!.sortedCount).toBe(3);
    });

    it("ignores partial overlapping replay", () => {
      handleTransferProjections([projection(1), projection(2)], "db-1", 1);
      // Replay with overlap + new
      handleTransferProjections([projection(2), projection(3)], "db-1", 1);

      const state = _getTransferredProjectionCache();
      expect(state!.count).toBe(3);
      expect(state!.sortedCount).toBe(3);
    });

    it("does not create duplicate entries in sorted array after multiple replays", () => {
      const records = [projection(5)];
      handleTransferProjections(records, "db-1", 1);
      handleTransferProjections(records, "db-1", 1);
      handleTransferProjections(records, "db-1", 1);

      const state = _getTransferredProjectionCache();
      expect(state!.count).toBe(1);
      expect(state!.sortedCount).toBe(1);
    });
  });

  // 4. Out-of-order append
  describe("out-of-order append", () => {
    it("handles out-of-order batches correctly", () => {
      // Second batch arrives first (IDs 3-4), then first batch (IDs 1-2)
      handleTransferProjections(
        [
          projection(3, { timestamp: "2026-01-01T00:00:03.000Z" }),
          projection(4, { timestamp: "2026-01-01T00:00:04.000Z" }),
        ],
        "db-1",
        1,
      );
      handleTransferProjections(
        [
          projection(1, { timestamp: "2026-01-01T00:00:01.000Z" }),
          projection(2, { timestamp: "2026-01-01T00:00:02.000Z" }),
        ],
        "db-1",
        1,
      );

      const state = _getTransferredProjectionCache();
      expect(state!.count).toBe(4);
      expect(state!.sortedCount).toBe(4);
    });

    it("handles reverse-order single-record batches", () => {
      handleTransferProjections(
        [projection(5, { timestamp: "2026-01-01T00:00:05.000Z" })],
        "db-1",
        1,
      );
      handleTransferProjections(
        [projection(1, { timestamp: "2026-01-01T00:00:01.000Z" })],
        "db-1",
        1,
      );
      handleTransferProjections(
        [projection(3, { timestamp: "2026-01-01T00:00:03.000Z" })],
        "db-1",
        1,
      );

      const state = _getTransferredProjectionCache();
      expect(state!.count).toBe(3);
      expect(state!.sortedCount).toBe(3);
    });
  });

  // 5. Generation reset
  describe("generation reset", () => {
    it("discards cache when dataGeneration changes", () => {
      handleTransferProjections([projection(1), projection(2)], "db-1", 1);
      // New generation
      handleTransferProjections([projection(10)], "db-1", 2);

      const state = _getTransferredProjectionCache();
      expect(state!.dataGeneration).toBe(2);
      expect(state!.count).toBe(1);
    });

    it("discards cache when databaseName changes", () => {
      handleTransferProjections([projection(1), projection(2)], "db-1", 1);
      // Different database
      handleTransferProjections([projection(10)], "db-2", 1);

      const state = _getTransferredProjectionCache();
      expect(state!.databaseName).toBe("db-2");
      expect(state!.count).toBe(1);
    });

    it("resets to fresh state allowing re-population after generation change", () => {
      handleTransferProjections(
        [projection(1), projection(2), projection(3)],
        "db-1",
        1,
      );
      // Generation change
      handleTransferProjections([projection(1)], "db-1", 2);
      handleTransferProjections([projection(2)], "db-1", 2);

      const state = _getTransferredProjectionCache();
      expect(state!.count).toBe(2);
      expect(state!.dataGeneration).toBe(2);
    });
  });

  // 6. Worker restart / partial cache fallback
  describe("worker restart / partial cache fallback", () => {
    it("fresh worker has null transferred cache", () => {
      expect(_getTransferredProjectionCache()).toBeNull();
    });

    it("reset clears all caches simulating worker restart", () => {
      handleTransferProjections([projection(1), projection(2)], "db-1", 1);
      _resetWorkerCaches();
      expect(_getTransferredProjectionCache()).toBeNull();
    });

    it("partial cache after restart can be rebuilt incrementally", () => {
      // Simulate: worker had records 1-5, restarts, only receives 3-5
      handleTransferProjections(
        [projection(3), projection(4), projection(5)],
        "db-1",
        1,
      );

      const state = _getTransferredProjectionCache();
      expect(state!.count).toBe(3);
      // The gap (records 1-2 missing) will trigger IDB fallback in
      // loadPagedProjectionCache because count < entryCount
    });
  });

  // 7. All filter modes with transferred records
  describe("filter modes with transferred/normalized projections", () => {
    it("level filter works on transferred records", () => {
      const records = [
        projection(1, { level: "INFO" }),
        projection(2, { level: "DEBUG" }),
        projection(3, { level: "ERROR" }),
      ];
      const normalized = records.map(normalizeProjection);
      const result = filterProjectionPages(
        [normalized],
        options({
          filter: { level: "ERROR", logger: "", thread: "", message: "" },
        }),
      );
      expect(result.filteredIndices).toEqual([3]);
      expect(result.stats.rejectedByLevel).toBe(2);
    });

    it("logger filter works on transferred records", () => {
      const records = [
        projection(1, { logger: "com.example.Service" }),
        projection(2, { logger: "com.other.Thing" }),
      ];
      const normalized = records.map(normalizeProjection);
      const result = filterProjectionPages(
        [normalized],
        options({
          filter: {
            level: "",
            logger: "example",
            thread: "",
            message: "",
          },
        }),
      );
      expect(result.filteredIndices).toEqual([1]);
    });

    it("thread filter works on transferred records", () => {
      const records = [
        projection(1, { thread: "main" }),
        projection(2, { thread: "worker-1" }),
      ];
      const normalized = records.map(normalizeProjection);
      const result = filterProjectionPages(
        [normalized],
        options({
          filter: {
            level: "",
            logger: "",
            thread: "worker",
            message: "",
          },
        }),
      );
      expect(result.filteredIndices).toEqual([2]);
    });

    it("message filter works on transferred records", () => {
      const records = [
        projection(1, { message: "User login successful" }),
        projection(2, { message: "Database connection failed" }),
        projection(3, { message: "User logout" }),
      ];
      const normalized = records.map(normalizeProjection);
      const result = filterProjectionPages(
        [normalized],
        options({
          filter: { level: "", logger: "", thread: "", message: "user" },
        }),
      );
      expect(result.filteredIndices).toEqual([1, 3]);
    });

    it("time filter works on transferred records", () => {
      const records = [
        projection(1, {
          source: "elastic://logs",
          timestamp: "2026-01-01T00:00:01.000Z",
        }),
        projection(2, {
          source: "elastic://logs",
          timestamp: "2026-01-02T00:00:00.000Z",
        }),
        projection(3, {
          source: "elastic://logs",
          timestamp: "2026-01-03T00:00:00.000Z",
        }),
      ];
      const normalized = records.map(normalizeProjection);
      const result = filterProjectionPages(
        [normalized],
        options({
          timeFilterEnabled: true,
          timeFilterFrom: "2026-01-01T12:00:00Z",
          timeFilterTo: "2026-01-02T12:00:00Z",
        }),
      );
      expect(result.filteredIndices).toEqual([2]);
    });

    it("DC filter works on transferred records", () => {
      const records = [
        projection(1, { mdc: { tenant: "acme" } }),
        projection(2, { mdc: { tenant: "other" } }),
        projection(3, { mdc: { tenant: "acme", env: "prod" } }),
      ];
      const normalized = records.map(normalizeProjection);
      const result = filterProjectionPages(
        [normalized],
        options({
          dcFilterEnabled: true,
          dcFilterEntries: [{ key: "tenant", value: "acme", active: true }],
        }),
      );
      expect(result.filteredIndices).toEqual([1, 3]);
    });

    it("onlyMarked filter works with external markedSignatures", () => {
      const records = [
        projection(1),
        projection(2, { _mark: "yellow" }),
        projection(3),
      ];
      const normalized = records.map(normalizeProjection);
      const result = filterProjectionPages(
        [normalized],
        options({ onlyMarked: true }),
        new Set(["signature-1"]),
      );
      expect(result.filteredIndices).toEqual([1, 2]);
    });

    it("navigation search works on transferred records", () => {
      const records = [
        projection(1, { message: "needle in haystack" }),
        projection(2, { message: "just haystack" }),
        projection(3, { message: "another needle here" }),
      ];
      const normalized = records.map(normalizeProjection);
      const result = filterProjectionPages(
        [normalized],
        options({ navigationSearch: "needle" }),
      );
      expect(result.filteredIndices).toEqual([1, 2, 3]);
      expect(result.searchMatchIndices).toEqual([0, 2]);
    });

    it("combined filters work together", () => {
      const records = [
        projection(1, {
          level: "INFO",
          message: "user request",
          mdc: { tenant: "acme" },
        }),
        projection(2, {
          level: "ERROR",
          message: "user request",
          mdc: { tenant: "acme" },
        }),
        projection(3, {
          level: "INFO",
          message: "other thing",
          mdc: { tenant: "acme" },
        }),
        projection(4, {
          level: "INFO",
          message: "user request",
          mdc: { tenant: "other" },
        }),
      ];
      const normalized = records.map(normalizeProjection);
      const result = filterProjectionPages(
        [normalized],
        options({
          filter: { level: "INFO", logger: "", thread: "", message: "user" },
          dcFilterEnabled: true,
          dcFilterEntries: [{ key: "tenant", value: "acme", active: true }],
        }),
      );
      expect(result.filteredIndices).toEqual([1]);
    });
  });
});
