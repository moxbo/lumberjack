/**
 * Main Process (TypeScript)
 * Entry point for the Electron application with modern standards
 */

import { app, BrowserWindow, Menu, nativeImage, type NativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import log from 'electron-log/main';
import type { LogEntry } from '../types/ipc';
import { SettingsService } from '../services/SettingsService';
import { NetworkService } from '../services/NetworkService';
import { PerformanceService } from '../services/PerformanceService';
import { registerIpcHandlers } from './ipcHandlers';

// Environment
const isDev = process.env.NODE_ENV === 'development' || Boolean(process.env.VITE_DEV_SERVER_URL);
log.initialize();
log.transports.console.level = 'debug';
log.transports.file.level = isDev ? false : 'info';

// Services
const perfService = new PerformanceService();
const settingsService = new SettingsService();
const networkService = new NetworkService();

// Lazy modules
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let AdmZip: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getAdmZip(): any {
  if (!AdmZip) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AdmZip = require('adm-zip');
  }
  return AdmZip;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let parsers: any = null;
function getParsers(): typeof import('./parsers.cjs') {
  if (!parsers) {
    const appRoot = app.getAppPath();
    const parserPath = path.join(appRoot, 'src', 'main', 'parsers.cjs');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    parsers = require(parserPath);
  }
  return parsers;
}

// Windows/Meta
let mainWindow: BrowserWindow | null = null;
const iconPlay: NativeImage | null = null;
const iconStop: NativeImage | null = null;
const windows = new Set<BrowserWindow>();

type WindowMeta = {
  baseTitle?: string | null;
  canTcpControl?: boolean;
};
const windowMeta = new Map<number, WindowMeta>();

function getDefaultBaseTitle(): string {
  return 'Lumberjack';
}
function getWindowBaseTitle(win: BrowserWindow): string {
  const meta = windowMeta.get(win.id);
  const base = (meta?.baseTitle || '').trim();
  return base || getDefaultBaseTitle();
}
function setWindowBaseTitle(win: BrowserWindow, title: string | null | undefined): void {
  const t = (title ?? '').toString().trim();
  const meta = windowMeta.get(win.id) || {};
  meta.baseTitle = t || null;
  windowMeta.set(win.id, meta);
}
function getWindowCanTcpControl(win: BrowserWindow | null | undefined): boolean {
  if (!win) return true;
  const meta = windowMeta.get(win.id);
  return meta?.canTcpControl !== false; // default true
}
function setWindowCanTcpControl(win: BrowserWindow, allowed: boolean): void {
  const meta = windowMeta.get(win.id) || {};
  meta.canTcpControl = allowed;
  windowMeta.set(win.id, meta);
}

// TCP ownership per window
let tcpOwnerWindowId: number | null = null;
function setTcpOwnerWindowId(winId: number | null): void {
  tcpOwnerWindowId = winId == null ? null : Number(winId) || null;
  try {
    applyWindowTitles();
    updateMenu();
  } catch (e) {
    log.error(
      'setTcpOwnerWindowId applyWindowTitles/updateMenu failed:',
      e instanceof Error ? e.message : String(e)
    );
  }
}
function getTcpOwnerWindowId(): number | null {
  return tcpOwnerWindowId;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).__setTcpOwnerWindowId = setTcpOwnerWindowId;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).__getTcpOwnerWindowId = getTcpOwnerWindowId;

function applyWindowTitles(): void {
  const tcp = networkService.getTcpStatus();
  for (const w of windows) {
    try {
      if (w.isDestroyed()) continue;
      const base = getWindowBaseTitle(w);
      const isOwner = tcpOwnerWindowId != null && w.id === tcpOwnerWindowId;
      const title = tcp.running && tcp.port && isOwner ? `${base} — TCP:${tcp.port}` : base;
      w.setTitle(title);
    } catch (e) {
      log.warn('applyWindowTitles failed:', e instanceof Error ? e.message : String(e));
    }
  }
}
// Expose for ipcHandlers
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).__applyWindowTitles = applyWindowTitles;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).__getWindowBaseTitle = (winId: number) => {
  try {
    const w = BrowserWindow.fromId?.(winId);
    if (w) return windowMeta.get(winId)?.baseTitle || '';
  } catch (e) {
    log.error('__getWindowBaseTitle failed:', e instanceof Error ? e.message : String(e));
  }
  return '';
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).__setWindowBaseTitle = (winId: number, title: string) => {
  try {
    const w = BrowserWindow.fromId?.(winId);
    if (w) setWindowBaseTitle(w, title);
  } catch (e) {
    log.error('__setWindowBaseTitle failed:', e instanceof Error ? e.message : String(e));
  }
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).__getWindowCanTcpControl = (winId: number) => {
  try {
    const w = BrowserWindow.fromId?.(winId);
    return getWindowCanTcpControl(w);
  } catch {
    log.error('__getWindowCanTcpControl failed');
    return true;
  }
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).__setWindowCanTcpControl = (winId: number, allowed: boolean) => {
  try {
    const w = BrowserWindow.fromId?.(winId);
    if (w) setWindowCanTcpControl(w, allowed);
  } catch (e) {
    log.error('__setWindowCanTcpControl failed:', e instanceof Error ? e.message : String(e));
  }
};

// Buffers
const MAX_PENDING_APPENDS = 5000;
let pendingAppends: LogEntry[] = [];
const pendingMenuCmdsByWindow = new Map<number, Array<{ type: string; tab?: string }>>();
let lastFocusedWindowId: number | null = null;
const pendingAppendsByWindow = new Map<number, LogEntry[]>();

// File logging
let logStream: fs.WriteStream | null = null;
let logBytes = 0;
function defaultLogFilePath(): string {
  const base = app.getPath('userData');
  return path.join(base, 'lumberjack.log');
}
function closeLogStream(): void {
  try {
    logStream?.end?.();
  } catch (e) {
    log.error('Fehler beim Schließen des Log-Streams:', e instanceof Error ? e.message : String(e));
  }
  logStream = null;
  logBytes = 0;
}
function openLogStream(): void {
  const settings = settingsService.get();
  if (!settings.logToFile) return;
  const p = (settings.logFilePath && String(settings.logFilePath).trim()) || defaultLogFilePath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const st = fs.existsSync(p) ? fs.statSync(p) : null;
    logBytes = st ? st.size : 0;
    logStream = fs.createWriteStream(p, { flags: 'a' });
  } catch (err) {
    log.error(
      'Log-Datei kann nicht geöffnet werden:',
      err instanceof Error ? err.message : String(err)
    );
    closeLogStream();
  }
}
function rotateIfNeeded(extraBytes: number): void {
  const settings = settingsService.get();
  const max = Math.max(1024 * 1024, Number(settings.logMaxBytes || 0) || 0);
  if (!max) return;
  if (logBytes + extraBytes <= max) return;
  try {
    closeLogStream();
    const p = (settings.logFilePath && String(settings.logFilePath).trim()) || defaultLogFilePath();
    const backups = Math.max(0, Number(settings.logMaxBackups || 0) || 0);
    for (let i = backups - 1; i >= 1; i--) {
      const src = `${p}.${i}`;
      const dst = `${p}.${i + 1}`;
      if (fs.existsSync(src)) {
        try {
          fs.renameSync(src, dst);
        } catch (e) {
          log.error('Log rotation rename failed:', e instanceof Error ? e.message : String(e));
        }
      }
    }
    if (backups >= 1 && fs.existsSync(p)) {
      try {
        fs.renameSync(p, `${p}.1`);
      } catch (e) {
        log.error('Log rotation rename failed:', e instanceof Error ? e.message : String(e));
      }
    }
  } catch (e) {
    log.error('Log rotation failed:', e instanceof Error ? e.message : String(e));
  }
  openLogStream();
}
function writeEntriesToFile(entries: LogEntry[]): void {
  try {
    const settings = settingsService.get();
    if (!settings.logToFile) return;
    if (!entries || !entries.length) return;
    if (!logStream) openLogStream();
    if (!logStream) return;
    for (const e of entries) {
      const line = JSON.stringify(e) + '\n';
      rotateIfNeeded(line.length);
      if (!logStream) openLogStream();
      if (!logStream) return;
      logStream.write(line);
      logBytes += line.length;
    }
  } catch (err) {
    log.error(
      'Fehler beim Schreiben in Logdatei:',
      err instanceof Error ? err.message : String(err)
    );
  }
}

// Menu command routing (per-window)
function sendMenuCmd(cmd: { type: string; tab?: string }, targetWin?: BrowserWindow | null): void {
  const target =
    targetWin && !targetWin.isDestroyed()
      ? targetWin
      : BrowserWindow.getFocusedWindow?.() || mainWindow || null;
  if (!target || target.isDestroyed()) {
    const id = targetWin?.id ?? lastFocusedWindowId;
    if (id != null) {
      const arr = pendingMenuCmdsByWindow.get(id) || [];
      arr.push(cmd);
      pendingMenuCmdsByWindow.set(id, arr);
    }
    return;
  }
  try {
    target.webContents?.send('menu:cmd', cmd);
  } catch {
    const id = target.id;
    const arr = pendingMenuCmdsByWindow.get(id) || [];
    arr.push(cmd);
    pendingMenuCmdsByWindow.set(id, arr);
  }
}

// Ready checks and buffers
function isRendererReady(): boolean {
  try {
    if (!mainWindow) return false;
    if (mainWindow.isDestroyed()) return false;
    const wc = mainWindow.webContents;
    if (!wc || wc.isDestroyed()) return false;
    return !wc.isLoading();
  } catch {
    return false;
  }
}
function enqueueAppends(entries: LogEntry[]): void {
  if (!Array.isArray(entries) || entries.length === 0) return;
  const room = Math.max(0, MAX_PENDING_APPENDS - pendingAppends.length);
  if (entries.length <= room) {
    pendingAppends.push(...entries);
  } else {
    const take = entries.slice(entries.length - room);
    const overflow = pendingAppends.length + take.length - MAX_PENDING_APPENDS;
    if (overflow > 0) pendingAppends.splice(0, overflow);
    pendingAppends.push(...take);
  }
}
function flushPendingAppends(): void {
  if (!isRendererReady()) return;
  if (!pendingAppends.length) return;
  const wc = mainWindow?.webContents;
  if (!wc) return;
  const CHUNK = 1000;
  try {
    for (let i = 0; i < pendingAppends.length; i += CHUNK) {
      const slice = pendingAppends.slice(i, i + CHUNK);
      wc.send('logs:append', slice);
    }
  } catch {
    return;
  }
  pendingAppends = [];
}
function isWindowReady(win: BrowserWindow | null | undefined): boolean {
  try {
    if (!win || win.isDestroyed()) return false;
    const wc = win.webContents;
    if (!wc || wc.isDestroyed()) return false;
    return !wc.isLoading();
  } catch {
    return false;
  }
}
function enqueueAppendsFor(winId: number, entries: LogEntry[]): void {
  if (!entries || !entries.length) return;
  const list = pendingAppendsByWindow.get(winId) || [];
  const room = Math.max(0, MAX_PENDING_APPENDS - list.length);
  const toPush = entries.length <= room ? entries : entries.slice(entries.length - room);
  const updated = list.concat(toPush);
  if (updated.length > MAX_PENDING_APPENDS) updated.splice(0, updated.length - MAX_PENDING_APPENDS);
  pendingAppendsByWindow.set(winId, updated);
}
function flushPendingAppendsFor(win: BrowserWindow): void {
  if (!isWindowReady(win)) return;
  const buf = pendingAppendsByWindow.get(win.id);
  if (!buf || !buf.length) return;
  const wc = win.webContents;
  const CHUNK = 1000;
  try {
    for (let i = 0; i < buf.length; i += CHUNK) {
      const slice = buf.slice(i, i + CHUNK);
      wc.send('logs:append', slice);
    }
  } catch (e) {
    log.error('flushPendingAppendsFor send failed:', e instanceof Error ? e.message : String(e));
    return;
  }
  pendingAppendsByWindow.delete(win.id);
}

// NetworkService callback → route to right window(s)
function sendAppend(entries: LogEntry[]): void {
  try {
    writeEntriesToFile(entries);
  } catch {
    // Intentionally empty - ignore errors
  }

  const isTcpEntry = (e: LogEntry) => typeof e?.source === 'string' && e.source.startsWith('tcp:');
  const tcpEntries: LogEntry[] = [];
  const otherEntries: LogEntry[] = [];
  for (const e of entries) (isTcpEntry(e) ? tcpEntries : otherEntries).push(e);

  // TCP → owner window only
  if (tcpEntries.length) {
    const ownerId = getTcpOwnerWindowId();
    const ownerWin = ownerId != null ? BrowserWindow.fromId?.(ownerId) || null : null;
    if (ownerWin && isWindowReady(ownerWin)) {
      try {
        ownerWin.webContents.send('logs:append', tcpEntries);
      } catch {
        enqueueAppendsFor(ownerWin.id, tcpEntries);
      }
    } else if (ownerWin) {
      enqueueAppendsFor(ownerWin.id, tcpEntries);
    }
    // else: no owner → drop or route to main; we choose to route to main for now
    else {
      otherEntries.push(...tcpEntries);
    }
  }

  // Non-TCP → primary window (existing behavior)
  if (otherEntries.length) {
    if (!isRendererReady()) {
      enqueueAppends(otherEntries);
      return;
    }
    try {
      mainWindow?.webContents.send('logs:append', otherEntries);
    } catch {
      enqueueAppends(otherEntries);
    }
  }
}

// Cache icon/dist paths
let cachedIconPath: string | null = null;
let cachedDistIndexPath: string | null = null;
function resolveIconPathSync(): string | null {
  if (cachedIconPath !== null) return cachedIconPath || null;
  const resPath = process.resourcesPath || '';
  const candidates = [
    path.join(resPath, 'app.asar.unpacked', 'images', 'icon.ico'),
    path.join(resPath, 'images', 'icon.ico'),
    path.join(__dirname, 'images', 'icon.ico'),
    path.join(app.getAppPath?.() || '', 'images', 'icon.ico'),
    path.join(process.cwd(), 'images', 'icon.ico'),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) {
        cachedIconPath = p;
        try {
          log.debug?.('[icon] resolveIconPathSync hit:', p);
        } catch (e) {
          log.error(
            '[icon] resolveIconPathSync log error:',
            e instanceof Error ? e.message : String(e)
          );
        }
        return p;
      }
    } catch (e) {
      log.error(
        '[icon] resolveIconPathSync exists check error:',
        e instanceof Error ? e.message : String(e)
      );
    }
  }
  try {
    log.warn?.('[icon] resolveIconPathSync: no candidate exists');
  } catch (e) {
    log.error('[icon] resolveIconPathSync log error:', e instanceof Error ? e.message : String(e));
  }
  cachedIconPath = '';
  return null;
}
async function resolveIconPathAsync(): Promise<string | null> {
  if (cachedIconPath !== null) return cachedIconPath;
  const resPath = process.resourcesPath || '';
  const candidates = [
    path.join(resPath, 'app.asar.unpacked', 'images', 'icon.ico'),
    path.join(resPath, 'images', 'icon.ico'),
    path.join(__dirname, 'images', 'icon.ico'),
    path.join(app.getAppPath?.() || '', 'images', 'icon.ico'),
    path.join(process.cwd(), 'images', 'icon.ico'),
  ];
  for (const p of candidates) {
    try {
      const exists = await fs.promises
        .access(p)
        .then(() => true)
        .catch(() => false);
      if (exists) {
        cachedIconPath = p;
        try {
          log.debug?.('[icon] resolveIconPathAsync hit:', p);
        } catch (e) {
          log.error(
            '[icon] resolveIconPathAsync log error:',
            e instanceof Error ? e.message : String(e)
          );
        }
        return p;
      }
    } catch (e) {
      log.error(
        '[icon] resolveIconPathAsync exists check error:',
        e instanceof Error ? e.message : String(e)
      );
    }
  }
  try {
    log.warn?.('[icon] resolveIconPathAsync: no candidate exists');
  } catch (e) {
    log.error('[icon] resolveIconPathAsync log error:', e instanceof Error ? e.message : String(e));
  }
  cachedIconPath = '';
  return null;
}
function resolveMacIconPath(): string | null {
  const resPath = process.resourcesPath || '';
  const candidates = [
    path.join(resPath, 'app.asar.unpacked', 'images', 'icon.icns'),
    path.join(resPath, 'images', 'icon.icns'),
    path.join(__dirname, 'images', 'icon.icns'),
    path.join(process.cwd(), 'images', 'icon.icns'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // Intentionally empty - ignore errors
    }
  }
  return null;
}

// Menu
function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const tcpStatus = networkService.getTcpStatus();
  const focused = BrowserWindow.getFocusedWindow?.() || null;
  const canTcp = getWindowCanTcpControl(focused);
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'Datei',
      submenu: [
        {
          label: 'Neues Fenster',
          accelerator: 'CmdOrCtrl+N',
          click: () => createWindow({ makePrimary: false }),
        },
        { type: 'separator' as const },
        {
          label: 'Öffnen…',
          accelerator: 'CmdOrCtrl+O',
          click: (_mi, win) =>
            sendMenuCmd({ type: 'open-files' }, (win as BrowserWindow | null | undefined) || null),
        },
        {
          label: 'Einstellungen…',
          accelerator: 'CmdOrCtrl+,',
          click: (_mi, win) =>
            sendMenuCmd(
              { type: 'open-settings' },
              (win as BrowserWindow | null | undefined) || null
            ),
        },
        {
          label: 'Fenster-Titel setzen…',
          click: (_mi, win) =>
            sendMenuCmd(
              { type: 'window-title' },
              (win as BrowserWindow | null | undefined) || null
            ),
        },
        { type: 'separator' as const },
        (isMac ? { role: 'close' as const } : { role: 'quit' as const }) as never,
      ],
    },
    {
      label: 'Bearbeiten',
      submenu: [
        { role: 'undo' as const, label: 'Widerrufen' },
        { role: 'redo' as const, label: 'Wiederholen' },
        { type: 'separator' as const },
        { role: 'cut' as const, label: 'Ausschneiden' },
        { role: 'copy' as const, label: 'Kopieren' },
        { role: 'paste' as const, label: 'Einfügen' },
        { role: 'selectAll' as const, label: 'Alles auswählen' },
      ],
    },
    {
      label: 'Netzwerk',
      submenu: [
        {
          label: 'HTTP einmal laden…',
          click: (_mi, win) =>
            sendMenuCmd({ type: 'http-load' }, (win as BrowserWindow | null | undefined) || null),
        },
        {
          label: 'HTTP Poll starten…',
          click: (_mi, win) =>
            sendMenuCmd(
              { type: 'http-start-poll' },
              (win as BrowserWindow | null | undefined) || null
            ),
        },
        {
          label: 'HTTP Poll stoppen',
          click: (_mi, win) =>
            sendMenuCmd(
              { type: 'http-stop-poll' },
              (win as BrowserWindow | null | undefined) || null
            ),
        },
        { type: 'separator' as const },
        {
          id: 'tcp-toggle',
          label: tcpStatus.running ? '⏹ TCP stoppen' : '⏵ TCP starten',
          icon: tcpStatus.running ? (iconStop ?? undefined) : (iconPlay ?? undefined),
          click: (_mi, win) =>
            sendMenuCmd(
              { type: tcpStatus.running ? 'tcp-stop' : 'tcp-start' },
              (win as BrowserWindow | null | undefined) || null
            ),
          enabled: canTcp,
        },
      ],
    },
    {
      label: 'Ansicht',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        ...(isDev ? [{ role: 'toggleDevTools' as const }] : []),
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
function updateMenu(): void {
  buildMenu();
  applyWindowTitles();
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).__updateAppMenu = updateMenu;

// Create window
function createWindow(opts: { makePrimary?: boolean } = {}): BrowserWindow {
  const { makePrimary } = opts;
  const settings = settingsService.get();
  const { width, height, x, y } = settings.windowBounds || {};
  const win = new BrowserWindow({
    width: width || 1200,
    height: height || 800,
    ...(x != null && y != null ? { x, y } : {}),
    title: getDefaultBaseTitle(),
    // Icon bereits beim Erzeugen setzen (wichtig für Taskbar/Alt-Tab unter Windows)
    ...(process.platform === 'win32'
      ? (() => {
          const iconPath = resolveIconPathSync();
          return iconPath ? { icon: iconPath } : {};
        })()
      : {}),
    webPreferences: {
      preload: path.join(app.getAppPath(), 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
    backgroundColor: '#0f1113',
  });

  windowMeta.set(win.id, { canTcpControl: true, baseTitle: null });
  if (settings.isMaximized) win.maximize();

  windows.add(win);
  if (!mainWindow || makePrimary) mainWindow = win;

  setImmediate(() => applyWindowTitles());

  try {
    win.on('focus', () => {
      lastFocusedWindowId = win.id;
      updateMenu();
    });
    win.on('blur', () => updateMenu());
  } catch {
    // Intentionally empty - ignore errors
  }

  win.webContents.on('will-navigate', (event) => event.preventDefault());

  win.webContents.on('did-finish-load', () => {
    applyWindowTitles();

    // Flush queued menu cmds for this window
    try {
      const queued = pendingMenuCmdsByWindow.get(win.id);
      if (queued && queued.length) {
        for (const cmd of queued) {
          try {
            win.webContents.send('menu:cmd', cmd);
          } catch {
            // Intentionally empty - ignore errors
          }
        }
        pendingMenuCmdsByWindow.delete(win.id);
      }
    } catch {
      // Intentionally empty - ignore errors
    }

    // Flush window-specific logs
    try {
      flushPendingAppendsFor(win);
    } catch {
      // Intentionally empty - ignore errors
    }

    if (win === mainWindow) flushPendingAppends();

    setTimeout(() => {
      if (!win.isDestroyed() && !win.isVisible()) win.show();
    }, 50);
  });

  win.once('ready-to-show', () => {
    if (!win.isVisible()) win.show();
    if (process.platform === 'win32') {
      setImmediate(async () => {
        try {
          const iconPath = await resolveIconPathAsync();
          if (iconPath && !win.isDestroyed()) {
            try {
              win.setIcon(iconPath);
              try {
                log.debug?.('[icon] BrowserWindow.setIcon applied:', iconPath);
              } catch {
                // Intentionally empty - ignore errors
              }
            } catch (e) {
              try {
                log.warn?.(
                  '[icon] BrowserWindow.setIcon failed:',
                  e instanceof Error ? e.message : String(e)
                );
              } catch {
                // Intentionally empty - ignore errors
              }
            }
          } else {
            try {
              log.warn?.('[icon] No iconPath resolved for setIcon');
            } catch {
              // Intentionally empty - ignore errors
            }
          }
        } catch (e) {
          try {
            log.warn?.(
              '[icon] resolve/set icon error:',
              e instanceof Error ? e.message : String(e)
            );
          } catch {
            // Intentionally empty - ignore errors
          }
        }
      });
    }
  });

  win.on('maximize', () => {
    try {
      const s = settingsService.get();
      s.isMaximized = true;
      settingsService.update(s);
      void settingsService.save();
    } catch {
      // Intentionally empty - ignore errors
    }
  });
  win.on('unmaximize', () => {
    try {
      const s = settingsService.get();
      s.isMaximized = false;
      settingsService.update(s);
      void settingsService.save();
    } catch {
      // Intentionally empty - ignore errors
    }
  });

  win.on('close', () => {
    try {
      if (win === mainWindow) {
        const bounds = win.getBounds();
        const s = settingsService.get();
        s.windowBounds = bounds;
        s.isMaximized = win.isMaximized();
        settingsService.update(s);
        void settingsService.save();
      }
    } catch {
      // Intentionally empty - ignore errors
    }
  });

  win.on('closed', () => {
    windows.delete(win);
    windowMeta.delete(win.id);
    pendingAppendsByWindow.delete(win.id);
    if (tcpOwnerWindowId != null && tcpOwnerWindowId === win.id) {
      try {
        void networkService.stopTcpServer();
      } catch {
        // Intentionally empty - ignore errors
      }
      setTcpOwnerWindowId(null);
    }
    if (win === mainWindow) mainWindow = null;
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    if (cachedDistIndexPath) {
      void win.loadFile(cachedDistIndexPath);
    } else {
      const resPath = process.resourcesPath || '';
      const distCandidates = [
        path.join(__dirname, 'dist', 'index.html'),
        path.join(app.getAppPath(), 'dist', 'index.html'),
        path.join(process.cwd(), 'dist', 'index.html'),
        path.join(resPath, 'app.asar.unpacked', 'dist', 'index.html'),
        path.join(resPath, 'app.asar', 'dist', 'index.html'),
        path.join(resPath, 'dist', 'index.html'),
      ];
      let loaded = false;
      for (const candidate of distCandidates) {
        try {
          if (fs.existsSync(candidate)) {
            try {
              void win.loadFile(candidate);
              cachedDistIndexPath = candidate;
              loaded = true;
              break;
            } catch {
              // Intentionally empty - ignore errors
            }
          }
        } catch {
          // Intentionally empty - ignore errors
        }
      }
      if (!loaded) {
        try {
          void win.loadFile('index.html');
          cachedDistIndexPath = 'index.html';
        } catch {
          // Intentionally empty - ignore errors
        }
      }
    }
  }

  try {
    const wc = win.webContents;
    wc.on('did-fail-load', (_e, errorCode, errorDescription) => {
      log.error('Renderer did-fail-load:', errorCode, errorDescription);
    });
    wc.on('render-process-gone', (_e, details) => {
      log.error('Renderer gone:', details);
    });
    if (isDev || process.env.LJ_DEBUG_RENDERER === '1') {
      try {
        wc.openDevTools({ mode: 'bottom' });
      } catch {
        // Intentionally empty - ignore errors
      }
    }
  } catch {
    // Intentionally empty - ignore errors
  }

  setImmediate(async () => {
    buildMenu();
    await settingsService.load();
    const s = settingsService.get();
    if (s.logToFile) openLogStream();
    updateMenu();
  });

  return win;
}

// Startup wiring
perfService.mark('main-loaded');
networkService.setLogCallback((entries: LogEntry[]) => {
  sendAppend(entries);
});
setImmediate(() => {
  // Parsers injection for NetworkService
  const p = getParsers();
  networkService.setParsers({
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    parseJsonFile: p.parseJsonFile,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    parseTextLines: p.parseTextLines,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    toEntry: p.toEntry,
  });
});

// Register IPC
registerIpcHandlers(settingsService, networkService, getParsers, getAdmZip);

// Fallback: react to tcp:status broadcasts
try {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-require-imports
  const { ipcMain } = require('electron');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  ipcMain.on('tcp:status', () => {
    applyWindowTitles();
    updateMenu();
  });
} catch {
  // Intentionally empty - ignore errors
}

// App lifecycle
if (process.platform === 'win32') {
  try {
    app.setAppUserModelId('de.hhla.lumberjack');
  } catch {
    // Intentionally empty - ignore errors
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (argv.some((a) => a === '--new-window')) {
      createWindow({ makePrimary: false });
      return;
    }
    const win = mainWindow || BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
}

void app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    const macIconPath = resolveMacIconPath();
    if (macIconPath) {
      try {
        const img = nativeImage.createFromPath(macIconPath);
        if (!img.isEmpty()) app.dock.setIcon(img);
      } catch {
        // Intentionally empty - ignore errors
      }
    }
    try {
      const dockMenu = Menu.buildFromTemplate([
        { label: 'Neues Fenster', click: () => createWindow({ makePrimary: false }) },
      ]);
      app.dock.setMenu(dockMenu);
    } catch {
      // Intentionally empty - ignore errors
    }
  }

  createWindow({ makePrimary: true });

  try {
    app.on('browser-window-focus', () => updateMenu());
    app.on('browser-window-blur', () => updateMenu());
  } catch {
    // Intentionally empty - ignore errors
  }

  if (process.argv.some((a) => a === '--new-window')) {
    createWindow({ makePrimary: false });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('quit', () => {
  closeLogStream();
  networkService.cleanup();
});

// Export for IPC handlers
export { settingsService, networkService, getParsers, getAdmZip };
