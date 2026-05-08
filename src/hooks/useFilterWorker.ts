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
import { entrySignature } from "../utils/entryUtils";
import {
  filterIsAvailable,
  filterEntries as typedFilterEntries,
} from "../utils/typedApi";

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
  /**
   * @param entries  Vollständige Renderer-Einträge.
   * @param options  Filter-Optionen.
   * @param marksMap Optional: Map signature → Farbe. Wird genutzt, um
   *                 `_mark` für `onlyMarked` und für die Worker-Projektion
   *                 nachzuschlagen, ohne dass das Feld in den Entry-Objekten
   *                 selbst gepflegt werden muss (Performance-Quick-Win #2).
   */
  filterEntries: (
    entries: unknown[],
    options: FilterOptions,
    marksMap?: Record<string, string>,
  ) => void;
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
 *
 * `marksMap` (signature → color) wird – falls vorhanden – genutzt, um das
 * `_mark`-Feld zu projizieren, ohne dass die Renderer-Entries selbst eine
 * `_mark`-Property tragen müssen.
 */
function projectToSlimEntries(
  entries: unknown[],
  marksMap?: Record<string, string>,
): SlimEntry[] {
  const result: SlimEntry[] = new Array(entries.length);
  const hasMarks = !!marksMap && Object.keys(marksMap).length > 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] as Record<string, unknown> | null;
    if (!e) {
      result[i] = {};
      continue;
    }
    let mark: string | null | undefined = e._mark as string | null | undefined;
    if (hasMarks && mark == null) {
      try {
        const sig = entrySignature(e as any);
        const c = marksMap![sig];
        if (c) mark = c;
      } catch {
        /* ignore */
      }
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
      _mark: mark,
    };
  }
  return result;
}

/**
 * Hook that uses UtilityProcess (Electron 40+) or Web Worker for filtering large datasets.
 * Falls back to synchronous filtering for kleinere Datensätze oder wenn UtilityProcess nicht verfügbar ist.
 *
 * Priorität:
 * 1. UtilityProcess (beste Performance, separater Prozess)
 * 2. Web Worker (Fallback, läuft im Renderer-Thread-Pool)
 * 3. Synchron (für kleine Datensätze < 5000 Einträge)
 */
export function useFilterWorker(): UseFilterWorkerResult {
  const [filteredIndices, setFilteredIndices] = useState<number[]>([]);
  const [isFiltering, setIsFiltering] = useState(false);
  const [stats, setStats] = useState<FilterStats | null>(null);
  const [useUtilityProcess, setUseUtilityProcess] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const pendingRequestRef = useRef<number>(0);
  const utilityProcessAvailableRef = useRef<boolean | null>(null);

  // Check if UtilityProcess is available on mount
  useEffect(() => {
    const checkUtilityProcess = async (): Promise<void> => {
      try {
        const available = await filterIsAvailable();
        utilityProcessAvailableRef.current = available;
        setUseUtilityProcess(available);
        if (available) {
          console.warn(
            "[FilterWorker] UtilityProcess available, using for large datasets",
          );
        }
      } catch {
        utilityProcessAvailableRef.current = false;
      }
    };
    void checkUtilityProcess();
  }, []);

  // Initialize worker
  // Performance-Quick-Win #3: Wir laden den Worker direkt aus
  // ../workers/filterWorker.ts via Vite-Worker-Import. Vorher wurde der
  // Worker-Code als ~310 Zeilen langer String konkateniert und über eine
  // Blob-URL geladen – das verhinderte Tree-Shaking, ESM-Modules,
  // Source-Maps und musste parallel zur "echten" filterWorker.ts gepflegt
  // werden. Vite bündelt den Worker als eigenen Chunk (worker.format: "es"
  // ist in vite.config.mjs gesetzt) und die CSP erlaubt `worker-src 'self'`.
  useEffect(() => {
    try {
      workerRef.current = new Worker(
        new URL("../workers/filterWorker.ts", import.meta.url),
        { type: "module" },
      );

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
      marksMap?: Record<string, string>,
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
      const hasMarks = !!marksMap && Object.keys(marksMap).length > 0;

      for (let i = 0; i < entries.length; i++) {
        const e = entries[i] as Record<string, unknown> | null;
        filterStats.total++;
        if (!e) continue;

        if (options.onlyMarked) {
          let mark: unknown = e._mark;
          if (mark == null && hasMarks) {
            try {
              mark = marksMap![entrySignature(e as any)];
            } catch {
              /* ignore */
            }
          }
          if (!mark) {
            filterStats.rejectedByOnlyMarked++;
            continue;
          }
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
    (
      entries: unknown[],
      options: FilterOptions,
      marksMap?: Record<string, string>,
    ) => {
      const requestId = Date.now();
      pendingRequestRef.current = requestId;

      // For small datasets, use synchronous filtering (fastest for small data)
      if (entries.length <= WORKER_THRESHOLD) {
        const result = filterSync(entries, options, marksMap);
        setFilteredIndices(result.indices);
        setStats(result.stats);
        setIsFiltering(false);
        return;
      }

      // For large datasets, prefer UtilityProcess (Electron 40+)
      if (utilityProcessAvailableRef.current) {
        setIsFiltering(true);

        try {
          // Check if dataset is too large for IPC transfer
          if (entries.length > MAX_ENTRIES_PER_MESSAGE) {
            console.warn(
              `[FilterWorker] Dataset too large for UtilityProcess (${entries.length} entries), falling back to sync`,
            );
            const syncResult = filterSync(entries, options, marksMap);
            setFilteredIndices(syncResult.indices);
            setStats(syncResult.stats);
            setIsFiltering(false);
            return;
          }

          // Project to slim entries to prevent DataCloneError (out of memory)
          const slimEntries = projectToSlimEntries(entries, marksMap);

          typedFilterEntries(slimEntries, options)
            .then((result: import("../types/ipc").FilterResult) => {
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
                  const syncResult = filterSync(entries, options, marksMap);
                  setFilteredIndices(syncResult.indices);
                  setStats(syncResult.stats);
                }
                setIsFiltering(false);
              }
            })
            .catch((error: unknown) => {
              console.warn("[FilterWorker] UtilityProcess error:", error);
              // Fall back to sync on error
              if (pendingRequestRef.current === requestId) {
                const syncResult = filterSync(entries, options, marksMap);
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
          const syncResult = filterSync(entries, options, marksMap);
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
            const syncResult = filterSync(entries, options, marksMap);
            setFilteredIndices(syncResult.indices);
            setStats(syncResult.stats);
            setIsFiltering(false);
            return;
          }

          // Project to slim entries to prevent DataCloneError (out of memory)
          // Only transfer fields needed for filtering, skip raw/stackTrace/etc.
          const slimEntries = projectToSlimEntries(entries, marksMap);

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
          const syncResult = filterSync(entries, options, marksMap);
          setFilteredIndices(syncResult.indices);
          setStats(syncResult.stats);
          setIsFiltering(false);
        }
      } else {
        // Last resort: synchronous filtering
        const result = filterSync(entries, options, marksMap);
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
