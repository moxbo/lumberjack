/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
// NOTE: This file still has some `any` types that should be gradually replaced
// See extracted hooks in src/hooks/ for properly typed state management
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { useVirtualizer } from "@tanstack/react-virtual";
import { highlightAll } from "../utils/highlight";
import { msgMatches } from "../utils/msgFilter";
import logger from "../utils/logger";
import { rendererPerf } from "../utils/rendererPerf";
import { useI18n } from "../utils/i18n";
import { LoggingStore } from "../store/loggingStore";
import { canonicalDcKey, DiagnosticContextFilter } from "../store/dcFilter";
import { DragAndDropManager } from "../utils/dnd";
import { TimeFilter } from "../store/timeFilter";
import { createPortal, lazy, Suspense } from "preact/compat";
import type { ElasticSearchOptions } from "../types/ipc";
import type {
  RendererLogEntry,
  ElasticFormState,
  ContextMenuState,
  HttpPollFormState,
  ThemeMode,
  SettingsTab,
  SettingsFormState,
  TimeFormState,
  FilterStats,
} from "../types/renderer";
import { MDCListener } from "../store/mdcListener";
import { clearHighlightCache, LogRow } from "./LogRow";
import { clearTimestampCache, fmtTimestamp } from "../utils/format";
import {
  setupDebugFunctions,
  setDebugEntriesRef,
  setDebugFilteredIdxRef,
} from "../utils/debugFunctions";

// Import refactored constants
import { BASE_MARK_COLORS } from "../constants";

// Import refactored utilities
import { entrySignature } from "../utils/entryUtils";

// Import refactored hooks
import {
  useDebounce,
  useFilterState,
  useHistoryPopovers,
  useAlerts,
  useResizeHandlers,
  useEntryManagement,
  useCommands,
  useFilterWorker,
} from "../hooks";

// Import refactored components - core components loaded eagerly
import {
  AlertDialog,
  ContextMenu,
  DetailPanel,
  FilterSection,
  UpdateNotification,
} from "./components";
import { SkeletonLoader } from "./components/SkeletonLoader";
import { JSX } from "preact/jsx-runtime";

// Lazy-load dialogs that are not shown on initial render for faster startup
const HelpDialog = lazy(() =>
  import("./components/HelpDialog").then((m) => ({ default: m.HelpDialog })),
);
const TitleDialog = lazy(() =>
  import("./components/TitleDialog").then((m) => ({ default: m.TitleDialog })),
);
const SettingsModal = lazy(() =>
  import("./components/SettingsModal").then((m) => ({
    default: m.SettingsModal,
  })),
);
const HttpLoadDialog = lazy(() =>
  import("./components/HttpDialogs").then((m) => ({
    default: m.HttpLoadDialog,
  })),
);
const HttpPollDialog = lazy(() =>
  import("./components/HttpDialogs").then((m) => ({
    default: m.HttpPollDialog,
  })),
);

// Lazy-load DCFilterDialog as a component
const DCFilterDialog = lazy(() => import("./DCFilterDialog"));
const ElasticSearchDialog = lazy(() => import("./ElasticSearchDialog"));
const CommandPalette = lazy(() =>
  import("./components/CommandPalette").then((m) => ({
    default: m.CommandPalette,
  })),
);
const TraceTimeline = lazy(() =>
  import("./components/TraceTimeline").then((m) => ({
    default: m.TraceTimeline,
  })),
);

// Initialize debug functions on module load
setupDebugFunctions();

export default function App(): JSX.Element {
  // Track component initialization (only once via ref to avoid re-marking on every render)
  const initMarkedRef = useRef(false);
  if (!initMarkedRef.current) {
    initMarkedRef.current = true;
    rendererPerf.mark("app-component-init");
  }

  // i18n hook
  const { t, locale, setLocale } = useI18n();

  // Ref for t function so it can be used in useEffects without dependencies
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  // Track when initial settings are loaded for skeleton UI
  const [settingsLoaded, setSettingsLoaded] = useState<boolean>(false);

  // Persistenz: Markierungen (signature -> color)
  const [marksMap, setMarksMap] = useState<Record<string, string>>({});

  // Use alerts hook
  const { alertState, showAlert, closeAlert, handleFeatureError } = useAlerts();

  // Entry management hook (entries, IPC batching, deduplication)
  const {
    entries,
    setEntries,
    setNextId,
    appendEntries,
    fileSigCacheRef,
    httpSigCacheRef,
  } = useEntryManagement({
    marksMap,
  });

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const lastClicked = useRef<number | null>(null);

  // Follow-Modus
  const [follow, setFollow] = useState<boolean>(false);

  // Theme Mode
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  function applyThemeMode(mode: string | null | undefined): void {
    const root = document.documentElement;
    if (!mode || mode === "system") {
      root.removeAttribute("data-theme");
      return;
    }
    root.setAttribute("data-theme", mode);
  }

  // Use the refactored filter state hook
  const filterState = useFilterState();
  const {
    search,
    setSearch,
    searchMode,
    setSearchMode,
    showSearchOptions,
    setShowSearchOptions,
    filter,
    setFilter,
    stdFiltersEnabled,
    setStdFiltersEnabled,
    onlyMarked,
    setOnlyMarked,
    fltHistSearch,
    fltHistLogger,
    fltHistThread,
    fltHistMessage,
    addFilterHistory,
    filtersExpanded,
    setFiltersExpanded,
  } = filterState;

  // Debounced Filter-Werte für bessere Performance beim Tippen (200ms Verzögerung)
  const debouncedSearch = useDebounce(search, 200);
  const debouncedFilter = useDebounce(filter, 200);

  // History popovers - using extracted hook
  const {
    showSearchHist,
    setShowSearchHist,
    searchHistHighlightIdx,
    setSearchHistHighlightIdx,
    searchPos,
    searchHistRef,
    searchPopRef,
    showLoggerHist,
    setShowLoggerHist,
    loggerPos,
    loggerHistRef,
    loggerPopRef,
    showThreadHist,
    setShowThreadHist,
    threadPos,
    threadHistRef,
    threadPopRef,
    showMessageHist,
    setShowMessageHist,
    messagePos,
    messageHistRef,
    messagePopRef,
    searchInputRef,
  } = useHistoryPopovers();

  // re-render trigger for MDC filter changes
  const [dcVersion, setDcVersion] = useState<number>(0);
  useEffect(() => {
    const off = (DiagnosticContextFilter as any).onChange?.(() =>
      setDcVersion((v) => v + 1),
    );
    return () => {
      try {
        if (typeof off === "function") off();
      } catch {}
    };
  }, []);
  // re-render trigger for Time filter changes
  const [timeVersion, setTimeVersion] = useState<number>(0);
  useEffect(() => {
    const off = (TimeFilter as any).onChange?.(() =>
      setTimeVersion((v) => v + 1),
    );
    return () => {
      try {
        if (typeof off === "function") off();
      } catch {}
    };
  }, []);

  // Neuer Dialog-State für DC-Filter
  const [showDcDialog, setShowDcDialog] = useState<boolean>(false);
  // Zeit-Filter Dialog-State
  const [showTimeDialog, setShowTimeDialog] = useState<boolean>(false);
  // TraceTimeline Dialog-State
  const [showTraceTimeline, setShowTraceTimeline] = useState<boolean>(false);
  const [traceTimelineId, setTraceTimelineId] = useState<string>("");
  const [timeForm, setTimeForm] = useState<TimeFormState>({
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
  });

  // Öffnet den Elastic-Search-Dialog und befüllt Formular aus TimeFilter-State
  async function openTimeFilterDialog(): Promise<void> {
    // Helper: get last used values from in-memory history or settings as fallback
    const getLasts = async (): Promise<{
      lastApp: string;
      lastEnv: string;
      lastIndex: string;
      lastEnvCase: string | undefined;
    }> => {
      let lastApp =
        (histAppName && histAppName.length > 0 ? String(histAppName[0]) : "") ||
        "";
      let lastEnv =
        (histEnvironment && histEnvironment.length > 0
          ? String(histEnvironment[0])
          : "") || "";
      let lastIndex =
        (histIndex && histIndex.length > 0 ? String(histIndex[0]) : "") || "";
      let lastEnvCase: string | undefined;
      if (window.api?.settingsGet) {
        try {
          const res = await window.api.settingsGet();
          const r = res?.ok ? (res.settings as any) : null;
          if (!lastApp && Array.isArray(r?.histAppName) && r.histAppName.length)
            lastApp = String(r.histAppName[0] || "");
          if (
            !lastEnv &&
            Array.isArray(r?.histEnvironment) &&
            r.histEnvironment.length
          )
            lastEnv = String(r.histEnvironment[0] || "");
          if (!lastIndex && Array.isArray(r?.histIndex) && r.histIndex.length)
            lastIndex = String(r.histIndex[0] || "");
          if (r && typeof r.lastEnvironmentCase === "string")
            lastEnvCase = r.lastEnvironmentCase;
        } catch {
          // ignore
        }
      }
      return { lastApp, lastEnv, lastIndex, lastEnvCase };
    };

    try {
      const s = (TimeFilter as any).getState?.();
      const toLocal = (iso: unknown): string => {
        const t = String(iso || "").trim();
        if (!t) return "";
        const d = new Date(t);
        if (isNaN(d.getTime())) return "";
        const pad = (n: number): string => String(n).padStart(2, "0");
        const y = d.getFullYear();
        const m = pad(d.getMonth() + 1);
        const da = pad(d.getDate());
        const hh = pad(d.getHours());
        const mm = pad(d.getMinutes());
        return `${y}-${m}-${da}T${hh}:${mm}`;
      };
      const { lastApp, lastEnv, lastIndex, lastEnvCase } = await getLasts();
      // Bestimme zuletzt verwendete Werte aus der letzten Suche (falls vorhanden)
      const prev: Partial<ElasticFormState> = lastEsForm || {};
      const initIndex = String(prev.index || lastIndex || "");
      const initEnvCase = String(
        prev.environmentCase ||
          lastEnvCase ||
          timeForm.environmentCase ||
          "original",
      );
      setTimeForm({
        enabled: true,
        mode: (s && s.mode) || "relative",
        duration: (s && s.duration) || "15m",
        from: toLocal(s?.from),
        to: toLocal(s?.to),
        application_name: lastApp,
        logger: "",
        level: "",
        environment: lastEnv,
        index: initIndex,
        environmentCase: initEnvCase,
      });
    } catch {
      const { lastApp, lastEnv, lastIndex, lastEnvCase } = await getLasts();
      const prev: Partial<ElasticFormState> = lastEsForm || {};
      const initIndex = String(prev.index || lastIndex || "");
      const initEnvCase = String(
        prev.environmentCase ||
          lastEnvCase ||
          timeForm.environmentCase ||
          "original",
      );
      setTimeForm({
        enabled: true,
        mode: "relative",
        duration: "15m",
        from: "",
        to: "",
        application_name: lastApp,
        logger: "",
        level: "",
        environment: lastEnv,
        index: initIndex,
        environmentCase: initEnvCase,
      });
    }
    setShowTimeDialog(true);
  }

  // Setzt das lokale Formular zurück und schließt den Dialog
  function clearTimeFilter() {
    setTimeForm({
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
    });
    setShowTimeDialog(false);
  }

  // Filter-Historien
  // Entfernt: persistente Logger-Historie; stattdessen flüchtige Verlaufslisten
  // const [histLogger, setHistLogger] = useState<string[]>([]);
  const [histAppName, setHistAppName] = useState<string[]>([]);
  const [histEnvironment, setHistEnvironment] = useState<string[]>([]);
  // NEW: Index history
  const [histIndex, setHistIndex] = useState<string[]>([]);

  // History-Pflege für Elastic-Dialog
  function addToHistory(kind: "app" | "env" | "index", val: string): void {
    const v = String(val || "").trim();
    if (!v) return;
    if (kind === "app") {
      setHistAppName((prev) => {
        const list = [v, ...prev.filter((x) => x !== v)].slice(0, 10);
        try {
          void window.api.settingsSet({ histAppName: list });
        } catch (e) {
          logger.error("Failed to save histAppName settings:", e);
          showAlert(t("errors.histAppNameSaveFailed"));
        }
        return list;
      });
    } else if (kind === "env") {
      setHistEnvironment((prev) => {
        const list = [v, ...prev.filter((x) => x !== v)].slice(0, 10);
        try {
          void window.api.settingsSet({ histEnvironment: list });
        } catch (e) {
          logger.error("Failed to save histEnvironment settings:", e);
          showAlert(t("errors.histEnvironmentSaveFailed"));
        }
        return list;
      });
    } else if (kind === "index") {
      setHistIndex((prev) => {
        const list = [v, ...prev.filter((x) => x !== v)].slice(0, 10);
        try {
          void window.api.settingsSet({ histIndex: list });
        } catch (e) {
          logger.error("Failed to save histIndex settings:", e);
          showAlert(t("errors.histIndexSaveFailed"));
        }
        return list;
      });
    }
  }

  const [tcpStatus, setTcpStatus] = useState<string>("TCP Port geschlossen");
  const [httpStatus, setHttpStatus] = useState<string>("HTTP Polling inaktiv");
  const [httpPollId, setHttpPollId] = useState<number | null>(null);
  const [tcpPort, setTcpPort] = useState<number>(5000);
  const [canTcpControlWindow, setCanTcpControlWindow] = useState<boolean>(true);

  const [httpUrl, setHttpUrl] = useState<string>("");
  const [httpInterval, setHttpInterval] = useState<number>(5000);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("tcp");
  const [form, setForm] = useState<SettingsFormState>({
    tcpPort: 5000,
    httpUrl: "",
    httpInterval: 5000,
    logToFile: false,
    logFilePath: "",
    logMaxMB: 5,
    logMaxBackups: 3,
    themeMode: "system",
    elasticUrl: "",
    elasticSize: 1000,
    elasticUser: "",
    elasticPassNew: "",
    elasticPassClear: false,
    elasticMaxParallel: 1,
    allowPrerelease: false,
    heapSizeMB: 2048,
  });
  // Store original heap size to detect changes requiring restart
  const [originalHeapSizeMB, setOriginalHeapSizeMB] = useState<number>(2048);
  // NEU: hält das tatsächlich beim Start verwendete Poll-Intervall (für stabilen Countdown)
  const [currentPollInterval, setCurrentPollInterval] = useState<number | null>(
    null,
  );

  const [showHttpLoadDlg, setShowHttpLoadDlg] = useState<boolean>(false);
  const [httpLoadUrl, setHttpLoadUrl] = useState<string>("");
  const [showHttpPollDlg, setShowHttpPollDlg] = useState<boolean>(false);
  const [httpPollForm, setHttpPollForm] = useState<HttpPollFormState>({
    url: "",
    interval: 5000,
  });

  async function openHttpLoadDialog() {
    let url = httpUrl;
    try {
      // Load fresh settings to ensure we have current httpUrl
      if (window.api?.settingsGet) {
        const result = await window.api.settingsGet();
        if (result?.ok) {
          const r = result.settings as any;
          if (typeof r?.httpUrl === "string") {
            url = r.httpUrl;
            setHttpUrl(url);
          }
        }
      }
    } catch (e) {
      logger.warn("Failed to load settings for HTTP load dialog:", e);
    }
    setHttpLoadUrl(String(url || ""));
    setShowHttpLoadDlg(true);
  }
  async function openHttpPollDialog() {
    let url = httpUrl;
    let interval = httpInterval;
    try {
      // Load fresh settings to ensure we have current values
      if (window.api?.settingsGet) {
        const result = await window.api.settingsGet();
        if (result?.ok) {
          const r = result.settings as any;
          if (typeof r?.httpUrl === "string") {
            url = r.httpUrl;
            setHttpUrl(url);
          }
          const int = r?.httpPollInterval ?? r?.httpInterval;
          if (int != null) {
            interval = Number(int) || 5;
            setHttpInterval(interval);
          }
        }
      }
    } catch (e) {
      logger.warn("Failed to load settings for HTTP poll dialog:", e);
    }
    setHttpPollForm({
      url: String(url || ""),
      interval: Number(interval || 5),
    });
    setShowHttpPollDlg(true);
  }

  // Logging-Settings
  const [logToFile, setLogToFile] = useState<boolean>(false);
  const [logFilePath, setLogFilePath] = useState<string>("");
  const [logMaxBytes, setLogMaxBytes] = useState<number>(5 * 1024 * 1024);
  const [logMaxBackups, setLogMaxBackups] = useState<number>(3);

  // Elasticsearch
  const [elasticUrl, setElasticUrl] = useState<string>("");
  const [elasticSize, setElasticSize] = useState<number>(1000);
  const [elasticUser, setElasticUser] = useState<string>("");
  const [elasticHasPass, setElasticHasPass] = useState<boolean>(false);
  const [elasticMaxParallel, setElasticMaxParallel] = useState<number>(1);

  // Kontextmenü + Farbpalette
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState>({
    open: false,
    x: 0,
    y: 0,
  });
  const ctxRef = useRef<HTMLDivElement | null>(null);
  const [customColors, setCustomColors] = useState<string[]>([]);
  const [pickerColor, setPickerColor] = useState<string>("#ffcc00");
  const palette = useMemo(
    () => [...BASE_MARK_COLORS, ...customColors],
    [customColors],
  );
  function addCustomColor(c: string) {
    const color = String(c || "").trim();
    if (!color) return;
    setCustomColors((prev) => {
      const list = prev.includes(color) ? prev : [...prev, color];
      try {
        void window.api.settingsSet({ customMarkColors: list });
      } catch (e) {
        logger.error("Failed to save customMarkColors settings:", e);
      }
      return list;
    });
  }
  function closeContextMenu() {
    setCtxMenu({ open: false, x: 0, y: 0 });
  }
  useEffect(() => {
    if (!ctxMenu.open) return;
    const onMouseDown = (e: MouseEvent) => {
      try {
        if (!ctxRef.current) return closeContextMenu();
        if (!ctxRef.current.contains(e.target as Node)) closeContextMenu();
      } catch {
        closeContextMenu();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeContextMenu();
    };
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu.open]);
  function openContextMenu(ev: MouseEvent, idx: number) {
    try {
      ev.preventDefault();
      setSelected((prev) => {
        if (prev && prev.has(idx)) return prev;
        return new Set([idx]);
      });
      setCtxMenu({ open: true, x: ev.clientX, y: ev.clientY });
      // Stelle sicher, dass die Liste fokussiert bleibt auch nach Kontextmenü
      try {
        setTimeout(() => {
          if (
            parentRef.current &&
            !parentRef.current.contains(document.activeElement || null)
          ) {
            (parentRef.current as any)?.focus?.({ preventScroll: true });
          }
        }, 0);
      } catch (err) {
        logger.warn("Failed to restore focus after context menu:", err);
      }
    } catch (err) {
      logger.error("openContextMenu error:", err);
    }
  }

  // Markierung anwenden/entfernen + Persistenz
  function applyMarkColor(color?: string) {
    setEntries((prev) => {
      if (!prev || !prev.length) return prev;
      const next = prev.slice();
      const newMap: Record<string, string> = { ...marksMap };
      for (const i of selected) {
        if (i >= 0 && i < next.length) {
          const e = next[i];
          if (!e) continue;
          const n: RendererLogEntry = { ...e };
          if (color) {
            n._mark = color;
            newMap[entrySignature(n)] = color;
          } else {
            if (n._mark) delete newMap[entrySignature(n)];
            delete n._mark;
          }
          next[i] = n;
        }
      }
      setMarksMap(newMap);
      try {
        void window.api.settingsSet({ marksMap: newMap });
      } catch {}
      return next;
    });
    closeContextMenu();
  }
  // Synchronisiere bestehende Einträge, wenn marksMap geladen/aktualisiert wird
  useEffect(() => {
    if (!entries.length) return;
    setEntries((prev) =>
      prev.map((e) => {
        const sig = entrySignature(e);
        const c = marksMap[sig];
        if (c && e._mark !== c) return { ...e, _mark: c };
        if (!c && e._mark) {
          const n = { ...e };
          delete n._mark;
          return n;
        }
        return e;
      }),
    );
  }, [marksMap]);

  function adoptTraceIds() {
    try {
      const variants = [
        "TraceID",
        "traceId",
        "trace_id",
        "trace.id",
        "trace-id",
        "x-trace-id",
        "x_trace_id",
        "x.trace.id",
        "trace",
      ];
      const added = new Set<string>();
      for (const i of selected) {
        const e = entries[i];
        const m = e && e.mdc;
        if (!m || typeof m !== "object") continue;
        for (const k of variants) {
          if (Object.prototype.hasOwnProperty.call(m, k)) {
            const v = String(m[k] ?? "");
            if (v && !added.has(v)) {
              (DiagnosticContextFilter as any).addMdcEntry("TraceID", v);
              added.add(v);
            }
          }
        }
      }
      if (added.size) (DiagnosticContextFilter as any).setEnabled(true);
    } catch (e) {
      logger.warn("adoptTraceIds failed:", e as any);
    }
    closeContextMenu();
  }
  async function copyTsMsg(): Promise<void> {
    const list = Array.from(selected).sort((a, b) => a - b);
    const lines = list.map((i) => {
      const e: RendererLogEntry | undefined = entries[i];
      if (!e) return "";
      return `${fmtTimestamp(e.timestamp)}\n${String(e.message ?? "")}`;
    });
    const text = lines.join("\n");
    try {
      if ((navigator as any)?.clipboard?.writeText)
        await (navigator as any).clipboard.writeText(text);
      else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
    } catch (e) {
      logger.error("Failed to copy to clipboard:", e);
      showAlert(t("errors.copyFailed"));
    }
    closeContextMenu();
  }

  // Busy helper
  const [busy, setBusy] = useState<boolean>(false);
  const [esBusy, setEsBusy] = useState<boolean>(false);
  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  // HTTP polling helper state
  const [nextPollDueAt, setNextPollDueAt] = useState<number | null>(null);
  const [nextPollIn, setNextPollIn] = useState<string>("");
  useEffect(() => {
    if (!nextPollDueAt) {
      setNextPollIn("");
      return;
    }
    let t = 0 as unknown as number;
    const tick = () => {
      const ms = Math.max(0, Number(nextPollDueAt) - Date.now());
      const active = httpPollId != null && currentPollInterval != null;
      setNextPollIn(ms > 0 ? `${Math.ceil(ms / 1000)}s` : active ? "0s" : "");
    };
    tick();
    t = window.setInterval(tick, 250) as unknown as number;
    return () => clearInterval(t as unknown as number);
  }, [nextPollDueAt, httpPollId, currentPollInterval]);

  // NEU: Halte den Countdown am Laufen, selbst wenn einzelne Ticks keine Events liefern
  useEffect(() => {
    // Nur aktiv, wenn ein Poll läuft und wir das reale Intervall kennen
    const interval =
      currentPollInterval != null ? Math.max(500, currentPollInterval) : null;
    if (httpPollId == null || interval == null) {
      return;
    }
    // Beim (Re-)Start sofort DueAt setzen
    setNextPollDueAt(Date.now() + interval);

    // Danach in diesem Intervall immer wieder neu setzen
    const h = window.setInterval(() => {
      setNextPollDueAt(Date.now() + interval);
    }, interval) as unknown as number;

    return () => {
      clearInterval(h as unknown as number);
    };
  }, [httpPollId, currentPollInterval]);

  // Filter statistics for debugging why entries are filtered out
  const [lastFilterStats, setLastFilterStats] = useState<FilterStats | null>(
    null,
  );

  // Refs/Layout/Virtualizer
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [isParentMounted, setIsParentMounted] = useState(false);

  // Track when parent element is mounted - use a layout effect to set this ASAP
  useEffect(() => {
    // Small delay to ensure ref is set after first render
    const timer = setTimeout(() => {
      if (parentRef.current && !isParentMounted) {
        setIsParentMounted(true);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []); // Only run once on mount

  const layoutRef = useRef<HTMLDivElement | null>(null);

  // Use resize handlers hook for divider and column resize
  const { dividerElRef, resizeHeight, onColMouseDown } = useResizeHandlers({
    layoutRef,
  });

  // Use Filter Worker for large datasets (>10,000 entries)
  const {
    filteredIndices: workerFilteredIdx,
    stats: workerFilterStats,
    filterEntries,
  } = useFilterWorker();

  // Track if we have ever triggered filtering (to show loading state on initial large load)
  const hasTriggeredFilterRef = useRef(false);

  // Trigger filtering when dependencies change
  useEffect(() => {
    // Build DC filter entries from DiagnosticContextFilter state
    const dcState = (DiagnosticContextFilter as any).getState?.() || {
      entries: [],
      enabled: false,
    };
    const dcFilterEntries = (dcState.entries || []).map(
      (e: { key: string; value: string; active: boolean }) => ({
        key: e.key,
        value: e.value,
        active: e.active,
      }),
    );
    const dcFilterEnabled = dcState.enabled === true;

    // Build time filter state from TimeFilter
    const timeState = (TimeFilter as any).getState?.() || {};
    const timeFilterEnabled = timeState.enabled === true;
    const timeFilterFrom = timeState.from || undefined;
    const timeFilterTo = timeState.to || undefined;

    hasTriggeredFilterRef.current = true;
    filterEntries(entries, {
      stdFiltersEnabled,
      filter: {
        level: debouncedFilter.level || "",
        logger: debouncedFilter.logger || "",
        thread: debouncedFilter.thread || "",
        message: debouncedFilter.message || "",
      },
      onlyMarked,
      dcFilterEnabled,
      dcFilterEntries,
      timeFilterEnabled,
      timeFilterFrom,
      timeFilterTo,
    });
  }, [
    entries,
    stdFiltersEnabled,
    debouncedFilter,
    dcVersion,
    timeVersion,
    onlyMarked,
    searchMode,
    filterEntries,
  ]);

  // Use worker results for filtered indices
  const filteredIdx = workerFilteredIdx;

  // Update filter stats from worker
  useEffect(() => {
    if (workerFilterStats) {
      setLastFilterStats(workerFilterStats);
      // Also expose via debug API
      (window as any).ljDebug.filterStats = workerFilterStats;

      // Reduced logging: only log filter stats when count changes significantly or all entries are filtered
      if (
        process.env.NODE_ENV === "development" &&
        (workerFilterStats.total % 5000 === 0 ||
          (workerFilterStats.passed === 0 && workerFilterStats.total > 0))
      ) {
        // eslint-disable-next-line no-console
        console.log("[filter-diag] Filter stats:", workerFilterStats);
        if (workerFilterStats.passed === 0 && workerFilterStats.total > 0) {
          console.warn("[filter-diag] WARNING: All entries filtered out!", {
            total: workerFilterStats.total,
            onlyMarked,
            stdFiltersEnabled,
            debouncedFilter,
            dcFilterEnabled: (DiagnosticContextFilter as any).isEnabled?.(),
          });
        }
      }
    }
  }, [workerFilterStats, onlyMarked, stdFiltersEnabled, debouncedFilter]);

  // Refs to track current values for menu handlers (avoid stale closures)
  const filteredIdxRef = useRef<number[]>(filteredIdx);
  const entriesRef = useRef<any[]>(entries);
  useEffect(() => {
    filteredIdxRef.current = filteredIdx;
    // Update debug reference
    setDebugFilteredIdxRef(filteredIdxRef);
  }, [filteredIdx]);
  useEffect(() => {
    entriesRef.current = entries;
    // Update debug reference
    setDebugEntriesRef(entriesRef);
  }, [entries]);

  const countTotal = entries.length;
  const countFiltered = filteredIdx.length;
  const countSelected = selected.size;

  const rowHeight = 36;

  // Ref, um programmatisches Scrollen von manuellem Scrollen zu unterscheiden
  const isProgrammaticScrollRef = useRef(false);

  // Handler für manuelles Scrollen: deaktiviert Follow-Modus wenn der Benutzer nach oben scrollt
  const handleListScroll = useCallback(
    (e: Event) => {
      // Ignoriere programmatisches Scrollen
      if (isProgrammaticScrollRef.current) {
        return;
      }

      // Nur reagieren, wenn Follow-Modus aktiv ist
      if (!follow) return;

      const target = e.target as HTMLElement;
      if (!target) return;

      // Berechne, ob wir am Ende der Liste sind (mit Toleranz)
      const scrollTop = target.scrollTop;
      const scrollHeight = target.scrollHeight;
      const clientHeight = target.clientHeight;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

      // Wenn der Benutzer mehr als 100px vom Ende entfernt ist, deaktiviere Follow-Modus
      if (distanceFromBottom > 100) {
        setFollow(false);
        try {
          void window.api.settingsSet({ follow: false });
        } catch (err) {
          logger.warn("Persisting follow flag failed:", err);
        }
      }
    },
    [follow],
  );

  // TEMPORARY: Disable virtualizer to test if it's causing the render loop
  // Memoize getScrollElement callback to prevent virtualizer from re-initializing
  const getScrollElement = useCallback(() => parentRef.current, []);

  // Memoize estimateSize to prevent re-initialization
  const estimateSize = useCallback(() => rowHeight, []);

  // Memoize getItemKey to prevent re-initialization
  const getItemKey = useCallback(
    (index: number) => {
      const globalIdx = filteredIdx[index];
      return globalIdx !== undefined ? `row-${globalIdx}` : `row-temp-${index}`;
    },
    [filteredIdx],
  );

  // Only create virtualizer if we have a scroll element to prevent initialization issues
  const hasScrollElement = parentRef.current !== null;

  const virtualizer = useVirtualizer({
    count: hasScrollElement ? filteredIdx.length : 0,
    getScrollElement,
    estimateSize,
    // Erhöhe overscan für glatteres Scrollen bei schnellem Scrollen
    overscan: 15,
    // getItemKey für stabile Keys und besseres Re-Rendering
    getItemKey,
    // CRITICAL: Disable automatic measurement which can cause render loops
    measureElement: undefined,
  } as any);

  // Get virtual items - memoized to prevent render loops
  // Note: virtualItems changes when scroll position changes, which is expected
  const virtualItems = hasScrollElement ? virtualizer.getVirtualItems() : [];
  const totalHeight = hasScrollElement ? virtualizer.getTotalSize() : 0;

  // Bei Filteränderung: ausgewählten Eintrag sichtbar halten, wenn er noch in der Liste ist
  const prevFilteredIdxRef = useRef<number[]>(filteredIdx);
  const selectedRef = useRef<Set<number>>(selected);
  // Track previous filter criteria to distinguish filter changes from new entries
  const prevFilterCriteriaRef = useRef({
    stdFiltersEnabled,
    debouncedFilter,
    dcVersion,
    timeVersion,
    onlyMarked,
    searchMode,
  });

  // Halte selectedRef aktuell
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  // Zustand für erzwungenes Re-Render nach Filter-Scroll
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    // Prüfe ob sich die gefilterte Liste geändert hat
    if (prevFilteredIdxRef.current === filteredIdx) return;

    // Prüfe ob sich die Filter-Kriterien geändert haben (nicht nur neue Einträge)
    const prevCriteria = prevFilterCriteriaRef.current;
    const filterCriteriaChanged =
      prevCriteria.stdFiltersEnabled !== stdFiltersEnabled ||
      prevCriteria.debouncedFilter !== debouncedFilter ||
      prevCriteria.dcVersion !== dcVersion ||
      prevCriteria.timeVersion !== timeVersion ||
      prevCriteria.onlyMarked !== onlyMarked ||
      prevCriteria.searchMode !== searchMode;

    // Update refs
    prevFilteredIdxRef.current = filteredIdx;
    prevFilterCriteriaRef.current = {
      stdFiltersEnabled,
      debouncedFilter,
      dcVersion,
      timeVersion,
      onlyMarked,
      searchMode,
    };

    // Nur bei Filter-Änderungen zum ausgewählten Eintrag scrollen, nicht bei neuen Einträgen
    if (!filterCriteriaChanged) return;

    // Wenn kein Eintrag ausgewählt ist, nichts tun
    if (selectedRef.current.size === 0) return;

    // Finde den zuletzt ausgewählten Eintrag (lastClicked oder letzten aus selected)
    const currentSelected =
      lastClicked.current ?? Array.from(selectedRef.current).pop();
    if (currentSelected == null) return;

    // Prüfe ob der ausgewählte Eintrag noch in der gefilterten Liste ist
    const viIndex = filteredIdx.indexOf(currentSelected);
    if (viIndex >= 0) {
      // Markiere als programmatisches Scrollen
      isProgrammaticScrollRef.current = true;

      // Element ist noch in der Liste - scrolle es in den sichtbaren Bereich
      // Verwende setTimeout um sicherzustellen, dass der virtualizer aktualisiert wurde
      setTimeout(() => {
        // Scrolle den Eintrag so, dass er am oberen Rand des sichtbaren Bereichs erscheint
        // mit ein paar Zeilen Puffer darüber
        const targetIndex = Math.max(0, viIndex - 3); // 3 Zeilen Puffer nach oben
        virtualizer.scrollToIndex(targetIndex, { align: "start" });

        // Erzwinge Re-Render
        requestAnimationFrame(() => {
          forceUpdate((n) => n + 1);
          // Reset programmatic scroll flag
          setTimeout(() => {
            isProgrammaticScrollRef.current = false;
          }, 300);
        });
      }, 0);
    }
  }, [
    filteredIdx,
    virtualizer,
    stdFiltersEnabled,
    debouncedFilter,
    dcVersion,
    timeVersion,
    onlyMarked,
    searchMode,
  ]);

  // Diagnostic logging removed - was causing render loops and performance issues on Windows
  // The logging condition (filteredIdx.length % 1000 === 0) fires on every render when length is 0

  // Stabile Callbacks für LogRow, um unnötige Re-Renders zu vermeiden
  const handleRowSelect = useCallback(
    (idx: number, shift: boolean, meta: boolean) => {
      try {
        toggleSelectIndex(idx, shift, meta);
        try {
          (parentRef.current as any)?.focus?.();
        } catch {}
      } catch (err) {
        logger.error("onClick handler error:", err);
      }
    },
    [toggleSelectIndex],
  );

  const handleRowContextMenu = useCallback(
    (ev: MouseEvent, idx: number) => {
      try {
        openContextMenu(ev, idx);
      } catch (err) {
        logger.error("onContextMenu handler error:", err);
      }
    },
    [openContextMenu],
  );

  // Stabilisierter Highlight-Callback
  const stableHighlightFn = useCallback(
    (text: string, searchTerm: string) => highlightAll(text, searchTerm),
    [],
  );

  function gotoListStart(): void {
    if (!filteredIdx.length) return;
    const targetVi = 0;
    const globalIdx = filteredIdx[targetVi]!;
    setSelected(new Set([globalIdx]));
    lastClicked.current = globalIdx;
    // In den sichtbaren Bereich scrollen
    scrollToIndexCenter(targetVi);
    try {
      (parentRef.current as any)?.focus?.();
    } catch {}
  }
  function gotoListEnd(): void {
    if (!filteredIdx.length) return;
    const targetVi = filteredIdx.length - 1;
    const globalIdx = filteredIdx[targetVi]!;
    setSelected(new Set([globalIdx]));
    lastClicked.current = globalIdx;
    // In den sichtbaren Bereich scrollen
    scrollToIndexCenter(targetVi);
    try {
      (parentRef.current as any)?.focus?.();
    } catch {}
  }

  // Hilfsfunktion: Ziel-Index im sichtbaren Bereich anzeigen (scrollt nur wenn nötig)
  function scrollToIndexCenter(viIndex: number) {
    // Markiere als programmatisches Scrollen, damit Follow-Modus nicht deaktiviert wird
    isProgrammaticScrollRef.current = true;

    // Erst Virtualizer nutzen um sicherzustellen, dass das Element gerendert wird
    virtualizer.scrollToIndex(viIndex, { align: "auto" });

    // Dann nach kurzer Verzögerung die Position korrigieren
    requestAnimationFrame(() => {
      const parent = parentRef.current as HTMLDivElement | null;
      if (!parent) return;

      // Versuche das Element direkt zu finden
      const rowEl = parent.querySelector(
        `[data-vi="${viIndex}"]`,
      ) as HTMLElement | null;
      if (rowEl) {
        // Element gefunden - scrolle es in den sichtbaren Bereich (nur wenn nötig)
        rowEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }

      // Setze das Flag nach dem Scrollen zurück (mit etwas Verzögerung für smooth scrolling)
      setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 300);
    });
  }

  // Selection
  function toggleSelectIndex(idx: number, shift: boolean, meta: boolean): void {
    try {
      setSelected((prev) => {
        try {
          let next = new Set(prev);
          if (shift && lastClicked.current != null) {
            const a = filteredIdx.indexOf(lastClicked.current);
            const b = filteredIdx.indexOf(idx);
            if (a >= 0 && b >= 0) {
              const [lo, hi] = a < b ? [a, b] : [b, a];
              next = new Set(filteredIdx.slice(lo, hi + 1).map((i) => i));
            } else next = new Set([idx]);
          } else if (meta) {
            if (next.has(idx)) next.delete(idx);
            else next.add(idx);
          } else {
            next = new Set([idx]);
          }
          lastClicked.current = idx;
          return next;
        } catch (err) {
          logger.error("toggleSelectIndex internal error:", err);
          return prev;
        }
      });
    } catch (err) {
      logger.error("toggleSelectIndex error:", err);
    }
  }

  const selectedOneIdx = useMemo(() => {
    if (selected.size === 1) return Array.from(selected)[0] as number;
    if (selected.size > 1)
      return (
        lastClicked.current ?? (Array.from(selected).slice(-1)[0] as number)
      );
    return null;
  }, [selected]);
  const selectedEntry = useMemo(
    () => (selectedOneIdx != null ? entries[selectedOneIdx] || null : null),
    [selectedOneIdx, entries],
  );

  const mdcPairs = useMemo(() => {
    const e = selectedEntry;
    const mdc =
      e && e.mdc && typeof e.mdc === "object"
        ? (e.mdc as Record<string, unknown>)
        : null;
    if (!mdc) return [] as [string, string][];
    // Gruppiere nach kanonischem Key (z. B. traceId/TraceID -> TraceID) und dedupliziere Werte
    const byKey = new Map<string, Set<string>>();
    for (const [k, v] of Object.entries(mdc)) {
      const ck = canonicalDcKey(k);
      if (!ck) continue;
      const val = v == null ? "" : String(v);
      if (!byKey.has(ck)) byKey.set(ck, new Set());
      byKey.get(ck)!.add(val);
    }
    const pairs: Array<[string, string]> = [];
    for (const [k, set] of byKey.entries()) {
      // prettier-ignore
      const vals = Array.from(set).filter((s) => s !== '').sort((a, b) => a.localeCompare(b));
      const hasEmpty = set.has("");
      const joined = vals.join(" | ");
      pairs.push([k, hasEmpty && !joined ? "" : joined]);
    }
    pairs.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    return pairs;
  }, [selectedEntry]);

  const markedIdx = useMemo(() => {
    const out: number[] = [];
    for (let vi = 0; vi < filteredIdx.length; vi++) {
      const idx = filteredIdx[vi]!;
      const e = entries[idx];
      if (e?._mark) out.push(vi);
    }
    return out;
  }, [filteredIdx, entries]);

  const searchMatchIdx = useMemo(() => {
    const s = String(debouncedSearch || "").trim();
    if (!s) return [] as number[];
    const out: number[] = [];
    for (let vi = 0; vi < filteredIdx.length; vi++) {
      const idx = filteredIdx[vi]!;
      const e = entries[idx];
      if (msgMatches(e?.message ?? "", s, { mode: searchMode })) out.push(vi);
    }
    return out;
  }, [debouncedSearch, filteredIdx, entries, searchMode]);

  function gotoMarked(dir: number) {
    if (!markedIdx.length) return;
    const curVi =
      selectedOneIdx != null ? filteredIdx.indexOf(selectedOneIdx) : -1;
    const first = markedIdx[0]!;
    const last = markedIdx[markedIdx.length - 1]!;
    let targetVi: number | undefined;
    if (dir > 0) {
      if (curVi < 0)
        targetVi = first; // keine Auswahl → zum ersten
      else {
        const next = markedIdx.find((vi) => vi > curVi);
        targetVi = next != null ? next : last; // kein nächster → am letzten stehen bleiben
      }
    } else {
      if (curVi < 0)
        targetVi = last; // keine Auswahl → zum letzten
      else {
        let prev = -1;
        for (const vi of markedIdx) if (vi < curVi) prev = vi;
        targetVi = prev >= 0 ? prev : first; // kein vorheriger → am ersten stehen bleiben
      }
    }
    const globalIdx: number = filteredIdx[targetVi]!;
    setSelected(new Set([globalIdx]));
    lastClicked.current = globalIdx;
    scrollToIndexCenter(targetVi);
  }
  function gotoSearchMatch(dir: number) {
    if (!searchMatchIdx.length) return;
    const curVi =
      selectedOneIdx != null ? filteredIdx.indexOf(selectedOneIdx) : -1;
    const first = searchMatchIdx[0]!;
    const last = searchMatchIdx[searchMatchIdx.length - 1]!;
    let targetVi: number | undefined;
    if (dir > 0) {
      if (curVi < 0)
        targetVi = first; // keine Auswahl → zum ersten Treffer
      else {
        const next = searchMatchIdx.find((vi) => vi > curVi);
        targetVi = next != null ? next : last; // kein nächster → am letzten stehen bleiben
      }
    } else {
      if (curVi < 0)
        targetVi = last; // keine Auswahl → zum letzten Treffer
      else {
        let prev = -1;
        for (const vi of searchMatchIdx) if (vi < curVi) prev = vi;
        targetVi = prev >= 0 ? prev : first; // kein vorheriger → am ersten stehen bleiben
      }
    }
    const globalIdx: number = filteredIdx[targetVi]!;
    setSelected(new Set([globalIdx]));
    lastClicked.current = globalIdx;
    scrollToIndexCenter(targetVi);
  }

  // Tastaturnavigation: ↑/↓ (Shift erweitert Auswahl)
  function moveSelectionBy(dir: 1 | -1, extend: boolean) {
    if (!filteredIdx.length) return;
    const curGlobal =
      selectedOneIdx != null
        ? (selectedOneIdx as number)
        : lastClicked.current != null
          ? (lastClicked.current as number)
          : null;
    const curVi = curGlobal != null ? filteredIdx.indexOf(curGlobal) : -1;

    let targetVi =
      curVi < 0 ? (dir > 0 ? 0 : filteredIdx.length - 1) : curVi + dir;
    if (targetVi < 0) targetVi = 0;
    if (targetVi > filteredIdx.length - 1) targetVi = filteredIdx.length - 1;

    const targetGlobal = filteredIdx[targetVi]!;
    if (!extend) {
      setSelected(new Set([targetGlobal]));
      lastClicked.current = targetGlobal;
    } else {
      const anchorGlobal =
        lastClicked.current != null
          ? (lastClicked.current as number)
          : (curGlobal ?? targetGlobal);
      const a = filteredIdx.indexOf(anchorGlobal);
      const b = targetVi;
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelected(new Set(filteredIdx.slice(lo, hi + 1)));
      } else {
        setSelected(new Set([targetGlobal]));
      }
    }
    scrollToIndexCenter(targetVi);
  }

  // Entry management functions (appendEntries, processIpcQueue) are now in useEntryManagement2 hook

  // Prüft, ob ein Message-Filter erweiterte Syntax enthält (& | ! ())
  function hasAdvancedSyntax(filter: string): boolean {
    const trimmed = (filter || "").trim();
    return /[&|!()]/.test(trimmed);
  }

  // Hilfsfunktion: Anhängen mit Kappung auf verfügbare Slots
  function appendElasticCapped(
    batch: any[],
    available: number,
    options?: { ignoreExistingForElastic?: boolean; messageFilter?: string },
  ): number {
    let filtered = Array.isArray(batch) ? batch : [];

    // Client-seitige Message-Filterung für erweiterte Syntax
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
  }

  const onListKeyDown = (e: KeyboardEvent) => {
    if (!filteredIdx.length) return;
    // Nur reagieren, wenn Fokus auf der Liste liegt
    // preventDefault stoppt Textcursor in Inputs außerhalb nicht, da wir nur bei Fokus der Liste sind
    try {
      // Standard Arrow Keys
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveSelectionBy(1, !!e.shiftKey);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        moveSelectionBy(-1, !!e.shiftKey);
      }
      // Vim-Style Navigation
      else if (e.key === "j" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        moveSelectionBy(1, !!e.shiftKey);
      } else if (e.key === "k" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        moveSelectionBy(-1, !!e.shiftKey);
      }
      // gg = go to start (double g)
      else if (e.key === "g" && !e.ctrlKey && !e.metaKey) {
        // Für doppeltes g müsste man State tracken, hier vereinfacht: g = start
        e.preventDefault();
        gotoListStart();
      }
      // G = go to end
      else if (e.key === "G" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        gotoListEnd();
      } else if (e.key === "End") {
        e.preventDefault();
        gotoListEnd();
      } else if (e.key === "Home") {
        e.preventDefault();
        gotoListStart();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setSelected(new Set());
      }
      // n = nächster Suchtreffer
      else if (e.key === "n" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        gotoSearchMatch(1);
      }
      // N = vorheriger Suchtreffer
      else if (e.key === "N" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        gotoSearchMatch(-1);
      }
    } catch (err) {
      logger.warn("Error in onListKeyDown:", err);
    }
  };

  // Follow mode auto-select
  useEffect(() => {
    if (!follow) return;
    if (!filteredIdx.length) return;
    const lastGlobalIdx = filteredIdx[filteredIdx.length - 1] as number;
    setSelected(new Set([lastGlobalIdx]));
    // Sicherstellen, dass der letzte Eintrag korrekt sichtbar ist (oberhalb des Detail-Overlays)
    setTimeout(() => {
      scrollToIndexCenter(filteredIdx.length - 1);
    }, 0);
  }, [entries, follow, stdFiltersEnabled, filter, dcVersion, timeVersion]);

  function addMdcToFilter(k: string, v: string) {
    try {
      (DiagnosticContextFilter as any).addMdcEntry(k, v ?? "");
      (DiagnosticContextFilter as any).setEnabled(true);
    } catch (e) {
      logger.error("Failed to add MDC entry to filter:", e);
      showAlert(t("errors.mdcFilterAddFailed"));
    }
  }

  function filterByLogger(logger: string) {
    setFilter((prev) => ({ ...prev, logger }));
    addFilterHistory("logger", logger);
    setStdFiltersEnabled(true);
  }

  function filterByThread(thread: string) {
    setFilter((prev) => ({ ...prev, thread }));
    addFilterHistory("thread", thread);
    setStdFiltersEnabled(true);
  }

  const [showTitleDlg, setShowTitleDlg] = useState<boolean>(false);
  const [showHelpDlg, setShowHelpDlg] = useState<boolean>(false);
  const [showCommandPalette, setShowCommandPalette] = useState<boolean>(false);

  // Alert refs for use in useEffects (useAlerts hook is called earlier with useEntryManagement2)
  const showAlertRef = useRef(showAlert);
  useEffect(() => {
    showAlertRef.current = showAlert;
  }, [showAlert]);

  // Ref for handleFeatureError so it can be used in useEffect without adding dependencies
  const handleFeatureErrorRef = useRef(handleFeatureError);
  useEffect(() => {
    handleFeatureErrorRef.current = handleFeatureError;
  }, [handleFeatureError]);

  // Settings laden - OPTIMIZED: Settings are pre-cached in preload script,
  // so settingsGet() returns immediately from cache without IPC round-trip
  useEffect(() => {
    const loadSettings = async () => {
      rendererPerf.mark("settings-load-start");
      try {
        if (!window.api?.settingsGet) {
          logger.error("window.api.settingsGet is not available.");
          setSettingsLoaded(true);
          return;
        }
        // This is now instant because settings are cached in preload
        const result = await window.api.settingsGet();
        if (!result || !result.ok) {
          logger.warn("Failed to load settings:", (result as any)?.error);
          setSettingsLoaded(true);
          return;
        }
        const r = result.settings as any;
        if (!r) {
          setSettingsLoaded(true);
          return;
        }
        if (r.tcpPort != null) setTcpPort(Number(r.tcpPort) || 5000);
        if (typeof r.httpUrl === "string") setHttpUrl(r.httpUrl);
        // Support both httpPollInterval (persisted) and httpInterval (legacy)
        const interval = r.httpPollInterval ?? r.httpInterval;
        if (interval != null) setHttpInterval(Number(interval) || 5);
        // Entfernt: Laden einer persistierten Logger-Historie, damit Verlauf nur temporär ist
        // if (Array.isArray(r.histLogger)) setHistLogger(r.histLogger);
        if (Array.isArray(r.histAppName)) setHistAppName(r.histAppName);
        if (Array.isArray(r.histEnvironment))
          setHistEnvironment(r.histEnvironment);
        // NEW: load histIndex
        if (Array.isArray(r.histIndex)) setHistIndex(r.histIndex);
        // Merke zuletzt verwendeten Environment-Case für Fallback im Dialog
        const lastEnvCase = (r.lastEnvironmentCase as any) || "original";
        setTimeForm((prev) => ({
          ...prev,
          environmentCase: String(lastEnvCase || "original"),
        }));
        if (typeof r.themeMode === "string") {
          const mode = ["light", "dark", "system"].includes(r.themeMode)
            ? r.themeMode
            : "system";
          setThemeMode(mode);
          applyThemeMode(mode);
        }
        if (typeof r.follow === "boolean") setFollow(!!r.follow);
        // followSmooth ist immer true, wird nicht aus Settings geladen
        const root = document.documentElement;
        const detail = Number(r.detailHeight || 0);
        if (detail)
          root.style.setProperty("--detail-height", `${Math.round(detail)}px`);
        const map: Array<[string, unknown]> = [
          ["--col-ts", r.colTs],
          ["--col-lvl", r.colLvl],
          ["--col-logger", r.colLogger],
        ];
        for (const [k, v] of map)
          if (v != null)
            root.style.setProperty(k, `${Math.round(Number(v) || 0)}px`);
        setLogToFile(!!r.logToFile);
        setLogFilePath(String(r.logFilePath || ""));
        setLogMaxBytes(Number(r.logMaxBytes || 5 * 1024 * 1024));
        setLogMaxBackups(Number(r.logMaxBackups || 3));
        setElasticUrl(String(r.elasticUrl || ""));
        setElasticSize(Number(r.elasticSize || 1000));
        setElasticUser(String(r.elasticUser || ""));
        setElasticHasPass(!!String(r.elasticPassEnc || "").trim());
        setElasticMaxParallel(Math.max(1, Number(r.elasticMaxParallel || 1)));
        if (r.marksMap && typeof r.marksMap === "object")
          setMarksMap(r.marksMap as Record<string, string>);
        if (Array.isArray(r.customMarkColors))
          setCustomColors(r.customMarkColors as string[]);
        if (typeof r.onlyMarked === "boolean") setOnlyMarked(!!r.onlyMarked);
        rendererPerf.mark("settings-loaded");
      } catch (e) {
        logger.error("Error loading settings:", e);
      } finally {
        setSettingsLoaded(true);
      }
      // Per-Window Berechtigungen laden
      try {
        const perms = await window.api?.windowPermsGet?.();
        if (perms?.ok) setCanTcpControlWindow(perms.canTcpControl !== false);
      } catch (e) {
        logger.warn("windowPermsGet failed:", e as any);
      }
    };

    // Call directly - no need for requestIdleCallback since settings are pre-cached
    void loadSettings();
  }, []);
  // ...existing code...
  async function openSettingsModal(
    initialTab?: "tcp" | "http" | "elastic" | "logging" | "appearance",
  ) {
    // Load fresh settings from main process to ensure we have current values
    let curMode = themeMode;
    let curTcpPort = tcpPort;
    let curHttpUrl = httpUrl;
    let curHttpInterval = httpInterval;
    let curLogToFile = logToFile;
    let curLogFilePath = logFilePath;
    let curLogMaxBytes = logMaxBytes;
    let curLogMaxBackups = logMaxBackups;
    let curElasticUrl = elasticUrl;
    let curElasticSize = elasticSize;
    let curElasticUser = elasticUser;
    let curElasticMaxParallel = elasticMaxParallel;
    let curAllowPrerelease = false;
    let curHeapSizeMB = 2048;

    try {
      if (window.api?.settingsGet) {
        const result = await window.api.settingsGet();
        const r = result?.ok ? (result.settings as any) : null;
        if (r) {
          // Update local state AND form values from fresh settings
          if (typeof r.themeMode === "string") {
            const mode = ["light", "dark", "system"].includes(r.themeMode)
              ? r.themeMode
              : "system";
            curMode = mode;
            setThemeMode(mode);
            applyThemeMode(mode);
          }
          if (typeof r.follow === "boolean") setFollow(!!r.follow);
          // followSmooth ist immer true, wird nicht aus Settings geladen

          // Load all form values from settings
          if (r.tcpPort != null) {
            curTcpPort = Number(r.tcpPort) || 5000;
            setTcpPort(curTcpPort);
          }
          if (typeof r.httpUrl === "string") {
            curHttpUrl = r.httpUrl;
            setHttpUrl(curHttpUrl);
          }
          const interval = r.httpPollInterval ?? r.httpInterval;
          if (interval != null) {
            curHttpInterval = Number(interval) || 5;
            setHttpInterval(curHttpInterval);
          }
          if (typeof r.logToFile === "boolean") {
            curLogToFile = r.logToFile;
            setLogToFile(curLogToFile);
          }
          if (typeof r.logFilePath === "string") {
            curLogFilePath = r.logFilePath;
            setLogFilePath(curLogFilePath);
          }
          if (r.logMaxBytes != null) {
            curLogMaxBytes = Number(r.logMaxBytes) || 5 * 1024 * 1024;
            setLogMaxBytes(curLogMaxBytes);
          }
          if (r.logMaxBackups != null) {
            curLogMaxBackups = Number(r.logMaxBackups) || 3;
            setLogMaxBackups(curLogMaxBackups);
          }
          if (typeof r.elasticUrl === "string") {
            curElasticUrl = r.elasticUrl;
            setElasticUrl(curElasticUrl);
          }
          if (r.elasticSize != null) {
            curElasticSize = Number(r.elasticSize) || 1000;
            setElasticSize(curElasticSize);
          }
          if (typeof r.elasticUser === "string") {
            curElasticUser = r.elasticUser;
            setElasticUser(curElasticUser);
          }
          if (r.elasticMaxParallel != null) {
            curElasticMaxParallel = Math.max(
              1,
              Number(r.elasticMaxParallel) || 1,
            );
            setElasticMaxParallel(curElasticMaxParallel);
          }
          if (typeof r.elasticPassEnc === "string") {
            setElasticHasPass(!!r.elasticPassEnc.trim());
          }
          if (typeof r.allowPrerelease === "boolean") {
            curAllowPrerelease = r.allowPrerelease;
          }
          if (typeof r.heapSizeMB === "number") {
            curHeapSizeMB = r.heapSizeMB;
          }
        }
      }
    } catch (e) {
      logger.warn("Failed to load settings for modal:", e);
    }
    setForm({
      tcpPort: curTcpPort,
      httpUrl: curHttpUrl,
      httpInterval: curHttpInterval,
      logToFile: curLogToFile,
      logFilePath: curLogFilePath,
      logMaxMB: Math.max(
        1,
        Math.round((curLogMaxBytes || 5 * 1024 * 1024) / (1024 * 1024)),
      ),
      logMaxBackups: curLogMaxBackups,
      themeMode: curMode,
      elasticUrl: curElasticUrl,
      elasticSize: curElasticSize,
      elasticUser: curElasticUser,
      elasticPassNew: "",
      elasticPassClear: false,
      elasticMaxParallel: curElasticMaxParallel || 1,
      allowPrerelease: curAllowPrerelease,
      heapSizeMB: curHeapSizeMB,
    });
    setOriginalHeapSizeMB(curHeapSizeMB);
    setSettingsTab(initialTab || "tcp");
    setShowSettings(true);
  }
  async function saveSettingsModal() {
    const port = Number(form.tcpPort || 0);
    if (!(port >= 1 && port <= 65535)) {
      showAlert(t("errors.invalidTcpPort"));
      return;
    }
    const interval = Math.max(1, Number(form.httpInterval || 5));
    const toFile = form.logToFile;
    const path = String(form.logFilePath || "").trim();
    const maxMB = Math.max(1, Number(form.logMaxMB || 5));
    const maxBytes = Math.round(maxMB * 1024 * 1024);
    const backups = Math.max(0, Number(form.logMaxBackups || 0));
    const mode = ["light", "dark", "system"].includes(form.themeMode)
      ? (form.themeMode as any)
      : "system";
    const patch: any = {
      tcpPort: port,
      httpUrl: String(form.httpUrl || "").trim(),
      httpPollInterval: interval,
      logToFile: toFile,
      logFilePath: path,
      logMaxBytes: maxBytes,
      logMaxBackups: backups,
      themeMode: mode,
      elasticUrl: String(form.elasticUrl || "").trim(),
      elasticSize: Math.max(1, Number(form.elasticSize || 1000)),
      elasticUser: String(form.elasticUser || "").trim(),
      elasticMaxParallel: Math.max(
        1,
        Number((form as any).elasticMaxParallel || elasticMaxParallel || 1),
      ),
      allowPrerelease: !!(form as any).allowPrerelease,
      heapSizeMB: Math.max(
        512,
        Math.min(8192, Number((form as any).heapSizeMB || 2048)),
      ),
    };
    const newPass = String(form.elasticPassNew || "").trim();
    if (form.elasticPassClear) patch["elasticPassClear"] = true;
    else if (newPass) patch["elasticPassPlain"] = newPass;
    try {
      const res = await window.api.settingsSet(patch);
      if (!res || !res.ok) {
        showAlert(
          t("errors.saveFailed", {
            message: (res as any)?.error || t("status.errorUnknown"),
          }),
        );
        return;
      }
      setTcpPort(port);
      setHttpUrl(String(form.httpUrl || "").trim());
      setHttpInterval(interval);
      setLogToFile(toFile);
      setLogFilePath(path);
      setLogMaxBytes(maxBytes);
      setLogMaxBackups(backups);
      setThemeMode(mode);
      applyThemeMode(mode);
      setElasticUrl(String(form.elasticUrl || "").trim());
      setElasticSize(Math.max(1, Number(form.elasticSize || 1000)));
      setElasticUser(String(form.elasticUser || "").trim());
      if (form.elasticPassClear) setElasticHasPass(false);
      else if (newPass) setElasticHasPass(true);

      // Update auto-updater with new allowPrerelease setting
      try {
        await window.api?.autoUpdaterSetAllowPrerelease?.(
          !!(form as any).allowPrerelease,
        );
      } catch (e) {
        logger.warn("Failed to update auto-updater allowPrerelease:", e);
      }

      setShowSettings(false);

      // Check if heap size changed and ask for restart
      const newHeapSize = Math.max(
        512,
        Math.min(8192, Number((form as any).heapSizeMB || 2048)),
      );
      if (newHeapSize !== originalHeapSizeMB) {
        // Use setTimeout to allow the modal to close first
        setTimeout(() => {
          const shouldRestart = window.confirm(
            t("settings.performance.restartRequired"),
          );
          if (shouldRestart && window.api?.appRelaunch) {
            void window.api.appRelaunch();
          }
        }, 100);
      }
    } catch (e) {
      logger.error("Failed to save settings:", e);
      showAlert(
        t("errors.saveFailed", { message: (e as any)?.message || String(e) }),
      );
    }
  }

  // Refs to access current values without triggering useEffect re-runs
  const httpPollIdRef = useRef<number | null>(httpPollId);
  const tcpPortRef = useRef<number>(tcpPort);
  useEffect(() => {
    httpPollIdRef.current = httpPollId;
  }, [httpPollId]);
  useEffect(() => {
    tcpPortRef.current = tcpPort;
  }, [tcpPort]);

  // IPC listeners setup (deferred to not block rendering)
  // IMPORTANT: This effect should only run ONCE on mount to avoid duplicate listeners
  useEffect(() => {
    rendererPerf.mark("ipc-setup-start");
    const offs: Array<() => void> = [];
    try {
      if (window.api?.onAppend) {
        console.log("[renderer-diag] Setting up onAppend listener");
        const off = window.api.onAppend((newEntries) => {
          console.log(
            `[renderer-diag] Received IPC logs:append with ${newEntries?.length || 0} entries`,
          );
          appendEntries(newEntries as any[]);
        });
        offs.push(off);
      } else {
        console.warn("[renderer-diag] window.api.onAppend not available!");
      }
    } catch (err) {
      console.error("[renderer-diag] Error setting up onAppend:", err);
    }
    try {
      if (window.api?.onMenu) {
        const off = window.api.onMenu(async (cmd) => {
          try {
            const { type, tab } = (cmd as any) || ({} as any);
            switch (type) {
              case "open-files": {
                const paths = await window.api.openFiles();
                if (paths && paths.length) {
                  const res = await window.api.parsePaths(paths);
                  if (res?.ok) appendEntries(res.entries as any);
                }
                break;
              }
              case "open-settings": {
                await openSettingsModal(tab || "tcp");
                break;
              }
              case "tcp-start": {
                try {
                  window.api.tcpStart(tcpPortRef.current);
                } catch (e) {
                  logger.error("Fehler beim Starten des TCP-Servers:", e);
                }
                break;
              }
              case "tcp-stop": {
                try {
                  window.api.tcpStop();
                } catch (e) {
                  logger.error("Fehler beim Stoppen des TCP-Servers:", e);
                }
                break;
              }
              case "http-load": {
                void openHttpLoadDialog();
                break;
              }
              case "http-start-poll": {
                void openHttpPollDialog();
                break;
              }
              case "http-stop-poll": {
                console.log(
                  "[menu] http-stop-poll received, httpPollIdRef.current =",
                  httpPollIdRef.current,
                );
                if (httpPollIdRef.current != null) {
                  console.log("[menu] calling httpMenuStopPoll()");
                  void httpMenuStopPoll();
                } else {
                  console.log(
                    "[menu] httpPollIdRef.current is null, not stopping",
                  );
                }
                break;
              }
              case "tcp-configure": {
                await openSettingsModal("tcp");
                break;
              }
              case "window-title": {
                setShowTitleDlg(true);
                break;
              }
              case "export-view": {
                void exportCurrentView();
                break;
              }
              case "show-help": {
                setShowHelpDlg(true);
                break;
              }
              case "toggle-follow": {
                setFollow((prev) => {
                  const newVal = !prev;
                  try {
                    void window.api.settingsSet({ follow: newVal } as any);
                  } catch (err) {
                    logger.warn("Persisting follow flag failed:", err);
                  }
                  return newVal;
                });
                break;
              }
              default:
                break;
            }
          } catch (e) {
            logger.warn("Menu command failed:", e);
          }
        });
        offs.push(off);
      }
    } catch (e) {
      logger.error("onMenu setup failed:", e);
    }
    try {
      if (window.api?.onTcpStatus) {
        const off = window.api.onTcpStatus((st) => {
          const status = st as any;
          if (status?.ok) {
            setTcpStatus(
              status.running
                ? tRef.current("status.tcpActive", {
                    port: String(status.port),
                  })
                : tRef.current("status.tcpStopped"),
            );
          } else {
            // Check if this is a feature-disabled error
            const errorMsg = status?.message || tRef.current("status.tcpError");
            if (!handleFeatureErrorRef.current(errorMsg)) {
              // Not a feature error, show in status
              setTcpStatus(errorMsg);
            }
          }
        });
        offs.push(off);
      }
    } catch (e) {
      logger.error("onTcpStatus setup failed:", e);
    }
    rendererPerf.mark("ipc-setup-complete");
    return () => {
      for (const f of offs)
        try {
          f();
        } catch (e) {
          logger.error("Failed to remove IPC listener:", e);
        }
    };
  }, []);

  // Drag & Drop
  const [dragActive, setDragActive] = useState<boolean>(false);
  useEffect(() => {
    const mgr = new DragAndDropManager({
      onFiles: async (paths) => {
        await withBusy(async () => {
          if (!window.api?.parsePaths) {
            showAlertRef.current(tRef.current("errors.apiNotAvailable"));
            return;
          }
          const res = await window.api.parsePaths(paths);
          if (res?.ok) appendEntries(res.entries as any);
          else
            showAlertRef.current(
              tRef.current("errors.dropLoadError", {
                message:
                  (res as any)?.error || tRef.current("status.errorUnknown"),
              }),
            );
        });
      },
      onActiveChange: (active) => setDragActive(active),
      onRawFiles: async (files) => {
        await withBusy(async () => {
          try {
            if (!window.api?.parseRawDrops) {
              showAlertRef.current(tRef.current("errors.apiNotAvailable"));
              return;
            }
            const res = await window.api.parseRawDrops(files);
            if (res?.ok) appendEntries(res.entries as any);
            else
              showAlertRef.current(
                tRef.current("errors.dropLoadError", {
                  message:
                    (res as any)?.error || tRef.current("status.errorUnknown"),
                }),
              );
          } catch (e) {
            logger.error("Error reading files (drop raw data):", e);
            showAlertRef.current(
              tRef.current("errors.fileReadError", {
                message: (e as any)?.message || String(e),
              }),
            );
          }
        });
      },
    });
    mgr.attach();
    return () => mgr.detach();
  }, []);

  const [esHasMore, setEsHasMore] = useState<boolean>(false);
  const [esNextSearchAfter, setEsNextSearchAfter] = useState<Array<
    string | number
  > | null>(null);
  const [lastEsForm, setLastEsForm] = useState<ElasticFormState | null>(null);
  const [esTotal, setEsTotal] = useState<number | null>(null);
  const [esBaseline, setEsBaseline] = useState<number>(0);
  const [esPitSessionId, setEsPitSessionId] = useState<string | null>(null);
  const esElasticCountAll = useMemo(() => {
    let cnt = 0;
    for (const e of entries) {
      const src = e?.source;
      if (typeof src === "string" && src.startsWith("elastic://")) cnt++;
    }
    return cnt;
  }, [entries]);
  const esLoaded = Math.max(0, esElasticCountAll - esBaseline);
  const esTarget = Math.max(1, Number(elasticSize || 0));
  const esPct =
    esTotal && esTotal > 0
      ? Math.min(100, Math.round((esLoaded / esTarget) * 100))
      : Math.round((esLoaded / esTarget) * 100) || 0;

  function clearLogs() {
    // Sicherheitsabfrage, nur wenn etwas zu löschen ist
    if (entries && entries.length > 0) {
      const confirmed = window.confirm(t("list.clearConfirmation"));
      if (!confirmed) return;
    }
    setEntries([]);
    setSelected(new Set());
    setNextId(1);
    setEsHasMore(false);
    setEsNextSearchAfter(null);
    setLastEsForm(null);
    setEsTotal(null);
    setEsBaseline(0);
    // Clear marksMap (session-only, not persisted)
    setMarksMap({});
    // Datei-Dedupe-Cache leeren
    fileSigCacheRef.current = new Map();
    // HTTP-Dedupe-Cache leeren
    httpSigCacheRef.current = new Map();
    // Caches leeren für bessere Speicherfreigabe
    clearHighlightCache();
    clearTimestampCache();
    // PIT-Session schließen (best effort)
    (async () => {
      try {
        if (esPitSessionId) await window.api.elasticClosePit(esPitSessionId);
      } catch {}
      setEsPitSessionId(null);
    })().catch(() => {});
    try {
      (LoggingStore as any).reset();
    } catch (e) {
      logger.error("LoggingStore.reset error:", e);
      showAlert(t("errors.resetLoggingStoreFailed"));
    }
    // HTTP/TCP Status wird NICHT zurückgesetzt, da Verbindungen noch aktiv sein können
  }

  /**
   * Export the current filtered view as HTML with colors
   */
  async function exportCurrentView() {
    // Use refs to get current values (avoid stale closures from menu handlers)
    const currentFilteredIdx = filteredIdxRef.current;
    const currentEntries = entriesRef.current;

    if (currentFilteredIdx.length === 0) {
      showAlert(t("errors.exportNoEntries"));
      return;
    }

    try {
      // First, show save dialog to let user choose format and path
      const pathResult = await window.api.chooseExportPath();
      if (!pathResult.ok || !pathResult.filePath) {
        // User canceled or error
        if (pathResult.error && pathResult.error !== "canceled") {
          showAlert(t("errors.exportFailed", { message: pathResult.error }));
        }
        return;
      }

      const format = pathResult.format || "html";
      const exportEntries = currentFilteredIdx.map(
        (idx) => currentEntries[idx],
      );

      let content: string;

      if (format === "json") {
        // JSON export - include mark color explicitly
        const jsonEntries = exportEntries.map((e) => ({
          timestamp: e?.timestamp,
          level: e?.level,
          logger: e?.logger,
          thread: e?.thread,
          message: e?.message,
          source: e?.source,
          traceId: e?.traceId,
          spanId: e?.spanId,
          stackTrace: e?.stackTrace,
          mdc: e?.mdc,
          markColor: e?._mark || null, // Explicitly include mark color
        }));
        content = JSON.stringify(jsonEntries, null, 2);
      } else if (format === "txt") {
        // Plain text export
        const lines = exportEntries.map((e) => {
          const ts = fmtTimestamp(e?.timestamp);
          const lvl = String(e?.level || "").padEnd(5);
          const loggerVal = String(e?.logger || "");
          const msg = String(e?.message || "");
          return `${ts} [${lvl}] ${loggerVal} - ${msg}`;
        });
        content = lines.join("\n");
      } else {
        // HTML export with styling
        const cssVars = getComputedStyle(document.documentElement);
        const bgColor =
          cssVars.getPropertyValue("--color-bg-default").trim() || "#f5f5f7";
        const textColor =
          cssVars.getPropertyValue("--color-text-primary").trim() || "#1d1d1f";
        const bgPaper =
          cssVars.getPropertyValue("--color-bg-paper").trim() || "#ffffff";

        const levelColors: Record<string, string> = {
          TRACE:
            cssVars.getPropertyValue("--color-level-trace").trim() || "#8b5cf6",
          DEBUG:
            cssVars.getPropertyValue("--color-level-debug").trim() || "#06b6d4",
          INFO:
            cssVars.getPropertyValue("--color-level-info").trim() || "#10b981",
          WARN:
            cssVars.getPropertyValue("--color-level-warn").trim() || "#f59e0b",
          WARNING:
            cssVars.getPropertyValue("--color-level-warn").trim() || "#f59e0b",
          ERROR:
            cssVars.getPropertyValue("--color-level-error").trim() || "#ef4444",
          FATAL:
            cssVars.getPropertyValue("--color-level-fatal").trim() || "#dc2626",
        };

        const rows = exportEntries.map((e) => {
          const ts = fmtTimestamp(e?.timestamp);
          const lvl = String(e?.level || "").toUpperCase();
          const loggerName = String(e?.logger || "");
          const msg = String(e?.message || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          const markColor = e?._mark as string | undefined;
          const levelColor = levelColors[lvl] || textColor;

          const rowStyle = markColor
            ? `border-left: 4px solid ${markColor}; background: ${markColor}22;`
            : "border-left: 4px solid transparent;";

          return `<tr style="${rowStyle}">
            <td style="white-space: nowrap; padding: 4px 8px;">${ts}</td>
            <td style="padding: 4px 8px; text-align: center;"><span style="color: ${levelColor}; font-weight: 600;">${lvl}</span></td>
            <td style="padding: 4px 8px; color: #666;">${loggerName}</td>
            <td style="padding: 4px 8px; font-family: monospace; white-space: pre-wrap; word-break: break-word;">${msg}</td>
          </tr>`;
        });

        content = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lumberjack Export - ${new Date().toLocaleString()}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
      background: ${bgColor};
      color: ${textColor};
      margin: 0;
      padding: 20px;
    }
    h1 { margin-bottom: 10px; }
    .meta { color: #666; margin-bottom: 20px; font-size: 14px; }
    table {
      width: 100%;
      border-collapse: collapse;
      background: ${bgPaper};
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    }
    th {
      background: ${bgColor};
      padding: 12px 8px;
      text-align: left;
      font-weight: 600;
      border-bottom: 1px solid #ddd;
    }
    tr:hover { background: rgba(0,0,0,0.02); }
    td { border-bottom: 1px solid #eee; vertical-align: top; }
    .level-trace { color: ${levelColors.TRACE}; }
    .level-debug { color: ${levelColors.DEBUG}; }
    .level-info { color: ${levelColors.INFO}; }
    .level-warn { color: ${levelColors.WARN}; }
    .level-error { color: ${levelColors.ERROR}; }
    .level-fatal { color: ${levelColors.FATAL}; }
    @media print {
      body { background: white; padding: 10px; }
      table { box-shadow: none; }
    }
  </style>
</head>
<body>
  <h1>🪵 Lumberjack Log Export</h1>
  <div class="meta">
    Exportiert: ${new Date().toLocaleString()}<br>
    Einträge: ${exportEntries.length} (gefiltert aus ${currentEntries.length} gesamt)
  </div>
  <table>
    <thead>
      <tr>
        <th style="width: 180px;">${t("list.header.timestamp")}</th>
        <th style="width: 80px; text-align: center;">${t("list.header.level")}</th>
        <th style="width: 200px;">${t("list.header.logger")}</th>
        <th>${t("list.header.message")}</th>
      </tr>
    </thead>
    <tbody>
      ${rows.join("\n")}
    </tbody>
  </table>
</body>
</html>`;
      }

      // Save the file
      const result = await window.api.saveExportFile(
        pathResult.filePath,
        content,
      );
      if (!result.ok) {
        showAlert(t("errors.exportFailed", { message: result.error || "" }));
      }
    } catch (err) {
      logger.error("Export failed:", err);
      showAlert(
        t("errors.exportFailed", {
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  async function httpMenuStopPoll() {
    // Use ref value instead of state value to avoid stale closures
    const currentPollId = httpPollIdRef.current;
    console.log(
      "[httpMenuStopPoll] called, httpPollIdRef.current =",
      currentPollId,
    );
    if (currentPollId == null) {
      console.log("[httpMenuStopPoll] currentPollId is null, returning early");
      return;
    }
    console.log(
      "[httpMenuStopPoll] calling window.api.httpStopPoll with id =",
      currentPollId,
    );
    const r = await window.api.httpStopPoll(currentPollId);
    console.log("[httpMenuStopPoll] result =", r);
    if (r.ok) {
      setHttpStatus(t("status.httpPollStopped"));
      setHttpPollId(null);
      setNextPollIn("");
      setNextPollDueAt(null);
      setCurrentPollInterval(null);
    }
  }

  // Divider and Column resize logic is now in useResizeHandlers hook

  // Starte MDCListener früh, damit Keys/Werte gesammelt werden, sobald Events eintreffen
  useEffect(() => {
    try {
      MDCListener.startListening();
    } catch (e) {
      logger.warn("MDCListener.startListening failed:", e as any);
    }
  }, []);

  // Globaler Keyboard-Handler für Shortcuts
  useEffect(() => {
    function onGlobalKeyDown(e: KeyboardEvent): void {
      // Use userAgentData if available, fallback to userAgent for older browsers
      const isMac =
        (navigator as any).userAgentData?.platform
          ?.toUpperCase()
          ?.includes("MAC") ??
        /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // Cmd/Ctrl+F = Fokus auf Suchfeld
      if (cmdOrCtrl && e.key.toLowerCase() === "f" && !e.shiftKey) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
      // Cmd/Ctrl+Shift+F = Filter-Bereich öffnen/schließen
      else if (cmdOrCtrl && e.key.toLowerCase() === "f" && e.shiftKey) {
        e.preventDefault();
        setFiltersExpanded((prev) => !prev);
      }
      // Escape im Suchfeld = Suchfeld leeren und fokus zur Liste
      else if (
        e.key === "Escape" &&
        document.activeElement === searchInputRef.current
      ) {
        e.preventDefault();
        if (search) {
          setSearch("");
        } else {
          try {
            (parentRef.current as any)?.focus?.();
          } catch {}
        }
      }
      // Escape bei offenem Hilfe-Dialog = Dialog schließen
      else if (e.key === "Escape" && showHelpDlg) {
        e.preventDefault();
        setShowHelpDlg(false);
      }
      // F1 = Hilfe öffnen
      else if (e.key === "F1") {
        e.preventDefault();
        setShowHelpDlg(true);
      }
      // Cmd+K / Ctrl+K = Command Palette öffnen
      else if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowCommandPalette(true);
      }
    }
    window.addEventListener("keydown", onGlobalKeyDown);
    return () => window.removeEventListener("keydown", onGlobalKeyDown);
  }, [search, showHelpDlg]);

  // Command Palette Commands
  const commands = useCommands({
    // Navigation
    onGotoStart: () => {
      try {
        virtualizer.scrollToIndex(0, { align: "start" });
      } catch {}
    },
    onGotoEnd: () => {
      try {
        const lastIdx = filteredIdx.length - 1;
        if (lastIdx >= 0) {
          virtualizer.scrollToIndex(lastIdx, { align: "end" });
        }
      } catch {}
    },
    onToggleFollow: () => setFollow((f) => !f),
    isFollowing: follow,

    // Filter
    onSetLevelFilter: (level: string) => {
      setFilter((prev) => ({ ...prev, level }));
      setStdFiltersEnabled(true);
    },
    onClearFilters: () => {
      setFilter({
        level: "",
        logger: "",
        thread: "",
        service: "",
        message: "",
      });
      setSearch("");
      setOnlyMarked(false);
    },
    onToggleMarked: () => setOnlyMarked((m) => !m),
    isOnlyMarked: onlyMarked,
    onFocusSearch: () => {
      try {
        searchInputRef.current?.focus();
      } catch {}
    },

    // Dialogs
    onOpenSettings: () => setShowSettings(true),
    onOpenElastic: () => openTimeFilterDialog(),
    onOpenHelp: () => setShowHelpDlg(true),

    // File
    onOpenFile: async () => {
      try {
        const result = await window.api.openFiles();
        if (result && result.length > 0) {
          const parsed = await window.api.parsePaths(result);
          if (parsed?.ok && parsed.entries && parsed.entries.length > 0) {
            appendEntries(parsed.entries);
          }
        }
      } catch (err) {
        logger.error("Open file failed:", err);
      }
    },
    onClearLogs: clearLogs,
    onExportLogs: async () => {
      try {
        await exportCurrentView();
      } catch (err) {
        logger.error("Export failed:", err);
      }
    },

    // TCP
    onStartTcp: () => {
      try {
        window.api?.tcpStart?.(tcpPort);
      } catch (err) {
        logger.error("TCP start failed:", err);
      }
    },
    onStopTcp: () => {
      try {
        window.api?.tcpStop?.();
      } catch (err) {
        logger.error("TCP stop failed:", err);
      }
    },
    isTcpActive: tcpStatus.includes("aktiv") || tcpStatus.includes("active"),

    // Theme
    onToggleTheme: () => {
      const newTheme = themeMode === "dark" ? "light" : "dark";
      setThemeMode(newTheme);
      applyThemeMode(newTheme);
      try {
        void window.api.settingsSet({ themeMode: newTheme });
      } catch {}
    },
    currentTheme: themeMode,
  });

  // Track when the component has fully mounted and is interactive
  useEffect(() => {
    rendererPerf.mark("app-mounted");
    // Log performance summary after a short delay to capture all initialization
    setTimeout(() => {
      const elapsed = rendererPerf.getElapsedTime();
      logger.log(`[App] Fully initialized in ${Math.round(elapsed)}ms`);
    }, 100);
  }, []);

  return (
    <div style="height:100%; display:flex; flex-direction:column;">
      {/* Skeleton loader während Settings geladen werden */}
      {!settingsLoaded && <SkeletonLoader />}

      {dragActive && (
        <div className="drop-overlay">
          Dateien hierher ziehen (.log, .json, .zip)
        </div>
      )}
      {/* DC-Filter Dialog */}
      {showDcDialog && (
        <div className="modal-backdrop" onClick={() => setShowDcDialog(false)}>
          <div
            className="modal modal-wide"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Diagnostic Context Filter</h3>
            <Suspense fallback={<div style={{ padding: "20px" }}>Lädt...</div>}>
              <DCFilterDialog />
            </Suspense>
            <div className="modal-actions">
              <button onClick={() => setShowDcDialog(false)}>Schließen</button>
            </div>
          </div>
        </div>
      )}

      {/* Elasticsearch Dialog */}
      {showTimeDialog && (
        <Suspense
          fallback={
            <div className="modal-backdrop">
              <div className="modal">Lädt…</div>
            </div>
          }
        >
          <ElasticSearchDialog
            open={showTimeDialog}
            initial={timeForm}
            histAppName={histAppName}
            histEnvironment={histEnvironment}
            histIndex={histIndex} // NEW: pass histIndex to dialog
            firstTs={(() => {
              const firstIdx = filteredIdx[0];
              return firstIdx != null ? entries[firstIdx]?.timestamp : null;
            })()}
            lastTs={(() => {
              const lastIdx = filteredIdx[filteredIdx.length - 1];
              return lastIdx != null ? entries[lastIdx]?.timestamp : null;
            })()}
            onApply={async (formVals: any) => {
              try {
                setShowTimeDialog(false);
                addToHistory("app", formVals?.application_name || "");
                addToHistory("env", formVals?.environment || "");
                addToHistory("index", formVals?.index || ""); // NEW: save index to history
                setLastEsForm(formVals);
                try {
                  await window.api.settingsSet({
                    lastEnvironmentCase: String(
                      formVals?.environmentCase || "original",
                    ),
                  } as any);
                } catch (e) {
                  logger.warn(
                    "Persisting lastEnvironmentCase failed:",
                    e as any,
                  );
                }

                // Bestimme Load-Mode gleich zu Beginn
                const loadMode = String(formVals.loadMode || "append");

                // Falls wir ersetzen: offene PIT-Session vorher schließen
                if (loadMode === "replace" && esPitSessionId) {
                  try {
                    await window.api.elasticClosePit(esPitSessionId);
                  } catch (e) {
                    logger.warn(
                      "elasticClosePit before new search failed:",
                      e as any,
                    );
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
                    const state = (TimeFilter as any).getState?.();
                    const wasEnabled = !!(state && state.enabled);
                    if (formVals.mode === "absolute" && wasEnabled) {
                      const curFrom: string | null = state.from ?? null;
                      const curTo: string | null = state.to ?? null;
                      const newFrom: string | null =
                        (formVals.from || "").trim() || null;
                      const newTo: string | null =
                        (formVals.to || "").trim() || null;
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
                  logger.warn("TimeFilter update (Elastic) failed:", e as any);
                }

                await withBusy(async () => {
                  setEsBusy(true);
                  setEsTotal(null);
                  try {
                    const opts: ElasticSearchOptions = {
                      url: elasticUrl || undefined,
                      size: elasticSize || undefined,
                      index: formVals.index,
                      sort: formVals.sort,
                      duration:
                        formVals.mode === "relative"
                          ? formVals.duration
                          : undefined,
                      from:
                        formVals.mode === "absolute"
                          ? formVals.from
                          : undefined,
                      to:
                        formVals.mode === "absolute" ? formVals.to : undefined,
                      application_name: formVals.application_name,
                      logger: formVals.logger,
                      level: formVals.level,
                      environment: formVals.environment,
                      message: formVals.message,
                      environmentCase: formVals.environmentCase || "original",
                      allowInsecureTLS: !!formVals.allowInsecureTLS,
                      // optionale PIT-Optimierungen
                      keepAlive: "1m",
                      trackTotalHits: false,
                    } as any;
                    logger.info("[Elastic] Search started", {
                      hasResponse: false,
                    });
                    setEsBaseline(
                      loadMode === "replace" ? 0 : esElasticCountAll,
                    );
                    // Verfügbare Slots anhand aktuellem Stand bestimmen (nur Elastic-Einträge zählen)
                    let available = Math.max(
                      0,
                      (elasticSize || 0) -
                        (loadMode === "replace" ? 0 : esElasticCountAll),
                    );
                    let carriedPit: string | null = null;
                    let nextToken: Array<string | number> | null = null;
                    let hasMore = false;

                    // Erste Seite holen
                    const res = await window.api.elasticSearch(opts);
                    const total = Array.isArray(res?.entries)
                      ? res.entries.length
                      : 0;
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

                      if (loadMode === "replace") {
                        // Vollständiges Zurücksetzen: alle vorhandenen Einträge entfernen
                        setEntries([]);
                        setSelected(new Set());
                        setNextId(1);
                        // Datei-Dedupe-Cache leeren, damit Files erneut geladen werden können
                        fileSigCacheRef.current = new Map();
                        // HTTP-Dedupe-Cache leeren
                        httpSigCacheRef.current = new Map();
                        // LoggingStore zurücksetzen (MDC etc.)
                        try {
                          (LoggingStore as any).reset();
                        } catch (e) {
                          logger.error(
                            "LoggingStore.reset error (Elastic replace)",
                            e,
                          );
                        }
                      }

                      // Anhängen mit Kappung
                      const messageFilter = formVals.message || "";
                      if (Array.isArray(res.entries) && res.entries.length) {
                        const used = appendElasticCapped(
                          res.entries as any[],
                          available,
                          {
                            ignoreExistingForElastic: loadMode === "replace",
                            messageFilter,
                          },
                        );
                        available = Math.max(0, available - used);
                      }

                      // Auto-Nachladen bis Cap erreicht oder keine weiteren Seiten
                      while (available > 0 && hasMore) {
                        const moreOpts: ElasticSearchOptions = {
                          ...opts,
                          // Für PIT: nextSearchAfter übergeben; für Scroll bleibt es undefiniert
                          ...(nextToken &&
                          Array.isArray(nextToken) &&
                          nextToken.length > 0
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
                            { messageFilter },
                          );
                          available = Math.max(0, available - used2);
                        }
                        if (!hasMore) break;
                      }

                      // Session nur beenden, wenn wirklich keine weiteren Ergebnisse mehr verfügbar
                      if (!hasMore) {
                        setEsPitSessionId(null);
                      }
                      // esHasMore bleibt true, wenn noch Ergebnisse existieren (auch bei Cap erreicht)
                    } else {
                      // Check if this is a feature-disabled error
                      const errorMsg =
                        (res as any)?.error || t("status.errorUnknown");
                      if (!handleFeatureError(errorMsg)) {
                        showAlert(
                          t("status.elasticError", { message: errorMsg }),
                        );
                      }
                    }
                  } finally {
                    setEsBusy(false);
                  }
                });
              } catch (e) {
                logger.error("[Elastic] Search failed", e as any);
                const errorMsg = (e as any)?.message || String(e);
                if (!handleFeatureError(errorMsg)) {
                  showAlert(t("status.elasticError", { message: errorMsg }));
                }
              }
            }}
            onClear={() => {
              clearTimeFilter();
              TimeFilter.reset();
            }}
            onClose={() => setShowTimeDialog(false)}
          />
        </Suspense>
      )}

      {/* HTTP Load Dialog - lazy loaded */}
      <Suspense fallback={null}>
        <HttpLoadDialog
          open={showHttpLoadDlg}
          initialUrl={httpLoadUrl}
          onClose={() => setShowHttpLoadDlg(false)}
          onLoad={async (url) => {
            await withBusy(async () => {
              try {
                setHttpUrl(url);
                await window.api.settingsSet({ httpUrl: url } as any);
                const res = await window.api.httpLoadOnce(url);
                if (res.ok) {
                  appendEntries((res.entries || []) as any[]);
                } else {
                  // Check if this is a feature-disabled error
                  if (!handleFeatureError(res.error)) {
                    setHttpStatus(
                      t("status.error", {
                        message: res.error || t("status.errorUnknown"),
                      }),
                    );
                  }
                }
              } catch (e) {
                setHttpStatus(
                  t("status.error", {
                    message: (e as any)?.message || String(e),
                  }),
                );
              }
            });
          }}
        />
      </Suspense>

      {/* HTTP Poll Dialog - lazy loaded */}
      <Suspense fallback={null}>
        <HttpPollDialog
          open={showHttpPollDlg}
          initialUrl={httpPollForm.url}
          initialInterval={httpPollForm.interval}
          isPollActive={httpPollId != null}
          onClose={() => setShowHttpPollDlg(false)}
          onStart={async (url, sec) => {
            try {
              setHttpUrl(url);
              setHttpInterval(sec);
              await window.api.settingsSet({
                httpUrl: url,
                httpPollInterval: sec,
              } as any);
              const r = await window.api.httpStartPoll({
                url,
                intervalSec: sec,
              });
              if (r.ok) {
                setHttpPollId(r.id!);
                setHttpStatus(t("status.httpPolling", { id: String(r.id) }));
                // Convert to ms for internal timer tracking
                setNextPollDueAt(Date.now() + sec * 1000);
                setCurrentPollInterval(sec * 1000);
              } else {
                // Check if this is a feature-disabled error
                if (!handleFeatureError(r.error)) {
                  setHttpStatus(
                    t("status.error", {
                      message: r.error || t("status.errorUnknown"),
                    }),
                  );
                }
              }
            } catch (e) {
              setHttpStatus(
                t("status.error", {
                  message: (e as any)?.message || String(e),
                }),
              );
            }
          }}
        />
      </Suspense>

      {/* Einstellungen (Tabs) - lazy loaded */}
      <Suspense fallback={null}>
        <SettingsModal
          open={showSettings}
          tab={settingsTab}
          form={form}
          elasticHasPass={elasticHasPass}
          canTcpControlWindow={canTcpControlWindow}
          locale={locale}
          onTabChange={setSettingsTab}
          onFormChange={setForm}
          onCanTcpControlWindowChange={setCanTcpControlWindow}
          onLocaleChange={setLocale}
          onSave={saveSettingsModal}
          onClose={() => setShowSettings(false)}
          applyThemeMode={applyThemeMode}
        />
      </Suspense>

      {/* Toolbar */}
      <header className="toolbar">
        <div className="section">
          <span className="counts">
            <span id="countTotal" className="count">
              {countTotal}
            </span>{" "}
            {t("toolbar.total")},{" "}
            <span
              id="countFiltered"
              className="count"
              title={
                lastFilterStats && countTotal > countFiltered
                  ? `Gefiltert: ${countTotal - countFiltered} Einträge\n` +
                    (lastFilterStats.rejectedByLevel > 0
                      ? `• Level: ${lastFilterStats.rejectedByLevel}\n`
                      : "") +
                    (lastFilterStats.rejectedByLogger > 0
                      ? `• Logger: ${lastFilterStats.rejectedByLogger}\n`
                      : "") +
                    (lastFilterStats.rejectedByThread > 0
                      ? `• Thread: ${lastFilterStats.rejectedByThread}\n`
                      : "") +
                    (lastFilterStats.rejectedByMessage > 0
                      ? `• Message: ${lastFilterStats.rejectedByMessage}\n`
                      : "") +
                    (lastFilterStats.rejectedByTime > 0
                      ? `• Zeit: ${lastFilterStats.rejectedByTime}\n`
                      : "") +
                    (lastFilterStats.rejectedByDC > 0
                      ? `• DC-Filter: ${lastFilterStats.rejectedByDC}\n`
                      : "") +
                    (lastFilterStats.rejectedByOnlyMarked > 0
                      ? `• Nur Markierte: ${lastFilterStats.rejectedByOnlyMarked}\n`
                      : "")
                  : undefined
              }
              style={{
                cursor:
                  lastFilterStats && countTotal > countFiltered
                    ? "help"
                    : undefined,
                textDecoration:
                  lastFilterStats && countTotal > countFiltered
                    ? "underline dotted"
                    : undefined,
              }}
            >
              {countFiltered}
            </span>{" "}
            {t("toolbar.filtered")},{" "}
            <span id="countSelected" className="count">
              {countSelected}
            </span>{" "}
            {t("toolbar.selected")}
          </span>
          <button onClick={clearLogs} disabled={entries.length === 0}>
            {t("toolbar.clearLogs")}
          </button>
        </div>
        {/* Kompakte Navigation & Markierungen */}
        <div className="section" style={{ gap: "4px" }}>
          <div className="btn-group" title="Navigation">
            <button
              className="btn-icon"
              title={t("toolbar.gotoStartTooltip")}
              onClick={gotoListStart}
              disabled={countFiltered === 0}
            >
              ⏫
            </button>
            <button
              className="btn-icon"
              title={t("toolbar.gotoEndTooltip")}
              onClick={gotoListEnd}
              disabled={countFiltered === 0}
            >
              ⏬
            </button>
          </div>
          <div className="btn-group" title="Markierungen">
            <button
              className="btn-icon"
              title={t("toolbar.prevMarkTooltip")}
              onClick={() => gotoMarked(-1)}
              disabled={markedIdx.length === 0}
            >
              🔺
            </button>
            <button
              className="btn-icon"
              title={t("toolbar.nextMarkTooltip")}
              onClick={() => gotoMarked(1)}
              disabled={markedIdx.length === 0}
            >
              🔻
            </button>
            {markedIdx.length > 0 && (
              <span
                className="badge-count"
                title={`${markedIdx.length} Markierungen`}
              >
                {markedIdx.length}
              </span>
            )}
          </div>
        </div>
        <div className="section">
          <div className="search-wrapper">
            <input
              id="searchText"
              ref={searchInputRef as any}
              type="search"
              value={search}
              onInput={(e) => setSearch(e.currentTarget.value)}
              onKeyDown={(e) => {
                const key = (e as any).key;
                // Handle Enter: select highlighted item or go to next match
                if (key === "Enter") {
                  if (
                    showSearchHist &&
                    searchHistHighlightIdx >= 0 &&
                    searchHistHighlightIdx < fltHistSearch.length
                  ) {
                    e.preventDefault();
                    const selectedItem = fltHistSearch[searchHistHighlightIdx];
                    if (selectedItem !== undefined) {
                      setSearch(selectedItem);
                      addFilterHistory("search", selectedItem);
                      setShowSearchHist(false);
                      setSearchHistHighlightIdx(-1);
                    }
                  } else {
                    addFilterHistory(
                      "search",
                      (e.currentTarget as any).value as string,
                    );
                    gotoSearchMatch(1);
                  }
                  return;
                }
                // Arrow navigation when dropdown is open
                if (key === "ArrowDown") {
                  if (showSearchHist && fltHistSearch.length > 0) {
                    e.preventDefault();
                    setSearchHistHighlightIdx(
                      Math.min(
                        searchHistHighlightIdx + 1,
                        fltHistSearch.length - 1,
                      ),
                    );
                  } else {
                    setShowSearchHist(true);
                    setSearchHistHighlightIdx(-1);
                  }
                  return;
                }
                if (key === "ArrowUp" && showSearchHist) {
                  e.preventDefault();
                  setSearchHistHighlightIdx(
                    Math.max(searchHistHighlightIdx - 1, 0),
                  );
                  return;
                }
                if (key === "Escape" && showSearchHist) {
                  e.preventDefault();
                  setShowSearchHist(false);
                  setSearchHistHighlightIdx(-1);
                  return;
                }
                if (key === "Home" && showSearchHist) {
                  e.preventDefault();
                  setSearchHistHighlightIdx(0);
                  return;
                }
                if (key === "End" && showSearchHist) {
                  e.preventDefault();
                  setSearchHistHighlightIdx(fltHistSearch.length - 1);
                  return;
                }
                const keyLower = key?.toLowerCase?.() || "";
                if (
                  keyLower === "a" &&
                  ((e as any).ctrlKey || (e as any).metaKey)
                ) {
                  e.preventDefault();
                  try {
                    (e.currentTarget as HTMLInputElement).select();
                  } catch {}
                }
              }}
              onFocus={() => {
                setShowLoggerHist(false);
                setShowThreadHist(false);
                setShowMessageHist(false);
                setShowSearchHist(true);
                setSearchHistHighlightIdx(-1);
              }}
              onBlur={(e) => addFilterHistory("search", e.currentTarget.value)}
              placeholder="Suchen… (foo&bar, foo|bar, !foo)"
              autocomplete="off"
            />
          </div>
          {/* Such-Optionen Button mit Dropdown */}
          <div style={{ position: "relative" }} id="searchModeBtn">
            <button
              onClick={(_) => {
                setShowSearchOptions(!showSearchOptions);
              }}
              title="Suchmodus"
              style={{
                padding: "6px 10px",
                minWidth: "unset",
                background:
                  searchMode !== "insensitive"
                    ? "var(--accent-gradient)"
                    : undefined,
                color: searchMode !== "insensitive" ? "white" : undefined,
                borderColor:
                  searchMode !== "insensitive" ? "transparent" : undefined,
              }}
            >
              {searchMode === "insensitive" && "Aa ▾"}
              {searchMode === "sensitive" && "Aa ▾"}
              {searchMode === "regex" && ".* ▾"}
            </button>
            {showSearchOptions &&
              createPortal(
                <div
                  style={{
                    position: "fixed",
                    top: (() => {
                      const btn = document.getElementById("searchModeBtn");
                      if (btn) {
                        const rect = btn.getBoundingClientRect();
                        return rect.bottom + 4 + "px";
                      }
                      return "60px";
                    })(),
                    left: (() => {
                      const btn = document.getElementById("searchModeBtn");
                      if (btn) {
                        const rect = btn.getBoundingClientRect();
                        return Math.max(0, rect.right - 180) + "px";
                      }
                      return "auto";
                    })(),
                    background: "var(--color-bg-paper)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "8px",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
                    zIndex: 999999,
                    minWidth: "180px",
                    overflow: "hidden",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div
                    style={{
                      padding: "8px 12px",
                      cursor: "pointer",
                      background:
                        searchMode === "insensitive"
                          ? "var(--color-bg-hover)"
                          : undefined,
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                    onClick={() => {
                      setSearchMode("insensitive");
                      setShowSearchOptions(false);
                    }}
                  >
                    <span style={{ width: "20px" }}>
                      {searchMode === "insensitive" ? "✓" : ""}
                    </span>
                    <div>
                      <div style={{ fontWeight: "500" }}>Aa ignorieren</div>
                      <div
                        style={{
                          fontSize: "11px",
                          color: "var(--color-text-secondary)",
                        }}
                      >
                        Case-insensitiv
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      padding: "8px 12px",
                      cursor: "pointer",
                      background:
                        searchMode === "sensitive"
                          ? "var(--color-bg-hover)"
                          : undefined,
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                    onClick={() => {
                      setSearchMode("sensitive");
                      setShowSearchOptions(false);
                    }}
                  >
                    <span style={{ width: "20px" }}>
                      {searchMode === "sensitive" ? "✓" : ""}
                    </span>
                    <div>
                      <div style={{ fontWeight: "500" }}>Aa beachten</div>
                      <div
                        style={{
                          fontSize: "11px",
                          color: "var(--color-text-secondary)",
                        }}
                      >
                        Case-sensitiv
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      padding: "8px 12px",
                      cursor: "pointer",
                      background:
                        searchMode === "regex"
                          ? "var(--color-bg-hover)"
                          : undefined,
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                    onClick={() => {
                      setSearchMode("regex");
                      setShowSearchOptions(false);
                    }}
                  >
                    <span style={{ width: "20px" }}>
                      {searchMode === "regex" ? "✓" : ""}
                    </span>
                    <div>
                      <div style={{ fontWeight: "500" }}>Regex</div>
                      <div
                        style={{
                          fontSize: "11px",
                          color: "var(--color-text-secondary)",
                        }}
                      >
                        Regulärer Ausdruck
                      </div>
                    </div>
                  </div>
                </div>,
                document.body,
              )}
          </div>
          <div
            ref={searchHistRef as any}
            style={{
              display: "none", // Versteckt, da wir die Ref noch für Positionierung brauchen
              position: "relative",
            }}
          />
          {showSearchHist &&
            fltHistSearch.length > 0 &&
            searchPos &&
            createPortal(
              <div
                ref={searchPopRef as any}
                role="listbox"
                className="autocomplete-dropdown"
                style={{
                  position: "fixed",
                  left: searchPos.left + "px",
                  top: searchPos.top + "px",
                  width: Math.max(searchPos.width, 300) + "px",
                }}
              >
                {fltHistSearch.map((v, i) => (
                  <div
                    key={i}
                    className={`autocomplete-item ${searchHistHighlightIdx === i ? "highlighted" : ""}`}
                    onClick={() => {
                      setSearch(v);
                      addFilterHistory("search", v);
                      setShowSearchHist(false);
                      setSearchHistHighlightIdx(-1);
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setSearchHistHighlightIdx(i)}
                    title={v}
                    role="option"
                    aria-selected={searchHistHighlightIdx === i}
                  >
                    <span>🕐</span>
                    {v}
                  </div>
                ))}
                <div className="autocomplete-hint">
                  <span>
                    <kbd>↑↓</kbd> Navigation
                  </span>
                  <span>
                    <kbd>Enter</kbd> Auswählen
                  </span>
                  <span>
                    <kbd>Esc</kbd> Schließen
                  </span>
                </div>
              </div>,
              document.body,
            )}
          <button
            id="btnPrevMatch"
            title={`${t("toolbar.prevMatch")} (Shift+N)`}
            disabled={!search.trim() || searchMatchIdx.length === 0}
            onClick={() => gotoSearchMatch(-1)}
          >
            ▲
          </button>
          <span
            style={{
              fontSize: "11px",
              color: "var(--color-text-secondary)",
              minWidth: "50px",
              textAlign: "center",
            }}
          >
            {search.trim() && searchMatchIdx.length > 0
              ? (() => {
                  // Berechne aktuellen Treffer-Index
                  const curVi =
                    selectedOneIdx != null
                      ? filteredIdx.indexOf(selectedOneIdx)
                      : -1;
                  const currentMatchPos =
                    curVi >= 0 ? searchMatchIdx.indexOf(curVi) : -1;
                  if (currentMatchPos >= 0) {
                    return `${currentMatchPos + 1}/${searchMatchIdx.length}`;
                  }
                  return `–/${searchMatchIdx.length}`;
                })()
              : ""}
          </span>
          <button
            id="btnNextMatch"
            title={`${t("toolbar.nextMatch")} (N)`}
            disabled={!search.trim() || searchMatchIdx.length === 0}
            onClick={() => gotoSearchMatch(1)}
          >
            ▼
          </button>
        </div>
        <div className="section">
          {busy && (
            <span className="busy">
              <span className="spinner"></span>
              {t("toolbar.busy")}
            </span>
          )}
          {/* TCP Status - nur anzeigen wenn aktiv */}
          {tcpStatus && !tcpStatus.includes("geschlossen") && (
            <span id="tcpStatus" className="status status-active">
              🟢 {tcpStatus}
            </span>
          )}
          {/* HTTP Status - nur anzeigen wenn aktiv */}
          {httpStatus && !httpStatus.includes("inaktiv") && (
            <span id="httpStatus" className="status status-active">
              🟢 {httpStatus}
            </span>
          )}
          {nextPollIn && (
            <span className="status" title="Nächster Poll in">
              {nextPollIn}
            </span>
          )}
        </div>
        <div className="section" style={{ flex: 1, flexWrap: "wrap" }}>
          {/* Filter Toggle Button */}
          <button
            className={`filter-toggle-btn ${filtersExpanded ? "expanded" : ""}`}
            onClick={() => setFiltersExpanded(!filtersExpanded)}
            title="Filter ein-/ausblenden (⌘⇧F)"
          >
            <span>🎛️ Filter</span>
            <span className="chevron">▼</span>
          </button>
          {/* Aktive Filter-Chips inline */}
          {(() => {
            const activeFilters: Array<{
              type: string;
              label: string;
              value: string;
              onRemove: () => void;
              colorClass?: string;
            }> = [];

            if (filter.level && stdFiltersEnabled) {
              activeFilters.push({
                type: "level",
                label: "",
                value: filter.level,
                colorClass: `level-${filter.level.toLowerCase()}`,
                onRemove: () => setFilter({ ...filter, level: "" }),
              });
            }
            if (filter.logger && stdFiltersEnabled) {
              activeFilters.push({
                type: "logger",
                label: "Logger",
                value: filter.logger,
                onRemove: () => setFilter({ ...filter, logger: "" }),
              });
            }
            if (filter.thread && stdFiltersEnabled) {
              activeFilters.push({
                type: "thread",
                label: "Thread",
                value: filter.thread,
                onRemove: () => setFilter({ ...filter, thread: "" }),
              });
            }
            if (filter.message && stdFiltersEnabled) {
              activeFilters.push({
                type: "message",
                label: "Msg",
                value:
                  filter.message.length > 20
                    ? filter.message.substring(0, 20) + "…"
                    : filter.message,
                onRemove: () => setFilter({ ...filter, message: "" }),
              });
            }
            if (onlyMarked) {
              activeFilters.push({
                type: "marked",
                label: "",
                value: "Markierte",
                onRemove: () => {
                  setOnlyMarked(false);
                  try {
                    void window.api.settingsSet({ onlyMarked: false });
                  } catch {}
                },
              });
            }
            const dcEntries = DiagnosticContextFilter.getDcEntries().filter(
              (e) => e.active,
            );
            // Check if TraceID is in active DC filters
            const activeTraceId = dcEntries.find(
              (e) =>
                e.key === "TraceID" || e.key.toLowerCase().includes("trace"),
            );
            if (DiagnosticContextFilter.isEnabled() && dcEntries.length > 0) {
              // Add Timeline button if TraceID is active
              if (activeTraceId) {
                activeFilters.push({
                  type: "trace-timeline",
                  label: "📊",
                  value: t("traceTimeline.openTimeline"),
                  colorClass: "trace-timeline-chip",
                  onRemove: () => {
                    setTraceTimelineId(activeTraceId.val);
                    setShowTraceTimeline(true);
                  },
                });
              }
              dcEntries.slice(0, 3).forEach((entry) => {
                activeFilters.push({
                  type: "dc",
                  label: entry.key,
                  value: entry.val || "*",
                  colorClass: "dc-filter",
                  onRemove: () =>
                    DiagnosticContextFilter.deactivateMdcEntry(
                      entry.key,
                      entry.val,
                    ),
                });
              });
              if (dcEntries.length > 3) {
                activeFilters.push({
                  type: "dc-more",
                  label: "",
                  value: `+${dcEntries.length - 3}`,
                  colorClass: "dc-filter",
                  onRemove: () => {},
                });
              }
            }

            if (activeFilters.length === 0) return null;

            return (
              <>
                {activeFilters.map((f, i) =>
                  f.type === "trace-timeline" ? (
                    <button
                      key={`${f.type}-${i}`}
                      className="filter-chip trace-timeline-chip"
                      onClick={f.onRemove}
                      title={t("traceTimeline.openTimelineTooltip")}
                    >
                      <span className="chip-label">{f.label}</span>
                      <span className="chip-value">{f.value}</span>
                    </button>
                  ) : (
                    <span
                      key={`${f.type}-${i}`}
                      className={`filter-chip ${f.colorClass || ""}`}
                    >
                      {f.label && (
                        <span className="chip-label">{f.label}:</span>
                      )}
                      <span className="chip-value" title={f.value}>
                        {f.value}
                      </span>
                      {f.type !== "dc-more" && (
                        <button
                          className="chip-remove"
                          onClick={f.onRemove}
                          title="Filter entfernen"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ),
                )}
                {activeFilters.length > 0 && (
                  <button
                    style={{
                      fontSize: "11px",
                      padding: "2px 6px",
                      marginLeft: "4px",
                    }}
                    onClick={() => {
                      setSearch("");
                      setFilter({
                        level: "",
                        logger: "",
                        thread: "",
                        service: "",
                        message: "",
                      });
                      setOnlyMarked(false);
                      try {
                        void window.api.settingsSet({ onlyMarked: false });
                      } catch {}
                      try {
                        (TimeFilter as any).reset?.();
                      } catch {}
                      try {
                        DiagnosticContextFilter.reset();
                      } catch {}
                    }}
                    title="Alle Filter löschen"
                  >
                    ✕ Alle
                  </button>
                )}
              </>
            );
          })()}
        </div>
        {/* Ausklappbare Filter-Sektion */}
        <FilterSection
          expanded={filtersExpanded}
          stdFiltersEnabled={stdFiltersEnabled}
          filter={filter}
          onlyMarked={onlyMarked}
          markedCount={markedIdx.length}
          fltHistLogger={fltHistLogger}
          fltHistThread={fltHistThread}
          fltHistMessage={fltHistMessage}
          showLoggerHist={showLoggerHist}
          showThreadHist={showThreadHist}
          showMessageHist={showMessageHist}
          loggerPos={loggerPos}
          threadPos={threadPos}
          messagePos={messagePos}
          loggerHistRef={loggerHistRef}
          threadHistRef={threadHistRef}
          messageHistRef={messageHistRef}
          loggerPopRef={loggerPopRef}
          threadPopRef={threadPopRef}
          messagePopRef={messagePopRef}
          onStdFiltersEnabledChange={setStdFiltersEnabled}
          onFilterChange={setFilter}
          onOnlyMarkedChange={(nv) => {
            setOnlyMarked(nv);
            try {
              void window.api.settingsSet({ onlyMarked: nv });
            } catch (err) {
              logger.error("Persisting onlyMarked setting failed:", err);
            }
          }}
          onShowLoggerHistChange={(show) => {
            if (show) setShowSearchHist(false);
            setShowLoggerHist(show);
          }}
          onShowThreadHistChange={(show) => {
            if (show) setShowSearchHist(false);
            setShowThreadHist(show);
          }}
          onShowMessageHistChange={(show) => {
            if (show) setShowSearchHist(false);
            setShowMessageHist(show);
          }}
          addFilterHistory={addFilterHistory}
          onShowDcDialog={() => setShowDcDialog(true)}
          onShowTimeDialog={openTimeFilterDialog}
          onClearAllFilters={() => {
            setSearch("");
            setFilter({
              level: "",
              logger: "",
              thread: "",
              service: "",
              message: "",
            });
            setOnlyMarked(false);
            try {
              void window.api.settingsSet({ onlyMarked: false });
            } catch {}
            try {
              (TimeFilter as any).reset?.();
            } catch (e) {
              logger.error("Resetting TimeFilter failed:", e);
            }
          }}
          search={search}
          onApplyProfile={(profile) => {
            setFilter({
              level: profile.filters.level,
              logger: profile.filters.logger,
              thread: profile.filters.thread,
              service: "",
              message: profile.filters.message,
            });
            setSearch(profile.filters.search || "");
            setStdFiltersEnabled(profile.filters.stdFiltersEnabled);
            // Apply MDC filters if available
            if (
              profile.filters.mdcFilters &&
              profile.filters.mdcFilters.length > 0
            ) {
              try {
                for (const mdc of profile.filters.mdcFilters) {
                  (DiagnosticContextFilter as any).addMdcEntry(
                    mdc.key,
                    mdc.value,
                  );
                  if (mdc.active) {
                    (DiagnosticContextFilter as any).activateMdcEntry(
                      mdc.key,
                      mdc.value,
                    );
                  }
                }
                (DiagnosticContextFilter as any).setEnabled(true);
              } catch (e) {
                logger.error("Applying MDC filters from profile failed:", e);
              }
            }
          }}
          getMdcFilters={() => {
            try {
              return DiagnosticContextFilter.getDcEntries().map((e) => ({
                key: e.key,
                value: e.val,
                active: e.active,
              }));
            } catch {
              return [];
            }
          }}
          esBusy={esBusy}
        />
        <div className="section">
          {(() => {
            const entries = DiagnosticContextFilter.getDcEntries();
            const total = entries.length;
            const active = entries.filter((e) => e.active).length;
            const enabled = DiagnosticContextFilter.isEnabled() && active > 0;
            if (total === 0) return null;
            return (
              <span
                className="status"
                title={
                  enabled
                    ? t("toolbar.dcFilterActive", { count: String(active) })
                    : t("toolbar.dcFilterInactive", { count: String(total) })
                }
              >
                {enabled
                  ? t("toolbar.dcFilterActive", { count: String(active) })
                  : t("toolbar.dcFilterInactive", { count: String(total) })}
              </span>
            );
          })()}
          {(() => {
            try {
              const s = TimeFilter.getState();
              const show = !!(
                s &&
                s.enabled &&
                (esBusy || esElasticCountAll > 0 || esPitSessionId)
              );
              if (!show) return null;
              return (
                <span className="status" title={t("toolbar.elasticActive")}>
                  {t("toolbar.elasticActive")}
                </span>
              );
            } catch {
              return null;
            }
          })()}
          {esBusy && (
            <span className="status" title="Ladefortschritt Elasticsearch">
              {t("toolbar.elasticLoading", {
                loaded: String(esLoaded),
                target: String(esTarget),
                percent: String(Math.max(0, Math.min(100, esPct))),
              })}
            </span>
          )}
          {!esBusy && esHasMore && (
            <button
              style={{ marginLeft: "8px" }}
              title={t("toolbar.elasticLoadMoreTooltip")}
              onClick={async () => {
                if (esBusy) return;
                const token = esNextSearchAfter;
                if (
                  !esPitSessionId &&
                  (!token || !Array.isArray(token) || token.length === 0)
                )
                  return;
                await withBusy(async () => {
                  setEsBusy(true);
                  try {
                    const f: Partial<ElasticFormState> = lastEsForm || {};
                    const mode = (f?.mode || "relative") as
                      | "relative"
                      | "absolute";
                    // Lade eine weitere Batch von elasticSize Einträgen (kein Limit mehr)
                    const batchSize = elasticSize || 1000;
                    const opts: ElasticSearchOptions = {
                      url: elasticUrl || undefined,
                      size: batchSize,
                      index: f?.index || undefined,
                      sort: f?.sort || undefined,
                      duration: mode === "relative" ? f?.duration : undefined,
                      from: mode === "absolute" ? f?.from : undefined,
                      to: mode === "absolute" ? f?.to : undefined,
                      application_name: f?.application_name,
                      logger: f?.logger,
                      level: f?.level,
                      environment: f?.environment,
                      message: f?.message,
                      environmentCase: f?.environmentCase || "original",
                      allowInsecureTLS: !!f?.allowInsecureTLS,
                      ...(token && Array.isArray(token) && token.length > 0
                        ? { searchAfter: token as Array<string | number> }
                        : {}),
                      pitSessionId: esPitSessionId || undefined,
                    };
                    const messageFilter = f?.message || "";
                    const res = await window.api.elasticSearch(opts);
                    if (res?.ok) {
                      if (Array.isArray(res.entries) && res.entries.length) {
                        // Keine Kapazitätsbeschränkung mehr - alle geladenen Einträge hinzufügen
                        appendElasticCapped(
                          res.entries as any[],
                          res.entries.length, // Alle Einträge verwenden
                          { messageFilter },
                        );
                      }
                      setEsHasMore(!!res.hasMore);
                      setEsNextSearchAfter(
                        (res.nextSearchAfter as any) || null,
                      );
                      setEsPitSessionId(
                        ((res as any)?.pitSessionId as string) ||
                          esPitSessionId ||
                          null,
                      );
                      if (typeof (res as any)?.total === "number")
                        setEsTotal(Number((res as any).total));
                      // PIT-Session nur beenden, wenn keine weiteren Ergebnisse vorhanden
                      if (!res.hasMore) setEsPitSessionId(null);
                    } else {
                      // Check if this is a feature-disabled error
                      const errorMsg =
                        (res as any)?.error || t("status.errorUnknown");
                      if (!handleFeatureError(errorMsg)) {
                        showAlert(
                          t("status.elasticError", { message: errorMsg }),
                        );
                      }
                    }
                  } finally {
                    setEsBusy(false);
                  }
                });
              }}
            >
              {t("toolbar.elasticLoadMore")}{" "}
              {esTotal != null && esTotal > esLoaded
                ? `(${esTotal - esLoaded})`
                : ""}
            </button>
          )}
          {esTotal != null && (
            <span
              className="status"
              title={
                t("toolbar.elasticLoadedTooltip", {
                  loaded: String(esLoaded),
                  total: String(esTotal),
                }) + (esHasMore ? t("toolbar.elasticMoreAvailable") : "")
              }
            >
              {t("toolbar.elasticLoaded", {
                loaded: String(esLoaded),
                total: String(esTotal),
              })}
            </span>
          )}
        </div>
      </header>

      {/* Resize-Indikator für Detail-Panel */}
      {resizeHeight !== null && (
        <div
          className="resize-indicator"
          style={{ bottom: resizeHeight + 20 + "px" }}
        >
          {resizeHeight}px
        </div>
      )}

      {/* Hauptlayout: Liste + Overlay-Details */}
      <div className="layout" ref={layoutRef}>
        {/* Listen-Header */}
        <div
          className="list"
          ref={parentRef as any}
          tabIndex={0}
          role="listbox"
          aria-label={t("list.ariaLabel")}
          onKeyDown={onListKeyDown as any}
          onScroll={handleListScroll as any}
          onMouseDown={(ev) => {
            try {
              // Stelle sicher, dass die Liste fokussiert ist wenn sie geklickt wird
              if ((parentRef.current as any)?.focus && !ev.defaultPrevented) {
                (parentRef.current as any).focus({ preventScroll: true });
              }
            } catch (err) {
              logger.warn("onMouseDown focus set failed:", err);
            }
          }}
        >
          <div className="list-header">
            <div className="cell">
              {t("list.header.timestamp")}
              <div
                className="resizer"
                onMouseDown={(e) => onColMouseDown("ts", e)}
              />
            </div>
            <div className="cell" style={{ textAlign: "center" }}>
              {t("list.header.level")}
              <div
                className="resizer"
                onMouseDown={(e) => onColMouseDown("lvl", e)}
              />
            </div>
            <div className="cell">
              {t("list.header.logger")}
              <div
                className="resizer"
                onMouseDown={(e) => onColMouseDown("logger", e)}
              />
            </div>
            <div className="cell">{t("list.header.message")}</div>
          </div>
          {/* Virtualized rows */}
          <div
            style={{
              height: totalHeight + "px",
              position: "relative",
              /* FIX: Stelle sicher dass Events in virtualisierte Zeilen durchgeleitet werden */
              pointerEvents: "auto",
              /* Performance: contain für besseres Layout-Verhalten */
              contain: "strict",
            }}
          >
            {virtualItems.map((vi: any) => {
              const viIndex =
                typeof vi?.index === "number" ? (vi.index as number) : -1;
              if (viIndex < 0 || viIndex >= filteredIdx.length) return null;
              const globalIdx: number = filteredIdx[viIndex]!;
              const e: RendererLogEntry | undefined = entries[globalIdx];
              if (!e) return null;
              const isSel = selected.has(globalIdx);
              const markColor = e._mark || e.color;
              const y: number =
                typeof vi?.start === "number" ? (vi.start as number) : 0;
              const key = (vi && vi.key) || `row-${globalIdx}`;

              // Use memoized LogRow component with stable callbacks for better performance
              return (
                <LogRow
                  key={key}
                  index={viIndex}
                  globalIdx={globalIdx}
                  entry={e}
                  isSelected={isSel}
                  rowHeight={rowHeight}
                  yOffset={y}
                  markColor={markColor}
                  search={search}
                  onSelect={handleRowSelect}
                  onContextMenu={handleRowContextMenu}
                  highlightFn={stableHighlightFn}
                  t={t}
                />
              );
            })}
            {countFiltered === 0 && entries.length === 0 && (
              <div className="list-empty">
                <div className="list-empty-icon">📋</div>
                <div className="list-empty-title">Bereit für Logs</div>
                <div className="list-empty-hint">
                  Ziehe Log-Dateien hierher, starte den TCP-Server oder verbinde
                  dich mit Elasticsearch.
                </div>
              </div>
            )}
            {countFiltered === 0 && entries.length > 0 && (
              <div className="list-empty">
                <div className="list-empty-icon">🔍</div>
                <div className="list-empty-title">Keine Treffer</div>
                <div className="list-empty-hint">
                  Die aktiven Filter zeigen keine Ergebnisse.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Overlay: Divider + Detailbereich */}
        <div className="overlay">
          <div
            className="divider"
            ref={(el) => (dividerElRef.current = el as any)}
          />
          <DetailPanel
            selectedEntry={selectedEntry}
            mdcPairs={mdcPairs}
            search={search}
            onAddMdcToFilter={addMdcToFilter}
            onFilterByLogger={filterByLogger}
            onFilterByThread={filterByThread}
          />
        </div>
      </div>

      {/* Kontextmenü */}
      <ContextMenu
        open={ctxMenu.open}
        x={ctxMenu.x}
        y={ctxMenu.y}
        ctxRef={ctxRef}
        palette={palette}
        pickerColor={pickerColor}
        onPickerColorChange={setPickerColor}
        onApplyMark={applyMarkColor}
        onAddCustomColor={addCustomColor}
        onAdoptTraceIds={adoptTraceIds}
        onCopyTsMsg={copyTsMsg}
      />

      {/* Hilfe-Dialog - lazy loaded */}
      <Suspense fallback={null}>
        <HelpDialog open={showHelpDlg} onClose={() => setShowHelpDlg(false)} />
      </Suspense>

      {/* Titel-Dialog - lazy loaded */}
      <Suspense fallback={null}>
        <TitleDialog
          open={showTitleDlg}
          onClose={() => setShowTitleDlg(false)}
        />
      </Suspense>

      {/* Alert-Dialog für Feature-Warnungen */}
      <AlertDialog
        open={alertState.open}
        title={alertState.title}
        message={alertState.message}
        type={alertState.type}
        onClose={closeAlert}
      />

      {/* Update-Benachrichtigung */}
      <UpdateNotification />

      {/* Command Palette - lazy loaded */}
      <Suspense fallback={null}>
        <CommandPalette
          open={showCommandPalette}
          onClose={() => setShowCommandPalette(false)}
          commands={commands}
        />
      </Suspense>

      {/* Trace Timeline - lazy loaded */}
      {showTraceTimeline && traceTimelineId && (
        <Suspense fallback={null}>
          <TraceTimeline
            entries={filteredIdx.map((i) => entries[i]).filter(Boolean)}
            traceId={traceTimelineId}
            onClose={() => setShowTraceTimeline(false)}
            onEntryClick={(entry) => {
              if (entry._id !== undefined) {
                setSelected(new Set([entry._id]));
                // Scroll to entry
                const idx = filteredIdx.indexOf(entry._id);
                if (idx >= 0) {
                  virtualizer.scrollToIndex(idx, { align: "center" });
                }
              }
              setShowTraceTimeline(false);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
