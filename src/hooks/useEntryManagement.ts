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
import type { PagedTimestamp } from "../store/paged";
import { compareByTimestampId, clearTimestampParseCache } from "../utils/sort";
import { entrySignature, isElasticSource } from "../utils/entryUtils";
import { clearHighlightCache } from "../renderer/LogRow";
import { clearTimestampCache } from "../utils/format";
import { clearRegexCache } from "../utils/highlight";
import logger from "../utils/logger";
import { IPC_BATCH_SIZE } from "../constants";

interface UseEntryManagementOptions {
  marksMap: Record<string, string>;
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
}

function mergeSortedMetadata(
  previous: PagedEntryMetadata[],
  incoming: PagedEntryMetadata[],
): PagedEntryMetadata[] {
  if (previous.length === 0) return incoming;
  if (incoming.length === 0) return previous;
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
  const marksMapRef = useRef(marksMap);
  marksMapRef.current = marksMap;
  const metadataByIdRef = useRef<Array<PagedEntryMetadata | undefined>>([]);

  const generationRef = useRef(0);
  const operationTailRef = useRef<Promise<void> | null>(null);
  const queueRef = useRef<
    Array<{
      entries: any[];
      options?: { ignoreExistingForElastic?: boolean };
      generation: number;
    }>
  >([]);
  const drainingRef = useRef(false);

  if (operationTailRef.current === null) {
    operationTailRef.current = pagedLogRepository.clear().catch((error) => {
      const normalized =
        error instanceof Error ? error : new Error(String(error));
      setStorageError(normalized);
      logger.error("Paged log storage initialization failed:", normalized);
      throw normalized;
    });
  }

  useEffect(() => {
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
      options: { ignoreExistingForElastic?: boolean } | undefined,
      generation: number,
    ): Promise<void> => {
      if (newEntries.length === 0) return;

      const batchKeys = new Set<string>();
      const candidates: Array<{ source: string; signature: string }> = [];
      const prepared: any[] = [];
      for (const input of newEntries) {
        if (!input) continue;
        const source = String(input.source ?? "");
        const signature = entrySignature(input);
        const key = `${source}\0${signature}`;
        if (batchKeys.has(key)) continue;
        batchKeys.add(key);

        const ignoreExisting =
          options?.ignoreExistingForElastic === true && isElasticSource(input);
        if (!ignoreExisting) candidates.push({ source, signature });
        prepared.push({ input, source, signature, ignoreExisting });
      }

      const existing =
        candidates.length > 0
          ? await pagedLogRepository.findExistingSignatures(candidates)
          : new Set<string>();
      if (generation !== generationRef.current) return;
      const accepted = prepared
        .filter(
          ({ source, signature, ignoreExisting }) =>
            ignoreExisting || !existing.has(`${source}\0${signature}`),
        )
        .map(({ input }) => {
          const entry = { ...input };
          delete entry.id;
          delete entry._id;
          delete entry.signature;
          return entry;
        });
      if (accepted.length === 0) return;

      try {
        LoggingStore.addEvents(accepted as any);
      } catch (error) {
        logger.error("LoggingStore.addEvents error:", error);
      }

      for (const entry of accepted) {
        entry.raw = null;
        const mark = marksMapRef.current[entrySignature(entry)];
        if (mark) entry._mark = mark;
      }

      const ids = await pagedLogRepository.putMany(accepted);
      if (generation !== generationRef.current) return;
      const metadata = accepted.map((entry, index): PagedEntryMetadata => {
        const signature = entrySignature(entry);
        return {
          _id: ids[index]!,
          timestamp: entry.timestamp ?? null,
          source: String(entry.source ?? ""),
          signature,
          level: entry.level ?? null,
          logger: entry.logger ?? null,
          traceId: entry.traceId ?? null,
          _mark:
            typeof entry._mark === "string" && entry._mark
              ? entry._mark
              : undefined,
        };
      });
      for (const item of metadata) metadataByIdRef.current[item._id] = item;
      metadata.sort(compareByTimestampId as any);

      setMetadataEntries((previous) => mergeSortedMetadata(previous, metadata));
      setStorageError(null);
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
        operationTailRef.current = operation.catch((error) => {
          const normalized =
            error instanceof Error ? error : new Error(String(error));
          setStorageError(normalized);
          logger.error("Paged log append failed:", normalized);
        });
        await operationTailRef.current;
      }
    } finally {
      drainingRef.current = false;
      if (queueRef.current.length > 0) void drainQueue();
    }
  }, [processBatch]);

  const appendEntries = useCallback(
    (newEntries: any[], options?: { ignoreExistingForElastic?: boolean }) => {
      if (!Array.isArray(newEntries) || newEntries.length === 0) return;
      const generation = generationRef.current;
      for (let start = 0; start < newEntries.length; start += IPC_BATCH_SIZE) {
        queueRef.current.push({
          entries: newEntries.slice(start, start + IPC_BATCH_SIZE),
          options,
          generation,
        });
      }
      void drainQueue();
    },
    [drainQueue],
  );

  const clearEntries = useCallback(() => {
    generationRef.current++;
    queueRef.current = [];
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
    operationTailRef.current = previous
      .then(() => pagedLogRepository.clear())
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
    appendEntries,
    clearEntries,
    storageError,
    repository: pagedLogRepository,
    getMetadata,
  };
}
