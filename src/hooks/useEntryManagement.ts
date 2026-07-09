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
import { clearRegexCache } from "../utils/highlight";
import { clearTimestampParseCache } from "../utils/sort";
import logger from "../utils/logger";
import {
  IPC_BATCH_SIZE,
  IPC_MAX_QUEUE_SIZE,
  IPC_PROCESS_INTERVAL,
  TRIM_THRESHOLD_ENTRIES,
} from "../constants";
import { getRendererLogEntryPool } from "../store/RendererLogEntryPool";

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

  // Memory Pool for log entries - reduces GC pressure with 100k+ entries
  // Erhöhte Größe für bessere Performance bei 300k+ Einträgen
  const poolRef = useRef(
    getRendererLogEntryPool({
      maxSize: 100_000,
      initialSize: 5_000,
      enableLogging: false,
    }),
  );

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

      // Assign IDs and apply marks using pool for efficient memory management
      const baseId = nextIdRef.current;
      // Acquire pooled objects for better memory efficiency at 100k+ entries
      const pooledEntries = poolRef.current.acquireBatch(accepted.length);
      const toAdd = accepted.map((e, i) => {
        // Use pooled entry and copy properties (fallback to new object if pool exhausted)
        const pooled = pooledEntries[i] ?? {
          timestamp: null,
          level: null,
          logger: null,
          thread: null,
          message: "",
          traceId: null,
          stackTrace: null,
          raw: null,
          source: "",
          _id: undefined,
          _mark: undefined,
          mdc: undefined,
          service: undefined,
          _fullMessage: undefined,
          _truncated: undefined,
          _messageSize: undefined,
        };
        pooled.timestamp = e.timestamp ?? null;
        pooled.level = e.level ?? null;
        pooled.logger = e.logger ?? null;
        pooled.thread = e.thread ?? null;
        pooled.message = e.message ?? "";
        pooled.traceId = e.traceId ?? null;
        pooled.stackTrace = e.stackTrace ?? null;
        pooled.raw = e.raw ?? null;
        pooled.source = e.source ?? "";
        pooled.mdc = e.mdc;
        pooled.service = e.service;
        pooled._fullMessage = e._fullMessage;
        pooled._truncated = e._truncated;
        pooled._messageSize = e._messageSize;
        // Preserve mark color from imported entries (JSON/NDJSON re-import).
        // Streaming sources (TCP/HTTP/Elastic) don't set _mark so this is a no-op
        // for them; marksMap below still wins for entries the user already marked
        // in the current session.
        pooled._mark =
          typeof e._mark === "string" && e._mark ? e._mark : undefined;
        pooled._id = baseId + i;

        // Apply marks from the live marks map – existing user marks take
        // precedence over the value carried in the imported entry.
        const sig = entrySignature(pooled);
        if (marksMap[sig]) pooled._mark = marksMap[sig];

        return pooled;
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

      // Add to LoggingStore (this computes each entry's `mdc` from `raw`).
      try {
        (LoggingStore as any).addEvents(toAdd);
      } catch (e) {
        logger.error("LoggingStore.addEvents error:", e);
      }

      // Memory: release the (potentially large) raw payload after MDC has been
      // derived. The renderer never reads `entry.raw` again – neither the log
      // table, the detail panel (uses `mdc`) nor any export format serialises
      // it. Keeping the full parsed object per entry roughly doubled the heap
      // footprint and caused Out-of-Memory renderer crashes ("app restarts")
      // around 200k–300k entries. `addEvents` above runs synchronously and all
      // listeners have already consumed `raw` by this point, so it is safe to
      // free it here.
      for (let i = 0; i < toAdd.length; i++) {
        const entry = toAdd[i];
        if (entry) entry.raw = null;
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

          // Recycle trimmed entries back to pool to reduce GC pressure
          const trimmedEntries = newState.slice(0, trimCount);
          poolRef.current.releaseBatch(trimmedEntries);

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
      console.warn(
        `[renderer-memory] Processing batch of ${batch.length}, ${remaining} entries still queued`,
      );
    }

    appendEntriesInternal(batch);
    ipcProcessingRef.current = false;

    // Schedule next batch using requestIdleCallback for better UI responsiveness
    if (ipcQueueRef.current.length > 0) {
      if (ipcFlushTimerRef.current) {
        clearTimeout(ipcFlushTimerRef.current);
      }
      // Use requestIdleCallback if available for non-blocking processing
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(
          () => {
            processIpcQueueRef.current();
          },
          { timeout: IPC_PROCESS_INTERVAL * 2 },
        );
      } else {
        ipcFlushTimerRef.current = window.setTimeout(() => {
          ipcFlushTimerRef.current = null;
          processIpcQueueRef.current();
        }, IPC_PROCESS_INTERVAL);
      }
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
        // Bounded imports (file loads) deliver the complete, finite set of
        // entries in a single call. They are already fully materialised in
        // memory, so queuing them adds no extra pressure – and discarding any
        // of them would silently drop log lines. The lossy overflow guard
        // below only makes sense for *unbounded* live streams (TCP/HTTP) where
        // a fast producer could outpace the consumer and exhaust memory.
        const isBoundedBatch = newEntries.some((e) => isFileSource(e));

        // Large batch: queue for controlled processing
        ipcQueueRef.current.push(...newEntries);

        // Limit queue size – but never drop entries from a bounded file import.
        // The final-state trim (TRIM_THRESHOLD_ENTRIES) still guards against
        // true out-of-memory situations after the entries are merged.
        if (
          !isBoundedBatch &&
          ipcQueueRef.current.length > IPC_MAX_QUEUE_SIZE
        ) {
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
    // Recycle all entries back to pool before clearing
    setEntries((prev) => {
      if (prev.length > 0) {
        poolRef.current.releaseBatch(prev);
      }
      return [];
    });

    setNextId(1);
    nextIdRef.current = 1;
    fileSigCacheRef.current = new Map();
    httpSigCacheRef.current = new Map();
    clearHighlightCache();
    clearTimestampCache();
    clearTimestampParseCache();
    clearRegexCache();

    try {
      (LoggingStore as any).reset();
    } catch (e) {
      logger.error("LoggingStore.reset error:", e);
    }
  }, []);

  // Get pool statistics for debugging/monitoring
  const getPoolStats = useCallback(() => {
    return poolRef.current.getStats();
  }, []);

  return {
    entries,
    setEntries,
    appendEntries,
    clearEntries,
    nextId,
    setNextId,
    fileSigCacheRef,
    httpSigCacheRef,
    getPoolStats,
  };
}
