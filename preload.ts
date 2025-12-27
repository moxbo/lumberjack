/**
 * Preload script with contextBridge
 * Exposes a secure, typed API to the renderer process
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  AutoUpdaterStatus,
  DroppedFile,
  ElasticSearchOptions,
  ElectronAPI,
  ExportPathResult,
  ExportResult,
  ExportViewOptions,
  HttpPollResult,
  LogEntry,
  MenuCommand,
  ParseResult,
  Result,
  Settings,
  SettingsResult,
  TcpStatus,
  WindowTitleResult,
} from "./src/types/ipc";

/**
 * Secure API exposed to renderer via contextBridge
 */
const api: ElectronAPI = {
  // Settings operations
  settingsGet: (): Promise<SettingsResult> =>
    ipcRenderer.invoke("settings:get"),

  settingsSet: (patch: Partial<Settings>): Promise<SettingsResult> =>
    ipcRenderer.invoke("settings:set", patch),

  getDefaultLogPath: (): Promise<string> =>
    ipcRenderer.invoke("settings:getDefaultLogPath"),

  // Window title (session) operations
  windowTitleGet: (): Promise<WindowTitleResult> =>
    ipcRenderer.invoke("windowTitle:get"),
  windowTitleSet: (title: string): Promise<Result<void>> =>
    ipcRenderer.invoke("windowTitle:set", title),

  // Per-window permissions
  windowPermsGet: (): Promise<{
    ok: boolean;
    canTcpControl?: boolean;
    error?: string;
  }> => ipcRenderer.invoke("windowPerms:get"),
  windowPermsSet: (patch: { canTcpControl?: boolean }): Promise<Result<void>> =>
    ipcRenderer.invoke("windowPerms:set", patch),

  // Dialog operations
  openFiles: (): Promise<string[]> => ipcRenderer.invoke("dialog:openFiles"),

  chooseLogFile: (): Promise<string> =>
    ipcRenderer.invoke("dialog:chooseLogFile"),

  // Export view operations
  chooseExportPath: (): Promise<ExportPathResult> =>
    ipcRenderer.invoke("dialog:chooseExportPath"),

  saveExportFile: (filePath: string, content: string): Promise<ExportResult> =>
    ipcRenderer.invoke("dialog:saveExportFile", filePath, content),

  exportView: (
    content: string,
    options: ExportViewOptions,
  ): Promise<ExportResult> =>
    ipcRenderer.invoke("dialog:exportView", content, options),

  // Log parsing operations
  parsePaths: (paths: string[]): Promise<ParseResult> =>
    ipcRenderer.invoke("logs:parsePaths", paths),

  parseRawDrops: (files: DroppedFile[]): Promise<ParseResult> =>
    ipcRenderer.invoke("logs:parseRaw", files),

  // TCP operations
  tcpStart: (port: number): void => {
    ipcRenderer.send("tcp:start", { port });
  },

  tcpStop: (): void => {
    ipcRenderer.send("tcp:stop");
  },

  // HTTP operations
  httpLoadOnce: (url: string): Promise<ParseResult> =>
    ipcRenderer.invoke("http:loadOnce", url),

  httpStartPoll: (options: {
    url: string;
    intervalSec: number;
  }): Promise<HttpPollResult> => ipcRenderer.invoke("http:startPoll", options),

  httpStopPoll: (id: number): Promise<Result<void>> =>
    ipcRenderer.invoke("http:stopPoll", id),

  // Elasticsearch operations
  elasticSearch: (options: ElasticSearchOptions): Promise<ParseResult> =>
    ipcRenderer.invoke("elastic:search", options),

  elasticClosePit: (sessionId: string) =>
    ipcRenderer.invoke("elastic:closePit", sessionId),

  // Event listeners with proper cleanup
  onAppend: (callback: (entries: LogEntry[]) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, entries: LogEntry[]): void => {
      callback(entries);
    };
    ipcRenderer.on("logs:append", listener);
    // Return cleanup function
    return (): void => {
      ipcRenderer.removeListener("logs:append", listener);
    };
  },

  onTcpStatus: (callback: (status: TcpStatus) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, status: TcpStatus): void => {
      callback(status);
    };
    ipcRenderer.on("tcp:status", listener);
    // Return cleanup function
    return (): void => {
      ipcRenderer.removeListener("tcp:status", listener);
    };
  },

  onMenu: (callback: (command: MenuCommand) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, command: MenuCommand): void => {
      callback(command);
    };
    ipcRenderer.on("menu:cmd", listener);
    // Return cleanup function
    return (): void => {
      ipcRenderer.removeListener("menu:cmd", listener);
    };
  },

  // Error logging from renderer to main process
  logError: (errorData: unknown): Promise<Result<void>> =>
    ipcRenderer.invoke("logError", errorData),

  // FeatureFlags operations
  featureFlagsGetAll: (): Promise<{
    features: Record<string, { enabled: boolean; reason?: string }>;
    stats: { total: number; enabled: number; disabled: number };
  }> => ipcRenderer.invoke("featureFlags:getAll"),

  featureFlagsIsEnabled: (feature: string): Promise<boolean> =>
    ipcRenderer.invoke("featureFlags:isEnabled", feature),

  featureFlagsDisable: (
    feature: string,
    reason?: string,
  ): Promise<Result<void>> =>
    ipcRenderer.invoke("featureFlags:disable", { feature, reason }),

  featureFlagsEnable: (feature: string): Promise<Result<void>> =>
    ipcRenderer.invoke("featureFlags:enable", feature),

  featureFlagsResetAll: (): Promise<Result<void>> =>
    ipcRenderer.invoke("featureFlags:resetAll"),

  // App operations
  appRelaunch: (): Promise<Result<void>> => ipcRenderer.invoke("app:relaunch"),

  // Auto-updater operations
  autoUpdaterCheck: (): Promise<unknown> =>
    ipcRenderer.invoke("auto-updater:check"),

  autoUpdaterDownload: (): Promise<void> =>
    ipcRenderer.invoke("auto-updater:download"),

  autoUpdaterInstall: (): Promise<void> =>
    ipcRenderer.invoke("auto-updater:install"),

  autoUpdaterStatus: (): Promise<{
    updateDownloaded: boolean;
    isChecking: boolean;
    allowPrerelease: boolean;
  }> => ipcRenderer.invoke("auto-updater:status"),

  autoUpdaterGetAllowPrerelease: (): Promise<boolean> =>
    ipcRenderer.invoke("auto-updater:getAllowPrerelease"),

  autoUpdaterSetAllowPrerelease: (allow: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("auto-updater:setAllowPrerelease", allow),

  onAutoUpdaterStatus: (
    callback: (status: AutoUpdaterStatus) => void,
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      status: AutoUpdaterStatus,
    ): void => {
      callback(status);
    };
    ipcRenderer.on("auto-updater:status", listener);
    return (): void => {
      ipcRenderer.removeListener("auto-updater:status", listener);
    };
  },

  // Memory critical warning listener
  onMemoryCritical: (
    callback: (data: {
      heapUsedMB: number;
      heapTotalMB: number;
      heapPercent: number;
    }) => void,
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      data: { heapUsedMB: number; heapTotalMB: number; heapPercent: number },
    ): void => {
      callback(data);
    };
    ipcRenderer.on("memory:critical", listener);
    return (): void => {
      ipcRenderer.removeListener("memory:critical", listener);
    };
  },
};

// Expose the API to the renderer process in a secure way
contextBridge.exposeInMainWorld("api", api);
contextBridge.exposeInMainWorld("electronAPI", api); // Also expose as electronAPI for consistency
