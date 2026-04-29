/**
 * useFileWatcher – manages tail-style file watchers from the renderer.
 *
 * Wraps the `watchStart` / `watchStop` IPC API and exposes the active watcher
 * list as state. Listens to `watch:status` events to keep the UI in sync and
 * to surface rotation/error events to a caller-provided sink.
 */
import { useCallback, useEffect, useState } from "preact/hooks";
import logger from "../utils/logger";

export interface ActiveWatcher {
  id: number;
  filePath: string;
}

export interface WatchStatusPayload {
  type: "started" | "stopped" | "rotated" | "error" | "lines";
  id: number;
  filePath: string;
  lineCount?: number;
  message?: string;
}

interface ApiShape {
  watchStart?: (args: {
    filePath: string;
    emitInitial?: boolean;
    pollIntervalMs?: number;
  }) => Promise<{
    ok: boolean;
    id?: number;
    filePath?: string;
    error?: string;
  }>;
  watchStop?: (id: number) => Promise<{ ok: boolean; error?: string }>;
  watchList?: () => Promise<{
    ok: boolean;
    watchers: ActiveWatcher[];
  }>;
  onWatchStatus?: (cb: (payload: WatchStatusPayload) => void) => () => void;
}

function getApi(): ApiShape | undefined {
  const w = window as unknown as { api?: ApiShape };
  return w.api;
}

interface UseFileWatcherOptions {
  /** Called for each rotation/error event; renderer typically shows a toast. */
  onStatus?: (payload: WatchStatusPayload) => void;
}

export function useFileWatcher(options: UseFileWatcherOptions = {}) {
  const [watchers, setWatchers] = useState<ActiveWatcher[]>([]);

  const refresh = useCallback(async () => {
    try {
      const api = getApi();
      if (!api?.watchList) return;
      const r = await api.watchList();
      if (r.ok) setWatchers(r.watchers);
    } catch (e) {
      logger.warn("[useFileWatcher] list failed:", e);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const api = getApi();
    if (!api?.onWatchStatus) return;
    const off = api.onWatchStatus((payload) => {
      try {
        options.onStatus?.(payload);
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
    });
    return off;
  }, [refresh, options.onStatus]);

  const start = useCallback(
    async (
      filePath: string,
      opts: { emitInitial?: boolean; pollIntervalMs?: number } = {},
    ): Promise<{ ok: boolean; error?: string; id?: number }> => {
      try {
        const api = getApi();
        if (!api?.watchStart) {
          return { ok: false, error: "watchStart not available" };
        }
        const res = await api.watchStart({
          filePath,
          emitInitial: opts.emitInitial,
          pollIntervalMs: opts.pollIntervalMs,
        });
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
        if (!api?.watchStop) return { ok: false };
        const res = await api.watchStop(id);
        if (res.ok) await refresh();
        return res;
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
    [refresh],
  );

  return { watchers, start, stop, refresh };
}
