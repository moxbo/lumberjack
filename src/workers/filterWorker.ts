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

import { compileDcFilter, matchesCompiledDcFilter } from "../utils/dcMatch";
// Geteilte msgMatches-Implementierung nutzen: sie cached tokenisierte
// Ausdrücke (tokenCache), sodass der Filter-Ausdruck NICHT pro Eintrag neu
// tokenisiert wird. Die bisherige lokale Kopie tokenisierte den Ausdruck für
// jeden der bis zu 300k Einträge erneut.
import { msgMatches, type SearchMode } from "../utils/msgFilter";

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
  navigationSearch?: string;
  navigationSearchMode?: SearchMode;
}

interface FilterResponse {
  type: "result";
  filteredIndices: number[];
  searchMatchIndices: number[];
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
  fromTs: number | null,
  toTs: number | null,
): boolean {
  if (fromTs === null && toTs === null) return true;
  try {
    const ts = new Date(timestamp as string).getTime();
    if (isNaN(ts)) return true; // Invalid timestamps pass through

    if (fromTs !== null && ts < fromTs) return false;
    if (toTs !== null && ts > toTs) return false;

    return true;
  } catch {
    return true;
  }
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
  const searchMatchIndices: number[] = [];
  const navigationSearch = String(options.navigationSearch || "").trim();
  const levelFilter = options.filter.level.toUpperCase();
  const loggerFilter = options.filter.logger.toLowerCase();
  const threadFilter = options.filter.thread.toLowerCase();
  const parsedFrom = options.timeFilterFrom
    ? new Date(options.timeFilterFrom).getTime()
    : NaN;
  const parsedTo = options.timeFilterTo
    ? new Date(options.timeFilterTo).getTime()
    : NaN;
  const fromTs = Number.isNaN(parsedFrom) ? null : parsedFrom;
  const toTs = Number.isNaN(parsedTo) ? null : parsedTo;
  const compiledDcFilter = options.dcFilterEnabled
    ? compileDcFilter(options.dcFilterEntries)
    : [];

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
      if (levelFilter) {
        const lev = String(e.level || "").toUpperCase();
        if (lev !== levelFilter) {
          stats.rejectedByLevel++;
          continue;
        }
      }

      // Logger filter
      if (loggerFilter) {
        if (
          !String(e.logger || "")
            .toLowerCase()
            .includes(loggerFilter)
        ) {
          stats.rejectedByLogger++;
          continue;
        }
      }

      // Thread filter
      if (threadFilter) {
        if (
          !String(e.thread || "")
            .toLowerCase()
            .includes(threadFilter)
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
      if (!matchesTimeRange(e.timestamp, fromTs, toTs)) {
        stats.rejectedByTime++;
        continue;
      }
    }

    // DC filter
    if (options.dcFilterEnabled) {
      if (!matchesCompiledDcFilter(e.mdc, compiledDcFilter)) {
        stats.rejectedByDC++;
        continue;
      }
    }

    stats.passed++;
    const visualIndex = filteredIndices.length;
    filteredIndices.push(i);
    if (
      navigationSearch &&
      visualIndex < 50_000 &&
      msgMatches(String(e.message ?? ""), navigationSearch, {
        mode: options.navigationSearchMode,
      })
    ) {
      searchMatchIndices.push(visualIndex);
    }
  }

  return {
    type: "result",
    filteredIndices,
    searchMatchIndices,
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
