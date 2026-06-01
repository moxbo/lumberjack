// filepath: /Users/mo/develop/my-electron-app/src/workers/filterWorker.ts
/**
 * Web Worker für das Filtern großer Log-Mengen.
 *
 * Der Worker ist *zustandsbehaftet*: Einträge werden einmal per `setEntries`
 * (und inkrementell per `appendEntries`) in den Worker geladen und dort
 * gecached. Beim eigentlichen Filtern muss nur noch die (kleine) Optionen-
 * Nachricht gesendet werden – nicht erneut der komplette Datensatz. Das
 * verhindert, dass bei 300k+ Einträgen pro Tastendruck Hunderttausende
 * Objekte über die postMessage-Grenze geklont werden (Haupt-Thread-Blocker).
 */

import { matchesDcFilter as sharedMatchesDcFilter } from "../utils/dcMatch";
// Geteilte msgMatches-Implementierung nutzen: sie cached tokenisierte
// Ausdrücke (tokenCache), sodass der Filter-Ausdruck NICHT pro Eintrag neu
// tokenisiert wird. Die bisherige lokale Kopie tokenisierte den Ausdruck für
// jeden der bis zu 300k Einträge erneut.
import { msgMatches } from "../utils/msgFilter";

// Message types
interface SetEntriesRequest {
  type: "setEntries";
  entries: any[];
}

interface AppendEntriesRequest {
  type: "appendEntries";
  entries: any[];
}

interface FilterRequest {
  type: "filter";
  /**
   * Optional: Wenn vorhanden, werden diese Einträge gefiltert (Legacy-Pfad,
   * z.B. Tests). Fehlt das Feld, wird der im Worker gecachte Datensatz genutzt.
   */
  entries?: any[];
  options: FilterOptions;
  /** Optional request id used by the consumer to discard stale results. */
  requestId?: number;
}

type WorkerRequest = SetEntriesRequest | AppendEntriesRequest | FilterRequest;

interface FilterOptions {
  stdFiltersEnabled: boolean;
  filter: {
    level: string;
    logger: string;
    thread: string;
    message: string;
  };
  onlyMarked: boolean;
  dcFilterEnabled: boolean;
  dcFilterEntries: Array<{ key: string; value: string; active: boolean }>;
  timeFilterEnabled: boolean;
  timeFilterFrom?: string;
  timeFilterTo?: string;
}

interface FilterResponse {
  type: "result";
  filteredIndices: number[];
  stats: FilterStats;
  /** Echoed back from the request so the caller can drop stale results. */
  requestId?: number;
}

interface FilterStats {
  total: number;
  passed: number;
  rejectedByOnlyMarked: number;
  rejectedByLevel: number;
  rejectedByLogger: number;
  rejectedByThread: number;
  rejectedByMessage: number;
  rejectedByTime: number;
  rejectedByDC: number;
}

// Token types for the parser
// (Die Tokenizer/Parser-Logik lebt jetzt zentral in ../utils/msgFilter.ts.)

// Check if timestamp is within time range
function matchesTimeRange(
  timestamp: unknown,
  from?: string,
  to?: string,
): boolean {
  if (!from && !to) return true;

  try {
    const ts = new Date(timestamp as string).getTime();
    if (isNaN(ts)) return true; // Invalid timestamps pass through

    if (from) {
      const fromTs = new Date(from).getTime();
      if (!isNaN(fromTs) && ts < fromTs) return false;
    }

    if (to) {
      const toTs = new Date(to).getTime();
      if (!isNaN(toTs) && ts > toTs) return false;
    }

    return true;
  } catch {
    return true;
  }
}

// Check if entry matches DC filter
// Logic: OR for same keys (e.g., TraceID=A OR TraceID=B), AND across different keys.
// Supports wildcards (empty value) and trace-key variants.
// Implementation: shared module src/utils/dcMatch.ts (single source of truth).
function matchesDcFilter(
  mdc: Record<string, unknown> | undefined,
  dcEntries: Array<{ key: string; value: string; active: boolean }>,
): boolean {
  return sharedMatchesDcFilter(mdc, dcEntries);
}

// Main filter function
function filterEntries(entries: any[], options: FilterOptions): FilterResponse {
  const stats: FilterStats = {
    total: 0,
    passed: 0,
    rejectedByOnlyMarked: 0,
    rejectedByLevel: 0,
    rejectedByLogger: 0,
    rejectedByThread: 0,
    rejectedByMessage: 0,
    rejectedByTime: 0,
    rejectedByDC: 0,
  };

  const filteredIndices: number[] = [];

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    stats.total++;

    if (!e) continue;

    // Only marked filter
    if (options.onlyMarked && !e._mark) {
      stats.rejectedByOnlyMarked++;
      continue;
    }

    // Standard filters
    if (options.stdFiltersEnabled) {
      // Level filter
      if (options.filter.level) {
        const lev = String(e.level || "").toUpperCase();
        if (lev !== options.filter.level.toUpperCase()) {
          stats.rejectedByLevel++;
          continue;
        }
      }

      // Logger filter
      if (options.filter.logger) {
        const q = options.filter.logger.toLowerCase();
        if (
          !String(e.logger || "")
            .toLowerCase()
            .includes(q)
        ) {
          stats.rejectedByLogger++;
          continue;
        }
      }

      // Thread filter
      if (options.filter.thread) {
        const q = options.filter.thread.toLowerCase();
        if (
          !String(e.thread || "")
            .toLowerCase()
            .includes(q)
        ) {
          stats.rejectedByThread++;
          continue;
        }
      }

      // Message filter
      if (options.filter.message) {
        if (!msgMatches(String(e.message ?? ""), options.filter.message)) {
          stats.rejectedByMessage++;
          continue;
        }
      }
    }

    // Time filter (only for Elastic sources)
    const isElasticSrc =
      typeof e?.source === "string" && e.source.startsWith("elastic://");
    if (isElasticSrc && options.timeFilterEnabled) {
      if (
        !matchesTimeRange(
          e.timestamp,
          options.timeFilterFrom,
          options.timeFilterTo,
        )
      ) {
        stats.rejectedByTime++;
        continue;
      }
    }

    // DC filter
    if (options.dcFilterEnabled) {
      if (!matchesDcFilter(e.mdc, options.dcFilterEntries)) {
        stats.rejectedByDC++;
        continue;
      }
    }

    stats.passed++;
    filteredIndices.push(i);
  }

  return {
    type: "result",
    filteredIndices,
    stats,
  };
}

// Worker message handler
//
// Zustandsbehafteter Cache: Der Worker hält die zuletzt per setEntries/
// appendEntries übertragenen Einträge. So muss beim Filtern (häufig, z.B. bei
// jedem Tastendruck) der Datensatz nicht erneut geklont werden.
let cachedEntries: any[] = [];

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const data = event.data;
  const type = data?.type;

  if (type === "setEntries") {
    cachedEntries = data.entries || [];
    return;
  }

  if (type === "appendEntries") {
    const add = data.entries;
    if (add && add.length) {
      // In-place anhängen, um eine erneute Allokation des Gesamt-Arrays zu
      // vermeiden (wichtig bei Streaming-Quellen mit vielen kleinen Updates).
      for (let i = 0; i < add.length; i++) cachedEntries.push(add[i]);
    }
    return;
  }

  if (type === "filter") {
    // Legacy/Test-Pfad: Wenn entries mitgesendet werden, diese nutzen;
    // ansonsten den gecachten Datensatz filtern.
    const entries = data.entries !== undefined ? data.entries : cachedEntries;
    const result = filterEntries(entries, data.options);
    if (data.requestId !== undefined) result.requestId = data.requestId;
    self.postMessage(result);
  }
};

// Export for type checking
export type {
  FilterRequest,
  FilterResponse,
  FilterOptions,
  FilterStats,
  SetEntriesRequest,
  AppendEntriesRequest,
};
