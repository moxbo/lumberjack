import { PagedLogRepository } from "./PagedLogRepository";
import { PAGED_DB_NAME } from "./indexedDb";

const sessionId =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const sessionCreatedAt = Date.now();

export const PAGED_SESSION_DATABASE_NAME = `${PAGED_DB_NAME}-${sessionId}-c${sessionCreatedAt}`;
const ACTIVE_SESSIONS_KEY = "lumberjack.paged.activeSessions";
const REGISTRY_LOCK_NAME = "lumberjack.paged.sessions.lock";
const STALE_SESSION_MS = 60_000;
const HEARTBEAT_MS = 10_000;

export const pagedLogRepository = new PagedLogRepository({
  pageSize: 256,
  maxCachedPages: 32,
  databaseName: PAGED_SESSION_DATABASE_NAME,
});

function readRegistry(): Record<string, number> {
  const raw = localStorage.getItem(ACTIVE_SESSIONS_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const result: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        typeof k === "string" &&
        typeof v === "number" &&
        Number.isFinite(v)
      ) {
        result[k] = v;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function writeRegistry(sessions: Record<string, number>): void {
  localStorage.setItem(ACTIVE_SESSIONS_KEY, JSON.stringify(sessions));
}

async function withRegistryLock<T>(fn: () => T | Promise<T>): Promise<T> {
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.locks?.request === "function"
  ) {
    return navigator.locks.request(
      REGISTRY_LOCK_NAME,
      { mode: "exclusive" },
      () => fn(),
    );
  }
  return fn();
}

async function updateSessionRegistry(
  update: (sessions: Record<string, number>) => void,
): Promise<Record<string, number>> {
  return withRegistryLock(() => {
    const sessions = readRegistry();
    update(sessions);
    writeRegistry(sessions);
    return sessions;
  });
}

async function heartbeat(): Promise<Record<string, number>> {
  return updateSessionRegistry((sessions) => {
    sessions[PAGED_SESSION_DATABASE_NAME] = Date.now();
  });
}

function deletePagedDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(request.error ?? new Error(`Failed to delete database ${name}`));
    request.onblocked = () =>
      reject(new Error(`Deleting database ${name} was blocked`));
  });
}

export function startPagedSessionLifecycle(
  onError: (error: unknown) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  void heartbeat()
    .then(() => {
      if (
        typeof indexedDB === "undefined" ||
        typeof indexedDB.databases !== "function"
      ) {
        return;
      }
      return indexedDB
        .databases()
        .then((databases) =>
          withRegistryLock(async () => {
            const sessions = readRegistry();
            const now = Date.now();
            let registryChanged = false;
            for (const database of databases) {
              const name = database.name;
              if (
                !name ||
                !name.startsWith(`${PAGED_DB_NAME}-`) ||
                name === PAGED_SESSION_DATABASE_NAME
              ) {
                continue;
              }
              const lastHeartbeat = sessions[name];
              if (
                lastHeartbeat === undefined ||
                now - lastHeartbeat <= STALE_SESSION_MS
              ) {
                continue;
              }
              try {
                await deletePagedDatabase(name);
                delete sessions[name];
                registryChanged = true;
              } catch (error) {
                onError(error);
              }
            }
            if (registryChanged) writeRegistry(sessions);
          }),
        )
        .catch(onError);
    })
    .catch(onError);

  const timer = window.setInterval(() => {
    void heartbeat().catch(onError);
  }, HEARTBEAT_MS);

  return () => {
    window.clearInterval(timer);
    try {
      void updateSessionRegistry((sessions) => {
        delete sessions[PAGED_SESSION_DATABASE_NAME];
      }).catch(onError);
    } catch (error) {
      onError(error);
    }
  };
}
