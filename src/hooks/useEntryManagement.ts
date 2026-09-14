/**
 * Persists canonical log entries in IndexedDB and keeps only sortable metadata
 * in renderer state.
 */
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { LoggingStore } from "../store/loggingStore";
import {
  pagedLogRepository,
  startPagedSessionLifecycle,
} from "../store/paged/session";
import {
  createProjectionRecord,
  type PagedTimestamp,
  type ProjectionRecord,
} from "../store/paged";
import { clearTimestampParseCache, compareByTimestampId } from "../utils/sort";
import {
  compactEntrySignature,
  isElasticSource,
  legacyEntrySignature,
  shouldDeduplicateSource,
} from "../utils/entryUtils";
import { clearHighlightCache } from "../renderer/LogRow";
import { clearTimestampCache } from "../utils/format";
import { clearRegexCache } from "../utils/highlight";
import logger from "../utils/logger";
import { IPC_BATCH_SIZE } from "../constants";
import type { ProjectionBridge } from "../workers/projectionBridge";
import { MetadataStore } from "../utils/metadataSnapshot";
import {
  DEFAULT_INGESTION_LIMITS,
  IngestionBudget,
  type IngestionLimits,
} from "./ingestionBudget";

interface UseEntryManagementOptions {
  marksMap: Record<string, string>;
  projectionBridgeRef?: { current: ProjectionBridge | null };
  ingestionLimits?: Partial<IngestionLimits>;
}

interface AppendEntriesOptions {
  ignoreExistingForElastic?: boolean;
  onProgress?: (processed: number, total: number) => void;
}

export interface PagedEntryMetadata {
  _id: number;
  timestamp: PagedTimestamp;
  source: string;
  signature: string;
  level?: string | null;
  logger?: string | null;
  traceId?: string | null;
  _mark?: string;
  thread?: string | null;
  message?: string;
  mdc?: Record<string, unknown> | null;
}

export function getMetadataPublishDelay(entryCount: number): number {
  if (entryCount >= 500_000) return 250;
  if (entryCount >= 100_000) return 100;
  return 50;
}

export function useEntryManagement({
  marksMap,
  projectionBridgeRef: externalBridgeRef,
  ingestionLimits,
}: UseEntryManagementOptions) {
  const metadataStoreRef = useRef(new MetadataStore());
  const [entries, setMetadataEntries] = useState(() =>
    metadataStoreRef.current.publish(),
  );
  const [storageError, setStorageError] = useState<Error | null>(null);
  const [clearPhase, setClearPhase] = useState<"waiting" | "clearing" | null>(
    null,
  );
  const initialUsesPagedStorage = pagedLogRepository.isAvailable();
  const usesPagedStorage = true;
  const marksMapRef = useRef(marksMap);
  marksMapRef.current = marksMap;
  const hasLegacyMarksRef = useRef(false);
  hasLegacyMarksRef.current = Object.keys(marksMap).some(
    (signature) => !signature.startsWith("v2:"),
  );
  const projectionBridgeRef = externalBridgeRef ?? { current: null };
  const metadataByIdRef = useRef<Array<PagedEntryMetadata | undefined>>([]);
  const publishedMetadataCountRef = useRef(0);
  const metadataPublishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const idsBySignatureRef = useRef<Map<string, number | number[]>>(new Map());
  const repositoryRef = useRef(pagedLogRepository);
  const pausedErrorRef = useRef<Error | null>(null);
  const mountedRef = useRef(true);
  const budgetRef = useRef(
    new IngestionBudget({
      ...DEFAULT_INGESTION_LIMITS,
      ...ingestionLimits,
    }),
  );
  const producersRef = useRef(new Set<{ cancel: (error: Error) => void }>());

  const generationRef = useRef(0);
  const operationTailRef = useRef<Promise<void> | null>(null);
  const queueRef = useRef<
    Array<{
      entries: any[];
      options?: AppendEntriesOptions;
      generation: number;
      resolve: (stored: number) => void;
      reject: (error: Error) => void;
    }>
  >([]);
  const drainingRef = useRef(false);
  const cancelPending = useCallback((error: Error) => {
    const queued = queueRef.current;
    queueRef.current = [];
    for (const batch of queued) {
      batch.entries = [];
      batch.reject(error);
    }
    for (const producer of producersRef.current) producer.cancel(error);
    producersRef.current.clear();
  }, []);
  const pauseStorage = useCallback(
    (cause: unknown, generation: number) => {
      const normalized =
        cause instanceof Error ? cause : new Error(String(cause));
      const error =
        normalized === pausedErrorRef.current
          ? normalized
          : new Error(
              `Log storage failed: ${normalized.message}. Ingestion is paused. Existing logs remain available for browsing and export. Clear logs successfully before importing again.`,
              { cause: normalized },
            );
      if (generation === generationRef.current && mountedRef.current) {
        pausedErrorRef.current = error;
        setStorageError(error);
        cancelPending(error);
        logger.error(
          "Log storage failed; ingestion paused until a successful clear:",
          error,
        );
      }
      return error;
    },
    [cancelPending],
  );

  const publishMetadata = useCallback((): void => {
    if (metadataPublishTimerRef.current !== null) {
      clearTimeout(metadataPublishTimerRef.current);
      metadataPublishTimerRef.current = null;
    }
    const snapshot = metadataStoreRef.current.publish();
    publishedMetadataCountRef.current = snapshot.length;
    setMetadataEntries(snapshot);
  }, []);

  const scheduleMetadataPublish = useCallback((): void => {
    const unpublishedCount =
      metadataStoreRef.current.length - publishedMetadataCountRef.current;
    if (publishedMetadataCountRef.current === 0 || unpublishedCount >= 20_000) {
      publishMetadata();
      return;
    }
    if (metadataPublishTimerRef.current === null) {
      metadataPublishTimerRef.current = setTimeout(
        publishMetadata,
        getMetadataPublishDelay(metadataStoreRef.current.length),
      );
    }
  }, [publishMetadata]);

  if (operationTailRef.current === null) {
    const generation = generationRef.current;
    operationTailRef.current = Promise.resolve()
      .then(() => {
        if (!mountedRef.current || generation !== generationRef.current) return;
        if (!pagedLogRepository.isAvailable()) {
          throw new Error("IndexedDB is unavailable; log ingestion is paused.");
        }
        return pagedLogRepository.clear();
      })
      .catch((error) => {
        pauseStorage(error, generation);
      });
  }

  useEffect(() => {
    const stopLifecycle = initialUsesPagedStorage
      ? startPagedSessionLifecycle((error) => {
          logger.error("Maintaining paged log session failed:", error);
        })
      : () => undefined;
    return () => {
      mountedRef.current = false;
      generationRef.current++;
      cancelPending(
        new Error("Log append cancelled because the view was closed"),
      );
      if (metadataPublishTimerRef.current !== null) {
        clearTimeout(metadataPublishTimerRef.current);
      }
      stopLifecycle();
      void operationTailRef.current
        ?.then(() => pagedLogRepository.destroy())
        .catch((error) => {
          logger.error("Cleaning up paged log storage failed:", error);
        });
    };
  }, []);

  const processBatch = useCallback(
    async (
      newEntries: any[],
      options: AppendEntriesOptions | undefined,
      generation: number,
    ): Promise<number> => {
      if (newEntries.length === 0) return 0;
      const assertActive = () => {
        if (!mountedRef.current || generation !== generationRef.current) {
          throw new Error("Log append cancelled because the dataset changed");
        }
        if (pausedErrorRef.current) throw pausedErrorRef.current;
      };
      assertActive();
      const repository = repositoryRef.current;

      const batchKeys = new Set<string>();
      const candidates: Array<{ source: string; signature: string }> = [];
      const prepared: any[] = [];
      for (const input of newEntries) {
        if (!input) continue;
        const source = String(input.source ?? "");
        const signature = compactEntrySignature(input);
        const deduplicate = shouldDeduplicateSource(input);
        const key = `${source}\0${signature}`;
        if (deduplicate) {
          if (batchKeys.has(key)) continue;
          batchKeys.add(key);
        }

        const ignoreExisting =
          options?.ignoreExistingForElastic === true && isElasticSource(input);
        if (deduplicate && !ignoreExisting) {
          candidates.push({ source, signature });
        }
        prepared.push({
          input,
          source,
          signature,
          deduplicate,
          ignoreExisting,
        });
      }

      let existing = new Set<string>();
      if (candidates.length > 0) {
        existing = await repository.findExistingSignatures(candidates);
      }
      assertActive();
      const accepted = prepared
        .filter(
          ({ source, signature, deduplicate, ignoreExisting }) =>
            !deduplicate ||
            ignoreExisting ||
            !existing.has(`${source}\0${signature}`),
        )
        .map(({ input, signature }) => {
          const entry = { ...input };
          delete entry.id;
          delete entry._id;
          entry.signature = signature;
          return entry;
        });
      if (accepted.length === 0) return 0;

      try {
        LoggingStore.addEvents(accepted as any);
      } catch (error) {
        logger.error("LoggingStore.addEvents error:", error);
      }

      const legacyMarkedSignatures: Array<string | undefined> = [];
      for (let index = 0; index < accepted.length; index++) {
        const entry = accepted[index]!;
        entry.raw = null;
        let mark = marksMapRef.current[entry.signature];
        if (!mark && hasLegacyMarksRef.current) {
          const legacySignature = legacyEntrySignature(entry);
          mark = marksMapRef.current[legacySignature];
          if (mark) legacyMarkedSignatures[index] = legacySignature;
        }
        if (mark) entry._mark = mark;
      }

      const ids = await repository.putMany(accepted);
      assertActive();

      if (projectionBridgeRef.current) {
        const projections: ProjectionRecord[] = accepted.map((entry, index) =>
          createProjectionRecord(entry, ids[index]!),
        );
        projectionBridgeRef.current.publish(
          projections,
          repository.databaseName,
          generationRef.current,
        );
      }

      const metadata = accepted.map((entry, index): PagedEntryMetadata => {
        const base: PagedEntryMetadata = {
          _id: ids[index]!,
          timestamp: entry.timestamp ?? null,
          source: String(entry.source ?? ""),
          signature: entry.signature,
          level: entry.level ?? null,
          logger: entry.logger ?? null,
          traceId: entry.traceId ?? null,
          _mark:
            typeof entry._mark === "string" && entry._mark
              ? entry._mark
              : undefined,
        };
        return base;
      });
      for (let index = 0; index < metadata.length; index++) {
        const item = metadata[index]!;
        metadataByIdRef.current[item._id] = item;
        const signatures = [item.signature, legacyMarkedSignatures[index]];
        for (const signature of signatures) {
          if (!signature) continue;
          const current = idsBySignatureRef.current.get(signature);
          if (current === undefined) {
            idsBySignatureRef.current.set(signature, item._id);
          } else if (typeof current === "number") {
            idsBySignatureRef.current.set(signature, [current, item._id]);
          } else {
            current.push(item._id);
          }
        }
      }
      metadata.sort(compareByTimestampId);

      metadataStoreRef.current.appendSorted(metadata);
      scheduleMetadataPublish();
      return metadata.length;
    },
    [scheduleMetadataPublish],
  );

  const drainQueue = useCallback(async (): Promise<void> => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const batch = queueRef.current.shift()!;
        const previous = operationTailRef.current ?? Promise.resolve();
        const operation = previous.then(() =>
          processBatch(batch.entries, batch.options, batch.generation),
        );
        operationTailRef.current = operation.then(
          () => undefined,
          () => undefined,
        );
        try {
          const stored = await operation;
          batch.resolve(stored ?? 0);
        } catch (error) {
          const normalized = pauseStorage(error, batch.generation);
          batch.reject(normalized);
        } finally {
          batch.entries = [];
        }
      }
    } finally {
      drainingRef.current = false;
      if (queueRef.current.length > 0) void drainQueue();
    }
  }, [processBatch, pauseStorage]);

  const appendEntriesAsync = useCallback(
    (newEntries: any[], options?: AppendEntriesOptions): Promise<number> => {
      const generation = generationRef.current;
      if (!mountedRef.current) {
        return Promise.reject(new Error("Log view is closed"));
      }
      if (pausedErrorRef.current) {
        const error = new Error(pausedErrorRef.current.message, {
          cause: pausedErrorRef.current,
        });
        setStorageError(error);
        return Promise.reject(error);
      }
      if (!Array.isArray(newEntries) || newEntries.length === 0) {
        return Promise.resolve(0);
      }
      let release: () => void;
      try {
        release = budgetRef.current.reserve(newEntries);
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        setStorageError(error);
        return Promise.reject(error);
      }
      return new Promise<number>((resolveProducer, rejectProducer) => {
        const producer = {
          entries: newEntries,
          cancelled: false,
          cancel: (error: Error) => {
            producer.cancelled = true;
            producer.entries = [];
            rejectProducer(error);
          },
        };
        newEntries = [];
        producersRef.current.add(producer);
        void (async () => {
          let storedTotal = 0;
          const total = producer.entries.length;
          try {
            for (let start = 0; start < total; start += IPC_BATCH_SIZE) {
              if (producer.cancelled || generation !== generationRef.current) {
                throw new Error(
                  "Log append cancelled because the dataset changed",
                );
              }
              const count = Math.min(IPC_BATCH_SIZE, total - start);
              storedTotal += await new Promise<number>((resolve, reject) => {
                queueRef.current.push({
                  entries: producer.entries.slice(start, start + count),
                  options,
                  generation,
                  resolve,
                  reject,
                });
                void drainQueue();
              });
              if (producer.cancelled || generation !== generationRef.current) {
                throw new Error(
                  "Log append cancelled because the dataset changed",
                );
              }
              options?.onProgress?.(start + count, total);
            }
            resolveProducer(storedTotal);
          } catch (error) {
            rejectProducer(
              error instanceof Error ? error : new Error(String(error)),
            );
          } finally {
            producer.entries = [];
            producersRef.current.delete(producer);
            release();
          }
        })();
      });
    },
    [drainQueue],
  );

  const appendEntries = useCallback(
    (newEntries: any[], options?: AppendEntriesOptions) => {
      const generation = generationRef.current;
      void appendEntriesAsync(newEntries, options).catch((error) => {
        if (mountedRef.current && generation === generationRef.current) {
          setStorageError(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      });
    },
    [appendEntriesAsync],
  );

  const clearEntries = useCallback(() => {
    const generation = ++generationRef.current;
    setClearPhase("waiting");
    const clearingError = new Error(
      "Log ingestion is paused while storage is cleared",
    );
    pausedErrorRef.current = clearingError;
    cancelPending(
      new Error("Log append cancelled because entries were cleared"),
    );
    if (metadataPublishTimerRef.current !== null) {
      clearTimeout(metadataPublishTimerRef.current);
      metadataPublishTimerRef.current = null;
    }
    const previous = operationTailRef.current ?? Promise.resolve();
    const repository = repositoryRef.current;
    const operation = previous
      .then(() => {
        if (!mountedRef.current || generation !== generationRef.current) {
          throw new Error("Log clear cancelled because the dataset changed");
        }
        if (!repository.isAvailable())
          throw new Error("IndexedDB is unavailable");
        setClearPhase("clearing");
        return repository.clear();
      })
      .then(() => {
        if (!mountedRef.current || generation !== generationRef.current) {
          throw new Error("Log clear cancelled because the dataset changed");
        }
        projectionBridgeRef.current?.reset();
        metadataByIdRef.current = [];
        metadataStoreRef.current.clear();
        publishedMetadataCountRef.current = 0;
        idsBySignatureRef.current.clear();
        setMetadataEntries(metadataStoreRef.current.publish());
        clearHighlightCache();
        clearTimestampCache();
        clearTimestampParseCache();
        clearRegexCache();
        try {
          LoggingStore.reset();
        } catch (error) {
          logger.error("LoggingStore.reset error:", error);
        }
        pausedErrorRef.current = null;
        setStorageError(null);
      })
      .catch((error) => {
        if (mountedRef.current && generation === generationRef.current) {
          publishMetadata();
        }
        throw pauseStorage(error, generation);
      })
      .finally(() => {
        if (mountedRef.current && generation === generationRef.current) {
          setClearPhase(null);
        }
      });
    operationTailRef.current = operation.catch(() => undefined);
    return operation;
  }, [cancelPending, pauseStorage, publishMetadata]);

  const getMetadata = useCallback(
    (id: number) => metadataByIdRef.current[id],
    [],
  );
  const getDataGeneration = useCallback(() => generationRef.current, []);
  const getIdsBySignature = useCallback(
    (signature: string): number | readonly number[] | undefined =>
      idsBySignatureRef.current.get(signature),
    [],
  );

  return {
    entries,
    entryGeneration: generationRef.current,
    getDataGeneration,
    appendEntries,
    appendEntriesAsync,
    clearEntries,
    clearPhase,
    isClearing: clearPhase !== null,
    storageError,
    usesPagedStorage,
    repository: repositoryRef.current,
    getMetadata,
    getIdsBySignature,
  };
}
