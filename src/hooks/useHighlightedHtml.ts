import { useEffect, useState } from "preact/hooks";
import {
  clearAsyncHighlightCache,
  highlightCacheKey,
  requestHighlight,
} from "../services/highlightWorkerClient";
import { escapeHtml, highlightAll } from "../utils/highlight";

const ASYNC_HIGHLIGHT_MIN_LENGTH = 2000;
const syncCache = new Map<string, string>();
const MAX_SYNC_CACHE_SIZE = 2000;

function getSyncHighlight(text: string, search: string): string {
  const key = highlightCacheKey(text, search);
  const cached = syncCache.get(key);
  if (cached !== undefined) return cached;

  const html = highlightAll(text, search);
  syncCache.set(key, html);
  if (syncCache.size >= MAX_SYNC_CACHE_SIZE) {
    const removeCount = Math.floor(MAX_SYNC_CACHE_SIZE * 0.25);
    let removed = 0;
    for (const cacheKey of syncCache.keys()) {
      syncCache.delete(cacheKey);
      removed++;
      if (removed >= removeCount) break;
    }
  }
  return html;
}

export function useHighlightedHtml(text: string, search: string): string {
  const key = highlightCacheKey(text, search);
  const useWorker =
    text.length >= ASYNC_HIGHLIGHT_MIN_LENGTH && search.trim().length > 0;
  const [resolved, setResolved] = useState<{ key: string; html: string }>(
    () => ({
      key,
      html: useWorker ? escapeHtml(text) : getSyncHighlight(text, search),
    }),
  );

  useEffect(() => {
    let current = true;
    if (!useWorker) {
      setResolved({ key, html: getSyncHighlight(text, search) });
      return () => {
        current = false;
      };
    }

    void requestHighlight(text, search).then((html) => {
      if (current) setResolved({ key, html });
    });
    return () => {
      current = false;
    };
  }, [key, search, text, useWorker]);

  if (resolved.key === key) return resolved.html;
  return useWorker ? escapeHtml(text) : getSyncHighlight(text, search);
}

export function clearHighlightCaches(): void {
  syncCache.clear();
  clearAsyncHighlightCache();
}
