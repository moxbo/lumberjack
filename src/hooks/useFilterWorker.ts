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
import { msgMatches, type SearchMode } from "../utils/msgFilter";
import { entrySignature } from "../utils/entryUtils";
import { compileDcFilter, matchesCompiledDcFilter } from "../utils/dcMatch";
import {
  filterIsAvailable,
  filterEntries as typedFilterEntries,
} from "../utils/typedApi";

export interface FilterOptions {
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

export interface FilterStats {
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

export interface PagedFilterConfig {
  paged: true;
  databaseName?: string;
  generation?: string | number;
  dataGeneration?: string | number;
  entryCount: number;
  pageSize?: number;
}

export interface UseFilterWorkerResult {
  filteredIndices: number[];
  searchMatchIndices: number[];
  isFiltering: boolean;
  stats: FilterStats | null;
  /** IndexedDB/worker failures. Paged failures never masquerade as empty results. */
  error: Error | null;
  /**
   * @param entries  Renderer entries for legacy mode. Paged mode only uses the
   *                 call as a change trigger and never transfers this array.
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
    config?: PagedFilterConfig,
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
export interface SlimEntry {
  _id?: number;
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
export function projectToSlimEntries(
  entries: unknown[],
  marksMap?: Record<string, string>,
  includeMdc = false,
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
    const slimEntry: SlimEntry = {
      _id: typeof e._id === "number" ? (e._id as number) : undefined,
      level: e.level as string | null | undefined,
      logger: e.logger as string | null | undefined,
      thread: e.thread as string | null | undefined,
      message: e.message as string | null | undefined,
      timestamp: e.timestamp as string | number | Date | null | undefined,
      source: e.source as string | null | undefined,
      _mark: mark,
    };
    if (includeMdc) {
      slimEntry.mdc = e.mdc as Record<string, unknown> | null | undefined;
    }
    result[i] = slimEntry;
  }
  return result;
}

export function resolveFilteredEntryIds(
  entries: unknown[],
  filteredOffsets: readonly number[],
): number[] {
  return filteredOffsets.map((offset) => {
    const entry = entries[offset] as { _id?: unknown } | null | undefined;
    return typeof entry?._id === "number" ? entry._id : offset;
  });
}

function computeSearchMatchIndices(
  entries: unknown[],
  filteredIndices: number[],
  options: FilterOptions,
): number[] {
  const search = String(options.navigationSearch || "").trim();
  if (!search) return [];

  // UtilityProcess filtering still returns legacy array indices, so this helper
  // intentionally treats filteredIndices as direct offsets into `entries`.
  const matches: number[] = [];
  const limit = Math.min(filteredIndices.length, 50_000);
  for (let visualIndex = 0; visualIndex < limit; visualIndex++) {
    const entry = entries[filteredIndices[visualIndex]!] as Record<
      string,
      unknown
    > | null;
    if (
      msgMatches(String(entry?.message ?? ""), search, {
        mode: options.navigationSearchMode,
      })
    ) {
      matches.push(visualIndex);
    }
  }
  return matches;
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
  const [searchMatchIndices, setSearchMatchIndices] = useState<number[]>([]);
  const [isFiltering, setIsFiltering] = useState(false);
  const [stats, setStats] = useState<FilterStats | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [useUtilityProcess, setUseUtilityProcess] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const pendingRequestRef = useRef<number>(0);
  const pendingGenerationRef = useRef<string | number | undefined>(undefined);
  // ID des zuletzt tatsächlich angewendeten Ergebnisses. Der (Single-Thread-)
  // Worker beantwortet Requests strikt in Reihenfolge, daher kommen Ergebnisse
  // mit monoton steigender requestId zurück. Wir wenden jedes Ergebnis an, das
  // NEUER als das zuletzt angewendete ist – nicht nur exakt das allerletzte.
  //
  // Vorher wurde nur `requestId === pendingRequestRef.current` angewendet. Bei
  // kontinuierlichem/schnellem Datenzufluss (Streaming, große Bulk-Ladungen)
  // liegt jedoch immer schon ein neuerer Request an, während der Worker noch
  // ein älteres Ergebnis zurückliefert → JEDES Ergebnis wurde als "veraltet"
  // verworfen. Folge: "Gesamt" stieg, "Gefiltert" blieb stehen und es wurden
  // keine Einträge angezeigt (auch ohne aktiven Filter).
  const lastAppliedRequestRef = useRef<number>(0);
  const utilityProcessAvailableRef = useRef<boolean | null>(null);

  // Monoton steigender Request-Zähler. Date.now() kann bei schnellen Filtern
  // (mehrere im selben ms) kollidieren und so gültige Ergebnisse verwerfen.
  const requestSeqRef = useRef<number>(0);

  // Tracking des zuletzt an den Worker übertragenen Datensatzes, um beim
  // Filtern NICHT erneut den kompletten (ggf. 300k+) Datensatz zu klonen.
  // Wir merken uns die Array-Referenz + Länge, um Anhänge (Streaming) von
  // einem kompletten Austausch zu unterscheiden.
  const syncedEntriesRef = useRef<unknown[] | null>(null);
  const syncedLenRef = useRef<number>(0);
  const syncedIncludesMdcRef = useRef<boolean | null>(null);

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

      // Frischer Worker hat noch keinen gecachten Datensatz.
      syncedEntriesRef.current = null;
      syncedLenRef.current = 0;
      syncedIncludesMdcRef.current = null;
      lastAppliedRequestRef.current = 0;

      workerRef.current.onmessage = (event: MessageEvent) => {
        const {
          type,
          filteredIndices: indices,
          searchMatchIndices: workerSearchMatchIndices,
          stats: workerStats,
          requestId,
          paged,
          message,
          generation,
          partial,
        } = event.data;
        if (
          type === "error" &&
          paged === true &&
          requestId === pendingRequestRef.current
        ) {
          setError(new Error(message || "Paged filtering failed"));
          setIsFiltering(false);
          return;
        }
        // Monoton anwenden: jedes Ergebnis, das neuer ist als das zuletzt
        // angewendete, übernehmen. So bleibt die gefilterte Ansicht auch bei
        // kontinuierlichem Datenzufluss live, statt einzufrieren, weil ein
        // noch neuerer Request bereits aussteht.
        const isApplicablePagedResult =
          paged === true &&
          typeof requestId === "number" &&
          generation === pendingGenerationRef.current &&
          requestId >= lastAppliedRequestRef.current;
        const isApplicableLegacyResult =
          paged !== true &&
          typeof requestId === "number" &&
          requestId > lastAppliedRequestRef.current;
        if (
          type === "result" &&
          typeof requestId === "number" &&
          (isApplicablePagedResult || isApplicableLegacyResult)
        ) {
          lastAppliedRequestRef.current = requestId;
          setError(null);
          setFilteredIndices(indices);
          setSearchMatchIndices(workerSearchMatchIndices || []);
          setStats(workerStats);
          // isFiltering erst zurücksetzen, wenn das aktuell jüngste Ergebnis da
          // ist – sonst würde der Ladeindikator bei jedem Zwischenergebnis
          // flackern, obwohl noch Requests ausstehen.
          if (!partial && requestId >= pendingRequestRef.current) {
            setIsFiltering(false);
          }
        }
      };

      workerRef.current.onerror = (error: ErrorEvent) => {
        console.error("[FilterWorker] Error:", error);
        setError(new Error(error.message || "Filter worker failed"));
        setIsFiltering(false);
      };

      return () => {
        if (workerRef.current) {
          workerRef.current.terminate();
          workerRef.current = null;
        }
        syncedEntriesRef.current = null;
        syncedLenRef.current = 0;
        syncedIncludesMdcRef.current = null;
        lastAppliedRequestRef.current = 0;
      };
    } catch (error) {
      console.warn("[FilterWorker] Failed to initialize worker:", error);
      return () => {
        // Cleanup function
      };
    }
  }, []);

  /**
   * Synchronisiert den Datensatz mit dem (zustandsbehafteten) Web Worker.
   *
   * - Bei unveränderter Array-Referenz/Länge: nichts zu tun (häufigster Fall
   *   beim Tippen im Filter, da `entries` dann gleich bleibt).
   * - Bei reinem Anhängen (Streaming): nur die neuen Einträge per
   *   `appendEntries` übertragen.
   * - Andernfalls: kompletter Austausch per `setEntries` (in Batches, um eine
   *   einzelne riesige structured-clone-Operation zu vermeiden).
   *
   * @returns true, wenn der Worker den Datensatz besitzt und gefiltert werden
   *          kann; false, wenn kein Worker verfügbar ist.
   */
  const syncEntriesToWorker = useCallback(
    (
      entries: unknown[],
      marksMap: Record<string, string> | undefined,
      forceFull: boolean,
      includeMdc: boolean,
    ): boolean => {
      const worker = workerRef.current;
      if (!worker) return false;

      const prevArr = syncedEntriesRef.current;
      const prevLen = syncedLenRef.current;
      const payloadShapeChanged =
        syncedIncludesMdcRef.current !== null &&
        syncedIncludesMdcRef.current !== includeMdc;
      const requiresFullSync = forceFull || payloadShapeChanged;

      // Unverändert → kein Re-Transfer nötig.
      if (
        !requiresFullSync &&
        prevArr === entries &&
        prevLen === entries.length &&
        prevArr !== null
      ) {
        return true;
      }

      // Append erkennen: gleiche Präfix-Objekte am Anfang und an der bisherigen
      // Grenze deuten auf reines Anhängen hin (immutable State-Update beim
      // Streaming erzeugt ein neues Array mit identischen vorhandenen Elementen).
      let appendOnly = false;
      if (
        !requiresFullSync &&
        prevArr !== null &&
        prevLen > 0 &&
        entries.length >= prevLen &&
        entries[0] === prevArr[0] &&
        entries[prevLen - 1] === prevArr[prevLen - 1]
      ) {
        appendOnly = true;
      }

      const BATCH = MAX_ENTRIES_PER_MESSAGE;

      if (appendOnly) {
        if (entries.length > prevLen) {
          // Nur die neuen Einträge projizieren + übertragen.
          for (let start = prevLen; start < entries.length; start += BATCH) {
            const end = Math.min(start + BATCH, entries.length);
            const delta = projectToSlimEntries(
              entries.slice(start, end),
              marksMap,
              includeMdc,
            );
            worker.postMessage({ type: "appendEntries", entries: delta });
          }
        }
      } else {
        // Kompletter Austausch (erstes Laden, Filterwechsel mit Marks, Reset…).
        const slim = projectToSlimEntries(entries, marksMap, includeMdc);
        // Erste Batch ersetzt den Cache, weitere hängen an.
        const first = slim.length <= BATCH ? slim : slim.slice(0, BATCH);
        worker.postMessage({ type: "setEntries", entries: first });
        for (let start = BATCH; start < slim.length; start += BATCH) {
          worker.postMessage({
            type: "appendEntries",
            entries: slim.slice(start, start + BATCH),
          });
        }
      }

      syncedEntriesRef.current = entries;
      syncedLenRef.current = entries.length;
      syncedIncludesMdcRef.current = includeMdc;
      return true;
    },
    [],
  );

  // Synchronous filter function (fallback for small datasets)
  const filterSync = useCallback(
    (
      entries: unknown[],
      options: FilterOptions,
      marksMap?: Record<string, string>,
    ): {
      indices: number[];
      searchMatchIndices: number[];
      stats: FilterStats;
    } => {
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
      const searchMatchIndices: number[] = [];
      const navigationSearch = String(options.navigationSearch || "").trim();
      const hasMarks = !!marksMap && Object.keys(marksMap).length > 0;
      const levelFilter = options.filter.level.toUpperCase();
      const loggerFilter = options.filter.logger.toLowerCase();
      const threadFilter = options.filter.thread.toLowerCase();
      const compiledDcFilter = options.dcFilterEnabled
        ? compileDcFilter(options.dcFilterEntries)
        : [];

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
          if (levelFilter) {
            const lev = String(e.level || "").toUpperCase();
            if (lev !== levelFilter) {
              filterStats.rejectedByLevel++;
              continue;
            }
          }
          if (loggerFilter) {
            if (
              !String(e.logger || "")
                .toLowerCase()
                .includes(loggerFilter)
            ) {
              filterStats.rejectedByLogger++;
              continue;
            }
          }
          if (threadFilter) {
            if (
              !String(e.thread || "")
                .toLowerCase()
                .includes(threadFilter)
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
        if (options.dcFilterEnabled) {
          const mdc = e.mdc as Record<string, unknown> | null | undefined;
          if (!matchesCompiledDcFilter(mdc, compiledDcFilter)) {
            filterStats.rejectedByDC++;
            continue;
          }
        }

        filterStats.passed++;
        const visualIndex = indices.length;
        const id = typeof e._id === "number" ? (e._id as number) : i;
        indices.push(id);
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

      return { indices, searchMatchIndices, stats: filterStats };
    },
    [],
  );

  // Main filter function - uses UtilityProcess, Web Worker, or sync based on availability
  const filterEntries = useCallback(
    (
      entries: unknown[],
      options: FilterOptions,
      marksMap?: Record<string, string>,
      config?: PagedFilterConfig,
    ) => {
      const requestId = ++requestSeqRef.current;
      pendingRequestRef.current = requestId;
      pendingGenerationRef.current = config?.generation;
      setError(null);

      if (config?.paged) {
        if (entries.length === 0) {
          const empty = filterSync([], options, marksMap);
          lastAppliedRequestRef.current = requestId;
          setFilteredIndices([]);
          setSearchMatchIndices([]);
          setStats(empty.stats);
          setIsFiltering(false);
          return;
        }
        const worker = workerRef.current;
        if (!worker) {
          setError(
            new Error(
              "Paged filtering requires the IndexedDB filter Web Worker",
            ),
          );
          setIsFiltering(false);
          return;
        }
        setIsFiltering(true);
        try {
          worker.postMessage({
            type: "filterPaged",
            options,
            requestId,
            markedSignatures: marksMap ? Object.keys(marksMap) : [],
            generation: config.generation,
            dataGeneration: config.dataGeneration,
            entryCount: config.entryCount,
            pageSize: config.pageSize,
            databaseName: config.databaseName,
          });
        } catch (postError) {
          setError(
            postError instanceof Error
              ? postError
              : new Error(String(postError)),
          );
          setIsFiltering(false);
        }
        return;
      }

      // For small datasets, use synchronous filtering (fastest for small data)
      if (entries.length <= WORKER_THRESHOLD) {
        const result = filterSync(entries, options, marksMap);
        // Monotonie wahren: als angewendete Request-ID markieren, damit ein
        // spät eintreffendes älteres Worker-Ergebnis dieses frischere Resultat
        // nicht überschreibt.
        lastAppliedRequestRef.current = requestId;
        setFilteredIndices(result.indices);
        setSearchMatchIndices(result.searchMatchIndices);
        setStats(result.stats);
        setIsFiltering(false);
        return;
      }

      // Bevorzugter Pfad für große Datensätze: zustandsbehafteter Web Worker.
      //
      // Der Worker hält die Einträge bereits gecached, daher übertragen wir nur
      // (a) ggf. neue Einträge inkrementell und (b) die kleine Optionen-
      // Nachricht. Damit blockiert das Filtern den Renderer-Hauptthread NICHT
      // mehr – der bisherige Sync-Fallback bei >50k Einträgen war die Hauptur-
      // sache für Einfrieren der UI bei 300k+ Einträgen.
      if (workerRef.current) {
        // Der Worker wertet `_mark` ausschließlich bei aktivem `onlyMarked` aus
        // (siehe filterWorker.ts). Nur dann muss der projizierte `_mark`-Stand
        // aktuell sein → kompletter Re-Sync. Solange die markierte Ansicht NICHT
        // aktiv ist, beeinflussen Markierungen das Filterergebnis nicht, also
        // genügt der inkrementelle Sync. Das vermeidet einen teuren Komplett-
        // Transfer aller Einträge pro Filterlauf, sobald überhaupt Marks
        // existieren (häufiger Fall bei großen Datenmengen).
        const forceFull = options.onlyMarked;

        try {
          const ok = syncEntriesToWorker(
            entries,
            marksMap,
            forceFull,
            options.dcFilterEnabled,
          );
          if (ok) {
            setIsFiltering(true);
            // Nur die Optionen senden – Worker filtert den gecachten Datensatz.
            workerRef.current.postMessage({
              type: "filter",
              options,
              requestId,
            });
            return;
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.warn(
            "[FilterWorker] Stateful worker sync failed, falling back:",
            errorMessage,
          );
          // Cache als ungültig markieren, damit der nächste Versuch neu synct.
          syncedEntriesRef.current = null;
          syncedLenRef.current = 0;
          syncedIncludesMdcRef.current = null;
        }
      }

      // Fallback 1: UtilityProcess (Electron 40+), nur wenn kein Web Worker da.
      if (utilityProcessAvailableRef.current) {
        setIsFiltering(true);

        try {
          // Check if dataset is too large for IPC transfer
          if (entries.length > MAX_ENTRIES_PER_MESSAGE) {
            console.warn(
              `[FilterWorker] Dataset too large for UtilityProcess (${entries.length} entries), falling back to sync`,
            );
            const syncResult = filterSync(entries, options, marksMap);
            lastAppliedRequestRef.current = requestId;
            setFilteredIndices(syncResult.indices);
            setSearchMatchIndices(syncResult.searchMatchIndices);
            setStats(syncResult.stats);
            setIsFiltering(false);
            return;
          }

          // Project to slim entries to prevent DataCloneError (out of memory)
          const slimEntries = projectToSlimEntries(
            entries,
            marksMap,
            options.dcFilterEnabled,
          );

          typedFilterEntries(slimEntries, options)
            .then((result: import("../types/ipc").FilterResult) => {
              // Nur anwenden, wenn dieses Ergebnis neuer ist als das zuletzt
              // angewendete (Promises können out-of-order auflösen).
              if (requestId > lastAppliedRequestRef.current) {
                lastAppliedRequestRef.current = requestId;
                if (result.ok) {
                  setSearchMatchIndices(
                    computeSearchMatchIndices(
                      entries,
                      result.filteredIndices,
                      options,
                    ),
                  );
                  setFilteredIndices(
                    resolveFilteredEntryIds(entries, result.filteredIndices),
                  );
                  setStats(result.stats);
                } else {
                  // UtilityProcess failed, fall back to sync
                  console.warn(
                    "[FilterWorker] UtilityProcess failed, falling back to sync:",
                    result.error,
                  );
                  const syncResult = filterSync(entries, options, marksMap);
                  setFilteredIndices(syncResult.indices);
                  setSearchMatchIndices(syncResult.searchMatchIndices);
                  setStats(syncResult.stats);
                }
                if (requestId >= pendingRequestRef.current) {
                  setIsFiltering(false);
                }
              }
            })
            .catch((error: unknown) => {
              console.warn("[FilterWorker] UtilityProcess error:", error);
              // Fall back to sync on error
              if (requestId > lastAppliedRequestRef.current) {
                lastAppliedRequestRef.current = requestId;
                const syncResult = filterSync(entries, options, marksMap);
                setFilteredIndices(syncResult.indices);
                setSearchMatchIndices(syncResult.searchMatchIndices);
                setStats(syncResult.stats);
                if (requestId >= pendingRequestRef.current) {
                  setIsFiltering(false);
                }
              }
            });
        } catch (error) {
          // Handle DataCloneError or other IPC errors
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.warn("[FilterWorker] IPC call failed:", errorMessage);
          const syncResult = filterSync(entries, options, marksMap);
          lastAppliedRequestRef.current = requestId;
          setFilteredIndices(syncResult.indices);
          setSearchMatchIndices(syncResult.searchMatchIndices);
          setStats(syncResult.stats);
          setIsFiltering(false);
        }
        return;
      }

      // Last resort: synchronous filtering
      const result = filterSync(entries, options, marksMap);
      lastAppliedRequestRef.current = requestId;
      setFilteredIndices(result.indices);
      setSearchMatchIndices(result.searchMatchIndices);
      setStats(result.stats);
      setIsFiltering(false);
    },
    [filterSync, syncEntriesToWorker],
  );

  return {
    filteredIndices,
    searchMatchIndices,
    isFiltering,
    stats,
    error,
    filterEntries,
    useUtilityProcess,
  };
}
