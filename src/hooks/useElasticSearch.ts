/**
 * Hook for Elasticsearch search functionality
 */
import { useState, useMemo, useCallback } from "preact/hooks";
import logger from "../utils/logger";
import type { ElasticSearchOptions } from "../types/ipc";

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
  const appendElasticCapped = useCallback(
    (
      batch: any[],
      available: number,
      options?: { ignoreExistingForElastic?: boolean; messageFilter?: string },
    ): number => {
      // Import msgMatches dynamically to avoid circular deps
      const { msgMatches } = require("../utils/msgFilter");

      let filtered = Array.isArray(batch) ? batch : [];

      // Client-side message filtering for advanced syntax
      const msgFilter = options?.messageFilter?.trim();
      if (msgFilter && hasAdvancedSyntax(msgFilter)) {
        filtered = filtered.filter((entry) => {
          const msg = entry?.message || "";
          return msgMatches(msg, msgFilter);
        });
      }

      const take = Math.max(0, Math.min(available, filtered.length));
      if (take <= 0) return 0;
      appendEntries(filtered.slice(0, take), options);
      return take;
    },
    [appendEntries, hasAdvancedSyntax],
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
          keepAlive: "1m",
          trackTotalHits: false,
        } as any;

        logger.info("[Elastic] Search started", { hasResponse: false });
        setEsBaseline(loadMode === "replace" ? 0 : esElasticCountAll);

        let available = Math.max(
          0,
          (elasticSize || 0) - (loadMode === "replace" ? 0 : esElasticCountAll),
        );
        let carriedPit: string | null = null;
        let nextToken: Array<string | number> | null = null;
        let hasMore = false;

        // First page
        const res = await window.api.elasticSearch(opts);
        const total = Array.isArray(res?.entries) ? res.entries.length : 0;
        logger.info("[Elastic] Search finished", {
          ok: !!res?.ok,
          total,
          hasResponse: true,
        });

        if (res?.ok) {
          hasMore = !!res.hasMore;
          nextToken = (res.nextSearchAfter as any) || null;
          carriedPit = (res as any).pitSessionId || null;
          setEsHasMore(hasMore);
          setEsNextSearchAfter(nextToken);
          setEsPitSessionId(carriedPit);
          setEsTotal(
            typeof (res as any)?.total === "number"
              ? Number((res as any).total)
              : null,
          );

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
                ? { searchAfter: nextToken as any }
                : {}),
              pitSessionId: carriedPit || undefined,
            } as any;

            const r2 = await window.api.elasticSearch(moreOpts);
            if (!r2?.ok) break;

            hasMore = !!r2.hasMore;
            nextToken = (r2.nextSearchAfter as any) || null;
            carriedPit = (r2 as any).pitSessionId || carriedPit;
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
      let available = Math.max(0, (elasticSize || 0) - esElasticCountAll);

      if (available <= 0) {
        return;
      }

      const opts: ElasticSearchOptions = {
        url: elasticUrl || undefined,
        size: Math.min(elasticSize || 1000, available),
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
        ...(token && Array.isArray(token) && token.length > 0
          ? { searchAfter: token as any }
          : {}),
        pitSessionId: esPitSessionId || undefined,
      } as any;

      const messageFilter = f?.message || "";
      const res = await window.api.elasticSearch(opts);

      if (res?.ok) {
        if (Array.isArray(res.entries) && res.entries.length) {
          const used = appendElasticCapped(res.entries as any[], available, {
            messageFilter,
          });
          available = Math.max(0, available - used);
        }
        setEsHasMore(!!res.hasMore && available > 0);
        setEsNextSearchAfter((res.nextSearchAfter as any) || null);
        setEsPitSessionId(
          ((res as any)?.pitSessionId as string) || esPitSessionId || null,
        );
        if (typeof (res as any)?.total === "number") {
          setEsTotal(Number((res as any).total));
        }
        if (!res.hasMore || available <= 0) {
          setEsPitSessionId(null);
        }
      } else {
        alert("Elastic-Fehler: " + ((res as any)?.error || "Unbekannt"));
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
    esElasticCountAll,
    lastEsForm,
    appendElasticCapped,
    setBusy,
  ]);

  // Close PIT session
  const closePitSession = useCallback(async () => {
    if (esPitSessionId) {
      try {
        await window.api.elasticClosePit(esPitSessionId);
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
    closePitSession();
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
