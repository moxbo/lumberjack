/**
 * IPC Handlers
 * Handles IPC communication between main and renderer processes
 */

import { ipcMain, dialog, BrowserWindow } from 'electron';
import log from 'electron-log/main';
import * as path from 'path';
import type { Settings, ElasticSearchOptions, ParseResult, SettingsResult, DroppedFile } from '../types/ipc';
import type { SettingsService } from '../services/SettingsService';
import type { NetworkService } from '../services/NetworkService';

/**
 * Register all IPC handlers
 */
export function registerIpcHandlers(
  settingsService: SettingsService,
  networkService: NetworkService,
  getParsers: () => typeof import('./parsers.cjs'),
  getAdmZip: () => typeof import('adm-zip')
): void {
  // Settings handlers
  ipcMain.handle('settings:get', (): SettingsResult => {
    try {
      const settings = settingsService.get();
      return { ok: true, settings };
    } catch (err) {
      log.error('Error getting settings:', err instanceof Error ? err.message : String(err));
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('settings:set', (_event, patch: Partial<Settings>): SettingsResult => {
    try {
      if (!patch || typeof patch !== 'object') {
        return { ok: false, error: 'Invalid patch: not an object' };
      }

      // Handle sensitive fields not in schema: elasticPassPlain and elasticPassClear
      const passPlain = (patch as Record<string, unknown>).elasticPassPlain;
      const passClear = !!(patch as Record<string, unknown>).elasticPassClear;

      // Build patch sans sensitive transient fields
      const clone = { ...patch };
      delete (clone as Record<string, unknown>).elasticPassPlain;
      delete (clone as Record<string, unknown>).elasticPassClear;

      // Merge with validation
      const validation = settingsService.validate(clone);
      if (!validation.success) {
        return { ok: false, error: validation.error };
      }

      let updated = settingsService.update(clone);

      // Apply password updates after merge
      if (passClear) {
        updated.elasticPassEnc = '';
      } else if (passPlain && typeof passPlain === 'string' && passPlain.trim()) {
        updated.elasticPassEnc = settingsService.encryptSecret(passPlain.trim());
      }

      // Update again if password changed
      if (passClear || passPlain) {
        updated = settingsService.update(updated);
      }

      // Save to disk
      const saved = settingsService.saveSync();
      if (!saved) {
        return { ok: false, error: 'Failed to save settings to disk' };
      }

      return { ok: true, settings: settingsService.get() };
    } catch (err) {
      log.error('Error setting settings:', err instanceof Error ? err.message : String(err));
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Dialog handlers
  ipcMain.handle('dialog:openFiles', async (): Promise<string[]> => {
    const mainWindow = BrowserWindow.getFocusedWindow();
    if (!mainWindow) return [];

    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Logs', extensions: ['log', 'json', 'jsonl', 'txt', 'zip'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    
    if (res.canceled) return [];
    return res.filePaths || [];
  });

  ipcMain.handle('dialog:chooseLogFile', async (): Promise<string> => {
    const mainWindow = BrowserWindow.getFocusedWindow();
    if (!mainWindow) return '';

    const settings = settingsService.get();
    const defaultPath = settings.logFilePath && String(settings.logFilePath).trim();

    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Logdatei wählen',
      defaultPath: defaultPath || undefined,
      filters: [
        { name: 'Logdateien', extensions: ['log', 'jsonl', 'txt'] },
        { name: 'Alle Dateien', extensions: ['*'] },
      ],
    });
    
    if (res.canceled) return '';
    return res.filePath || '';
  });

  // Log parsing handlers
  ipcMain.handle('logs:parsePaths', async (_event, filePaths: string[]): Promise<ParseResult> => {
    try {
      const { parsePaths } = getParsers();
      const entries = parsePaths(filePaths);
      return { ok: true, entries };
    } catch (err) {
      log.error('Error parsing paths:', err instanceof Error ? err.message : String(err));
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('logs:parseRaw', async (_event, files: DroppedFile[]): Promise<ParseResult> => {
    try {
      if (!Array.isArray(files) || !files.length) return { ok: true, entries: [] };
      
      const { parseJsonFile, parseTextLines } = getParsers();
      const ZipClass = getAdmZip();
      const all = [];
      
      for (const f of files) {
        const name = String(f?.name || '');
        const enc = String(f?.encoding || 'utf8');
        const data = String(f?.data || '');
        const ext = path.extname(name).toLowerCase();
        
        if (!name || !data) continue;
        
        if (ext === '.zip') {
          const buf = Buffer.from(data, enc === 'base64' ? 'base64' : 'utf8');
          const zip = new ZipClass(buf);
          
          zip.getEntries().forEach((zEntry) => {
            const ename = zEntry.entryName;
            const eext = path.extname(ename).toLowerCase();
            
            if (
              !zEntry.isDirectory &&
              (eext === '.log' || eext === '.json' || eext === '.jsonl' || eext === '.txt')
            ) {
              const text = zEntry.getData().toString('utf8');
              const parsed =
                eext === '.json' ? parseJsonFile(ename, text) : parseTextLines(ename, text);
              parsed.forEach((e) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (e as any).source = `${name}::${ename}`;
              });
              all.push(...parsed);
            }
          });
        } else if (ext === '.json') {
          const entries = parseJsonFile(name, data);
          all.push(...entries);
        } else {
          const entries = parseTextLines(name, data);
          all.push(...entries);
        }
      }
      
      return { ok: true, entries: all };
    } catch (err) {
      log.error('Error parsing raw drops:', err instanceof Error ? err.message : String(err));
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // TCP handlers
  ipcMain.on('tcp:start', (event, { port }: { port: number }) => {
    try {
      const status = networkService.startTcpServer(port);
      event.reply('tcp:status', status);
      
      // Save port to settings if successful
      if (status.ok) {
        const settings = settingsService.get();
        settings.tcpPort = port;
        settingsService.update(settings);
        void settingsService.save();
      }
    } catch (err) {
      log.error('Error starting TCP server:', err instanceof Error ? err.message : String(err));
      event.reply('tcp:status', {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  ipcMain.on('tcp:stop', (event) => {
    try {
      const status = networkService.stopTcpServer();
      event.reply('tcp:status', status);
    } catch (err) {
      log.error('Error stopping TCP server:', err instanceof Error ? err.message : String(err));
      event.reply('tcp:status', {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // HTTP handlers
  ipcMain.handle('http:loadOnce', async (_event, url: string): Promise<ParseResult> => {
    return await networkService.httpLoadOnce(url);
  });

  ipcMain.handle(
    'http:startPoll',
    async (_event, { url, intervalMs }: { url: string; intervalMs: number }) => {
      return await networkService.httpStartPoll(url, intervalMs);
    }
  );

  ipcMain.handle('http:stopPoll', async (_event, id: number) => {
    return networkService.httpStopPoll(id);
  });

  // Elasticsearch handler
  ipcMain.handle('elastic:search', async (_event, opts: ElasticSearchOptions): Promise<ParseResult> => {
    try {
      const settings = settingsService.get();
      const { fetchElasticLogs } = getParsers();
      
      const url = opts.url || settings.elasticUrl || '';
      const size = opts.size || settings.elasticSize || 1000;
      
      const auth = (() => {
        const user = settings.elasticUser || '';
        const pass = settingsService.decryptSecret(settings.elasticPassEnc || '');
        if (user && pass) {
          return { type: 'basic' as const, username: user, password: pass };
        }
        return undefined;
      })();
      
      const mergedOpts = {
        ...opts,
        url,
        size,
        auth: opts.auth || auth,
      };
      
      if (!mergedOpts.url) {
        throw new Error('Elasticsearch URL ist nicht konfiguriert');
      }

      const entries = await fetchElasticLogs(mergedOpts);
      return { ok: true, entries };
    } catch (err) {
      log.error('Elasticsearch search failed:', err instanceof Error ? err.message : String(err));
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
