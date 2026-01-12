/**
 * useEntryManagement Hook
 * Manages log entries, IPC batching, deduplication, and memory management
 */

import { useState, useRef, useCallback, useEffect } from "preact/hooks";
import type { RendererLogEntry } from "../types/renderer";
import { IPC_BATCH_SIZE, IPC_PROCESS_INTERVAL } from "../constants/logViewer";
import { TRIM_THRESHOLD_ENTRIES } from "../constants";
import { entrySignature, mergeSorted } from "../utils/entryUtils";
import { compareByTimestampId } from "../utils/sort";
import { LoggingStore } from "../store/loggingStore";
import logger from "../utils/logger";

export interface UseEntryManagementOptions {
  marksMap: Record<string, string>;
  showAlert: (msg: string) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

export interface UseEntryManagementReturn {
  entries: RendererLogEntry[];
  setEntries: (
    fn: RendererLogEntry[] | ((prev: RendererLogEntry[]) => RendererLogEntry[]),
  ) => void;
  nextId: number;
  setNextId: (fn: number | ((prev: number) => number)) => void;
  nextIdRef: React.MutableRefObject<number>;
  appendEntries: (
    newEntries: any[],
    options?: { ignoreExistingForElastic?: boolean },
  ) => void;
  clearAllEntries: () => void;
  fileSigCacheRef: React.MutableRefObject<Map<string, Set<string>>>;
  httpSigCacheRef: React.MutableRefObject<Map<string, Set<string>>>;
  ipcQueueRef: React.MutableRefObject<RendererLogEntry[]>;
}

/**
 * Check if entry is from Elasticsearch source
 */
function isElasticSource(e: any): boolean {
  return typeof e?.source === "string" && e.source.startsWith("elastic://");
}

/**
 * Check if entry is from file source (no schema)
 */
function isFileSource(e: any): boolean {
  const s = e?.source;
  return typeof s === "string" && !s.includes("://");
}

/**
 * Check if entry is from HTTP source
 */
function isHttpSource(e: any): boolean {
  const s = e?.source;
  return (
    typeof s === "string" &&
    (s.startsWith("http://") || s.startsWith("https://"))
  );
}

/**
 * Hook for managing log entries with batching and deduplication
 */
export function useEntryManagement(
  options: UseEntryManagementOptions,
): UseEntryManagementReturn {
  const { marksMap, showAlert, t } = options;

  const [entries, setEntries] = useState<RendererLogEntry[]>([]);
  const [nextId, setNextId] = useState<number>(1);

  // Keep ref in sync with nextId for atomic id assignment
  const nextIdRef = useRef<number>(1);
  useEffect(() => {
    nextIdRef.current = nextId;
  }, [nextId]);

  // IPC batching queue
  const ipcQueueRef = useRef<RendererLogEntry[]>([]);
  const ipcProcessingRef = useRef<boolean>(false);
  const ipcFlushTimerRef = useRef<number | null>(null);

  // Dedupe caches
  const fileSigCacheRef = useRef<Map<string, Set<string>>>(new Map());
  const httpSigCacheRef = useRef<Map<string, Set<string>>>(new Map());

  // Ref for processIpcQueue to avoid stale closure
  const processIpcQueueRef = useRef<() => void>(() => {});

  /**
   * Internal function to append entries (after batching)
   */
  const appendEntriesInternal = useCallback(
    (
      newEntries: any[],
      options?: { ignoreExistingForElastic?: boolean },
    ): void => {
      if (!Array.isArray(newEntries) || newEntries.length === 0) {
        return;
      }

      const ignoreExistingForElastic = !!options?.ignoreExistingForElastic;

      // Determine what types of deduplication are needed
      const needEsDedup = newEntries.some((e) => isElasticSource(e));
      const needFileDedup = newEntries.some((e) => isFileSource(e));
      const needHttpDedup = newEntries.some((e) => isHttpSource(e));

      setEntries((prevEntries) => {
        // Build signature set for existing ES entries if needed
        let existingEsSigs: Set<string> | null = null;
        if (needEsDedup && !ignoreExistingForElastic) {
          existingEsSigs = new Set<string>();
          for (const e of prevEntries) {
            if (isElasticSource(e)) existingEsSigs.add(entrySignature(e));
          }
        }

        // Initialize file source cache from existing entries if empty
        if (
          needFileDedup &&
          fileSigCacheRef.current.size === 0 &&
          prevEntries.length
        ) {
          const map = fileSigCacheRef.current;
          for (const e of prevEntries) {
            if (!isFileSource(e)) continue;
            const src = String(e.source);
            let set = map.get(src);
            if (!set) {
              set = new Set<string>();
              map.set(src, set);
            }
            set.add(entrySignature(e));
          }
        }

        // Initialize HTTP source cache from existing entries if empty
        if (
          needHttpDedup &&
          httpSigCacheRef.current.size === 0 &&
          prevEntries.length
        ) {
          const map = httpSigCacheRef.current;
          for (const e of prevEntries) {
            if (!isHttpSource(e)) continue;
            const src = String(e.source);
            let set = map.get(src);
            if (!set) {
              set = new Set<string>();
              map.set(src, set);
            }
            set.add(entrySignature(e));
          }
        }

        // Batch deduplication
        const batchEsSigs = new Set<string>();
        const batchFileSigsBySrc = new Map<string, Set<string>>();
        const batchHttpSigsBySrc = new Map<string, Set<string>>();
        const accepted: any[] = [];

        for (const e of newEntries) {
          // Elasticsearch deduplication
          if (needEsDedup && isElasticSource(e)) {
            const sig = entrySignature(e);
            if (
              !ignoreExistingForElastic &&
              existingEsSigs &&
              existingEsSigs.has(sig)
            ) {
              continue;
            }
            if (batchEsSigs.has(sig)) {
              continue;
            }
            batchEsSigs.add(sig);
            accepted.push(e);
            continue;
          }

          // File source deduplication (per source)
          if (needFileDedup && isFileSource(e)) {
            const src = String(e.source || "");
            const sig = entrySignature(e);
            const existingSet = fileSigCacheRef.current.get(src);
            if (existingSet && existingSet.has(sig)) {
              continue;
            }
            let batchSet = batchFileSigsBySrc.get(src);
            if (!batchSet) {
              batchSet = new Set<string>();
              batchFileSigsBySrc.set(src, batchSet);
            }
            if (batchSet.has(sig)) {
              continue;
            }
            batchSet.add(sig);
            accepted.push(e);
            continue;
          }

          // HTTP source deduplication (per source)
          if (needHttpDedup && isHttpSource(e)) {
            const src = String(e.source || "");
            const sig = entrySignature(e);
            const existingSet = httpSigCacheRef.current.get(src);
            if (existingSet && existingSet.has(sig)) {
              continue;
            }
            let batchSet = batchHttpSigsBySrc.get(src);
            if (!batchSet) {
              batchSet = new Set<string>();
              batchHttpSigsBySrc.set(src, batchSet);
            }
            if (batchSet.has(sig)) {
              continue;
            }
            batchSet.add(sig);
            accepted.push(e);
            continue;
          }

          // All other sources pass through
          accepted.push(e);
        }

        if (accepted.length === 0) return prevEntries;

        // Assign IDs atomically and apply marks
        const baseId = nextIdRef.current;
        const toAdd = accepted.map((e, i) => {
          const n = { ...e, _id: baseId + i };
          const sig = entrySignature(n);
          if (marksMap[sig]) (n as any)._mark = marksMap[sig];
          return n;
        });
        nextIdRef.current = baseId + toAdd.length;

        // Update file cache with newly accepted entries
        if (needFileDedup) {
          const map = fileSigCacheRef.current;
          for (const n of toAdd) {
            if (!isFileSource(n)) continue;
            const src = String(n.source || "");
            let set = map.get(src);
            if (!set) {
              set = new Set<string>();
              map.set(src, set);
            }
            set.add(entrySignature(n));
          }
        }

        // Update HTTP cache with newly accepted entries
        if (needHttpDedup) {
          const map = httpSigCacheRef.current;
          for (const n of toAdd) {
            if (!isHttpSource(n)) continue;
            const src = String(n.source || "");
            let set = map.get(src);
            if (!set) {
              set = new Set<string>();
              map.set(src, set);
            }
            set.add(entrySignature(n));
          }
        }

        // Add to LoggingStore
        try {
          (LoggingStore as any).addEvents(toAdd);
        } catch (e) {
          logger.error("LoggingStore.addEvents error:", e);
          showAlert(
            t("errors.parsePathsFailed", {
              message: (e as any)?.message || String(e),
            }),
          );
        }

        // Merge sorted
        const sortedNew = toAdd
          .slice()
          .sort(compareByTimestampId as (a: any, b: any) => number);
        let newState = mergeSorted(prevEntries, sortedNew);

        // Memory safety: Trim oldest entries if threshold exceeded
        if (newState.length > TRIM_THRESHOLD_ENTRIES) {
          const trimCount =
            newState.length - Math.floor(TRIM_THRESHOLD_ENTRIES * 0.8);
          logger.warn(`[renderer-memory] Trimming ${trimCount} oldest entries`);
          newState = newState.slice(trimCount);
        }

        return newState;
      });

      // Update nextId state to match ref
      setNextId(nextIdRef.current);
    },
    [marksMap, showAlert, t],
  );

  /**
   * Process IPC queue in controlled batches
   */
  const processIpcQueue = useCallback((): void => {
    if (ipcProcessingRef.current) return;
    if (ipcQueueRef.current.length === 0) return;

    ipcProcessingRef.current = true;

    // Take a batch from the queue
    const batch = ipcQueueRef.current.splice(0, IPC_BATCH_SIZE);

    // Process this batch
    appendEntriesInternal(batch);

    ipcProcessingRef.current = false;

    // Schedule next batch if there are more entries
    if (ipcQueueRef.current.length > 0) {
      if (ipcFlushTimerRef.current) {
        clearTimeout(ipcFlushTimerRef.current);
      }

      // Use requestIdleCallback for smoother processing when available
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(
          () => {
            ipcFlushTimerRef.current = null;
            processIpcQueueRef.current();
          },
          { timeout: IPC_PROCESS_INTERVAL * 3 },
        );
      } else {
        ipcFlushTimerRef.current = window.setTimeout(() => {
          ipcFlushTimerRef.current = null;
          processIpcQueueRef.current();
        }, IPC_PROCESS_INTERVAL);
      }
    }
  }, [appendEntriesInternal]);

  // Keep ref in sync
  useEffect(() => {
    processIpcQueueRef.current = processIpcQueue;
  }, [processIpcQueue]);

  /**
   * Public function to append entries (with batching for large batches)
   */
  const appendEntries = useCallback(
    (
      newEntries: any[],
      options?: { ignoreExistingForElastic?: boolean },
    ): void => {
      if (!Array.isArray(newEntries) || newEntries.length === 0) {
        return;
      }

      // For small batches or Elastic queries, process directly
      const isElasticBatch = newEntries.some((e) => isElasticSource(e));

      if (
        newEntries.length <= 200 ||
        isElasticBatch ||
        options?.ignoreExistingForElastic
      ) {
        // Small batch or Elastic: process immediately
        appendEntriesInternal(newEntries, options);
      } else {
        // Large batch: queue for controlled processing
        ipcQueueRef.current.push(...newEntries);

        // Limit queue size to prevent memory issues
        const MAX_QUEUE_SIZE = 100_000;
        if (ipcQueueRef.current.length > MAX_QUEUE_SIZE) {
          const overflow = ipcQueueRef.current.length - MAX_QUEUE_SIZE;
          ipcQueueRef.current.splice(0, overflow);
          logger.warn(
            `[renderer-memory] Queue overflow, discarded ${overflow} oldest entries`,
          );
        }

        // Start processing if not already running
        if (!ipcFlushTimerRef.current && !ipcProcessingRef.current) {
          setTimeout(() => processIpcQueueRef.current(), 0);
        }
      }
    },
    [appendEntriesInternal],
  );

  /**
   * Clear all entries and reset state
   */
  const clearAllEntries = useCallback((): void => {
    setEntries([]);
    setNextId(1);
    nextIdRef.current = 1;
    fileSigCacheRef.current = new Map();
    httpSigCacheRef.current = new Map();
    ipcQueueRef.current = [];
    try {
      (LoggingStore as any).reset();
    } catch (e) {
      logger.error("LoggingStore.reset error:", e);
    }
  }, []);

  return {
    entries,
    setEntries,
    nextId,
    setNextId,
    nextIdRef,
    appendEntries,
    clearAllEntries,
    fileSigCacheRef,
    httpSigCacheRef,
    ipcQueueRef,
  };
}
