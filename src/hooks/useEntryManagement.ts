/**
 * Hook for managing log entries (state, IPC queue, deduplication)
 */
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { LoggingStore } from "../store/loggingStore";
import { compareByTimestampId } from "../utils/sort";
import {
  entrySignature,
  isElasticSource,
  isFileSource,
  isHttpSource,
  mergeSorted,
} from "../utils/entryUtils";
import { clearHighlightCache } from "../renderer/LogRow";
import { clearTimestampCache } from "../utils/format";
import logger from "../utils/logger";
import {
  IPC_BATCH_SIZE,
  IPC_MAX_QUEUE_SIZE,
  IPC_PROCESS_INTERVAL,
  TRIM_THRESHOLD_ENTRIES,
} from "../constants";

interface UseEntryManagementOptions {
  marksMap: Record<string, string>;
}

export function useEntryManagement({ marksMap }: UseEntryManagementOptions) {
  const [entries, setEntries] = useState<any[]>([]);
  const [nextId, setNextId] = useState<number>(1);

  // Keep a ref in sync with nextId for atomic id assignment
  const nextIdRef = useRef<number>(1);
  useEffect(() => {
    nextIdRef.current = nextId;
  }, [nextId]);

  // IPC batching queue to prevent renderer overload
  const ipcQueueRef = useRef<any[]>([]);
  const ipcProcessingRef = useRef<boolean>(false);
  const ipcFlushTimerRef = useRef<number | null>(null);

  // Dedupe caches
  const fileSigCacheRef = useRef<Map<string, Set<string>>>(new Map());
  const httpSigCacheRef = useRef<Map<string, Set<string>>>(new Map());

  // Process IPC queue ref (to avoid stale closure)
  const processIpcQueueRef = useRef<() => void>(() => {});

  // Internal append function
  const appendEntriesInternal = useCallback(
    (newEntries: any[], options?: { ignoreExistingForElastic?: boolean }) => {
      if (!Array.isArray(newEntries) || newEntries.length === 0) return;

      const ignoreExistingForElastic = !!options?.ignoreExistingForElastic;

      // Check sources
      const needEsDedup = newEntries.some((e) => isElasticSource(e));
      const needFileDedup = newEntries.some((e) => isFileSource(e));
      const needHttpDedup = newEntries.some((e) => isHttpSource(e));

      // Build ES signature set if needed
      let existingEsSigs: Set<string> | null = null;
      if (needEsDedup && !ignoreExistingForElastic) {
        existingEsSigs = new Set<string>();
        for (const e of entries) {
          if (isElasticSource(e)) existingEsSigs.add(entrySignature(e));
        }
      }

      // Initialize file cache if needed
      if (
        needFileDedup &&
        fileSigCacheRef.current.size === 0 &&
        entries.length
      ) {
        const map = fileSigCacheRef.current;
        for (const e of entries) {
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

      // Initialize HTTP cache if needed
      if (
        needHttpDedup &&
        httpSigCacheRef.current.size === 0 &&
        entries.length
      ) {
        const map = httpSigCacheRef.current;
        for (const e of entries) {
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
        // ES dedup
        if (needEsDedup && isElasticSource(e)) {
          const sig = entrySignature(e);
          if (
            !ignoreExistingForElastic &&
            existingEsSigs &&
            existingEsSigs.has(sig)
          )
            continue;
          if (batchEsSigs.has(sig)) continue;
          batchEsSigs.add(sig);
          accepted.push(e);
          continue;
        }

        // File dedup
        if (needFileDedup && isFileSource(e)) {
          const src = String(e.source || "");
          const sig = entrySignature(e);
          const existingSet = fileSigCacheRef.current.get(src);
          if (existingSet && existingSet.has(sig)) continue;
          let batchSet = batchFileSigsBySrc.get(src);
          if (!batchSet) {
            batchSet = new Set<string>();
            batchFileSigsBySrc.set(src, batchSet);
          }
          if (batchSet.has(sig)) continue;
          batchSet.add(sig);
          accepted.push(e);
          continue;
        }

        // HTTP dedup
        if (needHttpDedup && isHttpSource(e)) {
          const src = String(e.source || "");
          const sig = entrySignature(e);
          const existingSet = httpSigCacheRef.current.get(src);
          if (existingSet && existingSet.has(sig)) continue;
          let batchSet = batchHttpSigsBySrc.get(src);
          if (!batchSet) {
            batchSet = new Set<string>();
            batchHttpSigsBySrc.set(src, batchSet);
          }
          if (batchSet.has(sig)) continue;
          batchSet.add(sig);
          accepted.push(e);
          continue;
        }

        // Other sources
        accepted.push(e);
      }

      if (accepted.length === 0) return;

      // Assign IDs and apply marks
      const baseId = nextIdRef.current;
      const toAdd = accepted.map((e, i) => {
        const n = { ...e, _id: baseId + i };
        const sig = entrySignature(n);
        if (marksMap[sig]) (n as any)._mark = marksMap[sig];
        return n;
      });
      nextIdRef.current = baseId + toAdd.length;

      // Update file cache
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

      // Update HTTP cache
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
      }

      // Update state
      setEntries((prev) => {
        const sortedNew = toAdd.slice().sort(compareByTimestampId as any);
        let newState = mergeSorted(prev, sortedNew);

        // Memory safety: trim if needed
        if (newState.length > TRIM_THRESHOLD_ENTRIES) {
          const trimCount =
            newState.length - Math.floor(TRIM_THRESHOLD_ENTRIES * 0.8);
          console.warn(
            `[renderer-memory] Trimming ${trimCount} oldest entries (${newState.length} -> ${newState.length - trimCount})`,
          );
          newState = newState.slice(trimCount);
        }

        return newState;
      });

      setNextId((prev) => prev + toAdd.length);
    },
    [entries, marksMap],
  );

  // Process queued entries

  // Keep ref in sync
  processIpcQueueRef.current = useCallback(() => {
    if (ipcProcessingRef.current) return;
    if (ipcQueueRef.current.length === 0) return;

    ipcProcessingRef.current = true;

    const batch = ipcQueueRef.current.splice(0, IPC_BATCH_SIZE);
    const remaining = ipcQueueRef.current.length;

    if (remaining > 0) {
      console.log(
        `[renderer-memory] Processing batch of ${batch.length}, ${remaining} entries still queued`,
      );
    }

    appendEntriesInternal(batch);
    ipcProcessingRef.current = false;

    // Schedule next batch
    if (ipcQueueRef.current.length > 0) {
      if (ipcFlushTimerRef.current) {
        clearTimeout(ipcFlushTimerRef.current);
      }
      ipcFlushTimerRef.current = window.setTimeout(() => {
        ipcFlushTimerRef.current = null;
        processIpcQueueRef.current();
      }, IPC_PROCESS_INTERVAL);
    }
  }, [appendEntriesInternal]);

  // Public append function
  const appendEntries = useCallback(
    (newEntries: any[], options?: { ignoreExistingForElastic?: boolean }) => {
      if (!Array.isArray(newEntries) || newEntries.length === 0) return;

      // Small batches or Elastic: process directly
      const isElasticBatch = newEntries.some((e) => isElasticSource(e));
      if (
        newEntries.length <= 500 ||
        isElasticBatch ||
        options?.ignoreExistingForElastic
      ) {
        appendEntriesInternal(newEntries, options);
      } else {
        // Large batch: queue for controlled processing
        ipcQueueRef.current.push(...newEntries);

        // Limit queue size
        if (ipcQueueRef.current.length > IPC_MAX_QUEUE_SIZE) {
          const overflow = ipcQueueRef.current.length - IPC_MAX_QUEUE_SIZE;
          ipcQueueRef.current.splice(0, overflow);
          console.warn(
            `[renderer-memory] Queue overflow, discarded ${overflow} oldest entries`,
          );
        }

        // Start processing
        if (!ipcFlushTimerRef.current && !ipcProcessingRef.current) {
          setTimeout(() => processIpcQueueRef.current(), 0);
        }
      }
    },
    [appendEntriesInternal],
  );

  // Clear all entries
  const clearEntries = useCallback(() => {
    setEntries([]);
    setNextId(1);
    nextIdRef.current = 1;
    fileSigCacheRef.current = new Map();
    httpSigCacheRef.current = new Map();
    clearHighlightCache();
    clearTimestampCache();

    try {
      (LoggingStore as any).reset();
    } catch (e) {
      logger.error("LoggingStore.reset error:", e);
    }
  }, []);

  return {
    entries,
    setEntries,
    appendEntries,
    clearEntries,
    nextId,
  };
}
