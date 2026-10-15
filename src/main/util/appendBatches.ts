import type { LogEntry } from "../../types/ipc";
import { boundEntryPayload } from "../../utils/entryLimits";
import { MAX_BATCH_ENTRIES } from "./constants";
import { prepareRenderBatch } from "./logEntryUtils";

/** Transport metadata must not become MDC when an entry has no raw payload. */
export function prepareAppendBatch(entries: LogEntry[]): LogEntry[] {
  const prepared = prepareRenderBatch(
    entries.map((original) => {
      const entry = { ...original };
      delete entry._ingestionKind;
      return entry;
    }),
  );
  for (let index = 0; index < prepared.length; index++) {
    prepared[index]!._ingestionKind = entries[index]!._ingestionKind;
  }
  return prepared;
}

/**
 * Stamps trusted provenance at admission, and preserves its boundaries when
 * independent producers are later coalesced by the per-window append queue.
 */
export function* renderBatches(
  entries: readonly LogEntry[],
  kind?: "live" | "import",
): IterableIterator<LogEntry[]> {
  let batch: LogEntry[] = [];
  let bytes = 0;
  for (const original of entries) {
    const transport = kind ? { ...original, _ingestionKind: kind } : original;
    const { entry, bytes: size } = boundEntryPayload(transport);
    if (
      batch.length &&
      (bytes + size > 1024 * 1024 ||
        batch.length >= MAX_BATCH_ENTRIES ||
        batch[0]!._ingestionKind !== entry._ingestionKind)
    ) {
      yield batch;
      batch = [];
      bytes = 0;
    }
    batch.push(entry);
    bytes += size;
  }
  if (batch.length) yield batch;
}
