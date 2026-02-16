// filepath: /Users/mo/develop/my-electron-app/src/hooks/useFilterWorker.ts
/**
 * Filter Worker Hook
 *
 * Nutzt bevorzugt den Electron 40+ UtilityProcess für bessere Performance.
 * Fällt auf Web Worker oder synchrones Filtering zurück wenn nötig.
 *
 * Vorteile des UtilityProcess:
 * - Eigener V8-Isolate (bessere Memory-Isolation)
 * - Kein Blob-URL-Workaround nötig
 * - Bessere Performance bei großen Datensätzen (>5000 Entries)
 */
import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import { msgMatches } from "../utils/msgFilter";

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
  /** True wenn UtilityProcess verwendet wird, false für Web Worker/Sync */
  useUtilityProcess: boolean;
}

// Threshold for using worker/utility process (entries count)
// Lowered from 10000 to 5000 for better responsiveness with large datasets
const WORKER_THRESHOLD = 5000;

// Max entries per postMessage to prevent DataCloneError (out of memory)
// Large entries with raw/stackTrace can exhaust memory during structured clone
const MAX_ENTRIES_PER_MESSAGE = 50000;

/**
 * Slim entry type - only fields needed for filtering
 * Prevents DataCloneError by not transferring large raw/stackTrace fields
 */
interface SlimEntry {
  level?: string | null;
  logger?: string | null;
  thread?: string | null;
  message?: string | null;
  timestamp?: string | number | Date | null;
  source?: string | null;
  mdc?: Record<string, unknown> | null;
  _mark?: string | null;
}

/**
 * Project full entries to slim entries for worker transfer
 * This prevents DataCloneError: out of memory when transferring large datasets
 */
function projectToSlimEntries(entries: unknown[]): SlimEntry[] {
  const result: SlimEntry[] = new Array(entries.length);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] as Record<string, unknown> | null;
    if (!e) {
      result[i] = {};
      continue;
    }
    // Only copy fields needed for filtering - skip raw, stackTrace, etc.
    result[i] = {
      level: e.level as string | null | undefined,
      logger: e.logger as string | null | undefined,
      thread: e.thread as string | null | undefined,
      message: e.message as string | null | undefined,
      timestamp: e.timestamp as string | number | Date | null | undefined,
      source: e.source as string | null | undefined,
      mdc: e.mdc as Record<string, unknown> | null | undefined,
      _mark: e._mark as string | null | undefined,
    };
  }
  return result;
}

// Worker code as a function string (avoids template literal escaping issues)
function getWorkerCode(): string {
  return [
    // Full msgMatches implementation with AND, OR, NOT operators and escape support
    "function msgMatches(message, pattern) {",
    "  if (!pattern) return true;",
    '  var rawMsg = String(message || "");',
    "  var rawExpr = pattern.trim();",
    "  if (!rawExpr) return true;",
    "",
    "  var m = rawMsg.toLowerCase();",
    "  var q = rawExpr.toLowerCase();",
    "",
    "  // Tokenizer with escape support",
    "  function tokenize(s) {",
    "    var toks = [];",
    "    var i = 0;",
    "    var N = s.length;",
    "    function isOp(ch) {",
    '      return ch === "&" || ch === "|" || ch === "!" || ch === "(" || ch === ")";',
    "    }",
    "    while (i < N) {",
    "      var ch = s[i];",
    '      if (ch <= " ") { i++; continue; }',
    "      // Escape handling",
    '      if (ch === "\\\\" && i + 1 < N) {',
    "        var j = i;",
    '        var word = "";',
    "        while (j < N) {",
    "          var c = s[j];",
    '          if (c <= " ") break;',
    '          if (c === "\\\\" && j + 1 < N) {',
    "            word += s[j + 1];",
    "            j += 2;",
    "            continue;",
    "          }",
    "          if (isOp(c)) break;",
    "          word += c;",
    "          j++;",
    "        }",
    '        if (word) toks.push({ t: "WORD", v: word });',
    "        i = j;",
    "        continue;",
    "      }",
    "      if (isOp(ch)) {",
    '        if (ch === "&") toks.push({ t: "AND" });',
    '        else if (ch === "|") toks.push({ t: "OR" });',
    '        else if (ch === "!") toks.push({ t: "NOT" });',
    '        else if (ch === "(") toks.push({ t: "LPAREN" });',
    '        else if (ch === ")") toks.push({ t: "RPAREN" });',
    "        i++;",
    "        continue;",
    "      }",
    "      // Collect word with escape support",
    "      var j = i;",
    '      var word = "";',
    "      while (j < N) {",
    "        var c = s[j];",
    '        if (c <= " ") break;',
    '        if (c === "\\\\" && j + 1 < N) {',
    "          word += s[j + 1];",
    "          j += 2;",
    "          continue;",
    "        }",
    "        if (isOp(c)) break;",
    "        word += c;",
    "        j++;",
    "      }",
    '      if (word) toks.push({ t: "WORD", v: word });',
    "      i = j;",
    "    }",
    "    return toks;",
    "  }",
    "",
    "  var tokens = tokenize(q);",
    "  if (tokens.length === 0) return true;",
    "",
    "  var pos = 0;",
    "  function peek() { return tokens[pos]; }",
    "  function take() { return tokens[pos++]; }",
    "",
    "  function evalPrimary() {",
    "    var tk = peek();",
    "    if (!tk) return true;",
    '    if (tk.t === "WORD") { take(); return m.indexOf(tk.v) !== -1; }',
    '    if (tk.t === "LPAREN") {',
    "      take();",
    "      var val = evalOr();",
    '      if (peek() && peek().t === "RPAREN") take();',
    "      return val;",
    "    }",
    "    take();",
    "    return true;",
    "  }",
    "",
    "  function evalNot() {",
    "    var neg = false;",
    '    while (peek() && peek().t === "NOT") { take(); neg = !neg; }',
    "    var v = evalPrimary();",
    "    return neg ? !v : v;",
    "  }",
    "",
    "  function skipPrimary() {",
    "    var tk = peek();",
    "    if (!tk) return;",
    '    if (tk.t === "WORD") { take(); return; }',
    '    if (tk.t === "LPAREN") {',
    "      take();",
    "      skipOr();",
    '      if (peek() && peek().t === "RPAREN") take();',
    "      return;",
    "    }",
    "    take();",
    "  }",
    "",
    "  function skipNotExpr() {",
    '    while (peek() && peek().t === "NOT") take();',
    "    skipPrimary();",
    "  }",
    "",
    "  function skipAnd() {",
    "    skipNotExpr();",
    '    while (peek() && peek().t === "AND") { take(); skipNotExpr(); }',
    "  }",
    "",
    "  function skipOr() {",
    "    skipAnd();",
    '    while (peek() && peek().t === "OR") { take(); skipAnd(); }',
    "  }",
    "",
    "  function evalAnd() {",
    "    var left = evalNot();",
    '    while (peek() && peek().t === "AND") {',
    "      take();",
    "      if (!left) { skipNotExpr(); }",
    "      else { left = evalNot(); }",
    "    }",
    "    return left;",
    "  }",
    "",
    "  function evalOr() {",
    "    var left = evalAnd();",
    '    while (peek() && peek().t === "OR") {',
    "      take();",
    "      if (left) { skipAnd(); }",
    "      else { left = evalAnd(); }",
    "    }",
    "    return left;",
    "  }",
    "",
    "  return evalOr();",
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
    "  // Group entries by key (OR within key, AND across keys)",
    "  var entriesByKey = {};",
    "  for (var i = 0; i < activeEntries.length; i++) {",
    "    var entry = activeEntries[i];",
    "    var key = entry.key.toLowerCase();",
    "    if (!entriesByKey[key]) entriesByKey[key] = [];",
    "    entriesByKey[key].push(entry.value.toLowerCase());",
    "  }",
    "  var keyGroups = Object.keys(entriesByKey);",
    "  for (var g = 0; g < keyGroups.length; g++) {",
    "    var groupKey = keyGroups[g];",
    "    var allowedValues = entriesByKey[groupKey];",
    "    var keyMatched = false;",
    "    var mdcKeys = Object.keys(mdc);",
    "    for (var j = 0; j < mdcKeys.length; j++) {",
    "      var k = mdcKeys[j];",
    "      if (k.toLowerCase() === groupKey) {",
    '        var val = String(mdc[k] || "").toLowerCase();',
    "        if (allowedValues.indexOf(val) !== -1) {",
    "          keyMatched = true;",
    "          break;",
    "        }",
    "      }",
    "    }",
    "    if (!keyMatched) return false;",
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
 * Hook that uses UtilityProcess (Electron 40+) or Web Worker for filtering large datasets.
 * Falls back to synchronous filtering for smaller datasets or when UtilityProcess unavailable.
 *
 * Priority:
 * 1. UtilityProcess (best performance, separate process)
 * 2. Web Worker (fallback, runs in renderer thread pool)
 * 3. Synchronous (for small datasets < 5000 entries)
 */
export function useFilterWorker(): UseFilterWorkerResult {
  const [filteredIndices, setFilteredIndices] = useState<number[]>([]);
  const [isFiltering, setIsFiltering] = useState(false);
  const [stats, setStats] = useState<FilterStats | null>(null);
  const [useUtilityProcess, setUseUtilityProcess] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const workerUrlRef = useRef<string | null>(null);
  const pendingRequestRef = useRef<number>(0);
  const utilityProcessAvailableRef = useRef<boolean | null>(null);

  // Check if UtilityProcess is available on mount
  useEffect(() => {
    const checkUtilityProcess = async (): Promise<void> => {
      try {
        if (window.api?.filterIsAvailable) {
          const result = await window.api.filterIsAvailable();
          utilityProcessAvailableRef.current = result.ok && result.available;
          setUseUtilityProcess(result.ok && result.available);
          if (result.ok && result.available) {
            console.warn(
              "[FilterWorker] UtilityProcess available, using for large datasets",
            );
          }
        }
      } catch {
        utilityProcessAvailableRef.current = false;
      }
    };
    void checkUtilityProcess();
  }, []);

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
            const msg = String(e.message || "");
            if (!msgMatches(msg, options.filter.message)) {
              filterStats.rejectedByMessage++;
              continue;
            }
          }
        }

        // DC Filter support for synchronous filtering
        if (options.dcFilterEnabled && options.dcFilterEntries) {
          const activeEntries = options.dcFilterEntries.filter(
            (entry) => entry.active,
          );
          if (activeEntries.length > 0) {
            const mdc = e.mdc as Record<string, unknown> | null | undefined;
            if (!mdc || typeof mdc !== "object") {
              filterStats.rejectedByDC++;
              continue;
            }
            let dcMatched = true;
            for (const entry of activeEntries) {
              const key = entry.key.toLowerCase();
              let found = false;
              for (const mdcKey of Object.keys(mdc)) {
                if (mdcKey.toLowerCase() === key) {
                  const val = String(mdc[mdcKey] || "").toLowerCase();
                  if (val === entry.value.toLowerCase()) {
                    found = true;
                    break;
                  }
                }
              }
              if (!found) {
                dcMatched = false;
                break;
              }
            }
            if (!dcMatched) {
              filterStats.rejectedByDC++;
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

  // Main filter function - uses UtilityProcess, Web Worker, or sync based on availability
  const filterEntries = useCallback(
    (entries: unknown[], options: FilterOptions) => {
      const requestId = Date.now();
      pendingRequestRef.current = requestId;

      // For small datasets, use synchronous filtering (fastest for small data)
      if (entries.length <= WORKER_THRESHOLD) {
        const result = filterSync(entries, options);
        setFilteredIndices(result.indices);
        setStats(result.stats);
        setIsFiltering(false);
        return;
      }

      // For large datasets, prefer UtilityProcess (Electron 40+)
      if (utilityProcessAvailableRef.current && window.api?.filterEntries) {
        setIsFiltering(true);

        try {
          // Check if dataset is too large for IPC transfer
          if (entries.length > MAX_ENTRIES_PER_MESSAGE) {
            console.warn(
              `[FilterWorker] Dataset too large for UtilityProcess (${entries.length} entries), falling back to sync`,
            );
            const syncResult = filterSync(entries, options);
            setFilteredIndices(syncResult.indices);
            setStats(syncResult.stats);
            setIsFiltering(false);
            return;
          }

          // Project to slim entries to prevent DataCloneError (out of memory)
          const slimEntries = projectToSlimEntries(entries);

          window.api
            .filterEntries(slimEntries, options)
            .then((result) => {
              // Only apply if this is still the current request
              if (pendingRequestRef.current === requestId) {
                if (result.ok) {
                  setFilteredIndices(result.filteredIndices);
                  setStats(result.stats);
                } else {
                  // UtilityProcess failed, fall back to sync
                  console.warn(
                    "[FilterWorker] UtilityProcess failed, falling back to sync:",
                    result.error,
                  );
                  const syncResult = filterSync(entries, options);
                  setFilteredIndices(syncResult.indices);
                  setStats(syncResult.stats);
                }
                setIsFiltering(false);
              }
            })
            .catch((error) => {
              console.warn("[FilterWorker] UtilityProcess error:", error);
              // Fall back to sync on error
              if (pendingRequestRef.current === requestId) {
                const syncResult = filterSync(entries, options);
                setFilteredIndices(syncResult.indices);
                setStats(syncResult.stats);
                setIsFiltering(false);
              }
            });
        } catch (error) {
          // Handle DataCloneError or other IPC errors
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.warn("[FilterWorker] IPC call failed:", errorMessage);
          const syncResult = filterSync(entries, options);
          setFilteredIndices(syncResult.indices);
          setStats(syncResult.stats);
          setIsFiltering(false);
        }
        return;
      }

      // Fall back to Web Worker
      if (workerRef.current) {
        setIsFiltering(true);

        try {
          // Check if dataset is too large for postMessage
          if (entries.length > MAX_ENTRIES_PER_MESSAGE) {
            console.warn(
              `[FilterWorker] Dataset too large for Web Worker (${entries.length} entries), falling back to sync`,
            );
            const syncResult = filterSync(entries, options);
            setFilteredIndices(syncResult.indices);
            setStats(syncResult.stats);
            setIsFiltering(false);
            return;
          }

          // Project to slim entries to prevent DataCloneError (out of memory)
          // Only transfer fields needed for filtering, skip raw/stackTrace/etc.
          const slimEntries = projectToSlimEntries(entries);

          workerRef.current.postMessage({
            type: "filter",
            entries: slimEntries,
            options,
            requestId,
          });
        } catch (error) {
          // Handle DataCloneError (out of memory) or other postMessage errors
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.warn("[FilterWorker] postMessage failed:", errorMessage);

          // Fall back to synchronous filtering
          const syncResult = filterSync(entries, options);
          setFilteredIndices(syncResult.indices);
          setStats(syncResult.stats);
          setIsFiltering(false);
        }
      } else {
        // Last resort: synchronous filtering
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
    useUtilityProcess,
  };
}
