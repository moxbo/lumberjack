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
  dataGeneration?: string | number;
  entryCount: number;
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
  partial?: boolean;
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

interface NormalizedProjectionFields {
  _id: number;
  levelUpper: string;
  loggerLower: string;
  threadLower: string;
  messageLower: string;
  timestampMs: number | null;
  elasticSource: boolean;
}

type FilterableEntry = Partial<ProjectionRecord> &
  Partial<NormalizedProjectionFields>;
export type CachedProjection = ProjectionRecord & NormalizedProjectionFields;

export interface PassingReference {
  id: number;
  _id: number;
  timestamp: unknown;
  message?: string;
  messageLower?: string;
}

interface PreparedFilter {
  navigationSearch: string;
  levelFilter: string;
  loggerFilter: string;
  threadFilter: string;
  fromTs: number | null;
  toTs: number | null;
  compiledDcFilter: ReturnType<typeof compileDcFilter>;
  messageMatcher: (entry: FilterableEntry) => boolean;
}

const PAGED_SCAN_SIZE = 2_000;
const SEARCHABLE_REFERENCE_LIMIT = 50_000;

interface PagedFilterCache {
  databaseName?: string;
  generation?: string | number;
  dataGeneration?: string | number;
  scannedEntryCount: number;
  lastScannedId?: number;
  references: PassingReference[];
  stats: FilterStats;
}

let pagedFilterCache: PagedFilterCache | null = null;

interface PagedProjectionCache {
  databaseName?: string;
  dataGeneration?: string | number;
  recordsById: CachedProjection[];
  sortedRecords: CachedProjection[];
  lastScannedId?: number;
}

let pagedProjectionCache: PagedProjectionCache | null = null;

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

function createMessageMatcher(
  expression: string,
  mode: SearchMode = "insensitive",
): (entry: Pick<FilterableEntry, "message" | "messageLower">) => boolean {
  const query = String(expression || "").trim();
  if (!query) return () => true;

  // Most interactive searches are literals or whitespace-separated implicit
  // AND terms. Avoid the general query parser and repeated lower-casing.
  if (/^[^&|!()"\\]+$/.test(query)) {
    const terms = query.split(/\s+/).filter(Boolean);
    const hasTextOperator = terms.some(
      (term) => term === "AND" || term === "OR" || term === "NOT",
    );
    if (hasTextOperator) {
      return (entry) =>
        msgMatches(String(entry.message ?? ""), query, {
          mode,
        });
    }
    if (mode === "sensitive") {
      return (entry) => {
        const message = String(entry.message ?? "");
        return terms.every((term) => message.includes(term));
      };
    }
    if (mode === "insensitive") {
      const needles = terms.map((term) => term.toLowerCase());
      return (entry) => {
        const message =
          entry.messageLower ?? String(entry.message ?? "").toLowerCase();
        return needles.every((needle) => message.includes(needle));
      };
    }
  }

  return (entry) =>
    msgMatches(String(entry.message ?? ""), query, {
      mode,
    });
}

export function normalizeProjection(entry: ProjectionRecord): CachedProjection {
  const timestampMs = new Date(entry.timestamp as string).getTime();
  return {
    ...entry,
    _id: entry.id,
    levelUpper: String(entry.level ?? "").toUpperCase(),
    loggerLower: String(entry.logger ?? "").toLowerCase(),
    threadLower: String(entry.thread ?? "").toLowerCase(),
    messageLower: String(entry.message ?? "").toLowerCase(),
    timestampMs: Number.isNaN(timestampMs) ? null : timestampMs,
    elasticSource: entry.source.startsWith("elastic://"),
  };
}

export function mergeProjectionRecords(
  previous: CachedProjection[],
  incoming: CachedProjection[],
): CachedProjection[] {
  if (previous.length === 0) return incoming.sort(compareByTimestampId);
  if (incoming.length === 0) return previous;
  incoming.sort(compareByTimestampId);
  if (compareByTimestampId(previous[previous.length - 1]!, incoming[0]!) <= 0) {
    for (const entry of incoming) previous.push(entry);
    return previous;
  }
  const merged = new Array<CachedProjection>(previous.length + incoming.length);
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
      merged[outputIndex++] = previous[previousIndex++]!;
    } else {
      merged[outputIndex++] = incoming[incomingIndex++]!;
    }
  }
  while (previousIndex < previous.length) {
    merged[outputIndex++] = previous[previousIndex++]!;
  }
  while (incomingIndex < incoming.length) {
    merged[outputIndex++] = incoming[incomingIndex++]!;
  }
  return merged;
}

export function mergePassingReferences(
  previous: PassingReference[],
  incoming: PassingReference[],
): PassingReference[] {
  if (previous.length === 0) {
    incoming.sort(compareByTimestampId);
    for (
      let index = SEARCHABLE_REFERENCE_LIMIT;
      index < incoming.length;
      index++
    ) {
      incoming[index]!.message = undefined;
      incoming[index]!.messageLower = undefined;
    }
    return incoming;
  }
  if (incoming.length === 0) return previous;
  incoming.sort(compareByTimestampId);
  if (compareByTimestampId(previous[previous.length - 1]!, incoming[0]!) <= 0) {
    for (const entry of incoming) {
      if (previous.length >= SEARCHABLE_REFERENCE_LIMIT) {
        entry.message = undefined;
        entry.messageLower = undefined;
      }
      previous.push(entry);
    }
    return previous;
  }
  const merged = new Array<PassingReference>(previous.length + incoming.length);
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
      const entry = previous[previousIndex++]!;
      if (outputIndex >= SEARCHABLE_REFERENCE_LIMIT) {
        entry.message = undefined;
        entry.messageLower = undefined;
      }
      merged[outputIndex++] = entry;
    } else {
      const entry = incoming[incomingIndex++]!;
      if (outputIndex >= SEARCHABLE_REFERENCE_LIMIT) {
        entry.message = undefined;
        entry.messageLower = undefined;
      }
      merged[outputIndex++] = entry;
    }
  }
  while (previousIndex < previous.length) {
    const entry = previous[previousIndex++]!;
    if (outputIndex >= SEARCHABLE_REFERENCE_LIMIT) {
      entry.message = undefined;
      entry.messageLower = undefined;
    }
    merged[outputIndex++] = entry;
  }
  while (incomingIndex < incoming.length) {
    const entry = incoming[incomingIndex++]!;
    if (outputIndex >= SEARCHABLE_REFERENCE_LIMIT) {
      entry.message = undefined;
      entry.messageLower = undefined;
    }
    merged[outputIndex++] = entry;
  }
  return merged;
}

function buildPagedResponse(
  request: PagedFilterRequest,
  references: PassingReference[],
  stats: FilterStats,
  partial = false,
): FilterResponse {
  const search = String(request.options.navigationSearch || "").trim();
  const searchMatchIndices: number[] = [];
  if (search) {
    const matcher = createMessageMatcher(
      search,
      request.options.navigationSearchMode,
    );
    const limit = Math.min(references.length, SEARCHABLE_REFERENCE_LIMIT);
    for (let visualIndex = 0; visualIndex < limit; visualIndex++) {
      if (matcher(references[visualIndex]!)) {
        searchMatchIndices.push(visualIndex);
      }
    }
  }
  return {
    type: "result",
    filteredIndices: references.map((entry) => entry.id),
    searchMatchIndices,
    stats,
    requestId: request.requestId,
    generation: request.generation,
    paged: true,
    partial,
  };
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
    messageMatcher: createMessageMatcher(options.filter.message),
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
      (entry.levelUpper ?? String(entry.level || "").toUpperCase()) !==
        prepared.levelFilter
    ) {
      stats.rejectedByLevel++;
      return false;
    }
    if (
      prepared.loggerFilter &&
      !(entry.loggerLower ?? String(entry.logger || "").toLowerCase()).includes(
        prepared.loggerFilter,
      )
    ) {
      stats.rejectedByLogger++;
      return false;
    }
    if (
      prepared.threadFilter &&
      !(entry.threadLower ?? String(entry.thread || "").toLowerCase()).includes(
        prepared.threadFilter,
      )
    ) {
      stats.rejectedByThread++;
      return false;
    }
    if (options.filter.message && !prepared.messageMatcher(entry)) {
      stats.rejectedByMessage++;
      return false;
    }
  }

  const isElasticSource =
    entry.elasticSource ??
    (typeof entry.source === "string" && entry.source.startsWith("elastic://"));
  if (
    isElasticSource &&
    options.timeFilterEnabled &&
    !(entry.timestampMs != null
      ? !(
          (prepared.fromTs !== null && entry.timestampMs < prepared.fromTs) ||
          (prepared.toTs !== null && entry.timestampMs > prepared.toTs)
        )
      : matchesTimeRange(entry.timestamp, prepared.fromTs, prepared.toTs))
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

async function loadPagedProjectionCache(
  request: PagedFilterRequest,
  pageSize: number,
): Promise<{
  cache: PagedProjectionCache;
  appendedRecords: CachedProjection[];
}> {
  const canReuse =
    pagedProjectionCache !== null &&
    pagedProjectionCache.databaseName === request.databaseName &&
    pagedProjectionCache.dataGeneration === request.dataGeneration &&
    request.entryCount >= pagedProjectionCache.recordsById.length;
  const cache: PagedProjectionCache = canReuse
    ? pagedProjectionCache!
    : {
        databaseName: request.databaseName,
        dataGeneration: request.dataGeneration,
        recordsById: [],
        sortedRecords: [],
      };

  if (request.entryCount === cache.recordsById.length) {
    pagedProjectionCache = cache;
    return { cache, appendedRecords: [] };
  }

  const appendedRecords: CachedProjection[] = [];
  const db = await openPagedDatabase(undefined, request.databaseName);
  try {
    while (true) {
      const page = await readProjectionPage(db, cache.lastScannedId, pageSize);
      for (const entry of page) {
        appendedRecords.push(normalizeProjection(entry));
      }
      if (page.length > 0) {
        cache.lastScannedId = page[page.length - 1]!.id;
      }
      if (page.length < pageSize) break;
    }
  } finally {
    db.close();
  }

  for (const record of appendedRecords) cache.recordsById.push(record);
  cache.sortedRecords = mergeProjectionRecords(
    cache.sortedRecords,
    appendedRecords.slice(),
  );
  pagedProjectionCache = cache;
  return { cache, appendedRecords };
}

function yieldWorker(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

let latestPagedRequestId = 0;

async function filterPagedDatabase(
  request: PagedFilterRequest,
  onProgress?: (response: FilterResponse) => void,
): Promise<FilterResponse | null> {
  const pageSize =
    request.pageSize !== undefined &&
    Number.isSafeInteger(request.pageSize) &&
    request.pageSize > 0
      ? request.pageSize
      : PAGED_SCAN_SIZE;
  const { cache: projectionCache } = await loadPagedProjectionCache(
    request,
    pageSize,
  );
  if (request.requestId !== latestPagedRequestId) return null;

  const canReuseFiltered =
    pagedFilterCache !== null &&
    pagedFilterCache.databaseName === request.databaseName &&
    pagedFilterCache.generation === request.generation &&
    pagedFilterCache.dataGeneration === request.dataGeneration &&
    projectionCache.recordsById.length >= pagedFilterCache.scannedEntryCount;
  const stats = canReuseFiltered
    ? { ...pagedFilterCache!.stats }
    : emptyStats();
  const prepared = prepareFilter(request.options);
  const previousReferences = canReuseFiltered
    ? pagedFilterCache!.references
    : [];
  const appendedReferences: PassingReference[] = [];
  const markedSignatures = new Set(request.markedSignatures);

  if (
    canReuseFiltered &&
    projectionCache.recordsById.length === pagedFilterCache!.scannedEntryCount
  ) {
    return buildPagedResponse(request, previousReferences, stats);
  }

  const records = canReuseFiltered
    ? projectionCache.recordsById.slice(pagedFilterCache!.scannedEntryCount)
    : projectionCache.sortedRecords;
  for (let index = 0; index < records.length; index++) {
    const entry = records[index]!;
    stats.total++;
    if (
      entryPasses(entry, request.options, prepared, stats, markedSignatures)
    ) {
      const retainMessage =
        canReuseFiltered ||
        appendedReferences.length < SEARCHABLE_REFERENCE_LIMIT;
      appendedReferences.push({
        id: entry.id,
        _id: entry.id,
        timestamp: entry.timestamp,
        message: retainMessage ? entry.message : undefined,
        messageLower: retainMessage ? entry.messageLower : undefined,
      });
    }

    if (!canReuseFiltered && index + 1 === Math.min(pageSize, records.length)) {
      onProgress?.(
        buildPagedResponse(
          request,
          appendedReferences.slice(),
          { ...stats },
          true,
        ),
      );
    }
    if ((index + 1) % 5_000 === 0) {
      await yieldWorker();
      if (request.requestId !== latestPagedRequestId) return null;
    }
  }

  const references = canReuseFiltered
    ? mergePassingReferences(previousReferences, appendedReferences)
    : appendedReferences;
  if (request.requestId !== latestPagedRequestId) return null;
  pagedFilterCache = {
    databaseName: request.databaseName,
    generation: request.generation,
    dataGeneration: request.dataGeneration,
    scannedEntryCount: projectionCache.recordsById.length,
    lastScannedId: projectionCache.lastScannedId,
    references,
    stats: { ...stats },
  };
  return buildPagedResponse(request, references, stats);
}

let cachedEntries: unknown[] = [];
let pagedFilterRunning = false;
let queuedPagedRequest: PagedFilterRequest | null = null;
let activePagedGeneration: string | number | undefined;
let activePagedDataGeneration: string | number | undefined;

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
    activePagedDataGeneration = request.dataGeneration;
    latestPagedRequestId = request.requestId;
    void filterPagedDatabase(request, (progress) =>
      workerScope.postMessage(progress),
    )
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
        activePagedDataGeneration = undefined;
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
      if (
        data.generation !== activePagedGeneration ||
        data.dataGeneration !== activePagedDataGeneration
      ) {
        latestPagedRequestId = data.requestId;
      }
    } else {
      runPagedRequest(data);
    }
  };
}
