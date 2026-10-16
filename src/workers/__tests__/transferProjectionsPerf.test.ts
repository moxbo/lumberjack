/**
 * Performance test for transferred projection cache merge.
 *
 * Target: ≤3 ms for merging 1k records into a 300k transferred cache
 * under normal runs.  CI-safe threshold is set higher (50 ms) to account
 * for scheduling jitter on shared CI runners.
 */

import { performance } from "node:perf_hooks";
import { describe, expect, it, beforeEach } from "vitest";
import {
  handleTransferProjections,
  _getTransferredProjectionCache,
  _resetWorkerCaches,
} from "../filterWorker";
import type { ProjectionRecord } from "../../store/paged";

// ─── Data generation ─────────────────────────────────────────────────────────

const EPOCH_MS = new Date("2026-01-01T00:00:00.000Z").getTime();

function makeProjections(
  n: number,
  idOffset = 0,
  tsBaseMs = EPOCH_MS,
): ProjectionRecord[] {
  const records: ProjectionRecord[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const id = idOffset + i + 1;
    const ts = new Date(tsBaseMs + i).toISOString();
    records[i] = {
      id,
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
    };
  }
  return records;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const BASE_SIZE = 300_000;
const BATCH_SIZE = 1_000;

/** Target for normal/local runs. */
const LOCAL_TARGET_MS = 3;
/** CI-safe budget: allows for scheduling jitter on shared runners. */
const CI_BUDGET_MS = 50;

// ─── Test ────────────────────────────────────────────────────────────────────

describe("transferProjections – cache merge performance", () => {
  beforeEach(() => {
    _resetWorkerCaches();
  });

  it(
    `merges ${BATCH_SIZE} records into ${BASE_SIZE} transferred cache within ${CI_BUDGET_MS} ms (target: ≤${LOCAL_TARGET_MS} ms)`,
    { timeout: 30_000 },
    () => {
      // Populate base cache (300k records)
      const base = makeProjections(BASE_SIZE);
      handleTransferProjections(base, "db-perf", 1);

      const state = _getTransferredProjectionCache();
      expect(state!.count).toBe(BASE_SIZE);

      // Create batch (1k records with timestamps strictly after base)
      const batchTsBase = EPOCH_MS + BASE_SIZE;
      const batch = makeProjections(BATCH_SIZE, BASE_SIZE, batchTsBase);

      // ── Timed region ──
      const t0 = performance.now();
      handleTransferProjections(batch, "db-perf", 1);
      const elapsed = performance.now() - t0;

      console.warn(
        `[perf] transferProjections merge ${BASE_SIZE / 1000}k+${BATCH_SIZE / 1000}k chronological: ${elapsed.toFixed(2)} ms (target ≤${LOCAL_TARGET_MS} ms, CI budget ${CI_BUDGET_MS} ms)`,
      );

      // Correctness
      const afterState = _getTransferredProjectionCache();
      expect(afterState!.count).toBe(BASE_SIZE + BATCH_SIZE);
      expect(afterState!.sortedCount).toBe(BASE_SIZE + BATCH_SIZE);

      // CI-safe assertion
      expect(elapsed).toBeLessThan(CI_BUDGET_MS);
    },
  );

  it(
    "merging replayed/duplicate batch into 300k is essentially free (idempotent skip)",
    { timeout: 30_000 },
    () => {
      // Populate base cache
      const base = makeProjections(BASE_SIZE);
      handleTransferProjections(base, "db-perf", 1);

      // Replay a batch that's already present (IDs 1000–1999)
      const replayBatch = makeProjections(BATCH_SIZE, 999, EPOCH_MS + 999);

      const t0 = performance.now();
      handleTransferProjections(replayBatch, "db-perf", 1);
      const elapsed = performance.now() - t0;

      console.warn(
        `[perf] transferProjections replay-skip ${BATCH_SIZE}: ${elapsed.toFixed(2)} ms`,
      );

      // Count should not increase
      const state = _getTransferredProjectionCache();
      expect(state!.count).toBe(BASE_SIZE);

      // Should be very fast since all are duplicates
      expect(elapsed).toBeLessThan(CI_BUDGET_MS);
    },
  );
});
