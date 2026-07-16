/**
 * useElasticSearch Hook
 *
 * Owns Elasticsearch search state and the search / pagination flow. Extracted
 * verbatim from App.tsx so behaviour is unchanged:
 *  - handleElasticApply: run a new search (append or replace mode) and
 *    auto-page up to the elasticSize budget.
 *  - esLoadMore: load the remaining hits ("load more" button).
 *  - appendElasticCapped: append a batch capped to the remaining budget.
 *  - resetElasticSearchState / closePitQuiet: used by the clear-logs flow.
 *
 * Entry-store mutations that happen on a "replace" search (clearing entries,
 * dedupe caches and LoggingStore) stay in App via the `onReplaceReset`
 * callback, so this hook does not need to own entry-management internals.
 */
import { useState, useMemo } from "preact/hooks";
import logger from "../utils/logger";
import type { ElasticSearchOptions } from "../types/ipc";
import type { ElasticFormState } from "../types/renderer";
import {
  elasticSearch as typedElasticSearch,
  elasticClosePit as typedElasticClosePit,
  patchSettings,
} from "../utils/typedApi";
import { TimeFilter } from "../store/timeFilter";
import { executeElasticSearch } from "../utils/elasticSearchEngine";

export interface UseElasticSearchOptions {
  entries: any[];
  appendEntries: (
    entries: any[],
    options?: { ignoreExistingForElastic?: boolean },
  ) => void;
  elasticUrl: string;
  elasticSize: number;
  withBusy: (fn: () => Promise<void>) => Promise<void>;
  showAlert: (msg: string) => void;
  handleFeatureError: (msg: string) => boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
  addToHistory: (kind: "app" | "env" | "index", val: string) => void;
  closeTimeDialog: () => void;
  onReplaceReset: () => void;
}

export function useElasticSearch({
  entries,
  appendEntries,
  elasticUrl,
  elasticSize,
  withBusy,
  showAlert,
  handleFeatureError,
  t,
  addToHistory,
  closeTimeDialog,
  onReplaceReset,
}: UseElasticSearchOptions) {
  const [esHasMore, setEsHasMore] = useState<boolean>(false);
  const [esNextSearchAfter, setEsNextSearchAfter] = useState<Array<
    string | number
  > | null>(null);
  const [lastEsForm, setLastEsForm] = useState<ElasticFormState | null>(null);
  const [esTotal, setEsTotal] = useState<number | null>(null);
  // Anzahl der im aktuellen Suchvorgang ABGERUFENEN ES-Einträge (inkl. bereits
  // vorhandener/deduplizierter). Wird bei jeder neuen Suche zurückgesetzt und
  // beim Nachladen ("Weitere laden") fortgeschrieben. Dient als "geladen"-Anzeige,
  // damit deduplizierte Einträge mitzählen und keine Abweichung zu "gefunden" entsteht.
  const [esLoadedCount, setEsLoadedCount] = useState<number>(0);
  const [esPitSessionId, setEsPitSessionId] = useState<string | null>(null);
  const [esBusy, setEsBusy] = useState<boolean>(false);

  const esElasticCountAll = useMemo(() => {
    let cnt = 0;
    for (const e of entries) {
      const src = e?.source;
      if (typeof src === "string" && src.startsWith("elastic://")) cnt++;
    }
    return cnt;
  }, [entries]);

  const esLoaded = esLoadedCount;
  const esTarget = Math.max(1, Number(elasticSize || 0));
  const esPct =
    esTotal && esTotal > 0
      ? Math.min(100, Math.round((esLoaded / esTarget) * 100))
      : Math.round((esLoaded / esTarget) * 100) || 0;

  // Hilfsfunktion: Anhängen mit Kappung auf das verbleibende Budget.
  // WICHTIG: Alle ES-Einträge werden in den State geladen (kein Filtern vor dem
  // Speichern). Die Anzeige-Filterung (Filter-Worker) steuert die Sichtbarkeit.
  //
  // Der Rückgabewert ist die Anzahl der ABGERUFENEN Einträge (vor Deduplizierung).
  // Ein bereits vorhandener (deduplizierter) Eintrag gilt als erfolgreich geladen –
  // er ist ja bereits in der Ansicht. Dadurch stimmen "geladen" und "gefunden"
  // überein und es wird nicht über das Ziel (elasticSize) hinaus nachgeladen.
  function appendElasticCapped(
    batch: any[],
    available: number,
    options?: { ignoreExistingForElastic?: boolean; messageFilter?: string },
  ): number {
    const list = Array.isArray(batch) ? batch : [];
    const take = Math.max(0, Math.min(available, list.length));
    if (take <= 0) return 0;
    appendEntries(take === list.length ? list : list.slice(0, take), options);
    return take;
  }

  /** Load next page of Elasticsearch results (invoked by ElasticStatusBar "load more" button) */
  async function esLoadMore(): Promise<void> {
    if (!esHasMore || !lastEsForm) return;
    // Fortsetzung benötigt entweder einen search_after-Token (PIT) ODER eine
    // aktive Session-ID (Scroll-Dialekt liefert KEIN nextSearchAfter und wird
    // ausschließlich über die pitSessionId fortgesetzt).
    const hasToken =
      Array.isArray(esNextSearchAfter) && esNextSearchAfter.length > 0;
    if (!esPitSessionId && !hasToken) return;
    setEsBusy(true);
    try {
      // "Weitere laden" lädt den verbleibenden Rest der Treffermenge in EINEM
      // Schwung nach (so wie vor dem Refactoring). Budget großzügig – mindestens
      // 50.000 Einträge pro Klick –, damit nicht mehrfach geklickt werden muss,
      // um alle Treffer zu laden. Sicherheitsobergrenze gegen Speicherüberlauf.
      let available = Math.max(elasticSize || 0, 50000);
      let hasMore: boolean = esHasMore;
      let nextToken = esNextSearchAfter;
      let carriedPit = esPitSessionId;

      while (available > 0 && hasMore) {
        const opts: ElasticSearchOptions = {
          url: elasticUrl || undefined,
          size: Math.max(1, available),
          index: lastEsForm.index,
          sort: lastEsForm.sort,
          duration:
            lastEsForm.mode === "relative" ? lastEsForm.duration : undefined,
          from: lastEsForm.mode === "absolute" ? lastEsForm.from : undefined,
          to: lastEsForm.mode === "absolute" ? lastEsForm.to : undefined,
          application_name: lastEsForm.application_name,
          logger: lastEsForm.logger,
          level: lastEsForm.level,
          environment: lastEsForm.environment,
          message: lastEsForm.message,
          environmentCase: lastEsForm.environmentCase || "original",
          timestampField: lastEsForm.timestampField || undefined,
          allowInsecureTLS: !!lastEsForm.allowInsecureTLS,
          keepAlive: "5m",
          trackTotalHits: false,
          ...(nextToken && Array.isArray(nextToken) && nextToken.length > 0
            ? { searchAfter: nextToken as any }
            : {}),
          pitSessionId: carriedPit || undefined,
        } as any;

        const r = await typedElasticSearch(opts);
        if (!r?.ok) break;
        hasMore = !!r.hasMore;
        nextToken = (r.nextSearchAfter as any) || null;
        carriedPit = r.pitSessionId || carriedPit;
        setEsHasMore(hasMore);
        setEsNextSearchAfter(nextToken);
        setEsPitSessionId(carriedPit);

        if (Array.isArray(r.entries) && r.entries.length) {
          const used = appendElasticCapped(r.entries as any[], available, {
            messageFilter: lastEsForm.message || "",
          });
          available = Math.max(0, available - used);
          setEsLoadedCount((c) => c + used);
        }
        if (!hasMore) break;
      }
      if (!hasMore) {
        setEsPitSessionId(null);
      }
    } catch (e) {
      logger.error("[Elastic] Load more failed:", e);
      const errorMsg = e instanceof Error ? e.message : String(e);
      if (!handleFeatureError(errorMsg)) {
        showAlert(t("status.elasticError", { message: errorMsg }));
      }
    } finally {
      setEsBusy(false);
    }
  }

  // Handler for the Elasticsearch dialog "Apply/Search" action. Extracted from
  // the inline JSX to keep the render tree readable. Behaviour is unchanged.
  const handleElasticApply = async (formVals: any) => {
    try {
      closeTimeDialog();
      addToHistory("app", formVals?.application_name || "");
      addToHistory("env", formVals?.environment || "");
      addToHistory("index", formVals?.index || ""); // NEW: save index to history
      setLastEsForm(formVals);
      try {
        const envCase = (formVals?.environmentCase || "original") as
          "original" | "lower" | "upper" | "case-sensitive";
        await patchSettings({
          lastEnvironmentCase: envCase,
          // Zuletzt genutztes Zeitstempel-Feld als Default merken.
          lastTimestampField: String(formVals?.timestampField || ""),
        });
      } catch (e) {
        logger.warn("Persisting lastEnvironmentCase failed:", e as any);
      }

      // Bestimme Load-Mode gleich zu Beginn
      const loadMode = String(formVals.loadMode || "append");

      // Falls wir ersetzen: offene PIT-Session vorher schließen
      if (loadMode === "replace" && esPitSessionId) {
        try {
          await typedElasticClosePit(esPitSessionId);
        } catch (e) {
          logger.warn("elasticClosePit before new search failed:", e as any);
        }
        setEsPitSessionId(null);
      }

      // Zeitfilter-Anpassung abhängig von loadMode
      try {
        if (loadMode === "replace") {
          if (formVals.mode === "relative" && formVals.duration) {
            TimeFilter.setRelative(formVals.duration);
            TimeFilter.setEnabled(true);
          } else if (formVals.mode === "absolute") {
            const from = formVals.from || undefined;
            const to = formVals.to || undefined;
            TimeFilter.setAbsolute(from, to);
            TimeFilter.setEnabled(true);
          }
        } else {
          const state = TimeFilter.getState();
          const wasEnabled = state && state.enabled;
          if (formVals.mode === "absolute" && wasEnabled) {
            const curFrom: string | null = state.from ?? null;
            const curTo: string | null = state.to ?? null;
            const newFrom: string | null = (formVals.from || "").trim() || null;
            const newTo: string | null = (formVals.to || "").trim() || null;
            const parseMs = (s: string | null) => {
              if (!s) return NaN;
              const ms = Date.parse(s);
              return isNaN(ms) ? NaN : ms;
            };
            const minIso = (
              a: string | null,
              b: string | null,
            ): string | undefined => {
              const am = parseMs(a);
              const bm = parseMs(b);
              if (isNaN(am)) return b || undefined;
              if (isNaN(bm)) return a || undefined;
              return am <= bm ? a || undefined : b || undefined;
            };
            const maxIso = (
              a: string | null,
              b: string | null,
            ): string | undefined => {
              const am = parseMs(a);
              const bm = parseMs(b);
              if (isNaN(am)) return b || undefined;
              if (isNaN(bm)) return a || undefined;
              return am >= bm ? a || undefined : b || undefined;
            };
            const unionFrom = minIso(curFrom, newFrom);
            const unionTo = maxIso(curTo, newTo);
            TimeFilter.setAbsolute(unionFrom, unionTo);
            TimeFilter.setEnabled(true);
          }
        }
      } catch (e) {
        logger.warn("TimeFilter update (Elastic) failed:", e);
      }

      await withBusy(async () => {
        setEsBusy(true);
        setEsTotal(null);
        try {
          await executeElasticSearch(formVals, loadMode, {
            elasticUrl,
            elasticSize,
            search: typedElasticSearch,
            appendCapped: appendElasticCapped,
            onReplaceReset,
            setHasMore: setEsHasMore,
            setNextSearchAfter: setEsNextSearchAfter,
            setPitSessionId: setEsPitSessionId,
            setTotal: setEsTotal,
            resetLoaded: () => setEsLoadedCount(0),
            addLoaded: (n) => setEsLoadedCount((c) => c + n),
            onError: (msg) => {
              if (!handleFeatureError(msg)) {
                showAlert(t("status.elasticError", { message: msg }));
              }
            },
            errorUnknownText: t("status.errorUnknown"),
          });
        } finally {
          setEsBusy(false);
        }
      });
    } catch (e) {
      logger.error("[Elastic] Search failed", e);
      const errorMsg = e instanceof Error ? e.message : String(e);
      if (!handleFeatureError(errorMsg)) {
        showAlert(t("status.elasticError", { message: errorMsg }));
      }
    }
  };

  // Elastic-Suchzustand zurücksetzen (verwendet vom "Logs leeren"-Flow).
  function resetElasticSearchState(): void {
    setEsHasMore(false);
    setEsNextSearchAfter(null);
    setLastEsForm(null);
    setEsTotal(null);
    setEsLoadedCount(0);
  }

  // Offene PIT-Session best-effort schließen (verwendet vom "Logs leeren"-Flow).
  async function closePitQuiet(): Promise<void> {
    try {
      if (esPitSessionId) await typedElasticClosePit(esPitSessionId);
    } catch {}
    setEsPitSessionId(null);
  }

  return {
    // State
    esBusy,
    esHasMore,
    esNextSearchAfter,
    esTotal,
    esLoadedCount,
    esPitSessionId,
    lastEsForm,
    setLastEsForm,

    // Derived
    esElasticCountAll,
    esLoaded,
    esTarget,
    esPct,

    // Actions
    appendElasticCapped,
    esLoadMore,
    handleElasticApply,
    resetElasticSearchState,
    closePitQuiet,
  };
}
