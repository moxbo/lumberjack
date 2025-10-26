/**
 * IPC Types and Contracts
 * Defines the typed API surface between main and renderer processes
 */

/**
 * Log entry structure
 */
export interface LogEntry {
  _id?: number;
  timestamp: string | number | Date;
  level: string;
  logger: string;
  thread?: string;
  message: string;
  traceId?: string;
  spanId?: string;
  source: string;
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
  tcpPort?: number;
  logToFile?: boolean;
  logFilePath?: string;
  logMaxBytes?: number;
  logMaxBackups?: number;
  elasticUrl?: string;
  elasticUser?: string;
  elasticPassEnc?: string;
  elasticSize?: number;
  themeMode?: 'system' | 'light' | 'dark';
  histLogger?: string[];
  httpUrl?: string;
  httpPollInterval?: number;
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

/**
 * Log parsing result
 */
export interface ParseResult {
  ok: boolean;
  entries?: LogEntry[];
  error?: string;
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
 * Elasticsearch search options
 */
export interface ElasticSearchOptions {
  url?: string;
  size?: number;
  query?: unknown;
  auth?: {
    type: 'basic';
    username: string;
    password: string;
  };
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
