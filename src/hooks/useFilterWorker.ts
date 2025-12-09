// filepath: /Users/mo/develop/my-electron-app/src/hooks/useFilterWorker.ts
import { useState, useEffect, useRef, useCallback } from "preact/hooks";

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

interface UseFilterWorkerResult {
  filteredIndices: number[];
  isFiltering: boolean;
  stats: FilterStats | null;
  filterEntries: (entries: unknown[], options: FilterOptions) => void;
}

// Threshold for using web worker (entries count)
const WORKER_THRESHOLD = 10000;

// Worker code as a function string (avoids template literal escaping issues)
function getWorkerCode(): string {
  return [
    "function msgMatches(message, pattern) {",
    "  if (!pattern) return true;",
    '  var msg = String(message || "").toLowerCase();',
    "  var pat = pattern.toLowerCase().trim();",
    "  if (!pat) return true;",
    "  return msg.indexOf(pat) !== -1;",
    "}",
    "",
    "function matchesTimeRange(timestamp, from, to) {",
    "  if (!from && !to) return true;",
    "  try {",
    "    var ts = new Date(timestamp).getTime();",
    "    if (isNaN(ts)) return true;",
    "    if (from) {",
    "      var fromTs = new Date(from).getTime();",
    "      if (!isNaN(fromTs) && ts < fromTs) return false;",
    "    }",
    "    if (to) {",
    "      var toTs = new Date(to).getTime();",
    "      if (!isNaN(toTs) && ts > toTs) return false;",
    "    }",
    "    return true;",
    "  } catch (e) {",
    "    return true;",
    "  }",
    "}",
    "",
    "function matchesDcFilter(mdc, dcEntries) {",
    "  if (!dcEntries || dcEntries.length === 0) return true;",
    "  var activeEntries = dcEntries.filter(function(e) { return e.active; });",
    "  if (activeEntries.length === 0) return true;",
    '  if (!mdc || typeof mdc !== "object") return false;',
    "  for (var i = 0; i < activeEntries.length; i++) {",
    "    var entry = activeEntries[i];",
    "    var key = entry.key.toLowerCase();",
    "    var found = false;",
    "    var keys = Object.keys(mdc);",
    "    for (var j = 0; j < keys.length; j++) {",
    "      var k = keys[j];",
    "      if (k.toLowerCase() === key) {",
    '        var val = String(mdc[k] || "").toLowerCase();',
    "        if (val === entry.value.toLowerCase()) {",
    "          found = true;",
    "          break;",
    "        }",
    "      }",
    "    }",
    "    if (!found) return false;",
    "  }",
    "  return true;",
    "}",
    "",
    "self.onmessage = function(event) {",
    "  var data = event.data;",
    "  var type = data.type;",
    "  var entries = data.entries;",
    "  var options = data.options;",
    "  var requestId = data.requestId;",
    '  if (type !== "filter") return;',
    "",
    "  var stats = {",
    "    total: 0, passed: 0,",
    "    rejectedByOnlyMarked: 0, rejectedByLevel: 0,",
    "    rejectedByLogger: 0, rejectedByThread: 0,",
    "    rejectedByMessage: 0, rejectedByTime: 0, rejectedByDC: 0",
    "  };",
    "",
    "  var filteredIndices = [];",
    "",
    "  for (var i = 0; i < entries.length; i++) {",
    "    var e = entries[i];",
    "    stats.total++;",
    "    if (!e) continue;",
    "",
    "    if (options.onlyMarked && !e._mark) {",
    "      stats.rejectedByOnlyMarked++;",
    "      continue;",
    "    }",
    "",
    "    if (options.stdFiltersEnabled) {",
    "      if (options.filter.level) {",
    '        var lev = String(e.level || "").toUpperCase();',
    "        if (lev !== options.filter.level.toUpperCase()) {",
    "          stats.rejectedByLevel++;",
    "          continue;",
    "        }",
    "      }",
    "      if (options.filter.logger) {",
    "        var q = options.filter.logger.toLowerCase();",
    '        if (String(e.logger || "").toLowerCase().indexOf(q) === -1) {',
    "          stats.rejectedByLogger++;",
    "          continue;",
    "        }",
    "      }",
    "      if (options.filter.thread) {",
    "        var qt = options.filter.thread.toLowerCase();",
    '        if (String(e.thread || "").toLowerCase().indexOf(qt) === -1) {',
    "          stats.rejectedByThread++;",
    "          continue;",
    "        }",
    "      }",
    "      if (options.filter.message) {",
    "        if (!msgMatches(e.message, options.filter.message)) {",
    "          stats.rejectedByMessage++;",
    "          continue;",
    "        }",
    "      }",
    "    }",
    "",
    '    var isElasticSrc = typeof e.source === "string" && e.source.indexOf("elastic://") === 0;',
    "    if (isElasticSrc && options.timeFilterEnabled) {",
    "      if (!matchesTimeRange(e.timestamp, options.timeFilterFrom, options.timeFilterTo)) {",
    "        stats.rejectedByTime++;",
    "        continue;",
    "      }",
    "    }",
    "",
    "    if (options.dcFilterEnabled) {",
    "      if (!matchesDcFilter(e.mdc, options.dcFilterEntries)) {",
    "        stats.rejectedByDC++;",
    "        continue;",
    "      }",
    "    }",
    "",
    "    stats.passed++;",
    "    filteredIndices.push(i);",
    "  }",
    "",
    '  self.postMessage({ type: "result", filteredIndices: filteredIndices, stats: stats, requestId: requestId });',
    "};",
  ].join("\n");
}

/**
 * Hook that uses a Web Worker for filtering large datasets.
 * Falls back to synchronous filtering for smaller datasets.
 */
export function useFilterWorker(): UseFilterWorkerResult {
  const [filteredIndices, setFilteredIndices] = useState<number[]>([]);
  const [isFiltering, setIsFiltering] = useState(false);
  const [stats, setStats] = useState<FilterStats | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const workerUrlRef = useRef<string | null>(null);
  const pendingRequestRef = useRef<number>(0);

  // Initialize worker
  useEffect(() => {
    try {
      const workerCode = getWorkerCode();
      const blob = new Blob([workerCode], { type: "application/javascript" });
      const workerUrl = URL.createObjectURL(blob);
      workerUrlRef.current = workerUrl;
      workerRef.current = new Worker(workerUrl);

      workerRef.current.onmessage = (event: MessageEvent) => {
        const {
          type,
          filteredIndices: indices,
          stats: workerStats,
          requestId,
        } = event.data;
        if (type === "result" && requestId === pendingRequestRef.current) {
          setFilteredIndices(indices);
          setStats(workerStats);
          setIsFiltering(false);
        }
      };

      workerRef.current.onerror = (error: ErrorEvent) => {
        console.error("[FilterWorker] Error:", error);
        setIsFiltering(false);
      };

      return () => {
        if (workerRef.current) {
          workerRef.current.terminate();
          workerRef.current = null;
        }
        if (workerUrlRef.current) {
          URL.revokeObjectURL(workerUrlRef.current);
          workerUrlRef.current = null;
        }
      };
    } catch (error) {
      console.warn("[FilterWorker] Failed to initialize worker:", error);
      return () => {
        // Cleanup function
      };
    }
  }, []);

  // Synchronous filter function (fallback for small datasets)
  const filterSync = useCallback(
    (
      entries: unknown[],
      options: FilterOptions,
    ): { indices: number[]; stats: FilterStats } => {
      const filterStats: FilterStats = {
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

      const indices: number[] = [];

      for (let i = 0; i < entries.length; i++) {
        const e = entries[i] as Record<string, unknown> | null;
        filterStats.total++;
        if (!e) continue;

        if (options.onlyMarked && !e._mark) {
          filterStats.rejectedByOnlyMarked++;
          continue;
        }

        if (options.stdFiltersEnabled) {
          if (options.filter.level) {
            const lev = String(e.level || "").toUpperCase();
            if (lev !== options.filter.level.toUpperCase()) {
              filterStats.rejectedByLevel++;
              continue;
            }
          }
          if (options.filter.logger) {
            const q = options.filter.logger.toLowerCase();
            if (
              !String(e.logger || "")
                .toLowerCase()
                .includes(q)
            ) {
              filterStats.rejectedByLogger++;
              continue;
            }
          }
          if (options.filter.thread) {
            const q = options.filter.thread.toLowerCase();
            if (
              !String(e.thread || "")
                .toLowerCase()
                .includes(q)
            ) {
              filterStats.rejectedByThread++;
              continue;
            }
          }
          if (options.filter.message) {
            const msg = String(e.message || "").toLowerCase();
            const pat = options.filter.message.toLowerCase();
            if (!msg.includes(pat)) {
              filterStats.rejectedByMessage++;
              continue;
            }
          }
        }

        filterStats.passed++;
        indices.push(i);
      }

      return { indices, stats: filterStats };
    },
    [],
  );

  // Main filter function
  const filterEntries = useCallback(
    (entries: unknown[], options: FilterOptions) => {
      const requestId = Date.now();
      pendingRequestRef.current = requestId;

      // Use worker for large datasets
      if (entries.length > WORKER_THRESHOLD && workerRef.current) {
        setIsFiltering(true);
        workerRef.current.postMessage({
          type: "filter",
          entries,
          options,
          requestId,
        });
      } else {
        // Synchronous filtering for smaller datasets
        const result = filterSync(entries, options);
        setFilteredIndices(result.indices);
        setStats(result.stats);
        setIsFiltering(false);
      }
    },
    [filterSync],
  );

  return {
    filteredIndices,
    isFiltering,
    stats,
    filterEntries,
  };
}
