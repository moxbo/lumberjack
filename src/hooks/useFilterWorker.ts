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
import {
  MetadataSnapshot,
  type ReadonlySequence,
} from "../utils/metadataSnapshot";
import { compileDcFilter, matchesCompiledDcFilter } from "../utils/dcMatch";
import {
  filterIsAvailable,
  filterEntries as typedFilterEntries,
} from "../utils/typedApi";
import {
  createProjectionBridge,
  type ProjectionBridge,
} from "../workers/projectionBridge";
import type { FilterProgress } from "../types/filterProgress";
import type {
  FilterResponse,
  FilterErrorResponse,
} from "../workers/filterWorker";

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
  /** Base filter identity, excluding navigation search. */
  baseGeneration?: string | number;
  dataGeneration?: string | number;
  entryCount: number;
  pageSize?: number;
}

export interface UseFilterWorkerResult {
  filteredIndices: number[];
  searchMatchIndices: number[];
  searchMatchIds: number[];
  isFiltering: boolean;
  progress: FilterProgress | null;
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
    entries: ReadonlySequence<unknown>,
    options: FilterOptions,
    marksMap?: Record<string, string>,
    config?: PagedFilterConfig,
  ) => void;
  cancelFiltering: (preserveBase?: boolean) => void;
  /** True wenn UtilityProcess verwendet wird, false für Web Worker/Sync */
  useUtilityProcess: boolean;
  /** Bridge for direct projection transfer to the filter worker. null when no worker. */
  projectionBridge: ProjectionBridge | null;
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
  entries: ReadonlySequence<unknown>,
  marksMap?: Record<string, string>,
  includeMdc = false,
): SlimEntry[] {
  const result: SlimEntry[] = new Array(entries.length);
  const hasMarks = !!marksMap && Object.keys(marksMap).length > 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries.at(i) as Record<string, unknown> | null;
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
  entries: ReadonlySequence<unknown>,
  filteredOffsets: readonly number[],
  baseOffset = 0,
): number[] {
  return filteredOffsets.map((offset) => {
    const entry = entries.at(offset) as { _id?: unknown } | null | undefined;
    return typeof entry?._id === "number" ? entry._id : baseOffset + offset;
  });
}

function computeSearchMatchIndices(
  entries: ReadonlySequence<unknown>,
  filteredIndices: number[],
  options: FilterOptions,
): number[] {
  const search = String(options.navigationSearch || "").trim();
  if (!search) return [];

  // UtilityProcess filtering still returns legacy array indices, so this helper
  // intentionally treats filteredIndices as direct offsets into `entries`.
  const matches: number[] = [];
  for (
    let visualIndex = 0;
    visualIndex < filteredIndices.length;
    visualIndex++
  ) {
    const entry = entries.at(filteredIndices[visualIndex]!) as Record<
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

function mergeSearchMatches(
  previous: { indices: number[]; ids: number[] },
  incoming: { indices: number[]; ids: number[] },
): { indices: number[]; ids: number[] } {
  if (!incoming.indices.length) return previous;
  if (!previous.indices.length) return incoming;
  if (previous.indices[previous.indices.length - 1]! < incoming.indices[0]!) {
    return {
      indices: previous.indices.concat(incoming.indices),
      ids: previous.ids.concat(incoming.ids),
    };
  }
  const indices: number[] = [];
  const ids: number[] = [];
  let left = 0;
  let right = 0;
  while (left < previous.indices.length || right < incoming.indices.length) {
    const takePrevious =
      right >= incoming.indices.length ||
      (left < previous.indices.length &&
        previous.indices[left]! < incoming.indices[right]!);
    const source = takePrevious ? previous : incoming;
    const index = takePrevious ? left++ : right++;
    indices.push(source.indices[index]!);
    ids.push(source.ids[index]!);
  }
  return { indices, ids };
}

/** Worker-first filtering with progressive, cancellable fallback pages. */
export function useFilterWorker(): UseFilterWorkerResult {
  const [filteredIndices, setFilteredIndices] = useState<number[]>([]);
  const [searchMatchIndices, setSearchMatchIndices] = useState<number[]>([]);
  const [isFiltering, setIsFiltering] = useState(false);
  const [stats, setStats] = useState<FilterStats | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [useUtilityProcess, setUseUtilityProcess] = useState(false);
  const [searchMatchIds, setSearchMatchIds] = useState<number[]>([]);
  const [progress, setProgress] = useState<FilterProgress | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const pendingRequestRef = useRef<number>(0);
  const pendingGenerationRef = useRef<string | number | undefined>(undefined);
  const pendingBaseGenerationRef = useRef<string | undefined>(undefined);
  const renderedBaseCountRef = useRef<number | undefined>(undefined);
  const deltaMatchesRef = useRef<{
    requestId: number;
    indices: number[];
    ids: number[];
  } | null>(null);
  // Accept partial snapshots from the current query, including a running scan
  // of an earlier append, but never from a replaced query or cleared dataset.
  const lastAppliedRequestRef = useRef<number>(0);
  const cancelledThroughRef = useRef(0);
  const targetCountRef = useRef(0);
  const previousSourceRef = useRef<ReadonlySequence<unknown> | null>(null);
  const sourceRevisionRef = useRef(0);
  const utilityProcessAvailableRef = useRef<boolean | null>(null);

  // Monoton steigender Request-Zähler. Date.now() kann bei schnellen Filtern
  // (mehrere im selben ms) kollidieren und so gültige Ergebnisse verwerfen.
  const requestSeqRef = useRef<number>(0);

  // Tracking des zuletzt an den Worker übertragenen Datensatzes, um beim
  // Filtern NICHT erneut den kompletten (ggf. 300k+) Datensatz zu klonen.
  // Wir merken uns die Array-Referenz + Länge, um Anhänge (Streaming) von
  // einem kompletten Austausch zu unterscheiden.
  const syncedEntriesRef = useRef<ReadonlySequence<unknown> | null>(null);
  const syncedLenRef = useRef<number>(0);
  const syncedIncludesMdcRef = useRef<boolean | null>(null);
  const projectionBridgeRef = useRef<ProjectionBridge | null>(null);
  const [projectionBridge, setProjectionBridge] =
    useState<ProjectionBridge | null>(null);
  const fallbackRunningRef = useRef(false);
  const queuedFallbackRef = useRef<(() => Promise<void>) | null>(null);

  const cancelFiltering = useCallback((preserveBase = false) => {
    const requestId = ++requestSeqRef.current;
    pendingRequestRef.current = requestId;
    cancelledThroughRef.current = requestId;
    pendingGenerationRef.current = undefined;
    if (!preserveBase) {
      pendingBaseGenerationRef.current = undefined;
      renderedBaseCountRef.current = undefined;
      setFilteredIndices([]);
      setStats(null);
    }
    deltaMatchesRef.current = null;
    queuedFallbackRef.current = null;
    setSearchMatchIndices([]);
    setSearchMatchIds([]);
    setProgress(null);
    setIsFiltering(false);
    setError(null);
    try {
      workerRef.current?.postMessage({ type: "cancel", requestId });
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }, []);

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

      // Create typed projection bridge for this worker instance.
      projectionBridgeRef.current = createProjectionBridge(workerRef.current);
      setProjectionBridge(projectionBridgeRef.current);

      workerRef.current.onmessage = (
        event: MessageEvent<FilterResponse | FilterErrorResponse>,
      ) => {
        const data = event.data;
        const { requestId, generation } = data;
        if (
          typeof requestId !== "number" ||
          requestId <= cancelledThroughRef.current ||
          generation !== pendingGenerationRef.current ||
          requestId < lastAppliedRequestRef.current
        ) {
          return;
        }
        if (data.type === "error") {
          if (requestId === pendingRequestRef.current) {
            setError(new Error(data.message));
            setIsFiltering(false);
          }
          return;
        }
        if (data.type !== "result") return;
        lastAppliedRequestRef.current = requestId;
        setError(null);
        if (!data.reuseFilteredIndices) {
          setFilteredIndices(data.filteredIndices);
          renderedBaseCountRef.current = data.progress?.processed;
        }
        if (data.searchMatchesDelta) {
          const previous = deltaMatchesRef.current;
          const merged = mergeSearchMatches(
            previous?.requestId === requestId
              ? previous
              : { indices: [], ids: [] },
            {
              indices: data.searchMatchIndices,
              ids: data.searchMatchIds ?? [],
            },
          );
          deltaMatchesRef.current = { requestId, ...merged };
          setSearchMatchIndices(merged.indices);
          setSearchMatchIds(merged.ids);
        } else {
          deltaMatchesRef.current = null;
          setSearchMatchIndices(data.searchMatchIndices);
          setSearchMatchIds(
            data.searchMatchIds ??
              data.searchMatchIndices.map(
                (index) => data.filteredIndices[index]!,
              ),
          );
        }
        if (data.progress) {
          setProgress({
            ...data.progress,
            total: Math.max(data.progress.total, targetCountRef.current),
          });
        }
        setStats(data.stats);
        if (!data.partial && requestId >= pendingRequestRef.current) {
          setIsFiltering(false);
        }
      };

      workerRef.current.onerror = (error: ErrorEvent) => {
        console.error("[FilterWorker] Error:", error);
        setError(new Error(error.message || "Filter worker failed"));
        setIsFiltering(false);
      };

      return () => {
        cancelledThroughRef.current = ++requestSeqRef.current;
        pendingGenerationRef.current = undefined;
        queuedFallbackRef.current = null;
        if (projectionBridgeRef.current) {
          projectionBridgeRef.current.dispose();
          projectionBridgeRef.current = null;
          setProjectionBridge(null);
        }
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
      entries: ReadonlySequence<unknown>,
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

      // Only the immutable backing identity proves the entire prefix unchanged.
      const appendOnly =
        !requiresFullSync &&
        entries instanceof MetadataSnapshot &&
        prevArr instanceof MetadataSnapshot &&
        entries.isAppendOf(prevArr);

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
        // Project and transfer bounded pages, including an empty reset page.
        for (
          let start = 0;
          start < Math.max(1, entries.length);
          start += BATCH
        ) {
          worker.postMessage({
            type: start === 0 ? "setEntries" : "appendEntries",
            entries: projectToSlimEntries(
              entries.slice(start, start + BATCH),
              marksMap,
              includeMdc,
            ),
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
      entries: ReadonlySequence<unknown>,
      options: FilterOptions,
      marksMap?: Record<string, string>,
      baseOffset = 0,
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
      const fromTs = options.timeFilterFrom
        ? Date.parse(options.timeFilterFrom)
        : NaN;
      const toTs = options.timeFilterTo
        ? Date.parse(options.timeFilterTo)
        : NaN;

      for (let i = 0; i < entries.length; i++) {
        const e = entries.at(i) as Record<string, unknown> | null;
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

        if (
          options.timeFilterEnabled &&
          typeof e.source === "string" &&
          e.source.startsWith("elastic://")
        ) {
          const timestamp =
            typeof e.timestamp === "number"
              ? e.timestamp
              : Date.parse(String(e.timestamp ?? ""));
          if (timestamp < fromTs || timestamp > toTs) {
            filterStats.rejectedByTime++;
            continue;
          }
        }

        if (options.dcFilterEnabled) {
          const mdc = e.mdc as Record<string, unknown> | null | undefined;
          if (!matchesCompiledDcFilter(mdc, compiledDcFilter)) {
            filterStats.rejectedByDC++;
            continue;
          }
        }

        filterStats.passed++;
        const visualIndex = indices.length;
        const id = typeof e._id === "number" ? e._id : baseOffset + i;
        indices.push(id);
        if (
          navigationSearch &&
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

  const filterEntries = useCallback(
    (
      entries: ReadonlySequence<unknown>,
      options: FilterOptions,
      marksMap?: Record<string, string>,
      config?: PagedFilterConfig,
    ) => {
      const requestId = ++requestSeqRef.current;
      const previousSource = previousSourceRef.current;
      if (
        !config?.paged &&
        ((entries !== previousSource &&
          !(
            entries instanceof MetadataSnapshot &&
            previousSource instanceof MetadataSnapshot &&
            entries.isAppendOf(previousSource)
          )) ||
          entries.length < targetCountRef.current)
      ) {
        sourceRevisionRef.current++;
      }
      previousSourceRef.current = entries;
      const generation = JSON.stringify({
        options,
        markedSignatures: options.onlyMarked
          ? Object.keys(marksMap ?? {}).sort()
          : [],
        paged: config?.paged ?? false,
        generation: config?.generation,
        baseGeneration: config?.baseGeneration,
        dataGeneration: config?.paged
          ? config.dataGeneration
          : sourceRevisionRef.current,
        databaseName: config?.databaseName,
      });
      const {
        navigationSearch: _search,
        navigationSearchMode: _mode,
        ...baseOptions
      } = options;
      const baseGeneration = JSON.stringify({
        options: baseOptions,
        markedSignatures: options.onlyMarked
          ? Object.keys(marksMap ?? {}).sort()
          : [],
        paged: config?.paged ?? false,
        generation: config?.baseGeneration ?? config?.generation,
        dataGeneration: config?.paged
          ? config.dataGeneration
          : sourceRevisionRef.current,
        databaseName: config?.databaseName,
      });
      const baseChanged = baseGeneration !== pendingBaseGenerationRef.current;
      const queryChanged = generation !== pendingGenerationRef.current;
      pendingRequestRef.current = requestId;
      pendingGenerationRef.current = generation;
      pendingBaseGenerationRef.current = baseGeneration;
      targetCountRef.current = config?.entryCount ?? entries.length;
      setError(null);
      if (queryChanged) {
        cancelledThroughRef.current = requestId - 1;
        queuedFallbackRef.current = null;
        if (baseChanged) {
          renderedBaseCountRef.current = undefined;
          setFilteredIndices([]);
          setStats(null);
        }
        deltaMatchesRef.current = null;
        setSearchMatchIndices([]);
        setSearchMatchIds([]);
        setProgress({
          processed: 0,
          total: targetCountRef.current,
          matches: 0,
        });
      } else {
        setProgress((previous) =>
          previous ? { ...previous, total: targetCountRef.current } : null,
        );
      }

      const isCurrent = () =>
        requestId > cancelledThroughRef.current &&
        generation === pendingGenerationRef.current;
      const publish = (
        result: ReturnType<typeof filterSync>,
        partial = false,
      ) => {
        if (!isCurrent() || requestId < lastAppliedRequestRef.current) return;
        lastAppliedRequestRef.current = requestId;
        setFilteredIndices(result.indices);
        setSearchMatchIndices(result.searchMatchIndices);
        setSearchMatchIds(
          result.searchMatchIndices.map((index) => result.indices[index]!),
        );
        setStats(result.stats);
        setProgress({
          processed: result.stats.total,
          total: targetCountRef.current,
          matches: String(options.navigationSearch ?? "").trim()
            ? result.searchMatchIndices.length
            : result.stats.passed,
        });
        if (!partial && requestId === pendingRequestRef.current) {
          setIsFiltering(false);
        }
      };

      if (entries.length === 0) {
        try {
          workerRef.current?.postMessage({ type: "cancel", requestId });
        } catch (cause) {
          setError(cause instanceof Error ? cause : new Error(String(cause)));
        }
        publish(filterSync(entries, options, marksMap));
        return;
      }

      if (config?.paged) {
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
            generation,
            baseGeneration,
            knownBaseCount: renderedBaseCountRef.current,
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

      if (entries.length <= WORKER_THRESHOLD) {
        if (requestId > 1) {
          try {
            workerRef.current?.postMessage({ type: "cancel", requestId });
          } catch (cause) {
            setError(cause instanceof Error ? cause : new Error(String(cause)));
          }
        }
        publish(filterSync(entries, options, marksMap));
        return;
      }

      if (workerRef.current) {
        const forceFull = options.onlyMarked && baseChanged;

        try {
          const ok = syncEntriesToWorker(
            entries,
            marksMap,
            forceFull,
            options.dcFilterEnabled,
          );
          if (ok) {
            setIsFiltering(true);
            workerRef.current.postMessage({
              type: "filter",
              options,
              requestId,
              generation,
              baseGeneration,
              knownBaseCount: renderedBaseCountRef.current,
              dataGeneration: sourceRevisionRef.current,
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
          syncedEntriesRef.current = null;
          syncedLenRef.current = 0;
          syncedIncludesMdcRef.current = null;
        }
      }

      // Keep the fallback cooperative too. Coalesce appends behind the running
      // scan; cancelling every append would starve results under continuous input.
      setIsFiltering(true);
      const runFallback = async () => {
        fallbackRunningRef.current = true;
        let useUtility = utilityProcessAvailableRef.current === true;
        const accumulated = filterSync([], options, marksMap);
        let lastPublishedAt = 0;
        try {
          for (let start = 0; start < entries.length; start += 2_000) {
            if (!isCurrent()) return;
            const page = entries.slice(start, start + 2_000);
            let pageResult: ReturnType<typeof filterSync> | undefined;
            if (useUtility) {
              try {
                const response = await typedFilterEntries(
                  projectToSlimEntries(page, marksMap, options.dcFilterEnabled),
                  options,
                );
                if (!isCurrent()) return;
                if (!response.ok) throw new Error(response.error);
                pageResult = {
                  indices: resolveFilteredEntryIds(
                    page,
                    response.filteredIndices,
                    start,
                  ),
                  searchMatchIndices: computeSearchMatchIndices(
                    page,
                    response.filteredIndices,
                    options,
                  ),
                  stats: response.stats,
                };
              } catch (cause) {
                if (!isCurrent()) return;
                console.warn(
                  "[FilterWorker] UtilityProcess failed, using cooperative fallback:",
                  cause,
                );
                useUtility = false;
              }
            }
            pageResult ??= filterSync(page, options, marksMap, start);
            const offset = accumulated.indices.length;
            accumulated.indices.push(...pageResult.indices);
            accumulated.searchMatchIndices.push(
              ...pageResult.searchMatchIndices.map((index) => offset + index),
            );
            for (const key of Object.keys(
              accumulated.stats,
            ) as (keyof FilterStats)[]) {
              accumulated.stats[key] += pageResult.stats[key];
            }
            const done = start + page.length >= entries.length;
            if (
              start === 0 ||
              done ||
              performance.now() - lastPublishedAt >= 100
            ) {
              publish(
                {
                  indices: accumulated.indices.slice(),
                  searchMatchIndices: accumulated.searchMatchIndices.slice(),
                  stats: { ...accumulated.stats },
                },
                !done,
              );
              lastPublishedAt = performance.now();
            }
            if (!done)
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
        } catch (cause) {
          if (isCurrent() && requestId === pendingRequestRef.current) {
            setError(cause instanceof Error ? cause : new Error(String(cause)));
            setIsFiltering(false);
          }
        } finally {
          fallbackRunningRef.current = false;
          const next = queuedFallbackRef.current;
          queuedFallbackRef.current = null;
          if (next) void next();
        }
      };
      if (fallbackRunningRef.current) queuedFallbackRef.current = runFallback;
      else void runFallback();
    },
    [filterSync, syncEntriesToWorker],
  );

  return {
    filteredIndices,
    searchMatchIndices,
    searchMatchIds,
    isFiltering,
    progress,
    stats,
    error,
    filterEntries,
    cancelFiltering,
    useUtilityProcess,
    projectionBridge,
  };
}
