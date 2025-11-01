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
  themeMode?: 'system' | 'light' | 'dark';
  // NEW: UI language (moved LanguageSelector into Settings > Appearance)
  locale?: 'de' | 'en';

  // Histories
  histLogger?: string[];

  // NEW: ElasticSearch dropdown histories
  histAppName?: string[];
  histEnvironment?: string[];
  // NEW: Index history (analog application_name)
  histIndex?: string[];
  // NEW: persist last chosen Environment-Case across sessions
  lastEnvironmentCase?: 'original' | 'lower' | 'upper' | 'case-sensitive';

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

  // Markierungen
  marksMap?: Record<string, string>; // signature -> color
  customMarkColors?: string[]; // temporäre Palette
  onlyMarked?: boolean; // UI-Filter: nur markierte anzeigen

  // Elasticsearch Performance
  elasticMaxParallel?: number; // maximale parallele Seiten (1 = sequentiell)
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
  | { type: 'basic'; username: string; password: string }
  | { type: 'apiKey' | 'bearer'; token: string };

/**
 * Elasticsearch search options
 * Matches main parsers' fetchElasticLogs signature
 */
export interface ElasticSearchOptions {
  url?: string; // base URL, e.g., https://es:9200
  index?: string; // e.g., logs-*
  size?: number; // default 1000
  sort?: 'asc' | 'desc'; // default desc

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
  environmentCase?: 'original' | 'lower' | 'upper' | 'case-sensitive';

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
  | { type: 'open-files' }
  | { type: 'open-settings'; tab?: string }
  | { type: 'http-load' }
  | { type: 'http-start-poll' }
  | { type: 'http-stop-poll' }
  | { type: 'tcp-configure' }
  | { type: 'tcp-start' }
  | { type: 'tcp-stop' }
  | { type: 'window-title' };

/**
 * Dropped file structure from renderer
 */
export interface DroppedFile {
  name: string;
  encoding: string;
  data: string;
}

/**
 * Main API exposed to renderer via contextBridge
 */
export interface ElectronAPI {
  // Settings
  settingsGet: () => Promise<SettingsResult>;
  settingsSet: (patch: Partial<Settings>) => Promise<SettingsResult>;

  // Window title (session)
  windowTitleGet: () => Promise<WindowTitleResult>;
  windowTitleSet: (title: string) => Promise<Result<void>>;

  // Per-window permissions (not persisted in Settings)
  windowPermsGet: () => Promise<WindowPermsResult>;
  windowPermsSet: (patch: { canTcpControl?: boolean }) => Promise<Result<void>>;

  // Dialogs
  openFiles: () => Promise<string[]>;
  chooseLogFile: () => Promise<string>;

  // Log parsing
  parsePaths: (paths: string[]) => Promise<ParseResult>;
  parseRawDrops: (files: DroppedFile[]) => Promise<ParseResult>;

  // TCP operations
  tcpStart: (port: number) => void;
  tcpStop: () => void;

  // HTTP operations
  httpLoadOnce: (url: string) => Promise<ParseResult>;
  httpStartPoll: (options: { url: string; intervalMs: number }) => Promise<HttpPollResult>;
  httpStopPoll: (id: number) => Promise<Result<void>>;

  // Elasticsearch
  elasticSearch: (options: ElasticSearchOptions) => Promise<ParseResult>;
  elasticClosePit: (sessionId: string) => Promise<Result<void>>;

  // Event listeners
  onAppend: (callback: (entries: LogEntry[]) => void) => () => void;
  onTcpStatus: (callback: (status: TcpStatus) => void) => () => void;
  onMenu: (callback: (command: MenuCommand) => void) => () => void;
}

/**
 * Extend Window interface with our API
 */
declare global {
  interface Window {
    api: ElectronAPI;
  }
}
