import { highlightAll } from "../utils/highlight";
import type {
  HighlightBatchItem,
  HighlightBatchRequest,
  HighlightBatchResponse,
} from "../workers/highlight.worker";

type Resolver = (html: string) => void;

interface QueuedHighlight extends HighlightBatchItem {
  resolvers: Resolver[];
}

const resultCache = new Map<string, string>();
const queued = new Map<string, QueuedHighlight>();
const inFlight = new Map<number, QueuedHighlight[]>();
const MAX_CACHE_SIZE = 2000;

let worker: Worker | null = null;
let flushScheduled = false;
let requestSequence = 0;

export function highlightCacheKey(text: string, search: string): string {
  return `${text.length}:${text}${search}`;
}

function cacheResult(key: string, html: string): void {
  if (resultCache.has(key)) resultCache.delete(key);
  resultCache.set(key, html);
  if (resultCache.size > MAX_CACHE_SIZE) {
    const removeCount = Math.floor(MAX_CACHE_SIZE * 0.25);
    let removed = 0;
    for (const cacheKey of resultCache.keys()) {
      resultCache.delete(cacheKey);
      removed++;
      if (removed >= removeCount) break;
    }
  }
}

function resolveSynchronously(items: QueuedHighlight[]): void {
  for (const item of items) {
    const html = highlightAll(item.text, item.search);
    cacheResult(item.key, html);
    for (const resolve of item.resolvers) resolve(html);
  }
}

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === "undefined") return null;

  try {
    worker = new Worker(
      new URL("../workers/highlight.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (event: MessageEvent<HighlightBatchResponse>) => {
      const response = event.data;
      if (response?.type !== "highlightBatchResult") return;
      const pending = inFlight.get(response.requestId);
      if (!pending) return;
      inFlight.delete(response.requestId);

      const byKey = new Map(
        response.results.map((result) => [result.key, result.html]),
      );
      for (const item of pending) {
        const html = byKey.get(item.key);
        if (html === undefined) continue;
        cacheResult(item.key, html);
        for (const resolve of item.resolvers) resolve(html);
      }
    };
    worker.onerror = () => {
      const pending = Array.from(inFlight.values()).flat();
      inFlight.clear();
      worker?.terminate();
      worker = null;
      resolveSynchronously(pending);
    };
    return worker;
  } catch {
    worker = null;
    return null;
  }
}

function flushQueue(): void {
  flushScheduled = false;
  if (queued.size === 0) return;

  const items = Array.from(queued.values());
  queued.clear();
  const activeWorker = getWorker();
  if (!activeWorker) {
    resolveSynchronously(items);
    return;
  }

  const requestId = ++requestSequence;
  inFlight.set(requestId, items);
  const request: HighlightBatchRequest = {
    type: "highlightBatch",
    requestId,
    items: items.map(({ key, text, search }) => ({ key, text, search })),
  };
  activeWorker.postMessage(request);
}

export function requestHighlight(
  text: string,
  search: string,
): Promise<string> {
  const key = highlightCacheKey(text, search);
  const cached = resultCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);

  return new Promise((resolve) => {
    const existing = queued.get(key);
    if (existing) {
      existing.resolvers.push(resolve);
    } else {
      queued.set(key, { key, text, search, resolvers: [resolve] });
    }
    if (!flushScheduled) {
      flushScheduled = true;
      queueMicrotask(flushQueue);
    }
  });
}

export function clearAsyncHighlightCache(): void {
  resultCache.clear();
}
