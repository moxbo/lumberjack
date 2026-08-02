import {
  openPagedDatabase,
  PROJECTION_STORE_NAME,
  type ProjectionRecord,
} from "../store/paged";
import { compileDcFilter, matchesCompiledDcFilter } from "../utils/dcMatch";
import { msgMatches, type SearchMode } from "../utils/msgFilter";
import { compareByTimestampId } from "../utils/sort";

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

export interface SetEntriesRequest {
  type: "setEntries";
  entries: unknown[];
}

export interface AppendEntriesRequest {
  type: "appendEntries";
  entries: unknown[];
}

export interface FilterRequest {
  type: "filter";
  entries?: unknown[];
  options: FilterOptions;
  requestId?: number;
}

export interface PagedFilterRequest {
  type: "filterPaged";
  options: FilterOptions;
  requestId: number;
  markedSignatures: string[];
  pageSize?: number;
  generation?: string | number;
  databaseName?: string;
}

export interface FilterResponse {
  type: "result";
  filteredIndices: number[];
  searchMatchIndices: number[];
  stats: FilterStats;
  requestId?: number;
  generation?: string | number;
  paged?: boolean;
}

export interface FilterErrorResponse {
  type: "error";
  requestId: number;
  message: string;
  generation?: string | number;
  paged: true;
}

type WorkerRequest =
  SetEntriesRequest | AppendEntriesRequest | FilterRequest | PagedFilterRequest;

type FilterableEntry = Partial<ProjectionRecord>;

interface PassingReference {
  id: number;
  _id: number;
  timestamp: unknown;
  message?: string;
}

interface PreparedFilter {
  navigationSearch: string;
  levelFilter: string;
  loggerFilter: string;
  threadFilter: string;
  fromTs: number | null;
  toTs: number | null;
  compiledDcFilter: ReturnType<typeof compileDcFilter>;
}

const PAGED_SCAN_SIZE = 2_000;

function emptyStats(): FilterStats {
  return {
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
}

function parseOptionalTimestamp(value?: string): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function prepareFilter(options: FilterOptions): PreparedFilter {
  return {
    navigationSearch: String(options.navigationSearch || "").trim(),
    levelFilter: options.filter.level.toUpperCase(),
    loggerFilter: options.filter.logger.toLowerCase(),
    threadFilter: options.filter.thread.toLowerCase(),
    fromTs: parseOptionalTimestamp(options.timeFilterFrom),
    toTs: parseOptionalTimestamp(options.timeFilterTo),
    compiledDcFilter: options.dcFilterEnabled
      ? compileDcFilter(options.dcFilterEntries)
      : [],
  };
}

function matchesTimeRange(
  timestamp: unknown,
  fromTs: number | null,
  toTs: number | null,
): boolean {
  if (fromTs === null && toTs === null) return true;
  try {
    const ts = new Date(timestamp as string).getTime();
    if (Number.isNaN(ts)) return true;
    return !((fromTs !== null && ts < fromTs) || (toTs !== null && ts > toTs));
  } catch {
    return true;
  }
}

function entryPasses(
  entry: FilterableEntry,
  options: FilterOptions,
  prepared: PreparedFilter,
  stats: FilterStats,
  markedSignatures?: ReadonlySet<string>,
): boolean {
  const externallyMarked =
    typeof entry.signature === "string" &&
    markedSignatures?.has(entry.signature) === true;
  if (options.onlyMarked && !entry._mark && !externallyMarked) {
    stats.rejectedByOnlyMarked++;
    return false;
  }

  if (options.stdFiltersEnabled) {
    if (
      prepared.levelFilter &&
      String(entry.level || "").toUpperCase() !== prepared.levelFilter
    ) {
      stats.rejectedByLevel++;
      return false;
    }
    if (
      prepared.loggerFilter &&
      !String(entry.logger || "")
        .toLowerCase()
        .includes(prepared.loggerFilter)
    ) {
      stats.rejectedByLogger++;
      return false;
    }
    if (
      prepared.threadFilter &&
      !String(entry.thread || "")
        .toLowerCase()
        .includes(prepared.threadFilter)
    ) {
      stats.rejectedByThread++;
      return false;
    }
    if (
      options.filter.message &&
      !msgMatches(String(entry.message ?? ""), options.filter.message)
    ) {
      stats.rejectedByMessage++;
      return false;
    }
  }

  const isElasticSource =
    typeof entry.source === "string" && entry.source.startsWith("elastic://");
  if (
    isElasticSource &&
    options.timeFilterEnabled &&
    !matchesTimeRange(entry.timestamp, prepared.fromTs, prepared.toTs)
  ) {
    stats.rejectedByTime++;
    return false;
  }

  if (
    options.dcFilterEnabled &&
    !matchesCompiledDcFilter(entry.mdc, prepared.compiledDcFilter)
  ) {
    stats.rejectedByDC++;
    return false;
  }

  stats.passed++;
  return true;
}

/**
 * Pure paged-filter core. Each iterable item represents one IndexedDB page.
 * It intentionally retains only passing IDs/timestamps and search messages.
 */
export function filterProjectionPages(
  pages: Iterable<readonly ProjectionRecord[]>,
  options: FilterOptions,
  markedSignatures: ReadonlySet<string> = new Set(),
): FilterResponse {
  const stats = emptyStats();
  const prepared = prepareFilter(options);
  const references: PassingReference[] = [];

  for (const page of pages) {
    for (const entry of page) {
      stats.total++;
      if (
        entry &&
        entryPasses(entry, options, prepared, stats, markedSignatures)
      ) {
        references.push({
          id: entry.id,
          _id: entry.id,
          timestamp: entry.timestamp,
          message: prepared.navigationSearch ? entry.message : undefined,
        });
      }
    }
  }

  references.sort(compareByTimestampId);
  const searchMatchIndices: number[] = [];
  if (prepared.navigationSearch) {
    const limit = Math.min(references.length, 50_000);
    for (let visualIndex = 0; visualIndex < limit; visualIndex++) {
      const ref = references[visualIndex]!;
      if (
        msgMatches(ref.message ?? "", prepared.navigationSearch, {
          mode: options.navigationSearchMode,
        })
      ) {
        searchMatchIndices.push(visualIndex);
      }
    }
  }
  return {
    type: "result",
    filteredIndices: references.map((entry) => entry.id),
    searchMatchIndices,
    stats,
    paged: true,
  };
}

function filterLegacyEntries(
  entries: unknown[],
  options: FilterOptions,
): FilterResponse {
  const stats = emptyStats();
  const prepared = prepareFilter(options);
  const filteredIndices: number[] = [];
  const searchMatchIndices: number[] = [];

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index] as FilterableEntry | null;
    stats.total++;
    if (!entry || !entryPasses(entry, options, prepared, stats)) continue;
    const visualIndex = filteredIndices.length;
    const entryId = (entry as { _id?: unknown })._id;
    const id = typeof entryId === "number" ? entryId : index;
    filteredIndices.push(id);
    if (
      prepared.navigationSearch &&
      visualIndex < 50_000 &&
      msgMatches(String(entry.message ?? ""), prepared.navigationSearch, {
        mode: options.navigationSearchMode,
      })
    ) {
      searchMatchIndices.push(visualIndex);
    }
  }

  return {
    type: "result",
    filteredIndices,
    searchMatchIndices,
    stats,
  };
}

function readProjectionPage(
  db: IDBDatabase,
  afterId: number | undefined,
  pageSize: number,
): Promise<ProjectionRecord[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const page: ProjectionRecord[] = [];
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction(PROJECTION_STORE_NAME, "readonly");
      const range =
        afterId === undefined
          ? undefined
          : IDBKeyRange.lowerBound(afterId, true);
      const request = transaction
        .objectStore(PROJECTION_STORE_NAME)
        .openCursor(range, "next");
      request.onerror = () => {
        settled = true;
        reject(request.error ?? new Error("Projection cursor failed"));
      };
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          if (!settled) {
            settled = true;
            resolve(page);
          }
          return;
        }
        page.push(cursor.value as ProjectionRecord);
        if (page.length < pageSize) {
          cursor.continue();
        } else if (!settled) {
          settled = true;
          resolve(page);
        }
      };
      transaction.onabort = () => {
        if (!settled)
          reject(transaction.error ?? new Error("Projection scan aborted"));
      };
      transaction.onerror = () => {
        if (!settled)
          reject(transaction.error ?? new Error("Projection scan failed"));
      };
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

let latestPagedRequestId = 0;

async function filterPagedDatabase(
  request: PagedFilterRequest,
): Promise<FilterResponse | null> {
  const stats = emptyStats();
  const prepared = prepareFilter(request.options);
  const references: PassingReference[] = [];
  const markedSignatures = new Set(request.markedSignatures);
  const pageSize =
    request.pageSize !== undefined &&
    Number.isSafeInteger(request.pageSize) &&
    request.pageSize > 0
      ? request.pageSize
      : PAGED_SCAN_SIZE;
  const db = await openPagedDatabase(undefined, request.databaseName);

  try {
    let afterId: number | undefined;
    while (true) {
      if (request.requestId !== latestPagedRequestId) return null;
      const page = await readProjectionPage(db, afterId, pageSize);
      if (request.requestId !== latestPagedRequestId) return null;
      for (const entry of page) {
        stats.total++;
        if (
          entry &&
          entryPasses(entry, request.options, prepared, stats, markedSignatures)
        ) {
          references.push({
            id: entry.id,
            _id: entry.id,
            timestamp: entry.timestamp,
            message: prepared.navigationSearch ? entry.message : undefined,
          });
        }
      }
      if (page.length < pageSize) break;
      afterId = page[page.length - 1]!.id;
    }
    if (request.requestId !== latestPagedRequestId) return null;
    references.sort(compareByTimestampId);
    const searchMatchIndices: number[] = [];
    if (prepared.navigationSearch) {
      const limit = Math.min(references.length, 50_000);
      for (let visualIndex = 0; visualIndex < limit; visualIndex++) {
        const ref = references[visualIndex]!;
        if (
          msgMatches(ref.message ?? "", prepared.navigationSearch, {
            mode: request.options.navigationSearchMode,
          })
        ) {
          searchMatchIndices.push(visualIndex);
        }
      }
    }
    if (request.requestId !== latestPagedRequestId) return null;
    return {
      type: "result",
      filteredIndices: references.map((entry) => entry.id),
      searchMatchIndices,
      stats,
      requestId: request.requestId,
      generation: request.generation,
      paged: true,
    };
  } finally {
    db.close();
  }
}

let cachedEntries: unknown[] = [];
let pagedFilterRunning = false;
let queuedPagedRequest: PagedFilterRequest | null = null;
let activePagedGeneration: string | number | undefined;

const workerScope =
  typeof self === "undefined"
    ? undefined
    : (self as unknown as {
        onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
        postMessage(message: FilterResponse | FilterErrorResponse): void;
      });

if (workerScope) {
  const runPagedRequest = (request: PagedFilterRequest): void => {
    pagedFilterRunning = true;
    activePagedGeneration = request.generation;
    latestPagedRequestId = request.requestId;
    void filterPagedDatabase(request)
      .then((result) => {
        if (result) workerScope.postMessage(result);
      })
      .catch((error: unknown) => {
        workerScope.postMessage({
          type: "error",
          requestId: request.requestId,
          message: error instanceof Error ? error.message : String(error),
          generation: request.generation,
          paged: true,
        });
      })
      .finally(() => {
        pagedFilterRunning = false;
        activePagedGeneration = undefined;
        const queued = queuedPagedRequest;
        queuedPagedRequest = null;
        if (queued) runPagedRequest(queued);
      });
  };

  workerScope.onmessage = (event: MessageEvent<WorkerRequest>) => {
    const data = event.data;
    if (data.type === "setEntries") {
      cachedEntries = data.entries || [];
      return;
    }
    if (data.type === "appendEntries") {
      const incoming = data.entries || [];
      for (let i = 0; i < incoming.length; i++) {
        cachedEntries.push(incoming[i]);
      }
      return;
    }
    if (data.type === "filter") {
      const result = filterLegacyEntries(
        data.entries ?? cachedEntries,
        data.options,
      );
      result.requestId = data.requestId;
      workerScope.postMessage(result);
      return;
    }

    if (pagedFilterRunning) {
      queuedPagedRequest = data;
      if (data.generation !== activePagedGeneration) {
        latestPagedRequestId = data.requestId;
      }
    } else {
      runPagedRequest(data);
    }
  };
}
