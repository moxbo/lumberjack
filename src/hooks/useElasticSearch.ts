/**
 * Hook for Elasticsearch search functionality
 */
import { useState, useMemo, useCallback } from "preact/hooks";
import logger from "../utils/logger";
import { nativeAlert } from "../utils/nativeDialog";
import type { ElasticSearchOptions } from "../types/ipc";
import { elasticSearch, elasticClosePit } from "../utils/typedApi";

interface UseElasticSearchOptions {
  entries: any[];
  elasticUrl: string;
  elasticSize: number;
  appendEntries: (
    entries: any[],
    options?: { ignoreExistingForElastic?: boolean },
  ) => void;
  setBusy: (busy: boolean) => void;
}

export interface TimeFormState {
  enabled: boolean;
  mode: "relative" | "absolute";
  duration: string;
  from: string;
  to: string;
  application_name: string;
  logger: string;
  level: string;
  environment: string;
  index: string;
  environmentCase: string;
}

const INITIAL_TIME_FORM: TimeFormState = {
  enabled: true,
  mode: "relative",
  duration: "15m",
  from: "",
  to: "",
  application_name: "",
  logger: "",
  level: "",
  environment: "",
  index: "",
  environmentCase: "original",
};

export function useElasticSearch({
  entries,
  elasticUrl,
  elasticSize,
  appendEntries,
  setBusy,
}: UseElasticSearchOptions) {
  const [esHasMore, setEsHasMore] = useState<boolean>(false);
  const [esNextSearchAfter, setEsNextSearchAfter] = useState<Array<
    string | number
  > | null>(null);
  const [lastEsForm, setLastEsForm] = useState<any>(null);
  const [esTotal, setEsTotal] = useState<number | null>(null);
  const [esBaseline, setEsBaseline] = useState<number>(0);
  const [esPitSessionId, setEsPitSessionId] = useState<string | null>(null);
  const [esBusy, setEsBusy] = useState<boolean>(false);

  // Time form state
  const [timeForm, setTimeForm] = useState<TimeFormState>(INITIAL_TIME_FORM);
  const [showTimeDialog, setShowTimeDialog] = useState<boolean>(false);

  // Count of elastic entries
  const esElasticCountAll = useMemo(() => {
    let cnt = 0;
    for (const e of entries) {
      const src = e?.source;
      if (typeof src === "string" && src.startsWith("elastic://")) cnt++;
    }
    return cnt;
  }, [entries]);

  // Progress calculation
  const esLoaded = Math.max(0, esElasticCountAll - esBaseline);
  const esTarget = Math.max(1, Number(elasticSize || 0));
  const esPct =
    esTotal && esTotal > 0
      ? Math.min(100, Math.round((esLoaded / esTarget) * 100))
      : Math.round((esLoaded / esTarget) * 100) || 0;

  // Check if message filter has advanced syntax
  const hasAdvancedSyntax = useCallback((filter: string): boolean => {
    const trimmed = (filter || "").trim();
    return /[&|!()]/.test(trimmed);
  }, []);

  // Append with capping
  // IMPORTANT: All ES entries are stored in state (no filtering before storing).
  // The display filter (filter worker) controls which entries are visible.
  const appendElasticCapped = useCallback(
    (
      batch: any[],
      available: number,
      options?: { ignoreExistingForElastic?: boolean; messageFilter?: string },
    ): number => {
      const entries = Array.isArray(batch) ? batch : [];

      const take = Math.max(0, Math.min(available, entries.length));
      if (take <= 0) return 0;
      appendEntries(entries.slice(0, take), options);
      return take;
    },
    [appendEntries],
  );

  // Perform search
  const performSearch = useCallback(
    async (formVals: any, loadMode: "append" | "replace" = "append") => {
      setEsBusy(true);
      setBusy(true);
      setEsTotal(null);

      try {
        const opts: ElasticSearchOptions = {
          url: elasticUrl || undefined,
          size: elasticSize || undefined,
          index: formVals.index,
          sort: formVals.sort,
          duration:
            formVals.mode === "relative" ? formVals.duration : undefined,
          from: formVals.mode === "absolute" ? formVals.from : undefined,
          to: formVals.mode === "absolute" ? formVals.to : undefined,
          application_name: formVals.application_name,
          logger: formVals.logger,
          level: formVals.level,
          environment: formVals.environment,
          message: formVals.message,
          environmentCase: formVals.environmentCase || "original",
          allowInsecureTLS: !!formVals.allowInsecureTLS,
          keepAlive: "5m",
          trackTotalHits: false,
        } as any;

        logger.info("[Elastic] Search started", { hasResponse: false });
        setEsBaseline(loadMode === "replace" ? 0 : esElasticCountAll);

        // Each new search gets the full elasticSize budget,
        // so entries are always fully loaded even if previous entries exist (possibly hidden by filters).
        let available = Math.max(0, elasticSize || 0);
        let carriedPit: string | null = null;
        let nextToken: Array<string | number> | null = null;
        let hasMore = false;

        // First page
        const res = await elasticSearch(opts);
        const total = Array.isArray(res?.entries) ? res.entries.length : 0;
        logger.info("[Elastic] Search finished", {
          ok: res?.ok,
          total,
          hasResponse: true,
        });

        if (res?.ok) {
          hasMore = !!res.hasMore;
          nextToken = res.nextSearchAfter || null;
          carriedPit = res.pitSessionId || null;
          setEsHasMore(hasMore);
          setEsNextSearchAfter(nextToken);
          setEsPitSessionId(carriedPit);
          setEsTotal(typeof res?.total === "number" ? Number(res.total) : null);

          const messageFilter = formVals.message || "";
          if (Array.isArray(res.entries) && res.entries.length) {
            const used = appendElasticCapped(res.entries as any[], available, {
              ignoreExistingForElastic: loadMode === "replace",
              messageFilter,
            });
            available = Math.max(0, available - used);
          }

          // Auto-load more pages until cap reached
          while (available > 0 && hasMore) {
            const moreOpts: ElasticSearchOptions = {
              ...opts,
              ...(nextToken && Array.isArray(nextToken) && nextToken.length > 0
                ? { searchAfter: nextToken }
                : {}),
              pitSessionId: carriedPit || undefined,
            };

            const r2 = await elasticSearch(moreOpts);
            if (!r2?.ok) break;

            hasMore = !!r2.hasMore;
            nextToken = r2.nextSearchAfter || null;
            carriedPit = r2.pitSessionId || carriedPit;
            setEsHasMore(hasMore);
            setEsNextSearchAfter(nextToken);
            setEsPitSessionId(carriedPit);

            if (Array.isArray(r2.entries) && r2.entries.length) {
              const used2 = appendElasticCapped(
                r2.entries as any[],
                available,
                {
                  messageFilter,
                },
              );
              available = Math.max(0, available - used2);
            }
            if (!hasMore) break;
          }

          if (!hasMore || available <= 0) {
            if (!hasMore) setEsPitSessionId(null);
          }

          return { ok: true };
        } else {
          return { ok: false, error: (res as any)?.error || "Unbekannt" };
        }
      } catch (e) {
        logger.error("[Elastic] Search failed", e as any);
        return { ok: false, error: (e as any)?.message || String(e) };
      } finally {
        setEsBusy(false);
        setBusy(false);
      }
    },
    [elasticUrl, elasticSize, esElasticCountAll, appendElasticCapped, setBusy],
  );

  // Load more results
  const loadMore = useCallback(async () => {
    if (esBusy) return;

    const token = esNextSearchAfter;
    if (
      !esPitSessionId &&
      (!token || !Array.isArray(token) || token.length === 0)
    )
      return;

    setEsBusy(true);
    setBusy(true);

    try {
      const f = lastEsForm || {};
      const mode = (f?.mode || "relative") as "relative" | "absolute";
      const batchSize = elasticSize || 10000;
      const maxPerClick = Math.max(batchSize, 50000);

      const baseOpts: ElasticSearchOptions = {
        url: elasticUrl || undefined,
        size: batchSize,
        index: f?.index || undefined,
        sort: f?.sort || undefined,
        duration: mode === "relative" ? (f?.duration as any) : undefined,
        from: mode === "absolute" ? (f?.from as any) : undefined,
        to: mode === "absolute" ? (f?.to as any) : undefined,
        application_name: f?.application_name,
        logger: f?.logger,
        level: f?.level,
        environment: f?.environment,
        message: f?.message,
        environmentCase: f?.environmentCase || "original",
        allowInsecureTLS: !!f?.allowInsecureTLS,
        keepAlive: "5m",
      } as any;

      const messageFilter = f?.message || "";
      let curToken = token;
      let curPit = esPitSessionId;
      let hasMore = true;
      let totalLoaded = 0;

      while (hasMore && totalLoaded < maxPerClick) {
        const opts: ElasticSearchOptions = {
          ...baseOpts,
          ...(curToken && Array.isArray(curToken) && curToken.length > 0
            ? { searchAfter: curToken }
            : {}),
          pitSessionId: curPit || undefined,
        };

        const res = await elasticSearch(opts);
        if (!res?.ok) {
          // Fehler (z.B. Scroll abgelaufen) – Session aufräumen
          setEsPitSessionId(null);
          setEsHasMore(false);
          nativeAlert(
            "Elastic-Fehler: " +
              (res?.error || "Unbekannt") +
              "\nBitte Suche erneut starten.",
          );
          return;
        }

        if (Array.isArray(res.entries) && res.entries.length) {
          const used = appendElasticCapped(
            res.entries as any[],
            res.entries.length,
            {
              messageFilter,
            },
          );
          totalLoaded += used;
        }

        hasMore = !!res.hasMore;
        curToken = (res.nextSearchAfter as any) || null;
        curPit = ((res as any)?.pitSessionId as string) || curPit;

        setEsHasMore(hasMore);
        setEsNextSearchAfter(curToken);
        setEsPitSessionId(curPit);
        if (typeof (res as any)?.total === "number") {
          setEsTotal(Number((res as any).total));
        }

        if (!hasMore) {
          setEsPitSessionId(null);
          break;
        }
      }
    } finally {
      setEsBusy(false);
      setBusy(false);
    }
  }, [
    esBusy,
    esNextSearchAfter,
    esPitSessionId,
    elasticUrl,
    elasticSize,
    lastEsForm,
    appendElasticCapped,
    setBusy,
  ]);

  // Close PIT session
  const closePitSession = useCallback(async () => {
    if (esPitSessionId) {
      try {
        await elasticClosePit(esPitSessionId);
      } catch {}
      setEsPitSessionId(null);
    }
  }, [esPitSessionId]);

  // Reset elastic state
  const resetElasticState = useCallback(() => {
    setEsHasMore(false);
    setEsNextSearchAfter(null);
    setLastEsForm(null);
    setEsTotal(null);
    setEsBaseline(0);
    void closePitSession();
  }, [closePitSession]);

  return {
    // State
    esHasMore,
    esNextSearchAfter,
    lastEsForm,
    setLastEsForm,
    esTotal,
    esBaseline,
    setEsBaseline,
    esPitSessionId,
    esBusy,
    esElasticCountAll,
    esLoaded,
    esTarget,
    esPct,

    // Time form
    timeForm,
    setTimeForm,
    showTimeDialog,
    setShowTimeDialog,

    // Actions
    performSearch,
    loadMore,
    closePitSession,
    resetElasticState,
    appendElasticCapped,
    hasAdvancedSyntax,
  };
}
