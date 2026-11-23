import { createHash } from "node:crypto";
import log from "electron-log/main";
import type { LogEntry } from "../types/ipc";

export const MAX_SEEN_ENTRIES = 10_000;

/** Stage one batch against the last acknowledged history. Poll batches are serial. */
export function prepareHttpPollBatch(
  entries: LogEntry[],
  seen: Set<string>,
): { fresh: LogEntry[]; commit(): Set<string> } {
  let base = seen;
  const additions = new Set<string>();
  const fresh: LogEntry[] = [];
  for (const e of entries) {
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          e.timestamp,
          e.level,
          e.logger,
          e.thread,
          e.message,
          e.traceId,
          e.source,
        ]),
      )
      .digest("hex");
    if (base.has(key) || additions.has(key)) continue;
    additions.add(key);
    fresh.push(e);

    const size = base.size + additions.size;
    if (size > MAX_SEEN_ENTRIES) {
      // The next entry in this batch must already see the eviction, even
      // though the poller's acknowledged history cannot change until delivery.
      base = new Set([...base, ...additions].slice(-MAX_SEEN_ENTRIES / 2));
      additions.clear();
      log.debug(
        `[http:poll] Trimmed seen Set to ${base.size} entries (was ${size})`,
      );
    }
  }
  return {
    fresh,
    commit() {
      for (const key of additions) base.add(key);
      return base;
    },
  };
}
