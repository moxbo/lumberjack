/**
 * IPC Types and Contracts
 * Defines the typed API surface between main and renderer processes
 */

/**
 * Log entry structure
 */
export interface LogEntry {
  _id?: number;
  timestamp: string | number | Date | null;
  level?: string | null;
  logger?: string | null;
  thread?: string | null;
  message: string;
  /** Original full message before truncation (only set if truncated) */
  _fullMessage?: string;
  /** Flag indicating this entry was truncated for display */
  _truncated?: boolean;
  traceId?: string | null;
  spanId?: string | null;
  stackTrace?: string | null;
  source: string;
  raw?: unknown;
  mdc?: Record<string, unknown>;
  mark?: string | null;
  [key: string]: unknown;
}

/**
 * Settings structure
 */
export interface Settings {
  windowBounds?: {
    width: number;
    height: number;
    x?: number;
    y?: number;
  };
  isMaximized: boolean;
  tcpPort?: number;
  logToFile?: boolean;
  logFilePath?: string;
  logMaxBytes?: number;
  logMaxBackups?: number;

  // Elasticsearch
  elasticUrl?: string;
  elasticUser?: string;
  elasticPassEnc?: string;
  elasticSize?: number;

  // Appearance
  themeMode?: "system" | "light" | "dark";
  // NEW: UI language (moved LanguageSelector into Settings > Appearance)
  locale?: "de" | "en";

  // Histories
  histLogger?: string[];

  // NEW: ElasticSearch dropdown histories
  histAppName?: string[];
  histEnvironment?: string[];
  // NEW: Index history (analog application_name)
  histIndex?: string[];
  // NEW: persist last chosen Environment-Case across sessions
  lastEnvironmentCase?: "original" | "lower" | "upper" | "case-sensitive";
  // NEW: persist last used timestamp field for the ES time-range filter
  lastTimestampField?: string;

  // HTTP
  httpUrl?: string;
  httpPollInterval?: number;
  /** Last used "emit initial content" flag for the HTTP tail dialog */
  httpTailEmitInitial?: boolean;
  /** Last used "allow insecure SSL" flag for the HTTP tail dialog */
  httpTailAllowInsecureSSL?: boolean;
  /** Encrypted HTTP auth header (never returned in plaintext by settingsGet) */
  httpAuthHeaderEnc?: string;
  /** Plaintext auth header to encrypt and store (write-only, used during settingsSet) */
  httpAuthHeaderPlain?: string;
  /** Set to true to clear the stored encrypted auth header */
  httpAuthHeaderClear?: boolean;

  // UI runtime prefs (persisted)
  follow?: boolean;
  followSmooth?: boolean;
  detailHeight?: number;
  colTs?: number;
  colLvl?: number;
  colLogger?: number;

  // Message display settings
  /** Maximum message length in list view before truncation (default: 10240 = 10KB) */
  messageTruncateLength?: number;
  /** Show full messages in detail panel by default */
  detailShowFullMessage?: boolean;

  // Markierungen
  marksMap?: Record<string, string>; // signature -> color
  customMarkColors?: string[]; // temporäre Palette
  onlyMarked?: boolean; // UI-Filter: nur markierte anzeigen

  // Elasticsearch Performance
  elasticMaxParallel?: number; // maximale parallele Seiten (1 = sequentiell)

  // Elasticsearch password operations (write-only, used during settingsSet)
  /** Set to true to clear the stored encrypted password */
  elasticPassClear?: boolean;
  /** Plaintext password to encrypt and store (never returned by settingsGet) */
  elasticPassPlain?: string;

  // Feature Flags (persisted disabled features)
  disabledFeatures?: Record<string, string | true>; // feature -> reason or true

  // Auto-Update
  /** Allow pre-release/beta updates (default: false - only stable releases) */
  allowPrerelease?: boolean;

  // Performance / Memory
  /** V8 heap size in MB (default: 4096, min: 512, max: 8192). Requires restart. */
  heapSizeMB?: number;
}

/**
 * Result type for async operations
 */
export interface Result<T> {
  ok: boolean;
  error?: string;
  data?: T;
}

/**
 * Settings operations result
 */
export interface SettingsResult {
  ok: boolean;
  settings?: Settings;
  error?: string;
}

// Window title result (session-scoped)
export interface WindowTitleResult {
  ok: boolean;
  title?: string;
  error?: string;
}

// Per-Window permissions
export interface WindowPermsResult {
  ok: boolean;
  canTcpControl?: boolean;
  error?: string;
}

/**
 * Log parsing result
 */
export interface ParseResult {
  ok: boolean;
  entries?: LogEntry[];
  error?: string;
  // Pagination info for Elasticsearch queries
  hasMore?: boolean;
  nextSearchAfter?: Array<string | number> | null;
  total?: number;
  // PIT session id for deep pagination lifecycle
  pitSessionId?: string | null;
}

/**
 * TCP status
 */
export interface TcpStatus {
  ok: boolean;
  message: string;
  running?: boolean;
  port?: number;
}

/**
 * Elasticsearch auth options
 */
export type ElasticAuth =
  | { type: "basic"; username: string; password: string }
  | { type: "apiKey" | "bearer"; token: string };

/**
 * Elasticsearch search options
 * Matches main parsers' fetchElasticLogs signature
 */
export interface ElasticSearchOptions {
  url?: string; // base URL, e.g., https://es:9200
  index?: string; // e.g., logs-*
  size?: number; // default 1000
  sort?: "asc" | "desc"; // default desc

  // time window
  from?: string | Date; // ISO string or Date
  to?: string | Date; // ISO string or Date
  duration?: string; // e.g., 15m, 4h, 7d (now-duration .. now)

  // common filters
  logger?: string;
  level?: string;
  message?: string;
  application_name?: string;
  environment?: string;
  // NEW: case handling for environment
  environmentCase?: "original" | "lower" | "upper" | "case-sensitive";
  /**
   * Timestamp field used for the time-range filter AND sorting (default `@timestamp`).
   * Must match the index's time field (like Kibana's data-view time field).
   */
  timestampField?: string;

  // auth and TLS
  auth?: ElasticAuth;
  allowInsecureTLS?: boolean;

  // Pagination: ES search_after token from previous page (array of sort values)
  searchAfter?: Array<string | number>;

  // PIT & performance options
  keepAlive?: string; // e.g., '1m'
  trackTotalHits?: boolean | number; // default false
  sourceIncludes?: string[]; // _source includes
  sourceExcludes?: string[]; // _source excludes
  pitSessionId?: string; // reuse existing PIT session
  timeoutMs?: number; // request timeout
  maxRetries?: number; // retry count for 429/5xx/timeouts
  backoffBaseMs?: number; // base for exponential backoff
}

/**
 * HTTP poll result
 */
export interface HttpPollResult {
  ok: boolean;
  id?: number;
  error?: string;
}

/**
 * Menu command types
 */
export type MenuCommand =
  | { type: "open-files" }
  | { type: "open-settings"; tab?: string }
  | { type: "http-load" }
  | { type: "http-start-poll" }
  | { type: "http-stop-poll" }
  | { type: "http-tail-start" }
  | { type: "http-tail-stop-all" }
  | { type: "tcp-configure" }
  | { type: "tcp-start" }
  | { type: "tcp-stop" }
  | { type: "window-title" }
  | { type: "export-view" };

/**
 * Supported export formats.
 * - html: rich, themed table with colours (best for sharing)
 * - txt:  plain text, one entry per line
 * - json: structured array (lossless, all fields)
 * - ndjson: newline-delimited JSON (streamable, log-pipeline friendly)
 * - csv:   spreadsheet-friendly (Excel/Numbers/Sheets)
 * - md:    GitHub-flavoured Markdown table
 */
export type ExportFormat = "html" | "txt" | "json" | "ndjson" | "csv" | "md";

/**
 * Export options for saving the current view
 */
export interface ExportViewOptions {
  format: ExportFormat;
  includeStyles?: boolean;
  title?: string;
}

/**
 * Export path result (from save dialog)
 */
export interface ExportPathResult {
  ok: boolean;
  filePath?: string;
  format?: ExportFormat;
  error?: string;
}

/**
 * Export result
 */
export interface ExportResult {
  ok: boolean;
  filePath?: string;
  error?: string;
}

/**
 * Dropped file structure from renderer
 */
export interface DroppedFile {
  name: string;
  encoding: string;
  data: string;
}

/**
 * Feature flags result
 */
export interface FeatureFlagsResult {
  features: Record<string, { enabled: boolean; reason?: string }>;
  stats: { total: number; enabled: number; disabled: number };
}

/**
 * Auto-Updater status
 */
export interface AutoUpdaterStatus {
  status:
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "error"
    | "available-portable";
  info?: {
    version: string;
    releaseDate?: string;
    releaseNotes?: string;
    releaseUrl?: string;
  };
  progress?: {
    percent: number;
    bytesPerSecond: number;
    transferred: number;
    total: number;
  };
  error?: string;
  isPortable?: boolean;
}

/**
 * Auto-Updater status result
 */
export interface AutoUpdaterStatusResult {
  updateDownloaded: boolean;
  isChecking: boolean;
  allowPrerelease: boolean;
  autoUpdatesAvailable: boolean;
  isPortable: boolean;
}

/**
 * Main API exposed to renderer via contextBridge
 */
export type ElectronAPI = {
  settingsGet: () => Promise<SettingsResult>;
  settingsSet: (patch: Partial<Settings>) => Promise<SettingsResult>;
  getDefaultLogPath: () => Promise<string>;
  windowTitleGet: () => Promise<WindowTitleResult>;
  windowTitleSet: (title: string) => Promise<Result<void>>;
  windowPermsGet: () => Promise<WindowPermsResult>;
  windowPermsSet: (patch: { canTcpControl?: boolean }) => Promise<Result<void>>;
  openFiles: () => Promise<string[]>;
  chooseLogFile: () => Promise<string>;
  chooseExportPath: () => Promise<ExportPathResult>;
  saveExportFile: (filePath: string, content: string) => Promise<ExportResult>;
  exportView: (
    content: string,
    options: ExportViewOptions,
  ) => Promise<ExportResult>;
  parsePaths: (paths: string[]) => Promise<ParseResult>;
  parseRawDrops: (files: DroppedFile[]) => Promise<ParseResult>;
  tcpStart: (port: number) => void;
  tcpStop: () => void;
  httpLoadOnce: (url: string) => Promise<ParseResult>;
  httpStartPoll: (options: {
    url: string;
    intervalSec: number;
  }) => Promise<HttpPollResult>;
  httpStopPoll: (id: number) => Promise<Result<void>>;
  // HTTP insecure SSL options
  httpSetAllowInsecureSSL: (allow: boolean) => Promise<{ ok: boolean }>;
  httpGetAllowInsecureSSL: () => Promise<boolean>;
  elasticSearch: (options: ElasticSearchOptions) => Promise<ParseResult>;
  elasticClosePit: (sessionId: string) => Promise<Result<void>>;
  onAppend: (callback: (entries: LogEntry[]) => void) => () => void;
  onTcpStatus: (callback: (status: TcpStatus) => void) => () => void;
  onMenu: (callback: (command: MenuCommand) => void) => () => void;
  logError: (errorData: unknown) => Promise<Result<void>>;
  // FeatureFlags
  featureFlagsGetAll: () => Promise<FeatureFlagsResult>;
  featureFlagsIsEnabled: (feature: string) => Promise<boolean>;
  featureFlagsDisable: (
    feature: string,
    reason?: string,
  ) => Promise<Result<void>>;
  featureFlagsEnable: (feature: string) => Promise<Result<void>>;
  featureFlagsResetAll: () => Promise<Result<void>>;
  // App operations
  appRelaunch: () => Promise<Result<void>>;
  // Auto-Updater
  autoUpdaterCheck: () => Promise<unknown>;
  autoUpdaterDownload: () => Promise<void>;
  autoUpdaterInstall: () => Promise<void>;
  autoUpdaterStatus: () => Promise<AutoUpdaterStatusResult>;
  autoUpdaterGetAllowPrerelease: () => Promise<boolean>;
  autoUpdaterSetAllowPrerelease: (allow: boolean) => Promise<Result<void>>;
  autoUpdaterOpenReleasePage: () => Promise<void>;
  onAutoUpdaterStatus: (
    callback: (status: AutoUpdaterStatus) => void,
  ) => () => void;
  // Memory warning
  onMemoryCritical: (
    callback: (data: {
      heapUsedMB: number;
      heapTotalMB: number;
      heapPercent: number;
    }) => void,
  ) => () => void;
  // Window focus - helps fix input issues when switching between windows
  onWindowFocus: (callback: () => void) => () => void;
  // Filter UtilityProcess API (Electron 40+)
  filterEntries: (
    entries: unknown[],
    options: FilterOptions,
  ) => Promise<FilterResult>;
  filterIsAvailable: () => Promise<{ ok: boolean; available: boolean }>;
  // Filter Profiles – file-based persistence (shared across all processes)
  filterProfilesGetAll: () => Promise<{
    ok: boolean;
    profiles: unknown[];
    error?: string;
  }>;
  filterProfilesSave: (
    profiles: unknown[],
  ) => Promise<{ ok: boolean; error?: string }>;
  onFilterProfilesChanged: (callback: () => void) => () => void;

  // Alert Rules – file-based persistence + native notifications
  alertRulesGetAll: () => Promise<{
    ok: boolean;
    rules: unknown[];
    error?: string;
  }>;
  alertRulesSave: (
    rules: unknown[],
  ) => Promise<{ ok: boolean; error?: string }>;
  onAlertRulesChanged: (callback: () => void) => () => void;
  notificationShow: (args: {
    title: string;
    body: string;
    severity?: "info" | "warning" | "critical";
  }) => Promise<{ ok: boolean; error?: string }>;

  // File watching (tail mode for local files)
  watchStart: (args: {
    filePath: string;
    emitInitial?: boolean;
    pollIntervalMs?: number;
  }) => Promise<{
    ok: boolean;
    id?: number;
    filePath?: string;
    error?: string;
  }>;
  watchStop: (id: number) => Promise<{ ok: boolean; error?: string }>;
  watchList: () => Promise<{
    ok: boolean;
    watchers: Array<{ id: number; filePath: string }>;
  }>;
  onWatchStatus: (
    callback: (payload: {
      type: "started" | "stopped" | "rotated" | "error" | "lines";
      id: number;
      filePath: string;
      lineCount?: number;
      message?: string;
    }) => void,
  ) => () => void;

  // HTTP Tail (incremental Range-based polling, e.g. Spring Boot Actuator)
  httpTailStart: (args: {
    url: string;
    intervalMs?: number;
    emitInitial?: boolean;
    headers?: Record<string, string>;
    allowInsecureSSL?: boolean;
  }) => Promise<{
    ok: boolean;
    id?: number;
    url?: string;
    error?: string;
  }>;
  httpTailStop: (id: number) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Notify the main process about the number of currently active HTTP tails
   * for this renderer window. The native menu uses this to enable/disable the
   * "Stop HTTP tail" entry without having to query the renderer.
   */
  httpTailNotifyActiveCount: (count: number) => void;
  httpTailList: () => Promise<{
    ok: boolean;
    tails: Array<{ id: number; url: string; offset: number }>;
  }>;
  /**
   * Return the decrypted HTTP auth header stored in settings so the tail
   * dialog can be pre-filled after a restart. Never exposed via settingsGet.
   */
  httpTailGetAuthHeader: () => Promise<{
    ok: boolean;
    authHeader: string;
    error?: string;
  }>;
  onHttpTailStatus: (
    callback: (payload: {
      type: "started" | "stopped" | "rotated" | "error" | "lines" | "progress";
      id: number;
      url: string;
      lineCount?: number;
      offset?: number;
      total?: number;
      message?: string;
    }) => void,
  ) => () => void;
};

/**
 * Filter options for UtilityProcess filtering
 */
export interface FilterOptions {
  stdFiltersEnabled: boolean;
  filter: {
    level: string;
    logger: string;
    thread: string;
    message: string;
  };
  onlyMarked: boolean;
  dcFilterEnabled: boolean;
  dcFilterEntries: Array<{ key: string; value: string; active: boolean }>;
  timeFilterEnabled: boolean;
  timeFilterFrom?: string;
  timeFilterTo?: string;
}

/**
 * Filter result from UtilityProcess
 */
export interface FilterResult {
  ok: boolean;
  error?: string;
  filteredIndices: number[];
  stats: FilterStats;
}

/**
 * Filter statistics
 */
export interface FilterStats {
  total: number;
  passed: number;
  rejectedByOnlyMarked: number;
  rejectedByLevel: number;
  rejectedByLogger: number;
  rejectedByThread: number;
  rejectedByMessage: number;
  rejectedByTime: number;
  rejectedByDC: number;
  processingTimeMs?: number;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
