/**
 * useHttpTail – manages incremental HTTP tail watchers from the renderer.
 *
 * Wraps the `httpTailStart` / `httpTailStop` IPC API. This is the HTTP
 * counterpart to `useFileWatcher`: instead of `fs.watchFile`, it polls a
 * URL with `Range: bytes=<offset>-` headers to deliver only new bytes
 * (e.g. Spring Boot Actuator's `/actuator/logfile`).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import logger from "../utils/logger";
import type {
  ActiveHttpTail,
  HttpTailStatusPayload,
  HttpTailTransferMode,
} from "../types/ipc";
export type { ActiveHttpTail, HttpTailStatusPayload } from "../types/ipc";

interface ApiShape {
  httpTailStart?: (args: {
    url: string;
    intervalMs?: number;
    emitInitial?: boolean;
    headers?: Record<string, string>;
    allowInsecureSSL?: boolean;
  }) => Promise<{
    ok: boolean;
    id?: number;
    url?: string;
    error?: string;
  }>;
  httpTailStop?: (id: number) => Promise<{ ok: boolean; error?: string }>;
  httpTailList?: () => Promise<{ ok: boolean; tails: ActiveHttpTail[] }>;
  onHttpTailStatus?: (
    cb: (payload: HttpTailStatusPayload) => void,
  ) => () => void;
}

function getApi(): ApiShape | undefined {
  const w = window as unknown as { api?: ApiShape };
  return w.api;
}

interface UseHttpTailOptions {
  onStatus?: (payload: HttpTailStatusPayload) => void;
}

export function useHttpTail(options: UseHttpTailOptions = {}) {
  const [tails, setTails] = useState<ActiveHttpTail[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const transferModesRef = useRef(new Map<number, HttpTailTransferMode>());
  // Stable ref so consumers can pass inline arrow functions without
  // tearing down the IPC subscription on every render of the parent.
  const onStatusRef = useRef(options.onStatus);
  onStatusRef.current = options.onStatus;

  const refresh = useCallback(async () => {
    try {
      const api = getApi();
      if (!api?.httpTailList) return;
      const r = await api.httpTailList();
      if (r.ok)
        setTails(
          r.tails.map((tail) => ({
            ...tail,
            transferMode:
              transferModesRef.current.get(tail.id) ?? tail.transferMode,
          })),
        );
    } catch (e) {
      logger.warn("[useHttpTail] list failed:", e);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const api = getApi();
    if (!api?.onHttpTailStatus) return;
    const off = api.onHttpTailStatus((payload) => {
      if (payload.type === "transfer-mode" && payload.transferMode) {
        const mode = payload.transferMode;
        transferModesRef.current.set(payload.id, mode);
        setTails((current) =>
          current.map((tail) =>
            tail.id === payload.id ? { ...tail, transferMode: mode } : tail,
          ),
        );
      } else if (payload.type === "stopped") {
        transferModesRef.current.delete(payload.id);
      }
      try {
        onStatusRef.current?.(payload);
      } catch {
        // ignore consumer errors
      }
      if (
        payload.type === "started" ||
        payload.type === "stopped" ||
        payload.type === "error"
      ) {
        void refresh();
      }
      if (
        payload.type === "paused" ||
        payload.type === "resumed" ||
        payload.type === "scheduled"
      ) {
        setTails((current) =>
          current.map((tail) =>
            tail.id === payload.id
              ? {
                  ...tail,
                  paused:
                    payload.type === "paused"
                      ? true
                      : payload.type === "resumed"
                        ? false
                        : tail.paused,
                  nextPollAt:
                    payload.type === "scheduled"
                      ? payload.nextPollAt || null
                      : payload.type === "paused"
                        ? null
                        : tail.nextPollAt,
                  intervalMs: payload.intervalMs || tail.intervalMs,
                }
              : tail,
          ),
        );
      }
    });
    return off;
  }, [refresh]);

  useEffect(() => {
    if (tails.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [tails.length]);

  const status = useMemo(() => {
    const pausedCount = tails.filter((tail) => tail.paused).length;
    const scheduled = tails
      .map((tail) => tail.nextPollAt)
      .filter((value): value is number => typeof value === "number");
    const nextPollAt = scheduled.length > 0 ? Math.min(...scheduled) : null;
    const pausedIntervalMs =
      tails.find((tail) => tail.paused)?.intervalMs ??
      tails[0]?.intervalMs ??
      0;
    return {
      pausedCount,
      fullResponseCount: tails.filter((tail) => tail.transferMode === "full")
        .length,
      nextPollSeconds:
        nextPollAt == null
          ? null
          : Math.max(0, Math.ceil((nextPollAt - now) / 1000)),
      pausedIntervalSeconds: Math.max(1, Math.ceil(pausedIntervalMs / 1000)),
    };
  }, [now, tails]);

  const start = useCallback(
    async (
      url: string,
      opts: {
        intervalMs?: number;
        emitInitial?: boolean;
        headers?: Record<string, string>;
        allowInsecureSSL?: boolean;
      } = {},
    ): Promise<{ ok: boolean; error?: string; id?: number }> => {
      try {
        const api = getApi();
        if (!api?.httpTailStart) {
          return { ok: false, error: "httpTailStart not available" };
        }
        const res = await api.httpTailStart({ url, ...opts });
        if (res.ok) await refresh();
        return res;
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
    [refresh],
  );

  const stop = useCallback(
    async (id: number) => {
      try {
        const api = getApi();
        if (!api?.httpTailStop) return { ok: false };
        const res = await api.httpTailStop(id);
        if (res.ok) await refresh();
        return res;
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
    [refresh],
  );

  return { tails, start, stop, refresh, ...status };
}
