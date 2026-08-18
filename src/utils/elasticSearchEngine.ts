/**
 * elasticSearchEngine
 *
 * Pure, dependency-injected Elasticsearch paging engine extracted verbatim
 * from the `useElasticSearch` hook. Keeping it free of preact state makes the
 * budgeting / auto-paging / PIT logic unit-testable in a plain Node context
 * (see scripts/test-elastic-search-flow.ts).
 */
import type { ElasticSearchOptions } from "../types/ipc";
import logger from "./logger";

export interface ElasticSearchResponse {
  ok?: boolean;
  entries?: any[];
  hasMore?: boolean;
  nextSearchAfter?: Array<string | number> | null;
  pitSessionId?: string | null;
  total?: number;
  error?: string;
}

export class ElasticPaginationStalledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ElasticPaginationStalledError";
  }
}

export function assertElasticPaginationProgress(
  previousToken: Array<string | number> | null,
  response: ElasticSearchResponse,
): void {
  if (!response.hasMore) return;
  const entries = Array.isArray(response.entries) ? response.entries : [];
  if (entries.length === 0) {
    throw new ElasticPaginationStalledError(
      "Elasticsearch meldet weitere Treffer, liefert aber keine Einträge.",
    );
  }

  const nextToken = Array.isArray(response.nextSearchAfter)
    ? response.nextSearchAfter
    : null;
  if (
    previousToken &&
    nextToken &&
    JSON.stringify(previousToken) === JSON.stringify(nextToken)
  ) {
    throw new ElasticPaginationStalledError(
      "Elasticsearch hat denselben Pagination-Cursor erneut geliefert.",
    );
  }
}

export interface ExecuteElasticSearchDeps {
  elasticUrl: string;
  elasticSize: number;
  /** Perform a single Elasticsearch request. */
  search: (opts: ElasticSearchOptions) => Promise<ElasticSearchResponse>;
  /**
   * Append a batch capped to the remaining budget. Returns the number of
   * fetched entries (counts deduplicated ones as loaded).
   */
  appendCapped: (
    batch: any[],
    available: number,
    options?: { ignoreExistingForElastic?: boolean; messageFilter?: string },
  ) => Promise<number>;
  /** Reset entry store on a "replace" search (clear entries, caches, LoggingStore). */
  onReplaceReset: () => void;
  setHasMore: (v: boolean) => void;
  setNextSearchAfter: (v: Array<string | number> | null) => void;
  setPitSessionId: (v: string | null) => void;
  setTotal: (v: number | null) => void;
  /** Reset the per-search "loaded" counter to 0. */
  resetLoaded: () => void;
  /** Add to the per-search "loaded" counter. */
  addLoaded: (n: number) => void;
  /** Report a search error (already-feature-error-filtered by the caller). */
  onError: (message: string) => void;
  /** Localised "unknown error" text used when the response carries no error. */
  errorUnknownText: string;
}

/**
 * Runs a new Elasticsearch search: fetches the first page, optionally resets
 * the entry store (replace mode) and auto-pages until the `elasticSize` budget
 * is exhausted or there are no further results. Behaviour is identical to the
 * former inline handler in App.tsx.
 */
export async function executeElasticSearch(
  formVals: any,
  loadMode: string,
  deps: ExecuteElasticSearchDeps,
): Promise<void> {
  const {
    elasticUrl,
    elasticSize,
    search,
    appendCapped,
    onReplaceReset,
    setHasMore,
    setNextSearchAfter,
    setPitSessionId,
    setTotal,
    resetLoaded,
    addLoaded,
    onError,
    errorUnknownText,
  } = deps;

  const opts: ElasticSearchOptions = {
    url: elasticUrl || undefined,
    size: elasticSize || undefined,
    index: formVals.index,
    sort: formVals.sort,
    duration: formVals.mode === "relative" ? formVals.duration : undefined,
    from: formVals.mode === "absolute" ? formVals.from : undefined,
    to: formVals.mode === "absolute" ? formVals.to : undefined,
    application_name: formVals.application_name,
    logger: formVals.logger,
    level: formVals.level,
    environment: formVals.environment,
    message: formVals.message,
    environmentCase: formVals.environmentCase || "original",
    allowInsecureTLS: !!formVals.allowInsecureTLS,
    // optionale PIT-Optimierungen
    keepAlive: "5m",
    // Beim ersten Request die echte Gesamtzahl ermitteln, damit
    // die UI die tatsächlich vorhandenen Treffer (z. B. 15766)
    // anzeigt – nicht nur die geladene Menge. Folgeseiten setzen
    // das aus Performancegründen wieder auf false.
    trackTotalHits: true,
  } as any;
  logger.info("[Elastic] Search started", {
    hasResponse: false,
  });
  // Geladen-Zähler für diesen Suchvorgang zurücksetzen.
  resetLoaded();
  // Jede neue Suche bekommt immer die vollen elasticSize Slots,
  // damit Einträge auch bei aktivem Filter vollständig geladen werden.
  // Mehr als elasticSize wird bei Bedarf über den
  // "Nachladen"-Button (esLoadMore) geladen.
  let available = Math.max(0, elasticSize || 0);
  let carriedPit: string | null;
  let nextToken: Array<string | number> | null;
  let hasMore: boolean;

  // Erste Seite holen
  const res = await search(opts);
  const total = Array.isArray(res?.entries) ? res.entries.length : 0;
  logger.info("[Elastic] Search finished", {
    ok: res?.ok,
    total,
    hasResponse: true,
  });
  if (res?.ok) {
    hasMore = !!res.hasMore;
    nextToken = (res.nextSearchAfter as any) || null;
    carriedPit = res.pitSessionId || null;
    setHasMore(hasMore);
    setNextSearchAfter(nextToken);
    setPitSessionId(carriedPit);
    setTotal(typeof res?.total === "number" ? Number(res.total) : null);

    if (loadMode === "replace") {
      // Vollständiges Zurücksetzen: alle vorhandenen Einträge entfernen,
      // Dedupe-Caches und LoggingStore leeren (App-seitig, damit dieser
      // Hook keine Entry-Management-Interna besitzen muss).
      onReplaceReset();
    }

    // Anhängen mit Kappung
    const messageFilter = formVals.message || "";
    if (Array.isArray(res.entries) && res.entries.length) {
      const used = await appendCapped(res.entries as any[], available, {
        ignoreExistingForElastic: loadMode === "replace",
        messageFilter,
      });
      available = Math.max(0, available - used);
      addLoaded(used);
    }

    // Auto-Nachladen bis Cap erreicht oder keine weiteren Seiten
    while (available > 0 && hasMore) {
      const moreOpts: ElasticSearchOptions = {
        ...opts,
        // Seite auf verbleibendes Budget begrenzen, damit nach
        // Dedup-bedingtem Nachladen kein großes Overshoot entsteht.
        size: Math.max(1, available),
        // Gesamtzahl nur einmal (erster Request) ermitteln.
        trackTotalHits: false,
        // Für PIT: nextSearchAfter übergeben; für Scroll bleibt es undefiniert
        ...(nextToken && Array.isArray(nextToken) && nextToken.length > 0
          ? { searchAfter: nextToken as any }
          : {}),
        pitSessionId: carriedPit || undefined,
      } as any;
      const r2 = await search(moreOpts);
      if (!r2?.ok) {
        throw new Error(r2?.error || errorUnknownText);
      }
      assertElasticPaginationProgress(nextToken, r2);
      hasMore = !!r2.hasMore;
      nextToken = (r2.nextSearchAfter as any) || null;
      carriedPit = r2.pitSessionId || carriedPit;
      setHasMore(hasMore);
      setNextSearchAfter(nextToken);
      setPitSessionId(carriedPit);
      if (Array.isArray(r2.entries) && r2.entries.length) {
        const used2 = await appendCapped(r2.entries as any[], available, {
          messageFilter,
        });
        available = Math.max(0, available - used2);
        addLoaded(used2);
      }
      if (!hasMore) break;
    }

    // Session nur beenden, wenn wirklich keine weiteren Ergebnisse mehr verfügbar
    if (!hasMore) {
      setPitSessionId(null);
    }
    // esHasMore bleibt true, wenn noch Ergebnisse existieren (auch bei Cap erreicht)
  } else {
    // Check if this is a feature-disabled error
    const errorMsg = res?.error || errorUnknownText;
    onError(errorMsg);
  }
}
