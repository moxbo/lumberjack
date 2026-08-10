/**
 * Persists canonical log entries in IndexedDB and keeps only sortable metadata
 * in renderer state.
 */
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { LoggingStore } from "../store/loggingStore";
import { InMemoryLogRepository } from "../store/paged/InMemoryLogRepository";
import {
  pagedLogRepository,
  startPagedSessionLifecycle,
} from "../store/paged/session";
import type { PagedLogEntry, PagedTimestamp } from "../store/paged";
import { clearTimestampParseCache, compareByTimestampId } from "../utils/sort";
import {
  entrySignature,
  isElasticSource,
  shouldDeduplicateSource,
} from "../utils/entryUtils";
import { clearHighlightCache } from "../renderer/LogRow";
import { clearTimestampCache } from "../utils/format";
import { clearRegexCache } from "../utils/highlight";
import logger from "../utils/logger";
import { IPC_BATCH_SIZE } from "../constants";

interface UseEntryManagementOptions {
  marksMap: Record<string, string>;
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

export function mergeSortedMetadata(
  previous: PagedEntryMetadata[],
  incoming: PagedEntryMetadata[],
): PagedEntryMetadata[] {
  if (previous.length === 0) return incoming;
  if (incoming.length === 0) return previous;
  if (compareByTimestampId(previous[previous.length - 1]!, incoming[0]!) <= 0) {
    return previous.concat(incoming);
  }
  const result = new Array<PagedEntryMetadata>(
    previous.length + incoming.length,
  );
  let previousIndex = 0;
  let incomingIndex = 0;
  let outputIndex = 0;
  while (previousIndex < previous.length && incomingIndex < incoming.length) {
    if (
      compareByTimestampId(
        previous[previousIndex]!,
        incoming[incomingIndex]!,
      ) <= 0
    ) {
      result[outputIndex++] = previous[previousIndex++]!;
    } else {
      result[outputIndex++] = incoming[incomingIndex++]!;
    }
  }
  while (previousIndex < previous.length) {
    result[outputIndex++] = previous[previousIndex++]!;
  }
  while (incomingIndex < incoming.length) {
    result[outputIndex++] = incoming[incomingIndex++]!;
  }
  return result;
}

export function useEntryManagement({ marksMap }: UseEntryManagementOptions) {
  const [entries, setMetadataEntries] = useState<PagedEntryMetadata[]>([]);
  const [storageError, setStorageError] = useState<Error | null>(null);
  const initialUsesPagedStorage = pagedLogRepository.isAvailable();
  const [usesPagedStorage, setUsesPagedStorage] = useState(
    initialUsesPagedStorage,
  );
  const marksMapRef = useRef(marksMap);
  marksMapRef.current = marksMap;
  const metadataByIdRef = useRef<Array<PagedEntryMetadata | undefined>>([]);
  const usesPagedStorageRef = useRef(usesPagedStorage);
  usesPagedStorageRef.current = usesPagedStorage;
  const repositoryRef = useRef<
    typeof pagedLogRepository | InMemoryLogRepository
  >(initialUsesPagedStorage ? pagedLogRepository : new InMemoryLogRepository());

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

  if (operationTailRef.current === null) {
    if (!pagedLogRepository.isAvailable()) {
      const memRepo = new InMemoryLogRepository();
      repositoryRef.current = memRepo;
      usesPagedStorageRef.current = false;
      operationTailRef.current = memRepo.clear();
    } else {
      operationTailRef.current = pagedLogRepository.clear().catch((error) => {
        const memRepo = new InMemoryLogRepository();
        repositoryRef.current = memRepo;
        usesPagedStorageRef.current = false;
        setUsesPagedStorage(false);
        logger.warn(
          "Paged log storage initialization failed; using in-memory storage",
          error,
        );
        return memRepo.clear();
      });
    }
  }

  useEffect(() => {
    if (!initialUsesPagedStorage) return () => {};
    const stopLifecycle = startPagedSessionLifecycle((error) => {
      logger.error("Maintaining paged log session failed:", error);
    });
    return () => {
      stopLifecycle();
      void pagedLogRepository.destroy().catch((error) => {
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
      let repository = repositoryRef.current;

      const fallBackToMemory = async (cause: unknown) => {
        if (repository instanceof InMemoryLogRepository) throw cause;

        const fallback = new InMemoryLogRepository();
        const recoveredEntries = new Map<number, PagedLogEntry>();
        const existingMetadata = metadataByIdRef.current.filter(
          (item): item is PagedEntryMetadata => item !== undefined,
        );
        try {
          for (
            let start = 0;
            start < existingMetadata.length;
            start += IPC_BATCH_SIZE
          ) {
            const page = existingMetadata.slice(start, start + IPC_BATCH_SIZE);
            const payloads = await repository.getPayloads(
              page.map((item) => item._id),
            );
            const entries = page
              .map((item): PagedLogEntry | null => {
                const entry = payloads.get(item._id);
                if (!entry) return null;
                return {
                  ...entry,
                  _id: item._id,
                  timestamp: item.timestamp,
                  message: String(entry.message ?? ""),
                  source: item.source,
                };
              })
              .filter((entry): entry is PagedLogEntry => entry !== null);
            if (entries.length !== page.length) {
              throw new Error("Not all paged log entries could be recovered");
            }
            await fallback.putMany(entries);
            for (const entry of entries) {
              recoveredEntries.set(entry._id!, entry);
            }
          }
        } catch (fallbackError) {
          throw new AggregateError(
            [cause, fallbackError],
            "Paged log storage failed and in-memory recovery was incomplete",
            { cause: fallbackError },
          );
        }

        repositoryRef.current = fallback;
        repository = fallback;
        usesPagedStorageRef.current = false;
        setUsesPagedStorage(false);
        setMetadataEntries((previous) => {
          return previous.map((item) => {
            const payload = recoveredEntries.get(item._id);
            const enriched: PagedEntryMetadata = {
              ...item,
              thread: payload?.thread ?? null,
              message: payload?.message ?? "",
              mdc: payload?.mdc ?? null,
            };
            metadataByIdRef.current[item._id] = enriched;
            return enriched;
          });
        });
        logger.warn(
          "Paged log storage failed; switched to in-memory storage",
          cause,
        );
      };

      const batchKeys = new Set<string>();
      const candidates: Array<{ source: string; signature: string }> = [];
      const prepared: any[] = [];
      for (const input of newEntries) {
        if (!input) continue;
        const source = String(input.source ?? "");
        const signature = entrySignature(input);
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
        try {
          existing = await repository.findExistingSignatures(candidates);
        } catch (error) {
          await fallBackToMemory(error);
          existing = await repository.findExistingSignatures(candidates);
        }
      }
      if (generation !== generationRef.current) return 0;
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

      for (const entry of accepted) {
        entry.raw = null;
        const mark = marksMapRef.current[entry.signature];
        if (mark) entry._mark = mark;
      }

      let ids: number[];
      try {
        ids = await repository.putMany(accepted);
      } catch (error) {
        await fallBackToMemory(error);
        ids = await repository.putMany(accepted);
      }
      if (generation !== generationRef.current) return 0;
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
        if (!usesPagedStorageRef.current) {
          base.thread = entry.thread ?? null;
          base.message = entry.message ?? "";
          base.mdc = entry.mdc ?? null;
        }
        return base;
      });
      for (const item of metadata) metadataByIdRef.current[item._id] = item;
      metadata.sort(compareByTimestampId as any);

      setMetadataEntries((previous) => mergeSortedMetadata(previous, metadata));
      setStorageError(null);
      return metadata.length;
    },
    [],
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
          const normalized =
            error instanceof Error ? error : new Error(String(error));
          setStorageError(normalized);
          logger.error("Paged log append failed:", normalized);
          batch.reject(normalized);
        }
      }
    } finally {
      drainingRef.current = false;
      if (queueRef.current.length > 0) void drainQueue();
    }
  }, [processBatch]);

  const appendEntriesAsync = useCallback(
    (newEntries: any[], options?: AppendEntriesOptions): Promise<number> => {
      if (!Array.isArray(newEntries) || newEntries.length === 0) {
        return Promise.resolve(0);
      }
      const generation = generationRef.current;
      const completions: Promise<number>[] = [];
      let processed = 0;
      for (let start = 0; start < newEntries.length; start += IPC_BATCH_SIZE) {
        const batchEntries = newEntries.slice(start, start + IPC_BATCH_SIZE);
        completions.push(
          new Promise<number>((resolve, reject) => {
            queueRef.current.push({
              entries: batchEntries,
              options,
              generation,
              resolve,
              reject,
            });
          }).then((stored) => {
            processed += batchEntries.length;
            options?.onProgress?.(processed, newEntries.length);
            return stored;
          }),
        );
      }
      void drainQueue();
      return Promise.all(completions).then((counts) => {
        let total = 0;
        for (const count of counts) total += count;
        return total;
      });
    },
    [drainQueue],
  );

  const appendEntries = useCallback(
    (newEntries: any[], options?: AppendEntriesOptions) => {
      void appendEntriesAsync(newEntries, options).catch(() => {
        // The hook already records and exposes the storage error to the UI.
      });
    },
    [appendEntriesAsync],
  );

  const clearEntries = useCallback(() => {
    generationRef.current++;
    const cancelled = queueRef.current;
    queueRef.current = [];
    for (const batch of cancelled) {
      batch.reject(
        new Error("Log append cancelled because entries were cleared"),
      );
    }
    metadataByIdRef.current = [];
    setMetadataEntries([]);
    clearHighlightCache();
    clearTimestampCache();
    clearTimestampParseCache();
    clearRegexCache();
    try {
      LoggingStore.reset();
    } catch (error) {
      logger.error("LoggingStore.reset error:", error);
    }

    const previous = operationTailRef.current ?? Promise.resolve();
    const repository = repositoryRef.current;
    operationTailRef.current = previous
      .then(() => repository.clear())
      .then(() => setStorageError(null))
      .catch((error) => {
        const normalized =
          error instanceof Error ? error : new Error(String(error));
        setStorageError(normalized);
        logger.error("Paged log clear failed:", normalized);
      });
  }, []);

  const getMetadata = useCallback(
    (id: number) => metadataByIdRef.current[id],
    [],
  );

  return {
    entries,
    entryGeneration: generationRef.current,
    appendEntries,
    appendEntriesAsync,
    clearEntries,
    storageError,
    usesPagedStorage,
    repository: repositoryRef.current,
    getMetadata,
  };
}
