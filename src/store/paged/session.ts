import { PagedLogRepository } from "./PagedLogRepository";
import { PAGED_DB_NAME } from "./indexedDb";

const sessionId =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const PAGED_SESSION_DATABASE_NAME = `${PAGED_DB_NAME}-${sessionId}`;
const ACTIVE_SESSIONS_KEY = "lumberjack.paged.activeSessions";
const STALE_SESSION_MS = 60_000;
const HEARTBEAT_MS = 10_000;

export const pagedLogRepository = new PagedLogRepository({
  pageSize: 256,
  maxCachedPages: 32,
  databaseName: PAGED_SESSION_DATABASE_NAME,
});

function updateSessionRegistry(
  update: (sessions: Record<string, number>) => void,
): Record<string, number> {
  const raw = localStorage.getItem(ACTIVE_SESSIONS_KEY);
  const sessions = raw ? (JSON.parse(raw) as Record<string, number>) : {};
  update(sessions);
  localStorage.setItem(ACTIVE_SESSIONS_KEY, JSON.stringify(sessions));
  return sessions;
}

export function startPagedSessionLifecycle(
  onError: (error: unknown) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const heartbeat = (): Record<string, number> =>
    updateSessionRegistry((sessions) => {
      sessions[PAGED_SESSION_DATABASE_NAME] = Date.now();
    });

  try {
    const sessions = heartbeat();
    if (typeof indexedDB.databases === "function") {
      void indexedDB
        .databases()
        .then((databases) => {
          const now = Date.now();
          for (const database of databases) {
            const name = database.name;
            if (
              !name ||
              !name.startsWith(`${PAGED_DB_NAME}-`) ||
              name === PAGED_SESSION_DATABASE_NAME
            ) {
              continue;
            }
            const lastHeartbeat = sessions[name] ?? 0;
            if (now - lastHeartbeat > STALE_SESSION_MS) {
              indexedDB.deleteDatabase(name);
            }
          }
        })
        .catch(onError);
    }
  } catch (error) {
    onError(error);
  }

  const timer = window.setInterval(() => {
    try {
      heartbeat();
    } catch (error) {
      onError(error);
    }
  }, HEARTBEAT_MS);

  return () => {
    window.clearInterval(timer);
    try {
      updateSessionRegistry((sessions) => {
        delete sessions[PAGED_SESSION_DATABASE_NAME];
      });
    } catch (error) {
      onError(error);
    }
  };
}
