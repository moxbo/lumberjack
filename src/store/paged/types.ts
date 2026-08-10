export type PagedTimestamp = string | number | Date | null;

export interface PagedLogEntry {
  id?: number;
  _id?: number;
  timestamp: PagedTimestamp;
  level?: string | null;
  logger?: string | null;
  thread?: string | null;
  message: string;
  source: string;
  mdc?: Record<string, unknown> | null;
  service?: string | null;
  traceId?: string | null;
  signature?: string;
  mark?: string | null;
  _mark?: string | null;
  raw?: unknown;
  [key: string]: unknown;
}

export interface CanonicalLogEntry extends Omit<PagedLogEntry, "id" | "raw"> {
  _id: number;
}

export interface PayloadRecord {
  id: number;
  entry: Partial<CanonicalLogEntry> & Pick<CanonicalLogEntry, "_id">;
}

export interface ProjectionRecord {
  id: number;
  timestamp: PagedTimestamp;
  level: string | null;
  logger: string | null;
  thread: string | null;
  message: string;
  source: string;
  mdc: Record<string, unknown> | null;
  service: string | null;
  traceId: string | null;
  signature: string;
  _mark: string | null;
}

export interface PreparedPagedRecord {
  payload: PayloadRecord;
  projection: ProjectionRecord;
}

export interface ProjectionScanOptions {
  pageSize?: number;
  afterId?: number;
  direction?: "next" | "prev";
}

export interface PayloadCacheStats {
  hits: number;
  misses: number;
  loads: number;
  coalescedLoads: number;
  evictions: number;
  residentPages: number;
  residentPayloads: number;
  maxResidentPayloads: number;
  pageSize: number;
  maxPages: number;
}

export interface PagedRepositoryStatus {
  initialized: boolean;
  available: boolean;
  count: number;
  cache: PayloadCacheStats;
  storage: StorageEstimateResult;
}

export interface StorageEstimateResult {
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
}

const MAX_SIGNATURE_MESSAGE_LENGTH = 10 * 1024;

export function createEntrySignature(entry: PagedLogEntry): string {
  const timestamp = entry.timestamp == null ? "" : String(entry.timestamp);
  const logger = entry.logger == null ? "" : String(entry.logger);
  const fullMessage = entry._fullMessage;
  let message =
    fullMessage == null ? String(entry.message ?? "") : String(fullMessage);

  if (message.length > MAX_SIGNATURE_MESSAGE_LENGTH) {
    message =
      message.slice(0, MAX_SIGNATURE_MESSAGE_LENGTH) +
      `[len:${message.length}]`;
  }

  return typeof entry.source === "string" &&
    entry.source.startsWith("elastic://")
    ? `${timestamp}|${logger}|${message}|${entry.source}`
    : `${timestamp}|${logger}|${message}`;
}

export function preparePagedRecord(
  input: PagedLogEntry,
  id: number,
): PreparedPagedRecord {
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new RangeError("Paged log entry IDs must be positive safe integers");
  }

  const entry = { ...input } as Record<string, unknown>;
  delete entry.id;
  delete entry.raw;
  entry._id = id;

  const mark = input._mark ?? input.mark ?? null;
  const projection: ProjectionRecord = {
    id,
    timestamp: input.timestamp ?? null,
    level: input.level ?? null,
    logger: input.logger ?? null,
    thread: input.thread ?? null,
    message: input.message ?? "",
    source: input.source ?? "",
    mdc: input.mdc ?? null,
    service: input.service ?? null,
    traceId: input.traceId ?? null,
    signature:
      typeof input.signature === "string"
        ? input.signature
        : createEntrySignature(input),
    _mark: mark,
  };

  for (const key of [
    "timestamp",
    "level",
    "logger",
    "thread",
    "message",
    "source",
    "mdc",
    "service",
    "traceId",
    "signature",
    "mark",
    "_mark",
  ]) {
    delete entry[key];
  }

  return {
    payload: { id, entry },
    projection,
  };
}

export function hydratePagedRecord(
  payload: PayloadRecord["entry"],
  projection: ProjectionRecord,
): CanonicalLogEntry {
  return {
    ...payload,
    _id: projection.id,
    timestamp: projection.timestamp,
    level: projection.level,
    logger: projection.logger,
    thread: projection.thread,
    message: projection.message,
    source: projection.source,
    mdc: projection.mdc,
    service: projection.service,
    traceId: projection.traceId,
    signature: projection.signature,
    _mark: projection._mark,
  } as CanonicalLogEntry;
}
