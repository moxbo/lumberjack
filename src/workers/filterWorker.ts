// filepath: /Users/mo/develop/my-electron-app/src/workers/filterWorker.ts
/**
 * Web Worker für das Filtern großer Log-Mengen.
 * Wird verwendet, wenn mehr als 10.000 Einträge gefiltert werden müssen.
 */

// Message types
interface FilterRequest {
  type: "filter";
  entries: any[];
  options: FilterOptions;
}

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

// Simple message matching (supports wildcards * and ?)
function msgMatches(message: unknown, pattern: string): boolean {
  if (!pattern) return true;
  const msg = String(message || "").toLowerCase();
  const pat = pattern.toLowerCase().trim();

  if (!pat) return true;

  // Simple wildcard support
  if (pat.includes("*") || pat.includes("?")) {
    const regexPattern = pat
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    try {
      const regex = new RegExp(regexPattern, "i");
      return regex.test(msg);
    } catch {
      return msg.includes(pat);
    }
  }

  return msg.includes(pat);
}

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
function matchesDcFilter(
  mdc: Record<string, unknown> | undefined,
  dcEntries: Array<{ key: string; value: string; active: boolean }>,
): boolean {
  if (!dcEntries || dcEntries.length === 0) return true;

  const activeEntries = dcEntries.filter((e) => e.active);
  if (activeEntries.length === 0) return true;

  if (!mdc || typeof mdc !== "object") return false;

  // All active DC entries must match (AND logic)
  for (const entry of activeEntries) {
    const key = entry.key.toLowerCase();
    let found = false;

    for (const [k, v] of Object.entries(mdc)) {
      if (k.toLowerCase() === key) {
        const val = String(v || "").toLowerCase();
        if (val === entry.value.toLowerCase()) {
          found = true;
          break;
        }
      }
    }

    if (!found) return false;
  }

  return true;
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
        if (!msgMatches(e.message, options.filter.message)) {
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
self.onmessage = (event: MessageEvent<FilterRequest>) => {
  const { type, entries, options } = event.data;

  if (type === "filter") {
    const result = filterEntries(entries, options);
    self.postMessage(result);
  }
};

// Export for type checking
export type { FilterRequest, FilterResponse, FilterOptions, FilterStats };
