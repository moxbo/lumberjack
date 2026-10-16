import { IndexedDbUnavailableError } from "./errors";
import type { StorageEstimateResult } from "./types";

export const PAGED_DB_NAME = "LumberjackPagedLogs";
export const PAGED_DB_VERSION = 2;
export const PAYLOAD_STORE_NAME = "payloads";
export const PROJECTION_STORE_NAME = "projections";
export const PROJECTION_SOURCE_SIGNATURE_INDEX = "by-source-signature";

export function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

export function openPagedDatabase(
  factory?: IDBFactory,
  databaseName = PAGED_DB_NAME,
): Promise<IDBDatabase> {
  const selectedFactory =
    factory ?? (isIndexedDbAvailable() ? indexedDB : undefined);
  if (!selectedFactory) {
    return Promise.reject(new IndexedDbUnavailableError());
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    const succeed = (db: IDBDatabase): void => {
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      resolve(db);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    let request: IDBOpenDBRequest;
    try {
      request = selectedFactory.open(databaseName, PAGED_DB_VERSION);
    } catch (error) {
      fail(
        new IndexedDbUnavailableError("Unable to open IndexedDB", {
          cause: error,
        }),
      );
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PAYLOAD_STORE_NAME)) {
        db.createObjectStore(PAYLOAD_STORE_NAME, { keyPath: "id" });
      }
      const projections = db.objectStoreNames.contains(PROJECTION_STORE_NAME)
        ? request.transaction!.objectStore(PROJECTION_STORE_NAME)
        : db.createObjectStore(PROJECTION_STORE_NAME, { keyPath: "id" });
      if (!projections.indexNames.contains(PROJECTION_SOURCE_SIGNATURE_INDEX)) {
        projections.createIndex(
          PROJECTION_SOURCE_SIGNATURE_INDEX,
          ["source", "signature"],
          { unique: false },
        );
      }
    };
    request.onerror = () =>
      fail(
        new IndexedDbUnavailableError("Unable to open IndexedDB", {
          cause: request.error,
        }),
      );
    request.onblocked = () =>
      fail(
        new IndexedDbUnavailableError(
          "IndexedDB schema upgrade is blocked by another connection",
        ),
      );
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      succeed(db);
    };
  });
}

export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    if (typeof navigator === "undefined") return null;
    if (typeof navigator.storage?.persist !== "function") return null;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function getStorageEstimate(): Promise<StorageEstimateResult> {
  let persisted: boolean | null = null;
  let usage: number | null = null;
  let quota: number | null = null;
  if (typeof navigator === "undefined") {
    return { persisted, usage, quota };
  }
  try {
    if (typeof navigator.storage?.persisted === "function") {
      persisted = await navigator.storage.persisted();
    }
  } catch {
    persisted = null;
  }
  try {
    if (typeof navigator.storage?.estimate === "function") {
      const result = await navigator.storage.estimate();
      usage = result.usage ?? null;
      quota = result.quota ?? null;
    }
  } catch {
    usage = null;
    quota = null;
  }
  return { persisted, usage, quota };
}
