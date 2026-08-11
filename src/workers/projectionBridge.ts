/**
 * Typed projection event/client bridge.
 *
 * Provides a thin, typed API for transferring projection records directly from
 * the paged repository to the filter worker without exposing the raw Worker
 * globally.  The main thread publishes batches of ProjectionRecords after a
 * successful putMany; the filter worker merges them idempotently before the
 * next filter request.
 */

import type { ProjectionRecord } from "../store/paged";

// ─── Message Types ───────────────────────────────────────────────────────────

export interface TransferProjectionsMessage {
  type: "transferProjections";
  records: ProjectionRecord[];
  databaseName: string;
  dataGeneration: string | number;
}

export interface ResetProjectionsMessage {
  type: "resetProjections";
}

// ─── Bridge Interface ────────────────────────────────────────────────────────

export interface ProjectionBridge {
  /** Post a batch of projection records to the filter worker. */
  publish(
    records: ProjectionRecord[],
    databaseName: string,
    dataGeneration: string | number,
  ): void;

  /** Release projection/filter caches after the active dataset is cleared. */
  reset(): void;

  /** Disconnect from the worker (e.g. on cleanup). */
  dispose(): void;
}

// ─── Bridge Factory ──────────────────────────────────────────────────────────

/**
 * Creates a projection bridge that posts `transferProjections` messages to the
 * given Worker instance.
 *
 * Only paged-storage records are published; in-memory fallback callers should
 * never construct a bridge (or should call `dispose()` on fallback transition).
 */
export function createProjectionBridge(worker: Worker): ProjectionBridge {
  let target: Worker | null = worker;

  return {
    publish(
      records: ProjectionRecord[],
      databaseName: string,
      dataGeneration: string | number,
    ): void {
      if (!target || records.length === 0) return;
      const message: TransferProjectionsMessage = {
        type: "transferProjections",
        records,
        databaseName,
        dataGeneration,
      };
      target.postMessage(message);
    },

    reset(): void {
      target?.postMessage({
        type: "resetProjections",
      } satisfies ResetProjectionsMessage);
    },

    dispose(): void {
      target = null;
    },
  };
}
