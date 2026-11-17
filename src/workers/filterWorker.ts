import {
  openPagedDatabase,
  PROJECTION_STORE_NAME,
  type ProjectionRecord,
} from "../store/paged";
import { compileDcFilter, matchesCompiledDcFilter } from "../utils/dcMatch";
import { compileLevelFilter } from "../utils/levelFilter";
import { compileMessageExpression, type SearchMode } from "../utils/msgFilter";
import {
  MESSAGE_SEARCH_STORE_NAME,
  readStoreRange,
} from "../store/paged/indexedDb";
import {
  MESSAGE_SEARCH_PAGE_SIZE,
  messageSearchPageId,
  validateMessageSearchPage,
  type MessageSearchPage,
} from "../store/paged/messageSearchIndex";
import { MessagePageQuery, MessageTermCache } from "./messageSearch";
import { compareByTimestampId } from "../utils/sort";
import { SortedStore, type SortedSnapshot } from "../utils/sortedSequence";
import type { ReadonlySequence } from "../utils/readonlySequence";
import type { FilterProgress } from "../types/filterProgress";
export type { FilterProgress } from "../types/filterProgress";

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
  dataGeneration?: string | number;
}

export interface AppendEntriesRequest {
  type: "appendEntries";
  entries: unknown[];
  dataGeneration?: string | number;
}

export interface FilterRequest {
  type: "filter";
  entries?: unknown[];
  options: FilterOptions;
  requestId?: number;
  generation?: string | number;
  baseGeneration?: string | number;
  knownBaseCount?: number;
  incrementalResults?: boolean;
  dataGeneration?: string | number;
}

export interface PagedFilterRequest {
  type: "filterPaged";
  options: FilterOptions;
  requestId: number;
  markedSignatures: string[];
  pageSize?: number;
  generation?: string | number;
  baseGeneration?: string | number;
  knownBaseCount?: number;
  incrementalResults?: boolean;
  dataGeneration?: string | number;
  entryCount: number;
  databaseName?: string;
}

export interface FilterResponse {
  type: "result";
  filteredIndices: number[];
  searchMatchIndices: number[];
  searchMatchIds?: number[];
  progress?: FilterProgress;
  stats: FilterStats;
  requestId?: number;
  generation?: string | number;
  dataGeneration?: string | number;
  paged?: boolean;
  partial?: boolean;
  /** The completed base view is unchanged; filteredIndices is omitted logically. */
  reuseFilteredIndices?: boolean;
  /** Match arrays contain only new matches, sorted by visual index. */
  searchMatchesDelta?: boolean;
  /** Ordered insertion delta; fromLength detects missed or stale base updates. */
  baseDelta?: {
    reset: boolean;
    fromLength: number;
    entries: PassingReference[];
  };
}

export interface FilterErrorResponse {
  type: "error";
  requestId?: number;
  message: string;
  generation?: string | number;
  dataGeneration?: string | number;
  paged?: boolean;
}

export interface TransferProjectionsRequest {
  type: "transferProjections";
  records: ProjectionRecord[];
  databaseName: string;
  dataGeneration: string | number;
}

export interface ResetProjectionsRequest {
  type: "resetProjections";
}

export type WorkerRequest =
  | SetEntriesRequest
  | AppendEntriesRequest
  | FilterRequest
  | PagedFilterRequest
  | TransferProjectionsRequest
  | ResetProjectionsRequest
  | { type: "cancel"; requestId: number };

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
  searchMatch?: boolean;
  message?: string;
  messageLower?: string;
}

interface PreparedFilter {
  navigationSearch: string;
  levelFilter: ReturnType<typeof compileLevelFilter>;
  loggerFilter: string;
  threadFilter: string;
  fromTs: number | null;
  toTs: number | null;
  compiledDcFilter: ReturnType<typeof compileDcFilter>;
  messageMatcher: (entry: FilterableEntry) => boolean;
}

const PAGED_SCAN_SIZE = 2_000;
const PROGRESS_INTERVAL_MS = 100;
const MAX_PENDING_REFERENCES = 8_000;
const TRANSFER_CACHE_MAX_CHARS = 64 * 1024 * 1024;
const TRANSFER_CACHE_MAX_RECORDS = 350_000;

interface PagedFilterCache {
  paged: boolean;
  baseKey: string;
  searchKey: string | null;
  databaseName?: string;
  generation?: string | number;
  dataGeneration?: string | number;
  scannedEntryCount: number;
  references: SortedSnapshot<PassingReference>;
  store: SortedStore<PassingReference>;
  matchCount: number;
  stats: FilterStats;
  positions?: Int32Array | Map<number, number>;
}

let pagedFilterCache: PagedFilterCache | null = null;
const messageTermCache = new MessageTermCache();
let messageIndexIdentity: string | undefined;

// ─── Transferred projection cache ────────────────────────────────────────────
// Records pushed directly from the main thread via `transferProjections`.
// Keyed by ID for idempotent duplicate rejection.

interface TransferredProjectionCache {
  databaseName: string;
  dataGeneration: string | number;
  recordsById: Map<number, CachedProjection>;
  sortedRecords: CachedProjection[];
  retainedChars: number;
  limited: boolean;
}

let transferredProjectionCache: TransferredProjectionCache | null = null;

/**
 * Merge transferred records idempotently.  Duplicate IDs (replayed batches)
 * are ignored.  Out-of-order batches are sorted on merge.  A generation or
 * database change resets the cache.
 */
export function handleTransferProjections(
  records: ProjectionRecord[],
  databaseName: string,
  dataGeneration: string | number,
): void {
  if (records.length === 0) return;

  // Generation/database reset → discard existing transferred cache
  if (
    transferredProjectionCache !== null &&
    (transferredProjectionCache.databaseName !== databaseName ||
      transferredProjectionCache.dataGeneration !== dataGeneration)
  ) {
    transferredProjectionCache = null;
  }

  if (transferredProjectionCache === null) {
    transferredProjectionCache = {
      databaseName,
      dataGeneration,
      recordsById: new Map(),
      sortedRecords: [],
      retainedChars: 0,
      limited: false,
    };
  }

  const cache = transferredProjectionCache;
  const newRecords: CachedProjection[] = [];

  for (const record of records) {
    if (cache.recordsById.has(record.id)) continue; // idempotent: skip duplicates
    if (cache.limited) break;
    const chars =
      (record.message?.length ?? 0) * 2 +
      (record.logger?.length ?? 0) * 2 +
      (record.thread?.length ?? 0) * 2 +
      (record.signature?.length ?? 0) +
      (record.source?.length ?? 0) +
      String(record.timestamp ?? "").length +
      Object.entries(record.mdc ?? {}).reduce(
        (sum, [key, value]) => sum + key.length + String(value ?? "").length,
        0,
      );
    if (
      cache.recordsById.size >= TRANSFER_CACHE_MAX_RECORDS ||
      cache.retainedChars + chars > TRANSFER_CACHE_MAX_CHARS
    ) {
      cache.limited = true;
      break;
    }
    const normalized = normalizeProjection(record);
    cache.recordsById.set(record.id, normalized);
    cache.retainedChars += chars;
    newRecords.push(normalized);
  }

  if (newRecords.length > 0) {
    cache.sortedRecords = mergeProjectionRecords(
      cache.sortedRecords,
      newRecords,
    );
  }
}

/** Test-only: inspect transferred projection cache state. */
export function _getTransferredProjectionCache(): {
  databaseName: string;
  dataGeneration: string | number;
  count: number;
  sortedCount: number;
} | null {
  if (!transferredProjectionCache) return null;
  return {
    databaseName: transferredProjectionCache.databaseName,
    dataGeneration: transferredProjectionCache.dataGeneration,
    count: transferredProjectionCache.recordsById.size,
    sortedCount: transferredProjectionCache.sortedRecords.length,
  };
}

/** Test-only: reset all worker-level caches. */
export function _resetWorkerCaches(): void {
  handleResetProjections();
}

export function handleResetProjections(): void {
  invalidateJobs();
  pagedFilterCache = null;
  transferredProjectionCache = null;
  messageTermCache.clear();
  messageIndexIdentity = undefined;
}

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

export function createMessageMatcher(
  expression: string,
  mode: SearchMode = "insensitive",
): (entry: Pick<FilterableEntry, "message" | "messageLower">) => boolean {
  const query = String(expression || "").trim();
  if (!query) return () => true;

  if (mode === "regex") {
    try {
      const regex = new RegExp(query, "i");
      return (entry) => regex.test(String(entry.message ?? ""));
    } catch {
      const needle = query.toLowerCase();
      return (entry) =>
        (
          entry.messageLower ?? String(entry.message ?? "").toLowerCase()
        ).includes(needle);
    }
  }

  const matches = compileMessageExpression<string>(query, (literal) => {
    const needle = mode === "sensitive" ? literal : literal.toLowerCase();
    return (message) => message.includes(needle);
  });
  return (entry) =>
    matches(
      mode === "sensitive"
        ? String(entry.message ?? "")
        : (entry.messageLower ?? String(entry.message ?? "").toLowerCase()),
    );
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
  incoming.sort(compareByTimestampId);
  return mergeSortedReferences(previous, incoming);
}

function mergeSortedReferences(
  previous: PassingReference[],
  incoming: PassingReference[],
): PassingReference[] {
  if (previous.length === 0) return incoming;
  if (incoming.length === 0) return previous;
  if (compareByTimestampId(previous[previous.length - 1]!, incoming[0]!) <= 0) {
    for (const entry of incoming) previous.push(entry);
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

function buildResponse(
  request: FilterRequest | PagedFilterRequest,
  references: ReadonlySequence<PassingReference>,
  stats: FilterStats,
  total: number,
  partial = false,
): FilterResponse {
  const filteredIndices: number[] = [];
  const searchMatchIndices: number[] = [];
  const searchMatchIds: number[] = [];
  for (const ref of references) {
    if (request.options.navigationSearch?.trim() && ref.searchMatch) {
      searchMatchIndices.push(filteredIndices.length);
      searchMatchIds.push(ref.id);
    }
    filteredIndices.push(ref.id);
  }
  return {
    type: "result",
    filteredIndices,
    searchMatchIndices,
    searchMatchIds,
    stats: { ...stats },
    progress: {
      processed: stats.total,
      total,
      matches: request.options.navigationSearch?.trim()
        ? searchMatchIds.length
        : stats.passed,
    },
    requestId: request.requestId,
    generation: request.generation,
    dataGeneration: request.dataGeneration,
    paged: request.type === "filterPaged",
    partial,
  };
}

function prepareFilter(options: FilterOptions): PreparedFilter {
  return {
    navigationSearch: String(options.navigationSearch || "").trim(),
    levelFilter: compileLevelFilter(options.filter.level),
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
      !prepared.levelFilter.has(
        entry.levelUpper ?? String(entry.level || "").toUpperCase(),
      )
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
 * It intentionally retains only passing IDs/timestamps and search flags.
 */
export function filterProjectionPages(
  pages: Iterable<readonly ProjectionRecord[]>,
  options: FilterOptions,
  markedSignatures: ReadonlySet<string> = new Set(),
): FilterResponse {
  const stats = emptyStats();
  const prepared = prepareFilter(options);
  const navigationMatcher = createMessageMatcher(
    prepared.navigationSearch,
    options.navigationSearchMode,
  );
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
          searchMatch: !!prepared.navigationSearch && navigationMatcher(entry),
        });
      }
    }
  }

  references.sort(compareByTimestampId);
  return buildResponse(
    {
      type: "filterPaged",
      options,
      entryCount: stats.total,
      requestId: 0,
      markedSignatures: [],
    },
    references,
    stats,
    stats.total,
  );
}

function readProjectionPage(
  db: IDBDatabase,
  firstId: number,
  lastId: number,
): Promise<ProjectionRecord[]> {
  return readStoreRange(db, PROJECTION_STORE_NAME, firstId, lastId);
}

function yieldWorker(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

type SearchRequest = FilterRequest | PagedFilterRequest;

interface FilterJob {
  request: SearchRequest;
  cancelled: boolean;
  total: number;
  batches?: unknown[][];
}

let cachedEntryBatches: unknown[][] = [];
let cachedEntryCount = 0;
let cachedDataGeneration: string | number | undefined;
let activeJob: FilterJob | null = null;
let queuedJob: FilterJob | null = null;
let newestRequestId = -1;

function invalidateJobs(): void {
  if (activeJob) activeJob.cancelled = true;
  queuedJob = null;
}

async function* legacyPages(
  job: FilterJob,
  skip = 0,
): AsyncGenerator<unknown[]> {
  let remaining = job.total - skip;
  for (const batch of job.batches ?? []) {
    if (skip >= batch.length) {
      skip -= batch.length;
      continue;
    }
    for (let start = skip; start < batch.length && remaining > 0;) {
      if (job.cancelled) return;
      const size = Math.min(PAGED_SCAN_SIZE, remaining, batch.length - start);
      yield batch.slice(start, start + size);
      start += size;
      remaining -= size;
    }
    skip = 0;
    if (!remaining) break;
  }
}

async function* projectionPages(
  job: FilterJob,
  start: number,
  candidatePositions?: Int32Array,
): AsyncGenerator<{ records: ProjectionRecord[]; processed: number }> {
  const request = job.request as PagedFilterRequest;
  const pageSize =
    Number.isSafeInteger(request.pageSize) && request.pageSize! > 0
      ? Math.min(request.pageSize!, PAGED_SCAN_SIZE)
      : PAGED_SCAN_SIZE;
  const transferred =
    transferredProjectionCache?.databaseName === request.databaseName &&
    transferredProjectionCache?.dataGeneration === request.dataGeneration
      ? transferredProjectionCache
      : null;
  let db: IDBDatabase | undefined;
  try {
    for (let offset = start; offset < job.total; offset += pageSize) {
      if (job.cancelled) return;
      const end = Math.min(job.total, offset + pageSize);
      if (candidatePositions) {
        let hasCandidate = false;
        for (let id = offset + 1; id <= end; id++) {
          if (candidatePositions[id]! >= 0) {
            hasCandidate = true;
            break;
          }
        }
        if (!hasCandidate) {
          yield { records: [], processed: end };
          continue;
        }
      }
      let records: ProjectionRecord[] = [];
      if (transferred) {
        for (let id = offset + 1; id <= end; id++) {
          const record = transferred.recordsById.get(id);
          if (!record) break;
          records.push(record);
        }
      }
      if (records.length !== end - offset) {
        db ??= await openPagedDatabase(undefined, request.databaseName);
        if (job.cancelled) return;
        records = await readProjectionPage(db, offset + 1, end);
      }
      if (job.cancelled) return;
      yield { records, processed: end };
    }
  } finally {
    db?.close();
  }
}

async function* indexedMessagePages(
  job: FilterJob,
  start: number,
): AsyncGenerator<{
  references?: PassingReference[];
  records?: ProjectionRecord[];
  rejected: number;
  processed: number;
}> {
  const request = job.request as PagedFilterRequest;
  const identity = JSON.stringify([
    request.databaseName,
    request.dataGeneration,
  ]);
  if (identity !== messageIndexIdentity) {
    messageTermCache.clear();
    messageIndexIdentity = identity;
  }
  const query = new MessagePageQuery(request.options.filter.message);
  const db = await openPagedDatabase(undefined, request.databaseName);
  try {
    // Older/unindexed databases and intentionally omitted oversized pages retain
    // the authoritative scan. Actual storage/decoding failures still propagate.
    const hasIndex = db.objectStoreNames.contains(MESSAGE_SEARCH_STORE_NAME);
    const batchSize = MESSAGE_SEARCH_PAGE_SIZE * 4;
    for (
      let first = messageSearchPageId(start + 1);
      first <= job.total;
      first += batchSize
    ) {
      if (job.cancelled) return;
      const last = Math.min(job.total, first + batchSize - 1);
      const pages = hasIndex
        ? await readStoreRange<MessageSearchPage>(
            db,
            MESSAGE_SEARCH_STORE_NAME,
            first,
            last,
          )
        : [];
      const byId = new Map(pages.map((page) => [page.id, page]));
      for (
        let pageId = first;
        pageId <= last;
        pageId += MESSAGE_SEARCH_PAGE_SIZE
      ) {
        if (job.cancelled) return;
        const from = Math.max(start + 1, pageId);
        const end = Math.min(job.total, pageId + MESSAGE_SEARCH_PAGE_SIZE - 1);
        const page = byId.get(pageId);
        if (page) validateMessageSearchPage(page);
        if (!page || page.omitted) {
          const records = await readProjectionPage(db, from, end);
          if (job.cancelled) return;
          yield { records, rejected: 0, processed: end };
          continue;
        }
        const matches = await query.match(page, messageTermCache);
        if (job.cancelled) return;
        const references: PassingReference[] = [];
        let rejected = 0;
        for (let index = 0; index < page.ids.length; index++) {
          const id = page.ids[index]!;
          if (id < from || id > end) continue;
          if (matches[index]) {
            references.push({ id, _id: id, timestamp: page.timestamps[index] });
          } else {
            rejected++;
          }
        }
        yield { references, rejected, processed: end };
      }
    }
  } finally {
    db.close();
  }
}

function baseKey(request: SearchRequest): string {
  const {
    navigationSearch: _search,
    navigationSearchMode: _mode,
    ...base
  } = request.options;
  return JSON.stringify({
    options: base,
    generation: request.baseGeneration ?? request.generation,
    marked:
      request.type === "filterPaged" && request.options.onlyMarked
        ? [...request.markedSignatures].sort()
        : [],
  });
}

function searchKey(request: SearchRequest): string {
  return JSON.stringify([
    request.options.navigationSearch?.trim() ?? "",
    request.options.navigationSearchMode ?? "insensitive",
  ]);
}

async function runNavigationSearch(
  job: FilterJob,
  cached: PagedFilterCache,
  publish: (response: FilterResponse) => void,
  basePublished = false,
): Promise<FilterResponse | null> {
  const request = job.request;
  const search = request.options.navigationSearch?.trim() ?? "";
  if (!basePublished && request.knownBaseCount !== cached.scannedEntryCount) {
    // Cancellation can clear the renderer while the worker still owns a base.
    const baseResponse = buildResponse(
      { ...request, options: { ...request.options, navigationSearch: "" } },
      request.incrementalResults ? [] : cached.references,
      cached.stats,
      job.total,
      true,
    );
    if (request.incrementalResults) {
      baseResponse.baseDelta = {
        reset: true,
        fromLength: 0,
        entries: cached.references.map((ref) => ({
          ...ref,
          searchMatch: false,
        })),
      };
    }
    publish(baseResponse);
  }
  const matcher = createMessageMatcher(
    search,
    request.options.navigationSearchMode,
  );
  // Dense paged IDs need four bytes per dataset row, not a million Map nodes.
  if (!cached.positions) {
    const positions = cached.paged
      ? new Int32Array(cached.scannedEntryCount + 1).fill(-1)
      : new Map<number, number>();
    cached.references.forEach((ref, index) => {
      if (positions instanceof Int32Array) positions[ref.id] = index;
      else positions.set(ref.id, index);
    });
    cached.positions = positions;
  }
  const positions = cached.positions;
  let pending: number[] = [];
  let matches = 0;
  let processed = 0;
  let published = false;
  let lastPublished = 0;
  // Flags are committed only after a complete scan, so cancelled searches cannot
  // poison append reuse of the previous query.
  const flags = new Uint8Array(cached.references.length);
  const response = (partial: boolean): FilterResponse => {
    pending.sort((a, b) => a - b);
    const indices = pending;
    pending = [];
    return {
      type: "result",
      filteredIndices: [],
      reuseFilteredIndices: true,
      searchMatchesDelta: true,
      searchMatchIndices: indices,
      searchMatchIds: indices.map((index) => cached.references.at(index)!.id),
      stats: { ...cached.stats },
      progress: {
        processed,
        total: job.total,
        matches: search ? matches : cached.stats.passed,
      },
      requestId: request.requestId,
      generation: request.generation,
      dataGeneration: request.dataGeneration,
      paged: cached.paged,
      partial,
    };
  };
  const scan = (records: readonly unknown[], end: number): void => {
    for (let offset = 0; offset < records.length; offset++) {
      const entry = records[offset] as FilterableEntry | null;
      if (!entry) continue;
      const id = cached.paged ? entry.id! : (entry._id ?? processed + offset);
      const index =
        positions instanceof Int32Array ? positions[id] : positions.get(id);
      if (index === undefined || index < 0 || !matcher(entry)) continue;
      flags[index] = 1;
      pending.push(index);
      matches++;
    }
    processed = end;
    if (
      !published ||
      pending.length >= MAX_PENDING_REFERENCES ||
      performance.now() - lastPublished >= PROGRESS_INTERVAL_MS
    ) {
      publish(response(true));
      published = true;
      lastPublished = performance.now();
    }
  };
  if (cached.searchKey === searchKey(request)) {
    cached.references.forEach((ref, index) => {
      if (search && ref.searchMatch) {
        flags[index] = 1;
        pending.push(index);
        matches++;
      }
    });
  } else if (search && cached.references.length) {
    if (cached.paged) {
      for await (const page of projectionPages(
        job,
        0,
        positions instanceof Int32Array ? positions : undefined,
      )) {
        if (job.cancelled) return null;
        scan(page.records, page.processed);
        await yieldWorker();
      }
    } else {
      for await (const page of legacyPages(job)) {
        if (job.cancelled) return null;
        scan(page, processed + page.length);
        await yieldWorker();
      }
    }
  }
  if (job.cancelled) return null;
  processed = job.total;
  cached.references.forEach((ref, index) => {
    ref.searchMatch = flags[index] === 1;
  });
  cached.searchKey = searchKey(request);
  cached.matchCount = matches;
  cached.generation = request.generation;
  return response(false);
}

async function runFilter(
  job: FilterJob,
  publish: (response: FilterResponse) => void,
): Promise<FilterResponse | null> {
  const request = job.request;
  const paged = request.type === "filterPaged";
  const cached =
    pagedFilterCache !== null &&
    pagedFilterCache.paged === paged &&
    pagedFilterCache?.databaseName ===
      (paged ? request.databaseName : undefined) &&
    pagedFilterCache.baseKey === baseKey(request) &&
    pagedFilterCache?.dataGeneration === request.dataGeneration &&
    pagedFilterCache.scannedEntryCount <= job.total
      ? pagedFilterCache
      : null;
  if (cached && cached.scannedEntryCount === job.total) {
    return runNavigationSearch(job, cached, publish);
  }
  const needsSearchScan = !!cached && cached.searchKey !== searchKey(request);
  const baseRequest = needsSearchScan
    ? { ...request, options: { ...request.options, navigationSearch: "" } }
    : request;
  const stats = cached ? { ...cached.stats } : emptyStats();
  const prepared = prepareFilter(baseRequest.options);
  const navigationMatcher = createMessageMatcher(
    prepared.navigationSearch,
    request.options.navigationSearchMode,
  );
  const marked = paged ? new Set(request.markedSignatures) : undefined;
  const store = cached?.store.fork() ?? new SortedStore<PassingReference>();
  let processed = cached?.scannedEntryCount ?? 0;
  let published = false;
  let lastPublished = 0;
  let matchCount = needsSearchScan ? 0 : (cached?.matchCount ?? 0);
  let reset =
    !cached ||
    (cached.generation !== request.generation &&
      request.knownBaseCount !== cached.scannedEntryCount);
  let fromLength = reset ? 0 : store.length;
  let pending: PassingReference[] =
    reset && cached && request.incrementalResults
      ? cached.references.map((ref) => ({
          ...ref,
          searchMatch: needsSearchScan ? false : ref.searchMatch,
        }))
      : [];
  const response = (partial = false): FilterResponse => {
    if (!request.incrementalResults)
      return buildResponse(
        baseRequest,
        store.publish(),
        stats,
        job.total,
        partial,
      );
    pending.sort(compareByTimestampId);
    const result = buildResponse(baseRequest, [], stats, job.total, partial);
    result.baseDelta = { reset, fromLength, entries: pending };
    result.progress!.matches = prepared.navigationSearch
      ? matchCount
      : stats.passed;
    reset = false;
    fromLength = store.length;
    pending = [];
    return result;
  };
  const appendPage = (incoming: PassingReference[], end: number): void => {
    processed = end;
    stats.total = processed;
    incoming.sort(compareByTimestampId);
    store.appendSorted(incoming);
    if (request.incrementalResults)
      for (const ref of incoming) pending.push(ref);
    const now = performance.now();
    if (
      !published ||
      pending.length >= MAX_PENDING_REFERENCES ||
      now - lastPublished >= PROGRESS_INTERVAL_MS
    ) {
      publish(response(true));
      published = true;
      lastPublished = performance.now();
    }
  };
  const scanPage = (records: readonly unknown[], end: number): void => {
    const incoming: PassingReference[] = [];
    for (let index = 0; index < records.length; index++) {
      const entry = records[index] as FilterableEntry | null;
      if (
        !entry ||
        !entryPasses(entry, request.options, prepared, stats, marked)
      )
        continue;
      const id = paged ? entry.id! : (entry._id ?? processed + index);
      incoming.push({
        id,
        _id: id,
        timestamp: entry.timestamp,
        searchMatch: !!prepared.navigationSearch && navigationMatcher(entry),
      });
      if (incoming[incoming.length - 1]!.searchMatch) matchCount++;
    }
    appendPage(incoming, end);
  };

  const messageOnly =
    paged &&
    request.options.stdFiltersEnabled &&
    !!request.options.filter.message.trim() &&
    !prepared.levelFilter &&
    !prepared.loggerFilter &&
    !prepared.threadFilter &&
    !request.options.onlyMarked &&
    (!request.options.timeFilterEnabled ||
      (prepared.fromTs === null && prepared.toTs === null)) &&
    prepared.compiledDcFilter.length === 0 &&
    !prepared.navigationSearch;
  if (messageOnly) {
    let lastYield = performance.now();
    for await (const page of indexedMessagePages(job, processed)) {
      if (job.cancelled) return null;
      if (page.references) {
        stats.passed += page.references.length;
        stats.rejectedByMessage += page.rejected;
        appendPage(page.references, page.processed);
      } else {
        scanPage(page.records!, page.processed);
      }
      // IndexedDB/decompression already yields; cached term masks only need a
      // timer when CPU work has actually consumed a time slice.
      if (performance.now() - lastYield >= 8) {
        await yieldWorker();
        lastYield = performance.now();
      }
    }
  } else if (paged) {
    for await (const page of projectionPages(job, processed)) {
      if (job.cancelled) return null;
      scanPage(page.records, page.processed);
      await yieldWorker();
    }
  } else {
    for await (const page of legacyPages(job, processed)) {
      if (job.cancelled) return null;
      scanPage(page, processed + page.length);
      await yieldWorker();
    }
  }
  if (job.cancelled) return null;
  pagedFilterCache = {
    paged,
    baseKey: baseKey(request),
    searchKey: needsSearchScan ? null : searchKey(request),
    databaseName: paged ? request.databaseName : undefined,
    dataGeneration: request.dataGeneration,
    generation: request.generation,
    scannedEntryCount: processed,
    references: store.publish(),
    store,
    matchCount,
    stats: { ...stats },
  };
  if (needsSearchScan) {
    publish(response(true));
    return runNavigationSearch(job, pagedFilterCache, publish, true);
  }
  return response();
}

const workerScope =
  typeof self === "undefined"
    ? undefined
    : (self as unknown as {
        onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
        postMessage(message: FilterResponse | FilterErrorResponse): void;
      });

if (workerScope) {
  const startJob = (job: FilterJob): void => {
    activeJob = job;
    const request = job.request;
    void runFilter(job, (progress) => {
      if (!job.cancelled) workerScope.postMessage(progress);
    })
      .then((result) => {
        if (result && !job.cancelled) workerScope.postMessage(result);
      })
      .catch((error: unknown) => {
        if (!job.cancelled)
          workerScope.postMessage({
            type: "error",
            requestId: request.requestId,
            message: error instanceof Error ? error.message : String(error),
            generation: request.generation,
            dataGeneration: request.dataGeneration,
            paged: request.type === "filterPaged",
          });
      })
      .finally(() => {
        activeJob = null;
        const queued = queuedJob;
        queuedJob = null;
        if (queued) startJob(queued);
      });
  };

  workerScope.onmessage = (event: MessageEvent<WorkerRequest>) => {
    const data = event.data;
    if (data.type === "cancel") {
      newestRequestId = Math.max(newestRequestId, data.requestId);
      if (activeJob && (activeJob.request.requestId ?? -1) <= data.requestId) {
        activeJob.cancelled = true;
      }
      if (queuedJob && (queuedJob.request.requestId ?? -1) <= data.requestId)
        queuedJob = null;
      return;
    }
    if (data.type === "setEntries") {
      invalidateJobs();
      pagedFilterCache = null;
      cachedEntryBatches = [data.entries || []];
      cachedEntryCount = data.entries?.length ?? 0;
      cachedDataGeneration = data.dataGeneration;
      return;
    }
    if (data.type === "appendEntries") {
      const incoming = data.entries || [];
      if (
        data.dataGeneration !== undefined &&
        data.dataGeneration !== cachedDataGeneration
      ) {
        invalidateJobs();
        pagedFilterCache = null;
        cachedEntryBatches = [];
        cachedEntryCount = 0;
        cachedDataGeneration = data.dataGeneration;
      }
      if (incoming.length) cachedEntryBatches.push(incoming);
      cachedEntryCount += incoming.length;
      return;
    }
    if (data.type === "transferProjections") {
      if (
        activeJob?.request.type === "filterPaged" &&
        (activeJob.request.databaseName !== data.databaseName ||
          activeJob.request.dataGeneration !== data.dataGeneration)
      ) {
        invalidateJobs();
        pagedFilterCache = null;
      }
      handleTransferProjections(
        data.records,
        data.databaseName,
        data.dataGeneration,
      );
      return;
    }
    if (data.type === "resetProjections") {
      handleResetProjections();
      return;
    }

    if (data.requestId !== undefined) {
      if (data.requestId <= newestRequestId) return;
      newestRequestId = data.requestId;
    }
    if (data.type === "filter" && data.entries) {
      invalidateJobs();
      pagedFilterCache = null;
    }
    const job: FilterJob = {
      request: data,
      cancelled: false,
      total:
        data.type === "filterPaged"
          ? Math.max(0, Math.floor(data.entryCount))
          : (data.entries?.length ?? cachedEntryCount),
      batches:
        data.type === "filter"
          ? data.entries
            ? [data.entries]
            : cachedEntryBatches
          : undefined,
    };
    if (activeJob) {
      queuedJob = job;
      const active = activeJob.request;
      if (
        active.type !== data.type ||
        active.generation !== data.generation ||
        baseKey(active) !== baseKey(data) ||
        searchKey(active) !== searchKey(data) ||
        active.dataGeneration !== data.dataGeneration ||
        (active.type === "filterPaged" &&
          data.type === "filterPaged" &&
          active.databaseName !== data.databaseName) ||
        job.total < activeJob.total
      ) {
        activeJob.cancelled = true;
      }
    } else {
      startJob(job);
    }
  };
}
