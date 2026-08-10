export { PageLruCache, type PageLoader } from "./cache";
export {
  IndexedDbUnavailableError,
  PagedStorageQuotaError,
  isQuotaOrAbortError,
} from "./errors";
export {
  PAGED_DB_NAME,
  PAGED_DB_VERSION,
  PAYLOAD_STORE_NAME,
  PROJECTION_SOURCE_SIGNATURE_INDEX,
  PROJECTION_STORE_NAME,
  getStorageEstimate,
  isIndexedDbAvailable,
  openPagedDatabase,
  requestPersistentStorage,
} from "./indexedDb";
export {
  PagedLogRepository,
  type PagedLogRepositoryOptions,
} from "./PagedLogRepository";
export {
  createEntrySignature,
  hydratePagedRecord,
  preparePagedRecord,
  type CanonicalLogEntry,
  type PagedLogEntry,
  type PagedRepositoryStatus,
  type PagedTimestamp,
  type PayloadCacheStats,
  type PayloadRecord,
  type PreparedPagedRecord,
  type ProjectionRecord,
  type ProjectionScanOptions,
  type StorageEstimateResult,
} from "./types";
