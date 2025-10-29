/**
 * Main Process (TypeScript)
 * Entry point for the Electron application with modern standards
 */

import { app, BrowserWindow, dialog, Menu, type NativeImage, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import log from 'electron-log/main';
import type { LogEntry } from '../types/ipc';
import { SettingsService } from '../services/SettingsService';
import { NetworkService } from '../services/NetworkService';
import { PerformanceService } from '../services/PerformanceService';
import { registerIpcHandlers } from './ipcHandlers';
import * as os from 'os';

// Configure electron-log based on environment
const isDev = process.env.NODE_ENV === 'development' || Boolean(process.env.VITE_DEV_SERVER_URL);
log.initialize();
log.transports.console.level = 'debug';
log.transports.file.level = isDev ? false : 'info';

// Initialize services
const perfService = new PerformanceService();
const settingsService = new SettingsService();
const networkService = new NetworkService();

/**
 * Lazy-load heavy AdmZip module only when needed for ZIP file handling
 * This improves startup performance by deferring module loading
 */
let AdmZip: any | null = null;
function getAdmZip(): any {
  if (!AdmZip) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-require-imports
    AdmZip = require('adm-zip');
  }
  return AdmZip;
}

/**
 * Lazy-load parsers module only when files are opened
 * This improves startup performance by deferring module loading
 */
let parsers: any | null = null;
function getParsers(): typeof import('./parsers.cjs') {
  if (!parsers) {
    // Resolve built CJS parser relative to the application root to work in dev and packaged
    const appRoot = app.getAppPath();
    const parserPath = path.join(appRoot, 'src', 'main', 'parsers.cjs');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    parsers = require(parserPath);
  }
  return parsers;
}

let mainWindow: BrowserWindow | null = null;
const iconPlay: NativeImage | null = null;
const iconStop: NativeImage | null = null;
// Track all windows for optional management
const windows: Set<BrowserWindow> = new Set();

// Titel-Handling: Basis und dynamischer TCP-Suffix
// Laufzeit-Override des Fenstertitels (nur für aktuelle Ausführung)
let runtimeTitleOverride: string | null = null;
function setRuntimeTitleOverride(title: string | null): void {
  const t = (title ?? '').trim();
  runtimeTitleOverride = t ? t : null;
  applyWindowTitles();
}
function getRuntimeTitleOverride(): string | null {
  return runtimeTitleOverride;
}
function getDefaultBaseTitle(): string {
  return 'Lumberjack';
}

function getPrimaryBaseTitle(): string {
  const t = getRuntimeTitleOverride();
  return (t && t.trim()) || getDefaultBaseTitle();
}

function applyWindowTitles(): void {
  const tcp = networkService.getTcpStatus();
  for (const w of windows) {
    try {
      if (w.isDestroyed()) continue;
      const isPrimary = w === mainWindow;
      const base = isPrimary ? getPrimaryBaseTitle() : getDefaultBaseTitle();
      const title = tcp.running && tcp.port ? `${base} — TCP:${tcp.port}` : base;
      w.setTitle(title);
    } catch (e) {
      log.warn(
        'applyWindowTitles failed for a window:',
        e instanceof Error ? e.message : String(e)
      );
    }
  }
}
// Exponiere für andere Module (ipcHandlers)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).__applyWindowTitles = applyWindowTitles;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).__setRuntimeTitleOverride = setRuntimeTitleOverride;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).__getRuntimeTitleOverride = getRuntimeTitleOverride;

/**
 * Buffer for logs when renderer is loading or window is not ready
 * Prevents log loss during window transitions
 */
const MAX_PENDING_APPENDS = 5000;
let pendingAppends: LogEntry[] = [];
let pendingMenuCmds: Array<{ type: string; tab?: string }> = [];

/**
 * File logging: stream management and rotation
 */
let logStream: fs.WriteStream | null = null;
let logBytes = 0;

/**
 * Get default log file path based on portable or standard installation
 */
function defaultLogFilePath(): string {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  const base =
    portableDir && portableDir.length ? path.join(portableDir, 'data') : app.getPath('userData');
  return path.join(base, 'lumberjack.log');
}

/**
 * Close the log stream safely
 */
function closeLogStream(): void {
  try {
    logStream?.end?.();
  } catch (e) {
    log.debug('closeLogStream ignored error:', e instanceof Error ? e.message : String(e));
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
  if (!max) return; // 0 deaktiviert
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
          log.warn(
            'Log rotation: failed to rename backup',
            src,
            '->',
            dst,
            e instanceof Error ? e.message : String(e)
          );
        }
      }
    }

    if (backups >= 1 && fs.existsSync(p)) {
      try {
        fs.renameSync(p, `${p}.1`);
      } catch (e) {
        log.warn(
          'Log rotation: failed to rotate current file:',
          e instanceof Error ? e.message : String(e)
        );
      }
    }
  } catch (e) {
    log.warn('Log rotation failed:', e instanceof Error ? e.message : String(e));
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

function sendMenuCmd(cmd: { type: string; tab?: string }): void {
  if (!isRendererReady()) {
    pendingMenuCmds.push(cmd);
    return;
  }
  try {
    mainWindow?.webContents.send('menu:cmd', cmd);
  } catch (e) {
    log.debug('sendMenuCmd failed, buffering:', e instanceof Error ? e.message : String(e));
    // Im Zweifel puffern (z. B. Reload mitten im Senden)
    pendingMenuCmds.push(cmd);
  }
}

function isRendererReady(): boolean {
  try {
    if (!mainWindow) return false;
    if (mainWindow.isDestroyed()) return false;
    const wc = mainWindow.webContents;
    if (!wc) return false;
    if (wc.isDestroyed()) return false;
    return !wc.isLoading();
  } catch (e) {
    log.debug('isRendererReady probe failed:', e instanceof Error ? e.message : String(e));
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
  } catch (e) {
    log.debug(
      'flushPendingAppends failed, keeping buffer:',
      e instanceof Error ? e.message : String(e)
    );
    return;
  }
  pendingAppends = [];
}

perfService.mark('main-loaded');

// Set up network service callback
networkService.setLogCallback((entries: LogEntry[]) => {
  sendAppend(entries);
});

// Set up parsers for network service (lazy loaded)
// Defer this until after window creation to avoid blocking startup
setImmediate(() => {
  perfService.mark('parsers-setup-start');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const parsers = getParsers();
  networkService.setParsers({
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access
    parseJsonFile: parsers.parseJsonFile,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access
    parseTextLines: parsers.parseTextLines,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access
    toEntry: parsers.toEntry,
  });
  perfService.mark('parsers-setup-complete');
});

// Register IPC handlers
perfService.mark('ipc-handlers-register-start');
registerIpcHandlers(settingsService, networkService, getParsers, getAdmZip);
perfService.mark('ipc-handlers-registered');

// Nach Registrierung: TCP Start/Stop abfangen, um Titel zu aktualisieren
try {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-require-imports
  const { ipcMain } = require('electron');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
  ipcMain.on('tcp:status', () => {
    // Vorsicht: Dieser Kanal wird per event.reply gesendet; hier nur als Fallback
    applyWindowTitles();
    updateMenu();
  });
} catch (e) {
  log.warn(
    'Failed to set up tcp:status fallback listener:',
    e instanceof Error ? e.message : String(e)
  );
}

// Helper: send appended logs to renderer
function sendAppend(entries: LogEntry[]): void {
  try {
    writeEntriesToFile(entries);
  } catch (e) {
    log.warn('writeEntriesToFile failed:', e instanceof Error ? e.message : String(e));
    // Ignore errors
  }

  if (!isRendererReady()) {
    enqueueAppends(entries);
    return;
  }
  try {
    mainWindow?.webContents.send('logs:append', entries);
  } catch {
    enqueueAppends(entries);
  }
}

// Cache the resolved icon path to avoid repeated filesystem operations
let cachedIconPath: string | null = null;

// Cache the resolved dist index path to avoid repeated filesystem operations on each window creation
let cachedDistIndexPath: string | null = null;

async function resolveIconPathAsync(): Promise<string | null> {
  if (cachedIconPath !== null) {
    return cachedIconPath;
  }

  const resPath = process.resourcesPath || '';
  const candidates = [
    path.join(resPath, 'app.asar.unpacked', 'images', 'icon.ico'),
    path.join(resPath, 'images', 'icon.ico'),
    path.join(__dirname, 'images', 'icon.ico'),
    path.join(process.cwd(), 'images', 'icon.ico'),
  ];

  for (const p of candidates) {
    try {
      const exists = await fs.promises
        .access(p)
        .then(() => true)
        .catch(() => false);
      if (exists) {
        if (p.includes('.asar' + path.sep) || p.endsWith('.asar') || p.includes('.asar/')) {
          try {
            const buf = await fs.promises.readFile(p);
            const outDir = path.join(app.getPath('userData'), 'assets');
            await fs.promises.mkdir(outDir, { recursive: true });
            const outPath = path.join(outDir, 'app-icon.ico');
            await fs.promises.writeFile(outPath, buf);
            cachedIconPath = outPath;
            return outPath;
          } catch (e) {
            log.warn(
              'Falling back to asar path for icon due to error:',
              e instanceof Error ? e.message : String(e)
            );
            cachedIconPath = p;
            return p;
          }
        }
        cachedIconPath = p;
        return p;
      }
    } catch (e) {
      log.warn(
        'Error while checking icon candidate:',
        p,
        e instanceof Error ? e.message : String(e)
      );
      // Continue to next candidate
    }
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
    path.join(resPath, 'images', 'lumberjack_v4_dark_1024.png'),
    path.join(__dirname, 'images', 'lumberjack_v4_dark_1024.png'),
    path.join(process.cwd(), 'images', 'lumberjack_v4_dark_1024.png'),
  ];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (e) {
      log.warn('Error checking mac icon candidate:', p, e instanceof Error ? e.message : String(e));
      // Continue to next candidate
    }
  }
  return null;
}

// About/Help Dialoge
function showAboutDialog(): void {
  try {
    const win = BrowserWindow.getFocusedWindow();
    const name = app.getName();
    const version = app.getVersion();
    const env = isDev ? 'Development' : 'Production';
    const electron = process.versions.electron;
    const chrome = process.versions.chrome;
    const node = process.versions.node;
    const v8 = process.versions.v8;
    const osInfo = `${process.platform} ${process.arch} ${os.release()}`;
    const detail = [
      `Version: ${version}`,
      `Umgebung: ${env}`,
      `Electron: ${electron}`,
      `Chromium: ${chrome}`,
      `Node.js: ${node}`,
      `V8: ${v8}`,
      `OS: ${osInfo}`,
    ].join('\n');

    const options: Electron.MessageBoxOptions = {
      type: 'info',
      title: `Über ${name}`,
      message: name,
      detail,
      buttons: ['OK'],
      noLink: true,
      normalizeAccessKeys: true,
    };
    if (win) void dialog.showMessageBox(win, options);
    else void dialog.showMessageBox(options);
  } catch (e) {
    log.warn('About-Dialog fehlgeschlagen:', e instanceof Error ? e.message : String(e));
  }
}

function showHelpDialog(): void {
  try {
    const win = BrowserWindow.getFocusedWindow();
    const lines: string[] = [];
    lines.push('Lumberjack ist ein Log-Viewer mit Fokus auf große Datenmengen und Live-Quellen.');
    lines.push('');
    lines.push('Funktionen:');
    lines.push(
      ' • Dateien öffnen (Menü "Datei → Öffnen…"), Drag & Drop von .log/.json/.jsonl/.txt und .zip'
    );
    lines.push(' • ZIPs werden entpackt und geeignete Dateien automatisch geparst');
    lines.push(' • TCP-Log-Server: Start/Stopp, eingehende Zeilen werden live angezeigt');
    lines.push(' • HTTP: Einmal laden oder periodisches Polling mit Deduplizierung');
    lines.push(' • Elasticsearch: Logs anhand von URL/Query abrufen');
    lines.push(' • Filter: Zeitfilter, MDC/DiagnosticContext-Filter, Volltextsuche');
    lines.push(' • Markieren/Färben einzelner Einträge, Kontextmenü pro Zeile');
    lines.push(' • Protokollierung in Datei (rotierend) optional aktivierbar');
    lines.push('');
    lines.push('Filter-Syntax (Volltextsuche in Nachrichten):');
    lines.push(' • ODER: Verwende | um Alternativen zu trennen, z. B. foo|bar');
    lines.push(' • UND: Verwende & um Bedingungen zu verknüpfen, z. B. foo&bar');
    lines.push(' • NICHT: Setze ! vor einen Begriff für Negation, z. B. foo&!bar');
    lines.push(' • Mehrfache ! toggeln die Negation (z. B. !!foo entspricht foo)');
    lines.push(' • Groß-/Kleinschreibung wird ignoriert, es wird nach Teilstrings gesucht');
    lines.push(' • Beispiele:');
    lines.push('    – QcStatus&!CB23  → enthält "QcStatus" und NICHT "CB23"');
    lines.push('    – error|warn      → enthält "error" ODER "warn"');
    lines.push('    – foo&bar         → enthält sowohl "foo" als auch "bar" (Reihenfolge egal)');
    lines.push('');
    lines.push('Tipps:');
    lines.push(' • Menü "Netzwerk" für HTTP/TCP Aktionen und Konfiguration');
    lines.push(
      ' • Einstellungen enthalten Pfade, Limits und Anmeldedaten (verschlüsselt gespeichert)'
    );

    const options: Electron.MessageBoxOptions = {
      type: 'info',
      title: 'Hilfe / Anleitung',
      message: 'Hilfe & Funktionen',
      detail: lines.join('\n'),
      buttons: ['OK'],
      noLink: true,
      normalizeAccessKeys: true,
    };
    if (win) void dialog.showMessageBox(win, options);
    else void dialog.showMessageBox(options);
  } catch (e) {
    log.warn('Hilfe-Dialog fehlgeschlagen:', e instanceof Error ? e.message : String(e));
  }
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const tcpStatus = networkService.getTcpStatus();

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
          click: () => sendMenuCmd({ type: 'open-files' }),
        },
        {
          label: 'Einstellungen…',
          accelerator: 'CmdOrCtrl+,',
          click: () => sendMenuCmd({ type: 'open-settings' }),
        },
        // Neuer Menüpunkt: Fenstertitel setzen wie bei "Neues Fenster"
        {
          label: 'Fenster-Titel setzen…',
          click: () => sendMenuCmd({ type: 'window-title' }),
        },
        { type: 'separator' as const },
        (isMac ? { role: 'close' as const } : { role: 'quit' as const }) as never,
      ],
    },
    {
      label: 'Netzwerk',
      submenu: [
        { label: 'HTTP einmal laden…', click: () => sendMenuCmd({ type: 'http-load' }) },
        { label: 'HTTP Poll starten…', click: () => sendMenuCmd({ type: 'http-start-poll' }) },
        { label: 'HTTP Poll stoppen', click: () => sendMenuCmd({ type: 'http-stop-poll' }) },
        { type: 'separator' as const },
        {
          label: 'HTTP URL festlegen…',
          click: () => sendMenuCmd({ type: 'open-settings', tab: 'http' }),
        },
        {
          label: 'TCP Port konfigurieren…',
          click: () => sendMenuCmd({ type: 'tcp-configure' }),
        },
        { type: 'separator' as const },
        {
          id: 'tcp-toggle',
          label: tcpStatus.running ? '⏹ TCP stoppen' : '⏵ TCP starten',
          icon: tcpStatus.running ? (iconStop ?? undefined) : (iconPlay ?? undefined),
          click: () => sendMenuCmd({ type: tcpStatus.running ? 'tcp-stop' : 'tcp-start' }),
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
    {
      label: 'Hilfe',
      submenu: [
        { label: 'Über Lumberjack…', click: () => showAboutDialog() },
        { label: 'Hilfe / Anleitung…', click: () => showHelpDialog() },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function updateMenu(): void {
  buildMenu();
  // Nach Menu-Update ebenfalls Titel anpassen (falls TCP-Icon/Label wechselte)
  applyWindowTitles();
}

// Expose updateMenu globally so ipcHandlers can trigger it
// eslint-disable-next-line @typescript-eslint/no-explicit-any,@typescript-eslint/no-unsafe-member-access
(global as any).__updateAppMenu = updateMenu;

perfService.mark('pre-window-creation');

function createWindow(opts: { makePrimary?: boolean } = {}): BrowserWindow {
  const { makePrimary } = opts;
  perfService.mark('window-creation-start');

  const settings = settingsService.get();
  const { width, height, x, y } = settings.windowBounds || {};

  const win = new BrowserWindow({
    width: width || 1200,
    height: height || 800,
    ...(x != null && y != null ? { x, y } : {}),
    // Neue Fenster zunächst mit Default-Basis betiteln; danach wird per applyWindowTitles korrekt gesetzt
    title: getDefaultBaseTitle(),
    webPreferences: {
      // Use application root to resolve preload reliably (works with asar and dev)
      preload: path.join(app.getAppPath(), 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
    // Set background color to match the app theme to prevent white flash
    // This allows us to show the window earlier without visible flashing
    backgroundColor: '#0f1113',
  });

  if (settings.isMaximized) {
    win.maximize();
  }

  windows.add(win);
  // Assign as primary when explicitly requested or when none exists
  if (!mainWindow || makePrimary) mainWindow = win;

  // Direkt nach Erstellung auch den aktuellen TCP-Status im Titel widerspiegeln
  setImmediate(() => applyWindowTitles());

  perfService.mark('window-created');

  win.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  win.webContents.on('did-finish-load', () => {
    perfService.mark('renderer-loaded');

    // ensure Titel ist nach Laden korrekt
    applyWindowTitles();

    // Only flush pending commands/logs into the primary window to keep new windows "clean"
    if (win === mainWindow) {
      if (pendingMenuCmds.length) {
        for (const cmd of pendingMenuCmds) {
          try {
            win.webContents.send('menu:cmd', cmd);
          } catch (e) {
            log.debug(
              'menu:cmd send during did-finish-load failed:',
              e instanceof Error ? e.message : String(e)
            );
            // Ignore errors
          }
        }
        pendingMenuCmds = [];
      }
      flushPendingAppends();
    }

    // Show window shortly after load completes instead of waiting for ready-to-show
    // The backgroundColor prevents white flash, and the UI will render progressively
    // This dramatically improves perceived startup time
    setTimeout(() => {
      if (!win.isDestroyed() && !win.isVisible()) {
        perfService.mark('window-shown-early');
        win.show();
      }
    }, 50);
  });

  win.once('ready-to-show', () => {
    perfService.mark('window-ready-to-show');
    perfService.checkStartupPerformance(5000);
    // Only show if not already visible (we show early in did-finish-load now)
    if (!win.isVisible()) {
      win.show();
    }

    // Defer icon loading completely after window is visible (Windows performance optimization)
    if (process.platform === 'win32') {
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      setImmediate(async () => {
        try {
          perfService.mark('icon-load-start');
          const iconPath = await resolveIconPathAsync();
          perfService.mark('icon-load-end');

          if (iconPath && !win.isDestroyed()) {
            try {
              win.setIcon(iconPath);
              log.info('App-Icon verwendet:', iconPath);
            } catch (err) {
              log.warn('Could not set icon:', err instanceof Error ? err.message : String(err));
            }
          } else if (!iconPath) {
            log.warn('Kein Icon gefunden (images/icon.ico).');
          }
        } catch (err) {
          log.error('Icon loading failed:', err instanceof Error ? err.message : String(err));
        }
      });
    }
  });

  win.on('maximize', () => {
    try {
      const settings = settingsService.get();
      settings.isMaximized = true;
      settingsService.update(settings);
      void settingsService.save();
    } catch (e) {
      log.warn('Failed to persist maximized state:', e instanceof Error ? e.message : String(e));
    }
  });

  win.on('unmaximize', () => {
    try {
      const settings = settingsService.get();
      settings.isMaximized = false;
      settingsService.update(settings);
      void settingsService.save();
    } catch (e) {
      log.warn(
        'Persisting isMaximized on unmaximize failed:',
        e instanceof Error ? e.message : String(e)
      );
    }
  });

  win.on('close', () => {
    try {
      // Persist bounds from the primary window only
      if (win === mainWindow) {
        const bounds = win.getBounds();
        if (bounds) {
          const settings = settingsService.get();
          settings.windowBounds = bounds;
          settings.isMaximized = win.isMaximized();
          settingsService.update(settings);
          void settingsService.save();
        }
      }
    } catch (e) {
      log.warn('Failed to persist window bounds:', e instanceof Error ? e.message : String(e));
      // Ignore errors
    }
  });

  win.on('closed', () => {
    windows.delete(win);
    if (win === mainWindow) {
      mainWindow = null;
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  log.info(
    'Startup: __dirname=',
    __dirname,
    'process.resourcesPath=',
    process.resourcesPath,
    'process.cwd=',
    process.cwd()
  );

  perfService.mark('renderer-load-start');

  if (devUrl) {
    log.info('Loading dev server URL:', devUrl);
    void win.loadURL(devUrl);
  } else {
    // Use cached path if available to avoid repeated filesystem checks
    if (cachedDistIndexPath) {
      log.info('Loading cached dist index from', cachedDistIndexPath);
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
          const exists = fs.existsSync(candidate);
          if (exists) {
            log.info('Loading dist index from', candidate);
            try {
              void win.loadFile(candidate);
              cachedDistIndexPath = candidate; // Cache successful path
              loaded = true;
              break;
            } catch (e) {
              log.error(
                'Failed to load file',
                candidate,
                e instanceof Error ? e.message : String(e)
              );
            }
          }
        } catch (e) {
          log.warn(
            'Error while checking candidate',
            candidate,
            e instanceof Error ? e.message : String(e)
          );
        }
      }

      if (!loaded) {
        log.info(
          'No production dist index.html found; falling back to root index.html (likely dev)'
        );
        try {
          void win.loadFile('index.html');
          cachedDistIndexPath = 'index.html'; // Cache fallback path
        } catch (e) {
          log.error(
            'Failed to load fallback index.html:',
            e instanceof Error ? e.message : String(e)
          );
        }
      }
    }
  }

  try {
    const wc = win.webContents;

    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      log.error('Renderer did-fail-load:', {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
      });
    });

    wc.on('render-process-gone', (_event, details) => {
      log.error('Renderer process gone:', details);
    });

    if (isDev || process.env.LJ_DEBUG_RENDERER === '1') {
      try {
        const reason = isDev ? 'Development mode' : 'LJ_DEBUG_RENDERER=1';
        log.info(`${reason} -> opening DevTools`);
        wc.openDevTools({ mode: 'bottom' });
      } catch (e) {
        log.warn('Could not open DevTools:', e instanceof Error ? e.message : String(e));
      }
    }
  } catch (e) {
    log.warn('Failed to attach renderer diagnostics:', e instanceof Error ? e.message : String(e));
  }

  setImmediate(async () => {
    perfService.mark('menu-build-start');
    buildMenu();
    perfService.mark('menu-built');

    perfService.mark('settings-load-start');
    await settingsService.load();
    perfService.mark('settings-loaded-deferred');

    const settings = settingsService.get();
    if (settings.logToFile) {
      perfService.mark('logstream-open-start');
      openLogStream();
      perfService.mark('logstream-opened');
    }
    updateMenu();
  });

  return win;
}

// Unter Windows AppUserModelID setzen
if (process.platform === 'win32') {
  try {
    app.setAppUserModelId('de.hhla.lumberjack');
  } catch (e) {
    log.warn('setAppUserModelId failed:', e instanceof Error ? e.message : String(e));
    // Ignore errors
  }
}

perfService.mark('app-ready-handler-registered');

// Ensure single instance to route Windows UserTasks (e.g., --new-window) into the primary process
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    // On Windows, argv contains the arguments for the new instance
    if (argv.some((a) => a === '--new-window')) {
      createWindow({ makePrimary: false });
      return;
    }
    // Focus existing primary window otherwise
    const win = mainWindow || BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
}

void app.whenReady().then(async () => {
  perfService.mark('app-ready');

  // Do NOT load settings here - they will be loaded asynchronously after window creation
  // to avoid blocking the window from appearing

  perfService.mark('platform-setup-start');

  if (process.platform === 'darwin' && app.dock) {
    const macIconPath = resolveMacIconPath();
    if (macIconPath) {
      try {
        const img = nativeImage.createFromPath(macIconPath);
        if (!img.isEmpty()) app.dock.setIcon(img);
      } catch (e) {
        log.warn(
          'Dock-Icon konnte nicht gesetzt werden:',
          e instanceof Error ? e.message : String(e)
        );
      }
    }
    // Dock menu: add quick action to open a clean new window
    try {
      const dockMenu = Menu.buildFromTemplate([
        { label: 'Neues Fenster', click: () => createWindow({ makePrimary: false }) },
      ]);
      app.dock.setMenu(dockMenu);
    } catch (e) {
      log.warn('Setting macOS dock menu failed:', e instanceof Error ? e.message : String(e));
    }
  }

  // Windows Task List (UserTasks): add "New Window" task
  if (process.platform === 'win32') {
    try {
      app.setUserTasks([
        {
          program: process.execPath,
          arguments: '--new-window',
          iconPath: process.execPath,
          iconIndex: 0,
          title: 'Neues Fenster',
          description: 'Öffnet ein neues Fenster',
        },
      ]);
    } catch (e) {
      log.warn('Konnte UserTasks nicht setzen:', e instanceof Error ? e.message : String(e));
    }
  }

  perfService.mark('platform-setup-complete');

  // Create the primary window by default
  perfService.mark('create-window-start');
  createWindow({ makePrimary: true });
  perfService.mark('create-window-initiated');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow({ makePrimary: true });
    else {
      // On macOS, Cmd+Tab back to app should show at least one window
      const any = BrowserWindow.getAllWindows()[0];
      if (any) {
        any.show();
        any.focus();
      }
    }
  });

  // If app was started with --new-window (e.g., from dev shell), open an extra clean window
  if (process.argv.some((a) => a === '--new-window')) {
    createWindow({ makePrimary: false });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  closeLogStream();
  networkService.cleanup();
});

// Export for IPC handlers (to be added in next part)
export { settingsService, networkService, getParsers, getAdmZip };
