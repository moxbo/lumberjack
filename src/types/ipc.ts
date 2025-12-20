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

  // HTTP
  httpUrl?: string;
  httpPollInterval?: number;

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

  // Feature Flags (persisted disabled features)
  disabledFeatures?: Record<string, string | true>; // feature -> reason or true

  // Auto-Update
  /** Allow pre-release/beta updates (default: false - only stable releases) */
  allowPrerelease?: boolean;
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
  | { type: "tcp-configure" }
  | { type: "tcp-start" }
  | { type: "tcp-stop" }
  | { type: "window-title" }
  | { type: "export-view" };

/**
 * Export options for saving the current view
 */
export interface ExportViewOptions {
  format: "html" | "txt" | "json";
  includeStyles?: boolean;
  title?: string;
}

/**
 * Export path result (from save dialog)
 */
export interface ExportPathResult {
  ok: boolean;
  filePath?: string;
  format?: "html" | "txt" | "json";
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
    | "error";
  info?: {
    version: string;
    releaseDate?: string;
    releaseNotes?: string;
  };
  progress?: {
    percent: number;
    bytesPerSecond: number;
    transferred: number;
    total: number;
  };
  error?: string;
}

/**
 * Auto-Updater status result
 */
export interface AutoUpdaterStatusResult {
  updateDownloaded: boolean;
  isChecking: boolean;
  allowPrerelease: boolean;
}

/**
 * Main API exposed to renderer via contextBridge
 */
export type ElectronAPI = {
  settingsGet: () => Promise<SettingsResult>;
  settingsSet: (patch: Partial<Settings>) => Promise<SettingsResult>;
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
  // Auto-Updater
  autoUpdaterCheck: () => Promise<unknown>;
  autoUpdaterDownload: () => Promise<void>;
  autoUpdaterInstall: () => Promise<void>;
  autoUpdaterStatus: () => Promise<AutoUpdaterStatusResult>;
  autoUpdaterGetAllowPrerelease: () => Promise<boolean>;
  autoUpdaterSetAllowPrerelease: (allow: boolean) => Promise<Result<void>>;
  onAutoUpdaterStatus: (
    callback: (status: AutoUpdaterStatus) => void,
  ) => () => void;
};

declare global {
  interface Window {
    api: ElectronAPI;
    electronAPI?: ElectronAPI;
  }
}
