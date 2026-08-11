import { compactEntrySignature } from "../../utils/signature";

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
  stackTrace?: string | null;
  _fullMessage?: string;
  _truncated?: boolean;
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

export function createEntrySignature(entry: PagedLogEntry): string {
  return compactEntrySignature(entry);
}

export function preparePagedRecord(
  input: PagedLogEntry,
  id: number,
): PreparedPagedRecord {
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new RangeError("Paged log entry IDs must be positive safe integers");
  }

  const entry: PreparedPagedRecord["payload"]["entry"] = {
    ...input,
    _id: id,
  };
  delete entry.id;
  delete entry.raw;

  const projection = createProjectionRecord(input, id);

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

export function createProjectionRecord(
  input: PagedLogEntry,
  id: number,
): ProjectionRecord {
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new RangeError("Paged log entry IDs must be positive safe integers");
  }
  const mark = input._mark ?? input.mark ?? null;
  return {
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
