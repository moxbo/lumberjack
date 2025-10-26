/**
 * Preload script with contextBridge
 * Exposes a secure, typed API to the renderer process
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  ElectronAPI,
  LogEntry,
  TcpStatus,
  MenuCommand,
  SettingsResult,
  ParseResult,
  DroppedFile,
  ElasticSearchOptions,
  HttpPollResult,
  Result,
  Settings,
  WindowTitleResult,
} from './src/types/ipc';

/**
 * Secure API exposed to renderer via contextBridge
 */
const api: ElectronAPI = {
  // Settings operations
  settingsGet: (): Promise<SettingsResult> => ipcRenderer.invoke('settings:get'),

  settingsSet: (patch: Partial<Settings>): Promise<SettingsResult> =>
    ipcRenderer.invoke('settings:set', patch),

  // Window title (session) operations
  windowTitleGet: (): Promise<WindowTitleResult> => ipcRenderer.invoke('windowTitle:get'),
  windowTitleSet: (title: string): Promise<Result<void>> =>
    ipcRenderer.invoke('windowTitle:set', title),

  // Dialog operations
  openFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:openFiles'),

  chooseLogFile: (): Promise<string> => ipcRenderer.invoke('dialog:chooseLogFile'),

  // Log parsing operations
  parsePaths: (paths: string[]): Promise<ParseResult> =>
    ipcRenderer.invoke('logs:parsePaths', paths),

  parseRawDrops: (files: DroppedFile[]): Promise<ParseResult> =>
    ipcRenderer.invoke('logs:parseRaw', files),

  // TCP operations
  tcpStart: (port: number): void => {
    ipcRenderer.send('tcp:start', { port });
  },

  tcpStop: (): void => {
    ipcRenderer.send('tcp:stop');
  },

  // HTTP operations
  httpLoadOnce: (url: string): Promise<ParseResult> => ipcRenderer.invoke('http:loadOnce', url),

  httpStartPoll: (options: { url: string; intervalMs: number }): Promise<HttpPollResult> =>
    ipcRenderer.invoke('http:startPoll', options),

  httpStopPoll: (id: number): Promise<Result<void>> => ipcRenderer.invoke('http:stopPoll', id),

  // Elasticsearch operations
  elasticSearch: (options: ElasticSearchOptions): Promise<ParseResult> =>
    ipcRenderer.invoke('elastic:search', options),

  // Event listeners with proper cleanup
  onAppend: (callback: (entries: LogEntry[]) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, entries: LogEntry[]): void => {
      callback(entries);
    };
    ipcRenderer.on('logs:append', listener);
    // Return cleanup function
    return (): void => {
      ipcRenderer.removeListener('logs:append', listener);
    };
  },

  onTcpStatus: (callback: (status: TcpStatus) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, status: TcpStatus): void => {
      callback(status);
    };
    ipcRenderer.on('tcp:status', listener);
    // Return cleanup function
    return (): void => {
      ipcRenderer.removeListener('tcp:status', listener);
    };
  },

  onMenu: (callback: (command: MenuCommand) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, command: MenuCommand): void => {
      callback(command);
    };
    ipcRenderer.on('menu:cmd', listener);
    // Return cleanup function
    return (): void => {
      ipcRenderer.removeListener('menu:cmd', listener);
    };
  },
};

// Expose the API to the renderer process in a secure way
contextBridge.exposeInMainWorld('api', api);
