import { estimatePayloadBytes } from "../utils/estimatePayloadBytes";

export interface IngestionLimits {
  maxEntries: number;
  maxBytes: number;
}

export const DEFAULT_INGESTION_LIMITS: IngestionLimits = {
  maxEntries: 100_000,
  maxBytes: 64 * 1024 * 1024,
};

export class IngestionBusyError extends Error {
  constructor() {
    super(
      "Log ingestion capacity exceeded; stop the producer and use smaller batches.",
    );
    this.name = "IngestionBusyError";
  }
}

/** Reserves entire producer inputs, not just slices hiding retained parent arrays. */
export class IngestionBudget {
  private entries = 0;
  private bytes = 0;

  constructor(private readonly limits: IngestionLimits) {
    if (
      !Number.isSafeInteger(limits.maxEntries) ||
      !Number.isSafeInteger(limits.maxBytes) ||
      limits.maxEntries <= 0 ||
      limits.maxBytes <= 0
    ) {
      throw new Error("Ingestion limits must be positive finite integers");
    }
  }

  reserve(entries: readonly unknown[]): () => void {
    const count = entries.length;
    if (count + this.entries > this.limits.maxEntries) {
      throw new IngestionBusyError();
    }
    let bytes = 64 + entries.length * 8;
    for (const entry of entries) {
      bytes += estimatePayloadBytes(
        entry,
        this.limits.maxBytes - this.bytes - bytes,
      );
      if (bytes + this.bytes > this.limits.maxBytes) {
        throw new IngestionBusyError();
      }
    }
    this.entries += count;
    this.bytes += bytes;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.entries -= count;
      this.bytes -= bytes;
    };
  }
}
