// NOTE: IPC calls now use the typed wrapper from ../utils/typedApi
// See extracted hooks in src/hooks/ and components in src/renderer/components/
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
import { lazy, Suspense } from "preact/compat";
import type { ElasticSearchOptions, Settings } from "../types/ipc";
import {
  getSettings,
  patchSettings,
  patchSettingsQuiet,
  windowPermsGet,
  openFiles as typedOpenFiles,
  parsePaths as typedParsePaths,
  parseRawDrops as typedParseRawDrops,
  tcpStart as typedTcpStart,
  tcpStop as typedTcpStop,
  httpLoadOnce as typedHttpLoadOnce,
  httpStartPoll as typedHttpStartPoll,
  httpStopPoll as typedHttpStopPoll,
  elasticSearch as typedElasticSearch,
  elasticClosePit as typedElasticClosePit,
  chooseExportPath as typedChooseExportPath,
  saveExportFile as typedSaveExportFile,
  autoUpdaterSetAllowPrerelease as typedAutoUpdaterSetAllowPrerelease,
  appRelaunch as typedAppRelaunch,
  onAppend as typedOnAppend,
  onMenu as typedOnMenu,
  onTcpStatus as typedOnTcpStatus,
  onWindowFocus as typedOnWindowFocus,
} from "../utils/typedApi";
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
  exportToCsv,
  exportToMarkdown,
  exportToNdjson,
} from "../utils/exportFormats";
import {
  setupDebugFunctions,
  setDebugEntriesRef,
  setDebugFilteredIdxRef,
} from "../utils/debugFunctions";

// Import refactored constants
import { BASE_MARK_COLORS } from "../constants";

// Import refactored utilities
import { entrySignature } from "../utils/entryUtils";
import { nativeConfirm } from "../utils/nativeDialog";

// Import refactored hooks
import {
  useDebouncedValueWithFlush,
  useFilterState,
  useHistoryPopovers,
  useAlerts,
  useConfirmDialog,
  useToasts,
  useAlertRules,
  useAlertRunner,
  useFileWatcher,
  useHttpTail,
  useResizeHandlers,
  useEntryManagement,
  useCommands,
  useFilterWorker,
} from "../hooks";

// Import refactored components - core components loaded eagerly
import {
  AlertDialog,
  BookmarksPopover,
  ConfirmDialog,
  ContextMenu,
  DetailPanel,
  FilterSection,
  ToastStack,
  UpdateNotification,
  SearchBar,
  ActiveFilterChips,
  StatusSection,
} from "./components";
import { SkeletonLoader } from "./components/SkeletonLoader";
import { ElasticStatusBar } from "./components/ElasticStatusBar";
import { JSX } from "preact/jsx-runtime";
import { buildDemoEntries, LOGBACK_TCP_SNIPPET } from "./onboardingData";

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
const HttpTailDialog = lazy(() =>
  import("./components/HttpDialogs").then((m) => ({
    default: m.HttpTailDialog,
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
const AlertsDialog = lazy(() =>
  import("./components/AlertsDialog").then((m) => ({
    default: m.AlertsDialog,
  })),
);
const StatsDialog = lazy(() =>
  import("./components/StatsDialog").then((m) => ({ default: m.StatsDialog })),
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
  // In-app confirm dialog (replaces native window.confirm)
  const {
    state: confirmState,
    onConfirm: confirmOnConfirm,
    onCancel: confirmOnCancel,
  } = useConfirmDialog();
  // Non-blocking toast notifications (success/info confirmations)
  const toaster = useToasts();

  // QW-11 / A11Y-3: aggregated aria-live announcement for incoming logs.
  // Screen readers receive a debounced summary like "+12 INFO, +1 ERROR" every ~2s.
  const [a11yAnnouncement, setA11yAnnouncement] = useState<string>("");
  const a11yPendingRef = useRef<Record<string, number>>({});
  const a11yTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announceAppend = useCallback(
    (newEntries: ReadonlyArray<{ level?: string | null }> | undefined) => {
      if (!newEntries || newEntries.length === 0) return;
      const pend = a11yPendingRef.current;
      for (const e of newEntries) {
        const lvl = (e?.level || "OTHER").toString().toUpperCase();
        pend[lvl] = (pend[lvl] || 0) + 1;
      }
      if (a11yTimerRef.current) return;
      a11yTimerRef.current = setTimeout(() => {
        a11yTimerRef.current = null;
        const counts = a11yPendingRef.current;
        a11yPendingRef.current = {};
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        if (total === 0) return;
        const summary = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([lvl, n]) => `+${n} ${lvl}`)
          .join(", ");
        setA11yAnnouncement(`${total} – ${summary}`);
      }, 2000);
    },
    [],
  );
  // Alert rules (persisted via IPC) + evaluator hooked into the append-pipeline.
  const alertRulesHook = useAlertRules();
  const alertRunner = useAlertRunner({
    rules: alertRulesHook.rules,
    onEvent: (ev) => {
      const sev =
        ev.severity === "critical"
          ? "error"
          : ev.severity === "warning"
            ? "warning"
            : "info";
      toaster.show(` ${ev.ruleName} – ${ev.triggeringMessage.slice(0, 120)}`, {
        severity: sev,
        durationMs: ev.severity === "critical" ? 10_000 : 6_000,
      });
    },
  });
  const [showAlertsDialog, setShowAlertsDialog] = useState<boolean>(false);
  const [showStatsDialog, setShowStatsDialog] = useState<boolean>(false);

  // Sprint 5 – C3: Tail/Watch mode. Show toast on rotation/error.
  const fileWatcher = useFileWatcher({
    onStatus: (payload) => {
      if (payload.type === "rotated") {
        toaster.info(
          ` ${
            payload.filePath.split(/[\\/]/).pop() || payload.filePath
          }: ${t("watch.rotated") || "Datei rotiert – tail wird fortgesetzt"}`,
        );
      } else if (payload.type === "error") {
        toaster.error(
          `${t("watch.error") || "Watch-Fehler"}: ${payload.message || ""}`,
        );
      }
    },
  });

  // HTTP Tail – incremental Range-based polling (e.g. Spring Boot Actuator).
  const httpTail = useHttpTail({
    onStatus: (payload) => {
      if (payload.type === "rotated") {
        toaster.info(`${payload.url}: ${t("httpTail.rotated")}`);
      } else if (payload.type === "error") {
        toaster.error(`${t("httpTail.error")}: ${payload.message || ""}`);
      } else if (payload.type === "started") {
        toaster.success(`${t("httpTail.started")}: ${payload.url}`);
      }
    },
  });
  const [showHttpTailDialog, setShowHttpTailDialog] = useState<boolean>(false);

  // Stable ref that always points to the latest httpTail API so the (mount-only)
  // menu IPC handler below can stop tails even after re-renders. Without this,
  // the closure captures the initial (empty) tails list and "Stop all HTTP
  // tails" silently does nothing – particularly visible when the URL is
  // unreachable and the user has no other UI to stop the tail.
  const httpTailRef = useRef(httpTail);
  httpTailRef.current = httpTail;

  // Notify the main process whenever the active HTTP-tail count changes so
  // the native Network menu can enable/disable the "HTTP-Tail stoppen" item.
  useEffect(() => {
    try {
      const api = (
        window as unknown as {
          api?: { httpTailNotifyActiveCount?: (n: number) => void };
        }
      ).api;
      api?.httpTailNotifyActiveCount?.(httpTail.tails.length);
    } catch {
      // ignore – best effort, menu just won't reflect state
    }
  }, [httpTail.tails.length]);

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

  // Debounced Filter-Werte für bessere Performance beim Tippen.
  // Etwas höhere Verzögerung (350ms) als komfortabler "type-to-filter"-Fallback;
  // Enter (flush) wendet die Eingabe sofort an, ohne auf den Timer zu warten.
  const [debouncedSearch, flushSearch] = useDebouncedValueWithFlush(
    search,
    350,
  );
  const [debouncedFilter, flushFilter] = useDebouncedValueWithFlush(
    filter,
    350,
  );

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
    const off = DiagnosticContextFilter.onChange(() =>
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
    const off = TimeFilter.onChange(() => setTimeVersion((v) => v + 1));
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
      lastTimestampField: string;
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
      let lastTimestampField = "";
      try {
        const r = await getSettings();
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
        if (r && typeof r.lastTimestampField === "string")
          lastTimestampField = r.lastTimestampField;
      } catch {
        // ignore
      }
      return { lastApp, lastEnv, lastIndex, lastEnvCase, lastTimestampField };
    };

    try {
      const s = TimeFilter.getState();
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
      const { lastApp, lastEnv, lastIndex, lastEnvCase, lastTimestampField } =
        await getLasts();
      // Bestimme zuletzt verwendete Werte aus der letzten Suche (falls vorhanden)
      const prev: Partial<ElasticFormState> = lastEsForm || {};
      const initIndex = String(prev.index || lastIndex || "");
      const initEnvCase = String(
        prev.environmentCase ||
          lastEnvCase ||
          timeForm.environmentCase ||
          "original",
      );
      const initTsField = String(
        prev.timestampField ||
          lastTimestampField ||
          timeForm.timestampField ||
          "",
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
        timestampField: initTsField,
      });
    } catch {
      const { lastApp, lastEnv, lastIndex, lastEnvCase, lastTimestampField } =
        await getLasts();
      const prev: Partial<ElasticFormState> = lastEsForm || {};
      const initIndex = String(prev.index || lastIndex || "");
      const initEnvCase = String(
        prev.environmentCase ||
          lastEnvCase ||
          timeForm.environmentCase ||
          "original",
      );
      const initTsField = String(
        prev.timestampField ||
          lastTimestampField ||
          timeForm.timestampField ||
          "",
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
        timestampField: initTsField,
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
          patchSettingsQuiet({ histAppName: list });
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
          patchSettingsQuiet({ histEnvironment: list });
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
          patchSettingsQuiet({ histIndex: list });
        } catch (e) {
          logger.error("Failed to save histIndex settings:", e);
          showAlert(t("errors.histIndexSaveFailed"));
        }
        return list;
      });
    }
  }

  const [tcpStatus, setTcpStatus] = useState<string>(t("status.tcpStopped"));
  const [httpStatus, setHttpStatus] = useState<string>(
    t("status.httpPollStopped"),
  );
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
    heapSizeMB: 4096,
  });
  // Store original heap size to detect changes requiring restart
  const [originalHeapSizeMB, setOriginalHeapSizeMB] = useState<number>(4096);
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
      const r = await getSettings();
      if (r && typeof r.httpUrl === "string") {
        url = r.httpUrl;
        setHttpUrl(url);
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
      const r = await getSettings();
      if (r) {
        if (typeof r.httpUrl === "string") {
          url = r.httpUrl;
          setHttpUrl(url);
        }
        const int = r.httpPollInterval ?? httpInterval;
        if (int != null) {
          interval = Number(int) || 5;
          setHttpInterval(interval);
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
        patchSettingsQuiet({ customMarkColors: list });
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
            parentRef.current?.focus({ preventScroll: true });
          }
        }, 0);
      } catch (err) {
        logger.warn("Failed to restore focus after context menu:", err);
      }
    } catch (err) {
      logger.error("openContextMenu error:", err);
    }
  }

  // Markierung anwenden/entfernen + Persistenz.
  // Performance-Quick-Win #2: Es wird KEIN `_mark`-Feld mehr in die
  // Entry-Objekte geschrieben. Stattdessen ist die `marksMap` (signature
  // → color) die Single-Source-of-Truth. LogRow, DetailPanel, Filter
  // (`onlyMarked`) und Bookmarks lesen die Markierung über die Map.
  // Vorteil: kein Vollscan über `entries` + kein Re-Filter pro Mark-Change.
  function applyMarkColor(color?: string) {
    if (!entries.length) {
      closeContextMenu();
      return;
    }
    const newMap: Record<string, string> = { ...marksMap };
    for (const i of selected) {
      if (i >= 0 && i < entries.length) {
        const e = entries[i];
        if (!e) continue;
        const sig = entrySignature(e);
        if (color) {
          newMap[sig] = color;
        } else {
          delete newMap[sig];
        }
      }
    }
    setMarksMap(newMap);
    try {
      patchSettingsQuiet({ marksMap: newMap });
    } catch {}
    closeContextMenu();
  }
  // Hinweis: Der frühere Sync-Effect, der bei jeder marksMap-Änderung das
  // gesamte `entries`-Array via setEntries(prev.map(...)) rebuildete, ist
  // entfernt. Er triggerte einen Vollscan + Re-Filter im UtilityProcess.
  // Markierungen werden nun direkt aus `marksMap` zur Render-Zeit
  // aufgelöst (siehe LogRow/DetailPanel-Aufrufe weiter unten).

  /**
   * Hydratisiert `marksMap` aus frisch importierten Einträgen, die bereits
   * eine Mark-Farbe (z. B. aus einem JSON/NDJSON-Re-Import einer früheren
   * Lumberjack-Export-Datei) im Feld `_mark` mitbringen.
   *
   * Wird nach jedem `appendEntries`-Aufruf aus einem Import-Pfad
   * aufgerufen. Berührt den State nur, wenn tatsächlich neue Marks
   * gefunden wurden – Tail-Streaming-Batches (TCP/HTTP) bleiben damit
   * vollständig kostenfrei.
   */
  const hydrateMarksFromEntries = useCallback(
    (importedEntries: any[] | undefined | null) => {
      if (!importedEntries || importedEntries.length === 0) return;
      let next: Record<string, string> | null = null;
      for (let i = 0; i < importedEntries.length; i++) {
        const e = importedEntries[i];
        const m = e?._mark;
        if (typeof m !== "string" || !m) continue;
        const sig = entrySignature(e);
        if (!sig) continue;
        if ((next ?? marksMap)[sig] === m) continue;
        if (!next) next = { ...marksMap };
        next[sig] = m;
      }
      if (next) {
        setMarksMap(next);
        try {
          patchSettingsQuiet({ marksMap: next });
        } catch {
          /* ignore */
        }
      }
    },
    [marksMap],
  );

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
              DiagnosticContextFilter.addMdcEntry("TraceID", v);
              added.add(v);
            }
          }
        }
      }
      if (added.size) DiagnosticContextFilter.setEnabled(true);
    } catch (e) {
      logger.warn("adoptTraceIds failed:", e);
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
    const dcState = DiagnosticContextFilter.getState();
    const dcFilterEntries = (dcState.entries || []).map(
      (e: { key: string; value: string; active: boolean }) => ({
        key: e.key,
        value: e.value,
        active: e.active,
      }),
    );
    const dcFilterEnabled = dcState.enabled;

    // Build time filter state from TimeFilter
    const timeState = TimeFilter.getState();
    const timeFilterEnabled = timeState.enabled;
    const timeFilterFrom = timeState.from || undefined;
    const timeFilterTo = timeState.to || undefined;

    hasTriggeredFilterRef.current = true;
    filterEntries(
      entries,
      {
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
      },
      // marksMap nur für `onlyMarked` relevant – sonst wird es im Worker
      // ohnehin ignoriert. Übergabe ist zustandslos und billig.
      onlyMarked ? marksMap : undefined,
    );
  }, [
    entries,
    stdFiltersEnabled,
    debouncedFilter,
    dcVersion,
    timeVersion,
    onlyMarked,
    searchMode,
    filterEntries,
    // marksMap wirkt sich nur auf das Ergebnis aus, wenn `onlyMarked` aktiv
    // ist. Anderfalls wäre eine Aufnahme in die Deps eine unnötige
    // Re-Filter-Quelle bei jedem Mark/Unmark-Klick.
    onlyMarked ? marksMap : null,
  ]);

  // Use worker results for filtered indices
  const filteredIdx = workerFilteredIdx;

  // Reverse-Index globalIdx → vi für O(1)-Lookup statt O(n) `indexOf`.
  // Performance-Quick-Win #7: Bisher verursachte jeder Tastendruck
  // (moveSelectionBy/gotoMarked/gotoSearchMatch/Range-Selection) einen
  // linearen Scan über bis zu 300k Einträge.
  const filteredIdxLookup = useMemo(() => {
    const m = new Map<number, number>();
    for (let vi = 0; vi < filteredIdx.length; vi++) {
      m.set(filteredIdx[vi]!, vi);
    }
    return m;
  }, [filteredIdx]);
  const viOfGlobal = useCallback(
    (g: number | null | undefined): number => {
      if (g == null) return -1;
      const v = filteredIdxLookup.get(g);
      return v === undefined ? -1 : v;
    },
    [filteredIdxLookup],
  );

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
        logger.debug("[filter-diag] Filter stats:", workerFilterStats);
        if (workerFilterStats.passed === 0 && workerFilterStats.total > 0) {
          console.warn("[filter-diag] WARNING: All entries filtered out!", {
            total: workerFilterStats.total,
            onlyMarked,
            stdFiltersEnabled,
            debouncedFilter,
            dcFilterEnabled: DiagnosticContextFilter.isEnabled(),
          });
        }
      }
    }
  }, [workerFilterStats, onlyMarked, stdFiltersEnabled, debouncedFilter]);

  // Refs to track current values for menu handlers (avoid stale closures)
  const filteredIdxRef = useRef<number[]>(filteredIdx);
  const entriesRef = useRef<any[]>(entries);
  // marksMapRef ist nötig, weil der Application-Menu-Handler (typedOnMenu)
  // einmalig in einem useEffect mit []-Deps registriert wird. Ohne diesen Ref
  // würde `exportCurrentView` über den Menu-Pfad auf eine stale `marksMap`-
  // Closure zugreifen → exportierte Einträge hätten `markColor: null`,
  // obwohl sie sichtbar markiert sind.
  const marksMapRef = useRef<Record<string, string>>(marksMap);
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
  useEffect(() => {
    marksMapRef.current = marksMap;
  }, [marksMap]);

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
          patchSettingsQuiet({ follow: false });
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
  // Use existing filteredIdxRef to avoid dependency on filteredIdx which changes frequently
  const getItemKey = useCallback((index: number) => {
    const globalIdx = filteredIdxRef.current[index];
    return globalIdx !== undefined ? `row-${globalIdx}` : `row-temp-${index}`;
  }, []);

  // Only create virtualizer if we have a scroll element to prevent initialization issues
  const hasScrollElement = parentRef.current !== null;

  // Dynamic overscan: increase for large datasets to prevent visual gaps during fast scrolling
  // For 300k+ entries, use higher overscan to keep scrolling smooth
  const dynamicOverscan =
    filteredIdx.length > 100000 ? 25 : filteredIdx.length > 50000 ? 20 : 15;

  const virtualizer = useVirtualizer({
    count: hasScrollElement ? filteredIdx.length : 0,
    getScrollElement,
    estimateSize,
    // Erhöhe overscan für glatteres Scrollen bei schnellem Scrollen
    overscan: dynamicOverscan,
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
    const viIndex = viOfGlobal(currentSelected);
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
          parentRef.current?.focus();
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
      parentRef.current?.focus();
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
      parentRef.current?.focus();
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
            const a = viOfGlobal(lastClicked.current);
            const b = viOfGlobal(idx);
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
    if (!Object.keys(marksMap).length) return out;
    const len = filteredIdx.length;
    // Performance: Bei sehr großen Listen nur die ersten 100k durchsuchen
    // um UI-Freezes zu vermeiden
    const searchLimit = Math.min(len, 100_000);
    for (let vi = 0; vi < searchLimit; vi++) {
      const idx = filteredIdx[vi]!;
      const e = entries[idx];
      if (!e) continue;
      // #2: Markierung kommt aus marksMap, nicht mehr aus e._mark.
      if (marksMap[entrySignature(e)]) out.push(vi);
    }
    return out;
  }, [filteredIdx, entries, marksMap]);

  const searchMatchIdx = useMemo(() => {
    const s = String(debouncedSearch || "").trim();
    if (!s) return [] as number[];
    const out: number[] = [];
    const len = filteredIdx.length;
    // Performance: Bei sehr großen Listen nur die ersten 50k durchsuchen
    // für Search-Navigation, um UI-Freezes zu vermeiden
    const searchLimit = Math.min(len, 50_000);
    for (let vi = 0; vi < searchLimit; vi++) {
      const idx = filteredIdx[vi]!;
      const e = entries[idx];
      if (msgMatches(e?.message ?? "", s, { mode: searchMode })) out.push(vi);
    }
    return out;
  }, [debouncedSearch, filteredIdx, entries, searchMode]);

  function gotoMarked(dir: number) {
    if (!markedIdx.length) return;
    const curVi = selectedOneIdx != null ? viOfGlobal(selectedOneIdx) : -1;
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

  /**
   * Direct jump to a specific bookmark (used by the BookmarksPopover).
   * vi = virtual index (position in filteredIdx).
   */
  function gotoBookmark(vi: number) {
    const globalIdx = filteredIdx[vi];
    if (globalIdx == null) return;
    setSelected(new Set([globalIdx]));
    lastClicked.current = globalIdx;
    scrollToIndexCenter(vi);
  }

  // Bookmark items derived from markedIdx for the popover.
  const bookmarkItems = useMemo(() => {
    const MAX_PREVIEW = 200; // performance cap for popover
    const slice = markedIdx.slice(0, MAX_PREVIEW);
    return slice.map((vi) => {
      const e = entries[filteredIdx[vi]!];
      const msg = String(e?.message || "");
      // #2: Farbe aus marksMap statt aus e._mark.
      const color =
        (e ? marksMap[entrySignature(e)] : undefined) ||
        (e?._mark as string | undefined) ||
        "#3b82f6";
      return {
        vi,
        color,
        timestamp: fmtTimestamp(e?.timestamp),
        message: msg.length > 200 ? msg.slice(0, 200) + "…" : msg,
      };
    });
  }, [markedIdx, filteredIdx, entries, marksMap]);

  function gotoSearchMatch(dir: number) {
    if (!searchMatchIdx.length) return;
    const curVi = selectedOneIdx != null ? viOfGlobal(selectedOneIdx) : -1;
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
    const curVi = curGlobal != null ? viOfGlobal(curGlobal) : -1;

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
      const a = viOfGlobal(anchorGlobal);
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

  const onListKeyDown = (e: KeyboardEvent) => {
    if (!filteredIdx.length) return;
    // Nur reagieren, wenn Fokus auf der Liste liegt
    // preventDefault stoppt Textcursor in Inputs außerhalb nicht, da wir nur bei Fokus der Liste sind
    try {
      // Standard Arrow Keys
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveSelectionBy(1, e.shiftKey);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        moveSelectionBy(-1, e.shiftKey);
      }
      // Vim-Style Navigation
      else if (e.key === "j" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        moveSelectionBy(1, e.shiftKey);
      } else if (e.key === "k" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        moveSelectionBy(-1, e.shiftKey);
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
      DiagnosticContextFilter.addMdcEntry(k, v ?? "");
      DiagnosticContextFilter.setEnabled(true);
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
  // Bookmarks (Lesezeichen) popover toggle – triggered by the mark-count badge.
  const [showBookmarks, setShowBookmarks] = useState<boolean>(false);

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
        const r = await getSettings();
        if (!r) {
          logger.warn("Failed to load settings: no settings returned");
          setSettingsLoaded(true);
          return;
        }
        if (r.tcpPort != null) setTcpPort(Number(r.tcpPort) || 5000);
        if (typeof r.httpUrl === "string") setHttpUrl(r.httpUrl);
        // Support both httpPollInterval (persisted) and httpInterval (legacy)
        const interval = r.httpPollInterval;
        if (interval != null) setHttpInterval(Number(interval) || 5);
        // Entfernt: Laden einer persistierten Logger-Historie, damit Verlauf nur temporär ist
        // if (Array.isArray(r.histLogger)) setHistLogger(r.histLogger);
        if (Array.isArray(r.histAppName)) setHistAppName(r.histAppName);
        if (Array.isArray(r.histEnvironment))
          setHistEnvironment(r.histEnvironment);
        // NEW: load histIndex
        if (Array.isArray(r.histIndex)) setHistIndex(r.histIndex);
        // Merke zuletzt verwendeten Environment-Case für Fallback im Dialog
        const lastEnvCase = r.lastEnvironmentCase || "original";
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
        if (typeof r.follow === "boolean") setFollow(r.follow);
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
        if (typeof r.onlyMarked === "boolean") setOnlyMarked(r.onlyMarked);
        rendererPerf.mark("settings-loaded");
      } catch (e) {
        logger.error("Error loading settings:", e);
      } finally {
        setSettingsLoaded(true);
        // Hide the splash screen now that app is ready
        const splash = document.getElementById("splash-screen");
        if (splash) {
          splash.classList.add("hidden");
          // Remove from DOM after transition completes
          setTimeout(() => splash.remove(), 300);
        }
      }
      // Per-Window Berechtigungen laden
      try {
        const perms = await windowPermsGet();
        if (perms?.ok) setCanTcpControlWindow(perms.canTcpControl !== false);
      } catch (e) {
        logger.warn("windowPermsGet failed:", e);
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
    let curHeapSizeMB = 4096;

    try {
      const r = await getSettings();
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
        if (typeof r.follow === "boolean") setFollow(r.follow);
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
        const interval = r.httpPollInterval;
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
    const mode: ThemeMode = ["light", "dark", "system"].includes(form.themeMode)
      ? (form.themeMode as ThemeMode)
      : "system";
    const patch: Partial<Settings> = {
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
        Number(form.elasticMaxParallel || elasticMaxParallel || 1),
      ),
      allowPrerelease: form.allowPrerelease,
      heapSizeMB: Math.max(
        512,
        Math.min(8192, Number(form.heapSizeMB || 4096)),
      ),
    };
    const newPass = String(form.elasticPassNew || "").trim();
    if (form.elasticPassClear) patch["elasticPassClear"] = true;
    else if (newPass) patch["elasticPassPlain"] = newPass;
    try {
      const res = await patchSettings(patch);
      if (!res || !res.ok) {
        showAlert(
          t("errors.saveFailed", {
            message: res?.error || t("status.errorUnknown"),
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
        await typedAutoUpdaterSetAllowPrerelease(form.allowPrerelease);
      } catch (e) {
        logger.warn("Failed to update auto-updater allowPrerelease:", e);
      }

      setShowSettings(false);

      // Check if heap size changed and ask for restart
      const newHeapSize = Math.max(
        512,
        Math.min(8192, Number(form.heapSizeMB || 4096)),
      );
      if (newHeapSize !== originalHeapSizeMB) {
        // Use setTimeout to allow the modal to close first
        setTimeout(() => {
          void (async () => {
            const shouldRestart = await nativeConfirm(
              t("settings.performance.restartRequired"),
            );
            if (shouldRestart) {
              void typedAppRelaunch();
            }
          })();
        }, 100);
      }
    } catch (e) {
      logger.error("Failed to save settings:", e);
      showAlert(
        t("errors.saveFailed", {
          message: e instanceof Error ? e.message : String(e),
        }),
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
    // Quick-Win #8: Diagnose-Logs auf dem IPC-Hot-Path nur im Dev-Build.
    // Vite ersetzt `process.env.NODE_ENV` statisch (siehe vite.config.mjs
    // `define`), sodass `DIAG` in Production zu `false` evaluiert und der
    // gesamte Diagnose-Block per Dead-Code-Elimination entfernt wird.
    const DIAG = process.env.NODE_ENV !== "production";
    try {
      {
        if (DIAG) console.warn("[renderer-diag] Setting up onAppend listener");
        const off = typedOnAppend((newEntries) => {
          if (DIAG) {
            console.warn(
              `[renderer-diag] Received IPC logs:append with ${newEntries?.length || 0} entries`,
            );
          }
          appendEntries(newEntries as any[]);
          announceAppend(newEntries as any[]);
          // Sprint 5: feed alert evaluator with new entries.
          try {
            if (Array.isArray(newEntries) && newEntries.length > 0) {
              alertRunner.evaluate(newEntries as any[]);
            }
          } catch (e) {
            logger.warn("[alerts] evaluation failed:", e);
          }
        });
        offs.push(off);
      }
    } catch (err) {
      console.error("[renderer-diag] Error setting up onAppend:", err);
    }
    try {
      {
        const off = typedOnMenu(async (cmd) => {
          try {
            const { type, tab } = (cmd as any) || ({} as any);
            switch (type) {
              case "open-files": {
                const paths = await typedOpenFiles();
                if (paths && paths.length) {
                  const res = await typedParsePaths(paths);
                  if (res?.ok) {
                    appendEntries(res.entries as any);
                    hydrateMarksFromEntries(res.entries as any[]);
                  }
                }
                break;
              }
              case "open-settings": {
                await openSettingsModal(tab || "tcp");
                break;
              }
              case "tcp-start": {
                try {
                  typedTcpStart(tcpPortRef.current);
                } catch (e) {
                  logger.error("Fehler beim Starten des TCP-Servers:", e);
                }
                break;
              }
              case "tcp-stop": {
                try {
                  typedTcpStop();
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
              case "http-tail-start": {
                setShowHttpTailDialog(true);
                break;
              }
              case "http-tail-stop-all": {
                void (async () => {
                  try {
                    // Read latest tails via ref to avoid stale closure
                    // (this handler is registered once with []-deps).
                    const current = httpTailRef.current;
                    const tails = current.tails.slice();
                    for (const tl of tails) {
                      await current.stop(tl.id);
                    }
                    if (tails.length > 0) {
                      toaster.info(t("httpTail.stoppedAll"));
                    }
                  } catch (err) {
                    logger.error("[menu] http-tail-stop-all failed:", err);
                  }
                })();
                break;
              }
              case "http-stop-poll": {
                console.warn(
                  "[menu] http-stop-poll received, httpPollIdRef.current =",
                  httpPollIdRef.current,
                );
                if (httpPollIdRef.current != null) {
                  console.warn("[menu] calling httpMenuStopPoll()");
                  void httpMenuStopPoll();
                } else {
                  console.warn(
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
                    patchSettingsQuiet({ follow: newVal });
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
      {
        const off = typedOnTcpStatus((st) => {
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
    // Handle window focus events to fix input issues when switching between windows
    try {
      {
        const off = typedOnWindowFocus(() => {
          // When window receives focus, force the browser to re-establish input interactivity.
          // This fixes the Electron issue where webContents has focus but the DOM doesn't
          // properly accept keyboard input until the user Alt-Tabs away and back.
          try {
            const active = document.activeElement;
            if (
              active &&
              active !== document.body &&
              active instanceof HTMLElement
            ) {
              // An element (e.g. an input) was focused – blur and re-focus it
              // to force the browser to re-establish keyboard input
              active.blur();
              requestAnimationFrame(() => {
                try {
                  active.focus();
                } catch {
                  /* ignore */
                }
              });
            } else {
              // No specific element focused – trigger a focus cycle on body
              // to ensure the document is ready to accept input
              document.body.blur();
              requestAnimationFrame(() => {
                try {
                  document.body.focus();
                } catch {
                  /* ignore */
                }
              });
            }
          } catch {
            // Ignore focus errors
          }
        });
        offs.push(off);
      }
    } catch (e) {
      logger.error("onWindowFocus setup failed:", e);
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
          const res = await typedParsePaths(paths);
          if (res?.ok) {
            appendEntries(res.entries as any);
            hydrateMarksFromEntries(res.entries as any[]);
          } else
            showAlertRef.current(
              tRef.current("errors.dropLoadError", {
                message: res?.error || tRef.current("status.errorUnknown"),
              }),
            );
        });
      },
      onActiveChange: (active) => setDragActive(active),
      onRawFiles: async (files) => {
        await withBusy(async () => {
          try {
            const res = await typedParseRawDrops(files);
            if (res?.ok) {
              appendEntries(res.entries as any);
              hydrateMarksFromEntries(res.entries as any[]);
            } else
              showAlertRef.current(
                tRef.current("errors.dropLoadError", {
                  message: res?.error || tRef.current("status.errorUnknown"),
                }),
              );
          } catch (e) {
            logger.error("Error reading files (drop raw data):", e);
            showAlertRef.current(
              tRef.current("errors.fileReadError", {
                message: e instanceof Error ? e.message : String(e),
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
  // Anzahl der im aktuellen Suchvorgang ABGERUFENEN ES-Einträge (inkl. bereits
  // vorhandener/deduplizierter). Wird bei jeder neuen Suche zurückgesetzt und
  // beim Nachladen ("Weitere laden") fortgeschrieben. Dient als "geladen"-Anzeige,
  // damit deduplizierte Einträge mitzählen und keine Abweichung zu "gefunden" entsteht.
  const [esLoadedCount, setEsLoadedCount] = useState<number>(0);
  const [esPitSessionId, setEsPitSessionId] = useState<string | null>(null);
  const esElasticCountAll = useMemo(() => {
    let cnt = 0;
    for (const e of entries) {
      const src = e?.source;
      if (typeof src === "string" && src.startsWith("elastic://")) cnt++;
    }
    return cnt;
  }, [entries]);

  // Min/Max timestamps across ALL entries (ignoring active filters), used by
  // the Elastic-Search-Dialog quick-select buttons ("older than" / "newer than").
  // Filters must NOT influence these values, otherwise the user cannot easily
  // load entries outside the current filter window.
  const entriesTsRange = useMemo(() => {
    let minTs: number | null = null;
    let maxTs: number | null = null;
    let minRaw: unknown = null;
    let maxRaw: unknown = null;
    for (const e of entries) {
      const raw = e?.timestamp;
      if (raw == null) continue;
      const t = new Date(raw as any).getTime();
      if (isNaN(t)) continue;
      if (minTs === null || t < minTs) {
        minTs = t;
        minRaw = raw;
      }
      if (maxTs === null || t > maxTs) {
        maxTs = t;
        maxRaw = raw;
      }
    }
    return { firstTs: minRaw, lastTs: maxRaw };
  }, [entries]);
  const esLoaded = esLoadedCount;
  const esTarget = Math.max(1, Number(elasticSize || 0));
  const esPct =
    esTotal && esTotal > 0
      ? Math.min(100, Math.round((esLoaded / esTarget) * 100))
      : Math.round((esLoaded / esTarget) * 100) || 0;

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

  function clearLogs() {
    // Sicherheitsabfrage über In-App-Dialog (keine native Dialog-Fokus-Bugs).
    if (entries && entries.length > 0) {
      void (async () => {
        const confirmed = await nativeConfirm(t("list.clearConfirmation"));
        if (!confirmed) return;
        doClearLogs();
      })();
      return;
    }
    doClearLogs();
  }

  function doClearLogs() {
    setEntries([]);
    setSelected(new Set());
    setNextId(1);
    setEsHasMore(false);
    setEsNextSearchAfter(null);
    setLastEsForm(null);
    setEsTotal(null);
    setEsLoadedCount(0);
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
        if (esPitSessionId) await typedElasticClosePit(esPitSessionId);
      } catch {}
      setEsPitSessionId(null);
    })().catch(() => {});
    try {
      LoggingStore.reset();
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
    // Auch marksMap muss über Ref gelesen werden – der App-Menu-Handler
    // (typedOnMenu) wird einmalig mit []-Deps registriert und würde sonst
    // permanent das initiale `{}` sehen → markColor wäre beim Export `null`.
    const currentMarksMap = marksMapRef.current;

    if (currentFilteredIdx.length === 0) {
      showAlert(t("errors.exportNoEntries"));
      return;
    }

    try {
      // First, show save dialog to let user choose format and path
      const pathResult = await typedChooseExportPath();
      if (!pathResult.ok || !pathResult.filePath) {
        // User canceled or error
        if (pathResult.error && pathResult.error !== "canceled") {
          showAlert(t("errors.exportFailed", { message: pathResult.error }));
        }
        return;
      }

      const format = pathResult.format || "ndjson";
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
          // #2: Mark-Farbe primär aus marksMap (Single-Source-of-Truth).
          markColor:
            (e ? currentMarksMap[entrySignature(e)] : undefined) ||
            e?._mark ||
            null,
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
      } else if (format === "ndjson" || format === "csv" || format === "md") {
        // Strukturierte Formate über exportFormats-Utilities. Mark-Farbe muss
        // dafür auf jedem Eintrag als `_mark` anliegen – wir injizieren sie
        // aus marksMap (Single-Source-of-Truth), damit auch in der aktuellen
        // Session manuell gesetzte Marks (die nicht mehr direkt in `e._mark`
        // landen) korrekt exportiert werden.
        const enriched = exportEntries.map((e) => {
          const mark = e
            ? currentMarksMap[entrySignature(e)] ||
              (e._mark as string | undefined)
            : undefined;
          return mark ? { ...e, _mark: mark } : e;
        });
        if (format === "ndjson") {
          content = exportToNdjson(enriched);
        } else if (format === "csv") {
          content = exportToCsv(enriched);
        } else {
          content = exportToMarkdown(enriched, {
            exportedAt: new Date().toISOString(),
            total: currentEntries.length,
          });
        }
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
          const markColor =
            (e ? currentMarksMap[entrySignature(e)] : undefined) ||
            (e?._mark as string | undefined);
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
<html lang="${locale}">
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
  <h1> Lumberjack Log Export</h1>
  <div class="meta">
    ${t("export.exported")}: ${new Date().toLocaleString()}<br>
    ${t("export.entries")}: ${exportEntries.length} (${t("export.filteredOf", { total: String(currentEntries.length) })})
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
      const result = await typedSaveExportFile(pathResult.filePath, content);
      if (!result.ok) {
        showAlert(t("errors.exportFailed", { message: result.error || "" }));
      } else {
        // Non-blocking success feedback
        const fileName =
          pathResult.filePath.split(/[\\/]/).pop() || pathResult.filePath;
        toaster.success(
          t("export.success", {
            count: String(exportEntries.length),
            file: fileName,
          }) ||
            `Export erfolgreich: ${exportEntries.length} Einträge → ${fileName}`,
        );
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
    logger.debug(
      "[httpMenuStopPoll] called, httpPollIdRef.current =",
      currentPollId,
    );
    if (currentPollId == null) {
      logger.debug("[httpMenuStopPoll] currentPollId is null, returning early");
      return;
    }
    logger.debug(
      "[httpMenuStopPoll] calling window.api.httpStopPoll with id =",
      currentPollId,
    );
    const r = await typedHttpStopPoll(currentPollId);
    logger.debug("[httpMenuStopPoll] result =", r);
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
      logger.warn("MDCListener.startListening failed:", e);
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
            parentRef.current?.focus();
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
    onOpenAlerts: () => setShowAlertsDialog(true),
    onOpenStats: () => setShowStatsDialog(true),
    onTailFile: async () => {
      try {
        const result = await typedOpenFiles();
        if (!result || result.length === 0) return;
        // Watch each picked file (typically just one).
        for (const filePath of result) {
          const res = await fileWatcher.start(filePath, { emitInitial: true });
          if (res.ok) {
            const fileName = filePath.split(/[\\/]/).pop() || filePath;
            toaster.success(
              t("watch.started", { file: fileName }) ||
                ` Tail aktiv: ${fileName}`,
            );
          } else {
            showAlert(
              t("watch.startFailed", { message: res.error || "" }) ||
                `Tail konnte nicht gestartet werden: ${res.error || ""}`,
            );
          }
        }
      } catch (err) {
        logger.error("Tail start failed:", err);
      }
    },
    onStopAllWatchers: async () => {
      try {
        for (const w of fileWatcher.watchers) {
          await fileWatcher.stop(w.id);
        }
        toaster.info(t("watch.stoppedAll") || "Alle Tail-Watcher gestoppt");
      } catch (err) {
        logger.error("Stop watchers failed:", err);
      }
    },
    hasActiveWatchers: fileWatcher.watchers.length > 0,
    onOpenHttpTail: () => setShowHttpTailDialog(true),
    onStopAllHttpTails: async () => {
      try {
        for (const t2 of httpTail.tails) {
          await httpTail.stop(t2.id);
        }
        toaster.info(t("httpTail.stoppedAll"));
      } catch (err) {
        logger.error("Stop HTTP tails failed:", err);
      }
    },
    hasActiveHttpTails: httpTail.tails.length > 0,

    // File
    onOpenFile: async () => {
      try {
        const result = await typedOpenFiles();
        if (result && result.length > 0) {
          const parsed = await typedParsePaths(result);
          if (parsed?.ok && parsed.entries && parsed.entries.length > 0) {
            appendEntries(parsed.entries);
            hydrateMarksFromEntries(parsed.entries as any[]);
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
        typedTcpStart(tcpPort);
      } catch (err) {
        logger.error("TCP start failed:", err);
      }
    },
    onStopTcp: () => {
      try {
        typedTcpStop();
      } catch (err) {
        logger.error("TCP stop failed:", err);
      }
    },
    isTcpActive:
      !!tcpStatus &&
      tcpStatus !== t("status.tcpStopped") &&
      tcpStatus !== t("status.tcpError"),

    // Theme
    onToggleTheme: () => {
      const newTheme = themeMode === "dark" ? "light" : "dark";
      setThemeMode(newTheme);
      applyThemeMode(newTheme);
      try {
        patchSettingsQuiet({ themeMode: newTheme });
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

      {dragActive && <div className="drop-overlay">{t("dropOverlay")}</div>}
      {/* DC-Filter Dialog */}
      {showDcDialog && (
        <div className="modal-backdrop" onClick={() => setShowDcDialog(false)}>
          <div
            className="modal modal-wide"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>{t("dcFilterDialog.title")}</h3>
            <Suspense
              fallback={
                <div style={{ padding: "20px" }}>
                  {t("dcFilterDialog.loading")}
                </div>
              }
            >
              <DCFilterDialog />
            </Suspense>
            <div className="modal-actions">
              <button onClick={() => setShowDcDialog(false)}>
                {t("dcFilterDialog.close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Elasticsearch Dialog */}
      {showTimeDialog && (
        <Suspense
          fallback={
            <div className="modal-backdrop">
              <div className="modal">{t("dcFilterDialog.loading")}</div>
            </div>
          }
        >
          <ElasticSearchDialog
            open={showTimeDialog}
            initial={timeForm}
            histAppName={histAppName}
            histEnvironment={histEnvironment}
            histIndex={histIndex} // NEW: pass histIndex to dialog
            firstTs={entriesTsRange.firstTs}
            lastTs={entriesTsRange.lastTs}
            onApply={async (formVals: any) => {
              try {
                setShowTimeDialog(false);
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
                    await typedElasticClosePit(esPitSessionId);
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
                    const state = TimeFilter.getState();
                    const wasEnabled = state && state.enabled;
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
                  logger.warn("TimeFilter update (Elastic) failed:", e);
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
                    setEsLoadedCount(0);
                    // Jede neue Suche bekommt immer die vollen elasticSize Slots,
                    // damit Einträge auch bei aktivem Filter vollständig geladen werden.
                    // Mehr als elasticSize wird bei Bedarf über den
                    // "Nachladen"-Button (esLoadMore) geladen.
                    let available = Math.max(0, elasticSize || 0);
                    let carriedPit: string | null = null;
                    let nextToken: Array<string | number> | null = null;
                    let hasMore = false;

                    // Erste Seite holen
                    const res = await typedElasticSearch(opts);
                    const total = Array.isArray(res?.entries)
                      ? res.entries.length
                      : 0;
                    logger.info("[Elastic] Search finished", {
                      ok: res?.ok,
                      total,
                      hasResponse: true,
                    });
                    if (res?.ok) {
                      hasMore = !!res.hasMore;
                      nextToken = (res.nextSearchAfter as any) || null;
                      carriedPit = res.pitSessionId || null;
                      setEsHasMore(hasMore);
                      setEsNextSearchAfter(nextToken);
                      setEsPitSessionId(carriedPit);
                      setEsTotal(
                        typeof res?.total === "number"
                          ? Number(res.total)
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
                          LoggingStore.reset();
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
                        setEsLoadedCount((c) => c + used);
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
                          ...(nextToken &&
                          Array.isArray(nextToken) &&
                          nextToken.length > 0
                            ? { searchAfter: nextToken as any }
                            : {}),
                          pitSessionId: carriedPit || undefined,
                        } as any;
                        const r2 = await typedElasticSearch(moreOpts);
                        if (!r2?.ok) break;
                        hasMore = !!r2.hasMore;
                        nextToken = (r2.nextSearchAfter as any) || null;
                        carriedPit = r2.pitSessionId || carriedPit;
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
                          setEsLoadedCount((c) => c + used2);
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
                      const errorMsg = res?.error || t("status.errorUnknown");
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
                logger.error("[Elastic] Search failed", e);
                const errorMsg = e instanceof Error ? e.message : String(e);
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
                await patchSettings({ httpUrl: url });
                const res = await typedHttpLoadOnce(url);
                if (res.ok) {
                  appendEntries((res.entries || []) as any[]);
                  setHttpStatus(""); // Clear error status on success
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
                    message: e instanceof Error ? e.message : String(e),
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
              await patchSettings({
                httpUrl: url,
                httpPollInterval: sec,
              });
              const r = await typedHttpStartPoll({
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
                  message: e instanceof Error ? e.message : String(e),
                }),
              );
            }
          }}
        />
      </Suspense>

      {/* HTTP Tail Dialog – incremental Range-based polling */}
      <Suspense fallback={null}>
        <HttpTailDialog
          open={showHttpTailDialog}
          initialUrl={httpUrl}
          initialIntervalSec={Math.max(1, Math.round(httpInterval || 2))}
          initialEmitInitial={false}
          initialAllowInsecureSSL={false}
          initialAuthHeader=""
          isAnyTailActive={httpTail.tails.length > 0}
          onClose={() => setShowHttpTailDialog(false)}
          onStart={async (args) => {
            try {
              const headers: Record<string, string> = {};
              if (args.authHeader) headers.Authorization = args.authHeader;
              const r = await httpTail.start(args.url, {
                intervalMs: args.intervalSec * 1000,
                emitInitial: args.emitInitial,
                headers: Object.keys(headers).length ? headers : undefined,
                allowInsecureSSL: args.allowInsecureSSL,
              });
              if (!r.ok) {
                showAlert(
                  t("httpTail.startFailed", { message: r.error || "" }),
                );
              }
            } catch (e) {
              showAlert(
                t("httpTail.startFailed", {
                  message: e instanceof Error ? e.message : String(e),
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
                  ? t("filterStats.filtered", {
                      count: String(countTotal - countFiltered),
                    }) +
                    "\n" +
                    (lastFilterStats.rejectedByLevel > 0
                      ? `• ${t("filterStats.byLevel", { count: String(lastFilterStats.rejectedByLevel) })}\n`
                      : "") +
                    (lastFilterStats.rejectedByLogger > 0
                      ? `• ${t("filterStats.byLogger", { count: String(lastFilterStats.rejectedByLogger) })}\n`
                      : "") +
                    (lastFilterStats.rejectedByThread > 0
                      ? `• ${t("filterStats.byThread", { count: String(lastFilterStats.rejectedByThread) })}\n`
                      : "") +
                    (lastFilterStats.rejectedByMessage > 0
                      ? `• ${t("filterStats.byMessage", { count: String(lastFilterStats.rejectedByMessage) })}\n`
                      : "") +
                    (lastFilterStats.rejectedByTime > 0
                      ? `• ${t("filterStats.byTime", { count: String(lastFilterStats.rejectedByTime) })}\n`
                      : "") +
                    (lastFilterStats.rejectedByDC > 0
                      ? `• ${t("filterStats.byDC", { count: String(lastFilterStats.rejectedByDC) })}\n`
                      : "") +
                    (lastFilterStats.rejectedByOnlyMarked > 0
                      ? `• ${t("filterStats.byOnlyMarked", { count: String(lastFilterStats.rejectedByOnlyMarked) })}\n`
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
          <div className="btn-group" title={t("toolbar.navigation")}>
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
          <div className="btn-group" title={t("toolbar.marks")}>
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
              <div style={{ position: "relative", display: "inline-flex" }}>
                <button
                  type="button"
                  className="badge-count"
                  onClick={() => setShowBookmarks((v) => !v)}
                  aria-haspopup="dialog"
                  aria-expanded={showBookmarks}
                  title={t("toolbar.marksCount", {
                    count: String(markedIdx.length),
                  })}
                >
                  {markedIdx.length}
                </button>
                {showBookmarks && (
                  <BookmarksPopover
                    bookmarks={bookmarkItems}
                    onSelect={(vi) => {
                      gotoBookmark(vi);
                      setShowBookmarks(false);
                    }}
                    emptyLabel={t("toolbar.noBookmarks") || "Keine Lesezeichen"}
                    ariaLabel={t("toolbar.marks") || "Lesezeichen"}
                  />
                )}
              </div>
            )}
          </div>
        </div>
        <SearchBar
          search={search}
          setSearch={setSearch}
          searchMode={searchMode}
          setSearchMode={setSearchMode}
          showSearchOptions={showSearchOptions}
          setShowSearchOptions={setShowSearchOptions}
          fltHistSearch={fltHistSearch}
          showSearchHist={showSearchHist}
          setShowSearchHist={setShowSearchHist}
          searchHistHighlightIdx={searchHistHighlightIdx}
          setSearchHistHighlightIdx={setSearchHistHighlightIdx}
          searchPos={searchPos}
          searchHistRef={searchHistRef}
          searchPopRef={searchPopRef}
          searchInputRef={searchInputRef}
          setShowLoggerHist={setShowLoggerHist}
          setShowThreadHist={setShowThreadHist}
          setShowMessageHist={setShowMessageHist}
          addFilterHistory={addFilterHistory}
          searchMatchIdx={searchMatchIdx}
          selectedOneIdx={selectedOneIdx}
          filteredIdx={filteredIdx}
          gotoSearchMatch={gotoSearchMatch}
          onSubmitSearch={flushSearch}
          t={t}
        />
        <StatusSection
          busy={busy}
          tcpStatus={tcpStatus}
          httpStatus={httpStatus}
          httpTailCount={httpTail.tails.length}
          nextPollIn={nextPollIn}
          t={t}
        />
        <div className="section" style={{ flex: 1, flexWrap: "wrap" }}>
          {/* Filter Toggle Button */}
          <button
            className={`filter-toggle-btn ${filtersExpanded ? "expanded" : ""}`}
            onClick={() => setFiltersExpanded(!filtersExpanded)}
            title={t("toolbar.filterToggle")}
          >
            <span>️ {t("toolbar.filterLabel")}</span>
            <span className="chevron">▼</span>
          </button>
          {/* Aktive Filter-Chips inline */}
          <ActiveFilterChips
            filter={filter}
            stdFiltersEnabled={stdFiltersEnabled}
            onlyMarked={onlyMarked}
            setFilter={setFilter}
            setOnlyMarked={setOnlyMarked}
            setSearch={setSearch}
            setTraceTimelineId={setTraceTimelineId}
            setShowTraceTimeline={setShowTraceTimeline}
            dcVersion={dcVersion}
            t={t}
          />
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
          onSubmitFilter={flushFilter}
          onOnlyMarkedChange={(nv) => {
            setOnlyMarked(nv);
            try {
              patchSettingsQuiet({ onlyMarked: nv });
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
              patchSettingsQuiet({ onlyMarked: false });
            } catch {}
            try {
              TimeFilter.reset();
            } catch (e) {
              logger.error("Resetting TimeFilter failed:", e);
            }
          }}
          search={search}
          searchMode={searchMode}
          onApplyProfile={(profile) => {
            setFilter({
              level: profile.filters.level,
              logger: profile.filters.logger,
              thread: profile.filters.thread,
              service: profile.filters.service ?? "",
              message: profile.filters.message,
            });
            setSearch(profile.filters.search || "");
            setSearchMode(profile.filters.searchMode ?? "insensitive");
            setStdFiltersEnabled(profile.filters.stdFiltersEnabled);
            setOnlyMarked(profile.filters.onlyMarked ?? false);
            // MDC-Filter konsistent übernehmen: zuerst alle bisherigen Einträge
            // entfernen, dann nur die im Profil hinterlegten (immer als aktiv
            // gespeicherten) Einträge übernehmen.
            try {
              DiagnosticContextFilter.reset();
              const profMdc = profile.filters.mdcFilters ?? [];
              if (profMdc.length > 0) {
                for (const mdc of profMdc) {
                  DiagnosticContextFilter.addMdcEntry(mdc.key, mdc.value);
                  // addMdcEntry setzt active=true. Falls ein Profil dennoch
                  // einen inaktiven Eintrag enthält (Altdaten), korrigieren.
                  if (!mdc.active) {
                    DiagnosticContextFilter.deactivateMdcEntry(
                      mdc.key,
                      mdc.value,
                    );
                  }
                }
                DiagnosticContextFilter.setEnabled(true);
              } else {
                // Kein MDC im Profil → Filter aus.
                DiagnosticContextFilter.setEnabled(false);
              }
            } catch (e) {
              logger.error("Applying MDC filters from profile failed:", e);
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
        <ElasticStatusBar
          esBusy={esBusy}
          esHasMore={esHasMore}
          esLoaded={esLoaded}
          esTarget={esTarget}
          esPct={esPct}
          esTotal={esTotal}
          esPitSessionId={esPitSessionId}
          esElasticCountAll={esElasticCountAll}
          onLoadMore={esLoadMore}
          t={t}
        />
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
              if (parentRef.current && !ev.defaultPrevented) {
                parentRef.current?.focus({ preventScroll: true });
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
            <div className="cell cell--center">
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
              // #2: Markierung kommt primär aus marksMap (Single-Source-of-Truth).
              // Fallback auf e._mark/e.color für Legacy-Pfade (z. B. Entries
              // mit eingebetteter Farbe aus früheren Sessions).
              const markColor =
                marksMap[entrySignature(e)] || e._mark || e.color;
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
                  search={debouncedSearch}
                  onSelect={handleRowSelect}
                  onContextMenu={handleRowContextMenu}
                  highlightFn={stableHighlightFn}
                  t={t}
                />
              );
            })}
          </div>
          {/* Empty-States außerhalb des virtualisierten Wrappers,
              damit sie bei totalHeight=0 nicht durch `contain: strict` geclippt werden. */}
          {countFiltered === 0 &&
            entries.length === 0 &&
            (!!tcpStatus &&
            tcpStatus !== t("status.tcpStopped") &&
            tcpStatus !== t("status.tcpError") ? (
              <div className="list-empty">
                <div className="list-empty-icon">📡</div>
                <div className="list-empty-title">
                  {t("list.emptyTitleTcpWaiting")}
                </div>
                <div className="list-empty-hint">
                  {t("list.emptyHintTcpWaiting", {
                    port: String(tcpPortRef.current),
                  })}
                </div>
                <div className="list-empty-actions">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          LOGBACK_TCP_SNIPPET,
                        );
                        toaster.success(t("list.logbackCopied"));
                      } catch (e) {
                        logger.error("Clipboard write failed:", e);
                        toaster.error(t("errors.copyFailed"));
                      }
                    }}
                  >
                    📋 {t("list.actionCopyLogback")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        typedTcpStop();
                      } catch (e) {
                        logger.error("TCP stop failed:", e);
                      }
                    }}
                  >
                    ⏹ {t("list.actionStopTcp")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="list-empty">
                <div className="list-empty-icon">📜</div>
                <div className="list-empty-title">{t("list.emptyTitle")}</div>
                <div className="list-empty-hint">{t("list.emptyHint")}</div>
                <div className="list-empty-actions">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={async () => {
                      try {
                        const paths = await typedOpenFiles();
                        if (paths && paths.length) {
                          const res = await typedParsePaths(paths);
                          if (res?.ok) {
                            appendEntries(res.entries as any);
                            hydrateMarksFromEntries(res.entries as any[]);
                          }
                        }
                      } catch (e) {
                        logger.error("Open file failed:", e);
                      }
                    }}
                  >
                    📂 {t("list.actionOpenFile")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        typedTcpStart(tcpPortRef.current);
                      } catch (e) {
                        logger.error("TCP start failed:", e);
                      }
                    }}
                  >
                    ⏵ {t("list.actionStartTcp")}
                  </button>
                  <button type="button" onClick={() => setShowTimeDialog(true)}>
                    🔍 {t("list.actionElastic")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const demo = buildDemoEntries();
                      appendEntries(demo as any);
                      toaster.success(
                        t("list.demoLoaded", { count: String(demo.length) }),
                      );
                    }}
                  >
                    🎬 {t("list.actionLoadDemo")}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          LOGBACK_TCP_SNIPPET,
                        );
                        toaster.success(t("list.logbackCopied"));
                      } catch (e) {
                        logger.error("Clipboard write failed:", e);
                        toaster.error(t("errors.copyFailed"));
                      }
                    }}
                  >
                    📋 {t("list.actionCopyLogback")}
                  </button>
                </div>
              </div>
            ))}
          {countFiltered === 0 && entries.length > 0 && (
            <div className="list-empty">
              <div className="list-empty-icon">🔎</div>
              <div className="list-empty-title">{t("list.noMatchTitle")}</div>
              <div className="list-empty-hint">{t("list.noMatchHint")}</div>
              <div className="list-empty-actions">
                <button
                  type="button"
                  className="btn-primary"
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
                      patchSettingsQuiet({ onlyMarked: false });
                    } catch {}
                    try {
                      TimeFilter.reset();
                    } catch (e) {
                      logger.error("Resetting TimeFilter failed:", e);
                    }
                    try {
                      DiagnosticContextFilter.setEnabled(false);
                    } catch {}
                  }}
                >
                  ✕ {t("list.actionResetFilters")}
                </button>
              </div>
            </div>
          )}
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
            markColor={
              selectedEntry ? marksMap[entrySignature(selectedEntry)] : null
            }
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

      {/* In-App Confirm-Dialog (ersetzt natives window.confirm) */}
      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel={confirmState.confirmLabel ?? t("common.ok")}
        cancelLabel={confirmState.cancelLabel ?? t("common.cancel")}
        type={confirmState.type}
        onConfirm={confirmOnConfirm}
        onCancel={confirmOnCancel}
      />

      {/* Non-blocking Toast Notifications (success/info) */}
      <ToastStack
        toasts={toaster.toasts}
        onDismiss={toaster.dismiss}
        closeLabel={t("common.close")}
      />

      {/* QW-11 / A11Y-3: visually hidden aria-live region for incoming logs */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={t("a11y.newEntries")}
        style={{
          position: "absolute",
          width: "1px",
          height: "1px",
          padding: 0,
          margin: "-1px",
          overflow: "hidden",
          clip: "rect(0,0,0,0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {a11yAnnouncement}
      </div>

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

      {/* Sprint 5: Alerts dialog - lazy loaded */}
      {showAlertsDialog && (
        <Suspense fallback={null}>
          <AlertsDialog
            open={showAlertsDialog}
            rules={alertRulesHook.rules}
            onClose={() => setShowAlertsDialog(false)}
            onAdd={alertRulesHook.addRule}
            onUpdate={alertRulesHook.updateRule}
            onRemove={alertRulesHook.removeRule}
            onToggle={alertRulesHook.toggleRule}
            t={t}
          />
        </Suspense>
      )}

      {/* Sprint 5: Statistics dialog - lazy loaded */}
      {showStatsDialog && (
        <Suspense fallback={null}>
          <StatsDialog
            open={showStatsDialog}
            entries={
              filteredIdx.map((i) => entries[i]).filter(Boolean) as any[]
            }
            totalEntries={entries.length}
            onClose={() => setShowStatsDialog(false)}
            t={t}
            fmtTimestamp={(v) => fmtTimestamp(v as any)}
          />
        </Suspense>
      )}

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
                const idx = viOfGlobal(entry._id);
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
