/**
 * Phase 0 – deterministic benchmark / regression tests
 *
 * Covers:
 *   1. Metadata-batch append      – mergePassingReferences, 300 000-base + 1 000-batch
 *   2. Projection-cache extension – mergeProjectionRecords, 300 000-base + 1 000-batch
 *   3. Compact entry-signature    – createEntrySignature correctness
 *
 * Timing model
 * ────────────
 * All measured operations run synchronously on the calling thread; there is no
 * background worker involved, so "main-thread dispatch time" == "total work
 * time".  Timing is emitted via console.warn so CI runners capture it without
 * triggering the no-console lint rule.  Hard assertions use conservative
 * budgets that stay well clear of realistic CI scheduling jitter (≥ 5 ms).
 *
 * CI-safe wall-clock budgets
 * ──────────────────────────
 *   mergePassingReferences  300 000-base + 1 000-batch (chronological)  500 ms
 *   mergeProjectionRecords  300 000-base + 1 000-batch (chronological)  100 ms
 *     ↑ 100 ms matches the threshold enforced by scripts/test-filter-latency.ts.
 *       The chronological fast-path is O(n_batch) push, so this holds on CI.
 *
 * Data-generation helpers are intentionally pure functions defined here so
 * they can be co-located with the tests that rely on them.  Extract to a
 * shared benchHelpers module if later phases reuse them.
 */

import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { createEntrySignature } from "../../store/paged";
import {
  mergePassingReferences,
  mergeProjectionRecords,
  type CachedProjection,
  type PassingReference,
} from "../filterWorker";

// ── Reusable pure data-generation helpers ────────────────────────────────────

const EPOCH_MS = new Date("2026-01-01T00:00:00.000Z").getTime();

/**
 * Build `n` PassingReference objects whose timestamps are 1 ms apart,
 * starting at `tsBaseMs`.  IDs start at `idOffset + 1`.
 *
 * The message / messageLower fields are set so entries within the first
 * 50 000 are searchable (mirrors the SEARCHABLE_REFERENCE_LIMIT applied by
 * mergePassingReferences).
 */
function makeRefs(
  n: number,
  idOffset = 0,
  tsBaseMs = EPOCH_MS,
): PassingReference[] {
  const refs: PassingReference[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const id = idOffset + i + 1;
    const ts = new Date(tsBaseMs + i).toISOString();
    refs[i] = {
      id,
      _id: id,
      timestamp: ts,
      message: `msg ${id}`,
      messageLower: `msg ${id}`,
    };
  }
  return refs;
}

/**
 * Build `n` CachedProjection objects whose timestamps are 1 ms apart,
 * starting at `tsBaseMs`.  IDs start at `idOffset + 1`.
 *
 * Fields are populated to satisfy `CachedProjection = ProjectionRecord &
 * NormalizedProjectionFields` without calling normalizeProjection so that
 * data-generation overhead is minimised and timed measurements stay focused
 * on the merge operation itself.
 */
function makeCachedProjections(
  n: number,
  idOffset = 0,
  tsBaseMs = EPOCH_MS,
): CachedProjection[] {
  const items: CachedProjection[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const id = idOffset + i + 1;
    const tsMs = tsBaseMs + i;
    const ts = new Date(tsMs).toISOString();
    items[i] = {
      id,
      _id: id,
      timestamp: ts,
      level: "INFO",
      logger: "bench.Logger",
      thread: "main",
      message: `bench message ${id}`,
      source: "tcp://bench",
      mdc: null,
      service: null,
      traceId: null,
      signature: `sig-${id}`,
      _mark: null,
      // Normalised fields (mirrors normalizeProjection output)
      levelUpper: "INFO",
      loggerLower: "bench.logger",
      threadLower: "main",
      messageLower: `bench message ${id}`,
      timestampMs: tsMs,
      elasticSource: false,
    };
  }
  return items;
}

// ── Constants ────────────────────────────────────────────────────────────────

const BASE_SIZE = 300_000;
const BATCH_SIZE = 1_000;

/** Conservative CI-safe budgets – well above typical fast-path durations. */
const CI_BUDGET_REFS_MS = 500; // mergePassingReferences
const CI_BUDGET_PROJ_MS = 100; // mergeProjectionRecords (matches test-filter-latency.ts)

// ── 1) Metadata-batch append ─────────────────────────────────────────────────

describe("Phase 0 – metadata-batch append (mergePassingReferences)", () => {
  it(
    "appends 1 000 chronological references into 300 000 within budget and preserves order",
    { timeout: 15_000 },
    () => {
      // Base: IDs 1–300 000, timestamps at EPOCH_MS + 0 … + 299 999 ms
      const base = makeRefs(BASE_SIZE);
      // Batch: IDs 300 001–301 000, timestamps strictly after the last base entry
      const batchTsBase = EPOCH_MS + BASE_SIZE; // = lastBaseTs + 1 ms
      const batch = makeRefs(BATCH_SIZE, BASE_SIZE, batchTsBase);

      // ── Timed region: main-thread dispatch == total work (no worker involved) ──
      const t0 = performance.now();
      const result = mergePassingReferences(base, batch);
      const elapsed = performance.now() - t0;

      // Report timing so it appears in CI logs
      console.warn(
        `[perf] mergePassingReferences 300k+1k chronological fast-path: ${elapsed.toFixed(2)} ms`,
      );

      // Correctness – count and same-array return (chronological fast-path pushes in-place)
      expect(result).toBe(base);
      expect(result.length).toBe(BASE_SIZE + BATCH_SIZE);

      // Order preservation – last base entry precedes first batch entry
      const lastBase = result[BASE_SIZE - 1]!;
      const firstBatch = result[BASE_SIZE]!;
      expect(
        new Date(lastBase.timestamp as string).getTime(),
      ).toBeLessThanOrEqual(new Date(firstBatch.timestamp as string).getTime());

      // Boundary IDs must be correct
      expect(result[0]!.id).toBe(1);
      expect(result[result.length - 1]!.id).toBe(BASE_SIZE + BATCH_SIZE);

      // CI-safe wall-clock assertion
      expect(elapsed).toBeLessThan(CI_BUDGET_REFS_MS);
    },
  );

  it("chronological batch appended by mergePassingReferences produces IDs in ascending order", () => {
    const base = makeRefs(5);
    const batch = makeRefs(3, 5, EPOCH_MS + 5); // timestamps strictly after base

    const result = mergePassingReferences(base, batch);

    expect(result.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("interleaved batch is sorted and merged into chronological order", () => {
    // Batch timestamps interleave with base (non-fast-path merge)
    const base: PassingReference[] = [
      { id: 1, _id: 1, timestamp: "2026-01-01T00:00:01.000Z" },
      { id: 3, _id: 3, timestamp: "2026-01-01T00:00:03.000Z" },
    ];
    const batch: PassingReference[] = [
      { id: 4, _id: 4, timestamp: "2026-01-01T00:00:04.000Z" },
      { id: 2, _id: 2, timestamp: "2026-01-01T00:00:02.000Z" },
    ];

    const result = mergePassingReferences(base, batch);

    expect(result.map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });
});

// ── 2) Projection-cache extension ────────────────────────────────────────────

describe("Phase 0 – projection-cache extension (mergeProjectionRecords)", () => {
  it(
    "appends 1 000 chronological projections into 300 000 within the 100 ms threshold and preserves order",
    { timeout: 15_000 },
    () => {
      const base = makeCachedProjections(BASE_SIZE);
      const batchTsBase = EPOCH_MS + BASE_SIZE; // timestamps strictly after base
      const batch = makeCachedProjections(BATCH_SIZE, BASE_SIZE, batchTsBase);

      // ── Timed region: main-thread dispatch == total work (no worker involved) ──
      const t0 = performance.now();
      const result = mergeProjectionRecords(base, batch);
      const elapsed = performance.now() - t0;

      // Report timing so it appears in CI logs
      console.warn(
        `[perf] mergeProjectionRecords 300k+1k chronological fast-path: ${elapsed.toFixed(2)} ms`,
      );

      // Correctness – count and same-array return (chronological fast-path)
      expect(result).toBe(base);
      expect(result.length).toBe(BASE_SIZE + BATCH_SIZE);

      // Order preservation via precomputed timestampMs
      const lastBase = result[BASE_SIZE - 1]!;
      const firstBatch = result[BASE_SIZE]!;
      expect(lastBase.timestampMs).toBeLessThanOrEqual(firstBatch.timestampMs!);

      // Boundary IDs must be correct
      expect(result[0]!.id).toBe(1);
      expect(result[result.length - 1]!.id).toBe(BASE_SIZE + BATCH_SIZE);

      // CI-safe wall-clock assertion (matches scripts/test-filter-latency.ts threshold)
      expect(elapsed).toBeLessThan(CI_BUDGET_PROJ_MS);
    },
  );

  it("chronological batch appended by mergeProjectionRecords produces IDs in ascending order", () => {
    const base = makeCachedProjections(5);
    const batch = makeCachedProjections(3, 5, EPOCH_MS + 5);

    const result = mergeProjectionRecords(base, batch);

    expect(result.map((p) => p.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("interleaved batch is sorted and merged into timestamp order", () => {
    const make = (id: number, tsMs: number): CachedProjection => ({
      id,
      _id: id,
      timestamp: new Date(tsMs).toISOString(),
      level: "INFO",
      logger: "app",
      thread: "main",
      message: `m${id}`,
      source: "tcp://test",
      mdc: null,
      service: null,
      traceId: null,
      signature: `s${id}`,
      _mark: null,
      levelUpper: "INFO",
      loggerLower: "app",
      threadLower: "main",
      messageLower: `m${id}`,
      timestampMs: tsMs,
      elasticSource: false,
    });

    const base = [make(1, EPOCH_MS), make(3, EPOCH_MS + 2)];
    const batch = [make(4, EPOCH_MS + 3), make(2, EPOCH_MS + 1)];

    const result = mergeProjectionRecords(base, batch);

    expect(result.map((p) => p.id)).toEqual([1, 2, 3, 4]);
  });
});

// ── 3) Compact entry-signature ────────────────────────────────────────────────

describe("Phase 0 – compact entry-signature (createEntrySignature)", () => {
  it("produces a fixed-width compact signature for non-Elastic entries", () => {
    const sig = createEntrySignature({
      timestamp: "2026-01-01T00:00:01.000Z",
      logger: "com.example.App",
      message: "Hello world",
      source: "tcp://localhost",
    });

    expect(sig).toMatch(/^v2:[0-9a-f]{32}$/);
  });

  it("includes the Elastic source to prevent false deduplication", () => {
    const first = createEntrySignature({
      timestamp: "2026-01-01T00:00:01.000Z",
      logger: "com.example.App",
      message: "Hello world",
      source: "elastic://logs/doc-1",
    });
    const second = createEntrySignature({
      timestamp: "2026-01-01T00:00:01.000Z",
      logger: "com.example.App",
      message: "Hello world",
      source: "elastic://logs/doc-2",
    });

    expect(first).not.toBe(second);
  });

  it("keeps signatures fixed-width for messages exceeding 10 KB", () => {
    const longMsg = "x".repeat(11 * 1024); // 11 KB > 10 KB limit
    const sig = createEntrySignature({
      timestamp: "2026-01-01T00:00:01.000Z",
      logger: "app",
      message: longMsg,
      source: "file.log",
    });

    expect(sig).toMatch(/^v2:[0-9a-f]{32}$/);
    expect(sig).not.toBe(
      createEntrySignature({
        timestamp: "2026-01-01T00:00:01.000Z",
        logger: "app",
        message: `${longMsg}x`,
        source: "file.log",
      }),
    );
  });

  it("uses _fullMessage over message when both are present", () => {
    const sigFull = createEntrySignature({
      timestamp: "2026-01-01T00:00:01.000Z",
      logger: "app",
      message: "truncated…",
      _fullMessage: "full original message",
      source: "file.log",
    });
    const sigMsg = createEntrySignature({
      timestamp: "2026-01-01T00:00:01.000Z",
      logger: "app",
      message: "full original message",
      source: "file.log",
    });

    // Both should produce the same signature
    expect(sigFull).toBe(sigMsg);
  });
});
