// NOTE: IPC calls now use the typed wrapper from ../utils/typedApi
// See extracted hooks in src/hooks/ and components in src/renderer/components/
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { highlightAll } from "../utils/highlight";
import logger from "../utils/logger";
import { rendererPerf } from "../utils/rendererPerf";
import { useI18n } from "../utils/i18n";
import { LoggingStore } from "../store/loggingStore";
import type { CanonicalLogEntry } from "../store/paged";
import { canonicalDcKey, DiagnosticContextFilter } from "../store/dcFilter";
import { DragAndDropManager } from "../utils/dnd";
import { TimeFilter } from "../store/timeFilter";
import { lazy, Suspense } from "preact/compat";
import type { Settings } from "../types/ipc";
import {
  getSettings,
  patchSettings,
  patchSettingsQuiet,
  windowPermsGet,
  openFiles as typedOpenFiles,
  parseRawDrops as typedParseRawDrops,
  streamAck as typedStreamAck,
  streamCancel as typedStreamCancel,
  streamParsePaths as typedStreamParsePaths,
  streamReady as typedStreamReady,
  tcpStart as typedTcpStart,
  tcpStop as typedTcpStop,
  httpLoadOnce as typedHttpLoadOnce,
  httpStartPoll as typedHttpStartPoll,
  httpStopPoll as typedHttpStopPoll,
  chooseExportPath as typedChooseExportPath,
  saveExportFile as typedSaveExportFile,
  autoUpdaterSetAllowPrerelease as typedAutoUpdaterSetAllowPrerelease,
  appRelaunch as typedAppRelaunch,
  onAppend as typedOnAppend,
  onMenu as typedOnMenu,
  onStreamChunk as typedOnStreamChunk,
  onStreamComplete as typedOnStreamComplete,
  onStreamError as typedOnStreamError,
  onTcpStatus as typedOnTcpStatus,
  onWindowFocus as typedOnWindowFocus,
} from "../utils/typedApi";
import type {
  ElasticFormState,
  HttpPollFormState,
  ThemeMode,
  SettingsTab,
  SettingsFormState,
  FilterStats,
} from "../types/renderer";
import type { StreamParseChunk, StreamParsePathsResult } from "../types/ipc";
import { MDCListener } from "../store/mdcListener";
import { clearHighlightCache } from "./LogRow";
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

// Import refactored utilities
import { compactEntrySignature, entrySignature } from "../utils/entryUtils";
import { compareByTimestampId } from "../utils/sort";
import { resolveMarkedPositionsById } from "../utils/markedPositions";
import { nativeConfirm } from "../utils/nativeDialog";

// Import refactored hooks
import {
  useThrottledValue,
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
  useA11yAnnouncer,
  useHttpPollCountdown,
  useContextMenuActions,
  useElasticSearch,
  useTimeFilterDialog,
} from "../hooks";
import { useStableCallback } from "../hooks/useStableCallback";
import type { ProjectionBridge } from "../workers/projectionBridge";

// Import refactored components - core components loaded eagerly
import {
  AlertDialog,
  ConfirmDialog,
  ContextMenu,
  DetailPanel,
  FilterSection,
  ToastStack,
  UpdateNotification,
  SearchBar,
  ActiveFilterChips,
  StatusSection,
  MarksNavigation,
  ToolbarCounts,
  VirtualizedLogList,
} from "./components";
import type { VirtualizedLogListHandle } from "./components";
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
  const marksMapRef = useRef<Record<string, string>>(marksMap);

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
  const { a11yAnnouncement, announceAppend } = useA11yAnnouncer();
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
  const projectionBridgeRef = useRef<ProjectionBridge | null>(null);
  const {
    entries,
    entryGeneration,
    appendEntries,
    appendEntriesAsync,
    clearEntries,
    storageError,
    usesPagedStorage,
    repository,
    getMetadata,
    getIdsBySignature,
  } = useEntryManagement({
    marksMap,
    projectionBridgeRef,
  });

  useEffect(() => {
    if (storageError) showAlert(storageError.message);
  }, [storageError, showAlert]);

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

  // Gedrosseltes `entries`-Snapshot als Filter-Trigger.
  // Beim Streaming wird `entries` bis zu ~60×/Sekunde aktualisiert. Ohne
  // Koaleszenz würde jeder Append (a) einen Worker-Filterlauf UND (b) die
  // O(n)-Neuberechnung von `markedIdx`/`searchMatchIdx` auf dem Main-Thread
  // auslösen → bei 100k–300k Einträgen friert die Oberfläche beim gleichzeitigen
  // Tippen/Einstellen ein. Das Throttling veröffentlicht den ersten Block
  // sofort und bündelt danach Bursts auf höchstens einen Filterlauf je 120 ms.
  const visibleEntries = useThrottledValue(entries, 120);

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
  // TraceTimeline Dialog-State
  const [showTraceTimeline, setShowTraceTimeline] = useState<boolean>(false);
  const [traceTimelineId, setTraceTimelineId] = useState<string>("");

  // Zeit-Filter Dialog + Filter-Historien (extrahiert in useTimeFilterDialog).
  // getLastEsForm liest die letzte Elastic-Suche (Eigentum von useElasticSearch)
  // lazy über einen Ref, damit dieser Hook vor useElasticSearch laufen kann.
  const lastEsFormRef = useRef<ElasticFormState | null>(null);
  const {
    showTimeDialog,
    setShowTimeDialog,
    timeForm,
    setTimeForm,
    openTimeFilterDialog,
    clearTimeFilter,
    histAppName,
    setHistAppName,
    histEnvironment,
    setHistEnvironment,
    histIndex,
    setHistIndex,
    addToHistory,
  } = useTimeFilterDialog({
    showAlert,
    t,
    getLastEsForm: () => lastEsFormRef.current,
  });
  const [tcpStatus, setTcpStatus] = useState<string>(t("status.tcpStopped"));
  const [httpStatus, setHttpStatus] = useState<string>(
    t("status.httpPollStopped"),
  );
  const [httpPollId, setHttpPollId] = useState<number | null>(null);
  const [tcpPort, setTcpPort] = useState<number>(5000);
  const [canTcpControlWindow, setCanTcpControlWindow] = useState<boolean>(true);

  const [httpUrl, setHttpUrl] = useState<string>("");
  const [httpInterval, setHttpInterval] = useState<number>(5000);
  // HTTP-Tail-Dialog: zuletzt verwendete Optionen (werden persistiert und beim
  // Öffnen des Dialogs vorbelegt, damit nach einem Neustart nichts verloren geht).
  const [httpTailEmitInitial, setHttpTailEmitInitial] =
    useState<boolean>(false);
  const [httpTailAllowInsecureSSL, setHttpTailAllowInsecureSSL] =
    useState<boolean>(false);
  const [httpTailAuthHeader, setHttpTailAuthHeader] = useState<string>("");
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

  // Öffnet den HTTP-Tail-Dialog und belegt ihn mit den zuletzt verwendeten
  // Werten vor (URL, Intervall, Optionen und – falls hinterlegt – dem
  // verschlüsselt gespeicherten Auth-Header). So geht nach einem Neustart
  // die zuletzt genutzte Tail-Konfiguration nicht verloren.
  async function openHttpTailDialog() {
    try {
      const r = await getSettings();
      if (r) {
        if (typeof r.httpUrl === "string") setHttpUrl(r.httpUrl);
        const int = r.httpPollInterval ?? httpInterval;
        if (int != null) setHttpInterval(Number(int) || 5);
        setHttpTailEmitInitial(!!r.httpTailEmitInitial);
        setHttpTailAllowInsecureSSL(!!r.httpTailAllowInsecureSSL);
      }
      // Der Auth-Header wird nie im Klartext über settingsGet ausgeliefert –
      // separat (entschlüsselt) abrufen.
      const api = (
        window as unknown as {
          api?: {
            httpTailGetAuthHeader?: () => Promise<{
              ok: boolean;
              authHeader: string;
            }>;
          };
        }
      ).api;
      if (api?.httpTailGetAuthHeader) {
        const auth = await api.httpTailGetAuthHeader();
        setHttpTailAuthHeader(auth?.ok ? auth.authHeader || "" : "");
      }
    } catch (e) {
      logger.warn("Failed to load settings for HTTP tail dialog:", e);
    }
    setShowHttpTailDialog(true);
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
      setMarksMap((current) => {
        let next: Record<string, string> | null = null;
        for (let i = 0; i < importedEntries.length; i++) {
          const e = importedEntries[i];
          const m = e?._mark;
          if (typeof m !== "string" || !m) continue;
          const sig = compactEntrySignature(e);
          if (!sig || (next ?? current)[sig] === m) continue;
          if (!next) next = { ...current };
          next[sig] = m;
        }
        return next ?? current;
      });
    },
    [],
  );

  // Busy helper
  const [busy, setBusy] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<{
    processedEntries: number;
    totalEntries?: number;
    bytesRead?: number;
    totalBytes?: number;
    filePath?: string;
    fileIndex?: number;
    totalFiles?: number;
  } | null>(null);
  const activeStreamSessionRef = useRef<string | null>(null);
  const activeStreamCleanupRef = useRef<(() => void) | null>(null);
  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const persistImportedEntries = useCallback(
    async (importedEntries: any[] | undefined | null): Promise<void> => {
      if (!importedEntries || importedEntries.length === 0) return;
      setImportProgress({
        processedEntries: 0,
        totalEntries: importedEntries.length,
      });
      try {
        await appendEntriesAsync(importedEntries, {
          onProgress: (processed, total) =>
            setImportProgress({
              processedEntries: processed,
              totalEntries: total,
            }),
        });
        hydrateMarksFromEntries(importedEntries);
      } finally {
        setImportProgress(null);
      }
    },
    [appendEntriesAsync, hydrateMarksFromEntries],
  );

  const persistStreamedEntries = useCallback(
    async (sessionId: string): Promise<void> => {
      activeStreamSessionRef.current = sessionId;
      setImportProgress({ processedEntries: 0, bytesRead: 0, totalBytes: 0 });
      let persistedEntries = 0;

      await new Promise<void>((resolve, reject) => {
        const cleanup = (): void => {
          offChunk();
          offComplete();
          offError();
          if (activeStreamSessionRef.current === sessionId) {
            activeStreamSessionRef.current = null;
          }
          if (activeStreamCleanupRef.current === cancel) {
            activeStreamCleanupRef.current = null;
          }
        };
        const cancel = (): void => {
          typedStreamCancel(sessionId);
          cleanup();
          reject(new DOMException("Stream import cancelled", "AbortError"));
        };

        const handleChunk = (chunk: StreamParseChunk): void => {
          if (chunk.sessionId !== sessionId) return;
          void (async () => {
            try {
              if (chunk.entries.length > 0) {
                await appendEntriesAsync(chunk.entries as any[], {
                  onProgress: (processed) =>
                    setImportProgress({
                      processedEntries: persistedEntries + processed,
                      bytesRead: chunk.bytesRead,
                      totalBytes: chunk.totalBytes,
                      filePath: chunk.filePath,
                      fileIndex: chunk.fileIndex,
                      totalFiles: chunk.totalFiles,
                    }),
                });
                persistedEntries += chunk.entries.length;
                hydrateMarksFromEntries(chunk.entries as any[]);
              }
              setImportProgress({
                processedEntries: persistedEntries,
                bytesRead: chunk.bytesRead,
                totalBytes: chunk.totalBytes,
                filePath: chunk.filePath,
                fileIndex: chunk.fileIndex,
                totalFiles: chunk.totalFiles,
              });
              typedStreamAck(sessionId, chunk.chunkIndex);
            } catch (error) {
              typedStreamCancel(sessionId);
              cleanup();
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          })();
        };

        const offChunk = typedOnStreamChunk(handleChunk);
        const offComplete = typedOnStreamComplete((result) => {
          if (result.sessionId !== sessionId) return;
          cleanup();
          if (result.errors.length > 0) {
            reject(new Error(result.errors.join("\n")));
          } else {
            resolve();
          }
        });
        const offError = typedOnStreamError((error) => {
          if (error.sessionId !== sessionId) return;
          cleanup();
          reject(new Error(error.error));
        });
        activeStreamCleanupRef.current = cancel;
        typedStreamReady(sessionId);
      }).finally(() => {
        if (activeStreamSessionRef.current === sessionId) {
          activeStreamSessionRef.current = null;
        }
        setImportProgress(null);
      });
    },
    [appendEntriesAsync, hydrateMarksFromEntries],
  );

  const importPaths = useCallback(
    async (paths: string[]): Promise<void> => {
      const result: StreamParsePathsResult = await typedStreamParsePaths(paths);
      if ("streamed" in result) {
        await persistStreamedEntries(result.sessionId);
        return;
      }
      if (!result.ok) {
        throw new Error(result.error || tRef.current("status.errorUnknown"));
      }
      await persistImportedEntries(result.entries as any[]);
    },
    [persistImportedEntries, persistStreamedEntries],
  );

  // Elasticsearch search state + flow (search, pagination, "load more").
  const {
    esBusy,
    esHasMore,
    esTotal,
    esPitSessionId,
    lastEsForm,
    esElasticCountAll,
    esLoaded,
    esTarget,
    esPct,
    esLoadMore,
    handleElasticApply,
    resetElasticSearchState,
    closePitQuiet,
  } = useElasticSearch({
    entries,
    appendEntries: appendEntriesAsync,
    elasticUrl,
    elasticSize,
    withBusy,
    showAlert,
    handleFeatureError,
    t,
    addToHistory,
    closeTimeDialog: () => setShowTimeDialog(false),
    onReplaceReset: () => {
      // Vollständiges Zurücksetzen: alle vorhandenen Einträge entfernen
      clearEntries();
      setSelected(new Set());
      // LoggingStore zurücksetzen (MDC etc.)
      try {
        LoggingStore.reset();
      } catch (e) {
        logger.error("LoggingStore.reset error (Elastic replace)", e);
      }
    },
  });

  // Letzte Elastic-Suche für useTimeFilterDialog (lazy) verfügbar machen.
  lastEsFormRef.current = lastEsForm;

  // HTTP polling helper state – countdown extracted into useHttpPollCountdown.
  const { nextPollIn, setNextPollDueAt } = useHttpPollCountdown({
    httpPollId,
    currentPollInterval,
  });

  // Filter statistics for debugging why entries are filtered out
  const [lastFilterStats, setLastFilterStats] = useState<FilterStats | null>(
    null,
  );

  // Refs/Layout/Virtualizer
  const parentRef = useRef<HTMLDivElement | null>(null);
  const virtualListRef = useRef<VirtualizedLogListHandle | null>(null);

  // Log-list context menu (state, mark colors, clipboard, trace-id adoption)
  const {
    ctxMenu,
    ctxRef,
    openContextMenu,
    setCustomColors,
    pickerColor,
    setPickerColor,
    palette,
    addCustomColor,
    applyMarkColor,
    copyTsMsg,
    adoptTraceIds,
  } = useContextMenuActions({
    entries,
    selected,
    setSelected,
    marksMap,
    setMarksMap,
    parentRef,
    showAlert,
    t,
    repository,
    getMetadata,
  });

  const layoutRef = useRef<HTMLDivElement | null>(null);

  // Use resize handlers hook for divider and column resize
  const { dividerElRef, resizeHeight, onColMouseDown } = useResizeHandlers({
    layoutRef,
  });

  // Use Filter Worker for large datasets (>10,000 entries)
  const {
    filteredIndices: workerFilteredIdx,
    searchMatchIndices: workerSearchMatchIdx,
    stats: workerFilterStats,
    error: filterWorkerError,
    filterEntries,
    projectionBridge,
  } = useFilterWorker();

  // Wire projection bridge so useEntryManagement can publish directly.
  projectionBridgeRef.current = projectionBridge;

  const standardFilterActive =
    stdFiltersEnabled &&
    [filter.level, filter.logger, filter.thread, filter.message].some(
      (value) => String(value ?? "").trim().length > 0,
    );
  const dcFilterActive =
    DiagnosticContextFilter.isEnabled() &&
    DiagnosticContextFilter.getState().entries.some((entry) => entry.active);
  const filterIsActive =
    standardFilterActive ||
    onlyMarked ||
    dcFilterActive ||
    TimeFilter.isEnabled();

  useEffect(() => {
    if (filterWorkerError) showAlert(filterWorkerError.message);
  }, [filterWorkerError, showAlert]);

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

    if (!filterIsActive && !String(search || "").trim()) return;

    hasTriggeredFilterRef.current = true;
    const filterGeneration = JSON.stringify({
      stdFiltersEnabled,
      filter,
      onlyMarked,
      dcFilterEnabled,
      dcFilterEntries,
      timeFilterEnabled,
      timeFilterFrom,
      timeFilterTo,
      markedSignatures: onlyMarked ? Object.keys(marksMap).sort() : [],
    });
    filterEntries(
      visibleEntries,
      {
        stdFiltersEnabled,
        filter: {
          level: filter.level || "",
          logger: filter.logger || "",
          thread: filter.thread || "",
          message: filter.message || "",
        },
        onlyMarked,
        dcFilterEnabled,
        dcFilterEntries,
        timeFilterEnabled,
        timeFilterFrom,
        timeFilterTo,
        navigationSearch: search,
        navigationSearchMode: searchMode,
      },
      // marksMap nur für `onlyMarked` relevant – sonst wird es im Worker
      // ohnehin ignoriert. Übergabe ist zustandslos und billig.
      onlyMarked ? marksMap : undefined,
      usesPagedStorage
        ? {
            paged: true,
            generation: filterGeneration,
            dataGeneration: entryGeneration,
            entryCount: visibleEntries.length,
            databaseName: repository.databaseName,
          }
        : undefined,
    );
  }, [
    visibleEntries,
    stdFiltersEnabled,
    filter,
    dcVersion,
    timeVersion,
    onlyMarked,
    search,
    searchMode,
    filterEntries,
    // marksMap wirkt sich nur auf das Ergebnis aus, wenn `onlyMarked` aktiv
    // ist. Anderfalls wäre eine Aufnahme in die Deps eine unnötige
    // Re-Filter-Quelle bei jedem Mark/Unmark-Klick.
    onlyMarked ? marksMap : null,
    usesPagedStorage,
    entryGeneration,
    filterIsActive,
  ]);

  const unfilteredIds = useMemo(
    () => entries.map((entry) => entry._id),
    [entries],
  );
  const filteredIdx = filterIsActive ? workerFilteredIdx : unfilteredIds;

  // Stable IDs are dense but no longer monotonic after timestamp sorting.
  // A compact typed reverse vector keeps navigation O(1) without Map overhead.
  const visualPositionById = useMemo(() => {
    const positions = new Int32Array(entries.length + 1);
    for (let index = 0; index < filteredIdx.length; index++) {
      const id = filteredIdx[index]!;
      if (id < positions.length) positions[id] = index + 1;
    }
    return positions;
  }, [entries.length, filteredIdx]);
  const viOfGlobal = useCallback(
    (g: number | null | undefined): number => {
      if (g == null || g >= visualPositionById.length) return -1;
      return visualPositionById[g]! - 1;
    },
    [visualPositionById],
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
            filter,
            dcFilterEnabled: DiagnosticContextFilter.isEnabled(),
          });
        }
      }
    }
  }, [workerFilterStats, onlyMarked, stdFiltersEnabled, filter]);

  // Refs to track current values for menu handlers (avoid stale closures)
  const filteredIdxRef = useRef<number[]>(filteredIdx);
  const entriesRef = useRef<any[]>(entries);
  // marksMapRef ist nötig, weil der Application-Menu-Handler (typedOnMenu)
  // einmalig in einem useEffect mit []-Deps registriert wird. Ohne diesen Ref
  // würde `exportCurrentView` über den Menu-Pfad auf eine stale `marksMap`-
  // Closure zugreifen → exportierte Einträge hätten `markColor: null`,
  // obwohl sie sichtbar markiert sind.
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
    try {
      patchSettingsQuiet({ marksMap });
    } catch {
      // Session marks remain available in component state.
    }
  }, [marksMap]);

  const countTotal = entries.length;
  const countFiltered = filteredIdx.length;
  const countSelected = selected.size;

  const clearAllFilters = useCallback(() => {
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
    } catch (error) {
      logger.error("Persisting cleared filter settings failed:", error);
    }
    TimeFilter.reset();
    DiagnosticContextFilter.reset();
  }, [setFilter, setOnlyMarked, setSearch]);

  const handleDisableFollow = useCallback(() => {
    setFollow(false);
    try {
      patchSettingsQuiet({ follow: false });
    } catch (err) {
      logger.warn("Persisting follow flag failed:", err);
    }
  }, []);

  // Bei Filteränderung: ausgewählten Eintrag sichtbar halten, wenn er noch in der Liste ist
  const prevFilteredIdxRef = useRef<number[]>(filteredIdx);
  const selectedRef = useRef<Set<number>>(selected);
  const pendingSelectedAfterFilterRef = useRef<number | null>(null);
  // Track previous filter criteria to distinguish filter changes from new entries
  const prevFilterCriteriaRef = useRef({
    stdFiltersEnabled,
    filter,
    dcVersion,
    timeVersion,
    onlyMarked,
    searchMode,
  });

  // Halte selectedRef aktuell
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    const filteredListChanged = prevFilteredIdxRef.current !== filteredIdx;

    // Prüfe ob sich die Filter-Kriterien geändert haben (nicht nur neue Einträge)
    const prevCriteria = prevFilterCriteriaRef.current;
    const filterCriteriaChanged =
      prevCriteria.stdFiltersEnabled !== stdFiltersEnabled ||
      prevCriteria.filter !== filter ||
      prevCriteria.dcVersion !== dcVersion ||
      prevCriteria.timeVersion !== timeVersion ||
      prevCriteria.onlyMarked !== onlyMarked ||
      prevCriteria.searchMode !== searchMode;

    if (filterCriteriaChanged) {
      pendingSelectedAfterFilterRef.current =
        lastClicked.current ?? Array.from(selectedRef.current).pop() ?? null;
    }

    prevFilteredIdxRef.current = filteredIdx;
    prevFilterCriteriaRef.current = {
      stdFiltersEnabled,
      filter,
      dcVersion,
      timeVersion,
      onlyMarked,
      searchMode,
    };

    if (!filteredListChanged) return;

    // Teilergebnisse enthalten den ausgewählten Eintrag möglicherweise noch
    // nicht. Das Ziel bleibt daher bis zu einem späteren Worker-Ergebnis aktiv.
    const currentSelected = pendingSelectedAfterFilterRef.current;
    if (currentSelected == null) return;

    // Prüfe ob der ausgewählte Eintrag noch in der gefilterten Liste ist
    const viIndex = viOfGlobal(currentSelected);
    if (viIndex >= 0) {
      pendingSelectedAfterFilterRef.current = null;
      virtualListRef.current?.scrollAfterFilterChange(viIndex);
    }
  }, [
    filteredIdx,
    stdFiltersEnabled,
    filter,
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
    virtualListRef.current?.scrollToIndexCenter(viIndex);
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
              next = new Set<number>();
              for (let vi = lo; vi <= hi; vi++) {
                next.add(filteredIdx[vi]!);
              }
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
  const [selectedEntry, setSelectedEntry] = useState<CanonicalLogEntry | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    if (selectedOneIdx == null) {
      setSelectedEntry(null);
      return;
    }
    setSelectedEntry(null);
    void repository
      .getPayload(selectedOneIdx)
      .then((entry) => {
        if (!cancelled) setSelectedEntry(entry ?? null);
      })
      .catch((error) => {
        if (!cancelled) {
          logger.error("Loading selected log entry failed:", error);
          showAlert(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repository, selectedOneIdx, showAlert]);

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

  const markedIdx = useMemo(
    () =>
      resolveMarkedPositionsById(
        marksMap,
        getIdsBySignature,
        visualPositionById,
      ),
    [getIdsBySignature, marksMap, visualPositionById],
  );

  // Der Filter-Worker ermittelt dieselben, auf 50k begrenzten visuellen
  // Trefferindizes im selben Durchlauf wie `filteredIdx`. Dadurch entfällt der
  // zusätzliche O(n)-Scan mit `msgMatches` im Renderer-Hauptthread.
  const searchMatchIdx = workerSearchMatchIdx;

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

  const [bookmarkItems, setBookmarkItems] = useState<
    Array<{ vi: number; color: string; timestamp: string; message: string }>
  >([]);
  useEffect(() => {
    let cancelled = false;
    const positions = markedIdx.slice(0, 200);
    const ids = positions
      .map((visualIndex) => filteredIdx[visualIndex])
      .filter((id): id is number => id !== undefined);
    if (ids.length === 0) {
      setBookmarkItems([]);
      return;
    }
    void repository
      .getPayloads(ids)
      .then((payloads) => {
        if (cancelled) return;
        setBookmarkItems(
          positions.flatMap((vi) => {
            const id = filteredIdx[vi];
            const entry = id === undefined ? undefined : payloads.get(id);
            if (!entry) return [];
            const message = String(entry.message || "");
            return [
              {
                vi,
                color:
                  marksMap[entrySignature(entry)] ||
                  (typeof entry._mark === "string" ? entry._mark : undefined) ||
                  "#3b82f6",
                timestamp: fmtTimestamp(entry.timestamp as any),
                message:
                  message.length > 200 ? message.slice(0, 200) + "…" : message,
              },
            ];
          }),
        );
      })
      .catch((error) => {
        if (!cancelled)
          logger.error("Loading bookmark previews failed:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [markedIdx, filteredIdx, marksMap, repository]);

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
  const onListKeyDownRef = useRef(onListKeyDown);
  onListKeyDownRef.current = onListKeyDown;
  const stableOnListKeyDown = useCallback(
    (event: KeyboardEvent) => onListKeyDownRef.current(event),
    [],
  );

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
    // Abhängigkeit nur auf das tatsächliche Filterergebnis `filteredIdx`:
    // dieses spiegelt bereits neue Einträge UND jede Filteränderung wider.
    // Vorher hing der Effekt am rohen `filter`-Objekt und lief so bei JEDEM
    // Tastendruck im Filterfeld (setSelected + Scroll) – auch während das
    // eigentliche Filtern noch debounced war.
  }, [filteredIdx, follow]);

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
        // HTTP-Tail-Optionen für die Dialog-Vorbelegung übernehmen
        if (typeof r.httpTailEmitInitial === "boolean")
          setHttpTailEmitInitial(r.httpTailEmitInitial);
        if (typeof r.httpTailAllowInsecureSSL === "boolean")
          setHttpTailAllowInsecureSSL(r.httpTailAllowInsecureSSL);
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
  useEffect(
    () => () => {
      if (activeStreamSessionRef.current) {
        activeStreamCleanupRef.current?.();
      }
    },
    [],
  );

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
          void appendEntriesAsync(newEntries as any[])
            .then(() => announceAppend(newEntries as any[]))
            .catch((error) => {
              logger.error("Persisting appended IPC logs failed:", error);
            });
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
                await withBusy(async () => {
                  const paths = await typedOpenFiles();
                  if (paths && paths.length) {
                    await importPaths(paths);
                  }
                });
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
                void openHttpTailDialog();
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
          try {
            await importPaths(paths);
          } catch (error) {
            showAlertRef.current(
              tRef.current("errors.dropLoadError", {
                message:
                  error instanceof Error
                    ? error.message
                    : tRef.current("status.errorUnknown"),
              }),
            );
          }
        });
      },
      onActiveChange: (active) => setDragActive(active),
      onRawFiles: async (files) => {
        await withBusy(async () => {
          try {
            const res = await typedParseRawDrops(files);
            if (res?.ok) {
              await persistImportedEntries(res.entries as any[]);
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

  // Min/Max timestamps across ALL entries (ignoring active filters), used by
  // the Elastic-Search-Dialog quick-select buttons ("older than" / "newer than").
  // Filters must NOT influence these values, otherwise the user cannot easily
  // load entries outside the current filter window.
  const entriesTsRange = useMemo(() => {
    // O(n)-Scan über ALLE Einträge (inkl. Date-Parsing). Diese Werte werden
    // ausschließlich vom Elastic-Search-Dialog benötigt. Beim Streaming würde
    // die Berechnung sonst bei jedem `entries`-Append (bis ~mehrmals/Sekunde)
    // erneut über den kompletten Datensatz laufen und die UI ausbremsen.
    // Daher nur berechnen, wenn der Dialog tatsächlich geöffnet ist.
    if (!showTimeDialog) {
      return { firstTs: null as unknown, lastTs: null as unknown };
    }
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
  }, [entries, showTimeDialog]);

  const filteredStatsEntries = useMemo(() => {
    if (!showStatsDialog) return [];
    const visibleIds = new Set(filteredIdx);
    return entries.flatMap((entry) => {
      if (!visibleIds.has(entry._id)) return [];
      const timestamp =
        entry.timestamp instanceof Date
          ? entry.timestamp.getTime()
          : entry.timestamp;
      return [{ level: entry.level, logger: entry.logger, timestamp }];
    });
  }, [entries, filteredIdx, showStatsDialog]);

  const [traceTimelineEntries, setTraceTimelineEntries] = useState<any[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!showTraceTimeline || !traceTimelineId) {
      setTraceTimelineEntries([]);
      return;
    }

    const visibleIds = new Set(filteredIdx);
    const traceKeys = [
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
    void (async () => {
      const matchingIds: number[] = [];
      await repository.scanProjections((page) => {
        if (cancelled) return false;
        for (const projection of page) {
          if (!visibleIds.has(projection.id)) continue;
          const directMatch = projection.traceId === traceTimelineId;
          const mdcMatch = traceKeys.some(
            (key) => String(projection.mdc?.[key] ?? "") === traceTimelineId,
          );
          if (directMatch || mdcMatch) matchingIds.push(projection.id);
        }
        return true;
      });
      if (cancelled) return;

      const payloads: any[] = [];
      for (let start = 0; start < matchingIds.length; start += 256) {
        const page = await repository.getPayloads(
          matchingIds.slice(start, start + 256),
        );
        if (cancelled) return;
        payloads.push(...page.values());
      }
      payloads.sort(compareByTimestampId as any);
      if (!cancelled) setTraceTimelineEntries(payloads);
    })().catch((error) => {
      if (!cancelled) {
        logger.error("Loading trace timeline failed:", error);
        showAlert(error instanceof Error ? error.message : String(error));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [filteredIdx, repository, showAlert, showTraceTimeline, traceTimelineId]);

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
    activeStreamCleanupRef.current?.();
    clearEntries();
    setSelected(new Set());
    resetElasticSearchState();
    // Clear marksMap (session-only, not persisted)
    setMarksMap({});
    // Caches leeren für bessere Speicherfreigabe
    clearHighlightCache();
    clearTimestampCache();
    // PIT-Session schließen (best effort)
    void closePitQuiet();
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
      const exportEntries: any[] = [];
      for (let start = 0; start < currentFilteredIdx.length; start += 256) {
        const ids = currentFilteredIdx.slice(start, start + 256);
        const page = await repository.getPayloads(ids);
        for (const id of ids) {
          const entry = page.get(id);
          if (entry) exportEntries.push(entry);
        }
      }
      const exportEntriesHydrated = exportEntries;

      let content: string;

      if (format === "json") {
        // JSON export - include mark color explicitly
        const jsonEntries = exportEntriesHydrated.map((e) => ({
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
        const enriched = exportEntriesHydrated.map((e) => {
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
        virtualListRef.current?.scrollToIndex(0, "start");
      } catch {}
    },
    onGotoEnd: () => {
      try {
        const lastIdx = filteredIdx.length - 1;
        if (lastIdx >= 0) {
          virtualListRef.current?.scrollToIndex(lastIdx, "end");
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
    onOpenHttpTail: () => void openHttpTailDialog(),
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
        await withBusy(async () => {
          const result = await typedOpenFiles();
          if (result && result.length > 0) {
            await importPaths(result);
          }
        });
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

  const onClearLogs = useStableCallback(clearLogs);
  const onGotoListStart = useStableCallback(gotoListStart);
  const onGotoListEnd = useStableCallback(gotoListEnd);
  const onGotoMarked = useStableCallback(gotoMarked);
  const onSelectBookmark = useStableCallback((visualIndex: number) => {
    gotoBookmark(visualIndex);
    setShowBookmarks(false);
  });
  const onToggleBookmarks = useStableCallback(() => {
    setShowBookmarks((visible) => !visible);
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

  // Handler for the one-shot HTTP load dialog. Extracted from inline JSX.
  const handleHttpLoad = async (url: string) => {
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
  };

  // Handler for starting HTTP polling. Extracted from inline JSX.
  const handleHttpPollStart = async (url: string, sec: number) => {
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
  };

  // Handler for starting an incremental HTTP tail. Extracted from inline JSX.
  const handleHttpTailStart = async (args: {
    url: string;
    intervalSec: number;
    emitInitial: boolean;
    allowInsecureSSL: boolean;
    authHeader: string;
  }) => {
    try {
      // Zuletzt verwendete Werte merken, damit der Dialog nach einem
      // Neustart wieder vorbelegt werden kann (Auth-Header wird im
      // Hauptprozess verschlüsselt abgelegt).
      const intervalSec = Math.max(1, Math.round(args.intervalSec));
      setHttpUrl(args.url);
      setHttpInterval(intervalSec);
      setHttpTailEmitInitial(args.emitInitial);
      setHttpTailAllowInsecureSSL(args.allowInsecureSSL);
      setHttpTailAuthHeader(args.authHeader);
      void patchSettings({
        httpUrl: args.url,
        httpPollInterval: intervalSec,
        httpTailEmitInitial: args.emitInitial,
        httpTailAllowInsecureSSL: args.allowInsecureSSL,
        ...(args.authHeader
          ? { httpAuthHeaderPlain: args.authHeader }
          : { httpAuthHeaderClear: true }),
      });
      const headers: Record<string, string> = {};
      if (args.authHeader) headers.Authorization = args.authHeader;
      const r = await httpTail.start(args.url, {
        intervalMs: intervalSec * 1000,
        emitInitial: args.emitInitial,
        headers: Object.keys(headers).length ? headers : undefined,
        allowInsecureSSL: args.allowInsecureSSL,
      });
      if (!r.ok) {
        showAlert(t("httpTail.startFailed", { message: r.error || "" }));
      }
    } catch (e) {
      showAlert(
        t("httpTail.startFailed", {
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  };

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
            onApply={handleElasticApply}
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
          onLoad={handleHttpLoad}
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
          onStart={handleHttpPollStart}
        />
      </Suspense>

      {/* HTTP Tail Dialog – incremental Range-based polling */}
      <Suspense fallback={null}>
        <HttpTailDialog
          open={showHttpTailDialog}
          initialUrl={httpUrl}
          initialIntervalSec={Math.max(1, Math.round(httpInterval || 2))}
          initialEmitInitial={httpTailEmitInitial}
          initialAllowInsecureSSL={httpTailAllowInsecureSSL}
          initialAuthHeader={httpTailAuthHeader}
          isAnyTailActive={httpTail.tails.length > 0}
          onClose={() => setShowHttpTailDialog(false)}
          onStart={handleHttpTailStart}
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
        <ToolbarCounts
          countTotal={countTotal}
          countFiltered={countFiltered}
          countSelected={countSelected}
          lastFilterStats={lastFilterStats}
          entriesLength={entries.length}
          onClearLogs={onClearLogs}
          t={t}
        />
        <MarksNavigation
          countFiltered={countFiltered}
          markedCount={markedIdx.length}
          bookmarkItems={bookmarkItems}
          showBookmarks={showBookmarks}
          onGotoStart={onGotoListStart}
          onGotoEnd={onGotoListEnd}
          onGotoMarked={onGotoMarked}
          onToggleBookmarks={onToggleBookmarks}
          onSelectBookmark={onSelectBookmark}
          t={t}
        />
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
          t={t}
        />
        <StatusSection
          busy={busy}
          importProgress={importProgress}
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
            setTraceTimelineId={setTraceTimelineId}
            setShowTraceTimeline={setShowTraceTimeline}
            onClearAllFilters={clearAllFilters}
            dcVersion={dcVersion}
            timeVersion={timeVersion}
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
          onClearAllFilters={clearAllFilters}
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
        <VirtualizedLogList
          ref={virtualListRef}
          listRef={parentRef}
          entries={entries}
          repository={repository}
          filteredIdx={filteredIdx}
          selected={selected}
          marksMap={marksMap}
          search={search}
          follow={follow}
          onDisableFollow={handleDisableFollow}
          onKeyDown={stableOnListKeyDown}
          onRowSelect={handleRowSelect}
          onRowContextMenu={handleRowContextMenu}
          onColMouseDown={onColMouseDown}
          highlightFn={stableHighlightFn}
          t={t}
        >
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
                        await withBusy(async () => {
                          const paths = await typedOpenFiles();
                          if (paths && paths.length) {
                            await importPaths(paths);
                          }
                        });
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
                  onClick={clearAllFilters}
                >
                  ✕ {t("list.actionResetFilters")}
                </button>
              </div>
            </div>
          )}
        </VirtualizedLogList>

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
            entries={filteredStatsEntries}
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
            entries={traceTimelineEntries}
            traceId={traceTimelineId}
            onClose={() => setShowTraceTimeline(false)}
            onEntryClick={(entry) => {
              if (entry._id !== undefined) {
                setSelected(new Set([entry._id]));
                // Scroll to entry
                const idx = viOfGlobal(entry._id);
                if (idx >= 0) {
                  virtualListRef.current?.scrollToIndex(idx, "center");
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
