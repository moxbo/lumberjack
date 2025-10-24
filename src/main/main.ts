/**
 * Main Process (TypeScript)
 * Entry point for the Electron application with modern standards
 */

import { app, BrowserWindow, ipcMain, dialog, Menu, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import log from 'electron-log/main';
import type { LogEntry } from '../types/ipc';
import { SettingsService } from '../services/SettingsService';
import { NetworkService } from '../services/NetworkService';
import { PerformanceService } from '../services/PerformanceService';
import { registerIpcHandlers } from './ipcHandlers';

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
let AdmZip: typeof import('adm-zip') | null = null;
function getAdmZip(): typeof import('adm-zip') {
  if (!AdmZip) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    AdmZip = require('adm-zip') as typeof import('adm-zip');
  }
  return AdmZip;
}

/**
 * Lazy-load parsers module only when files are opened
 * This improves startup performance by deferring module loading
 */
let parsers: typeof import('./parsers.cjs') | null = null;
function getParsers(): typeof import('./parsers.cjs') {
  if (!parsers) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    parsers = require('./parsers.cjs') as typeof import('./parsers.cjs');
  }
  return parsers;
}

let mainWindow: BrowserWindow | null = null;
let iconPlay: nativeImage | null = null;
let iconStop: nativeImage | null = null;

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
let logPath = '';

/**
 * Get default log file path based on portable or standard installation
 */
function defaultLogFilePath(): string {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  const base =
    portableDir && typeof portableDir === 'string' && portableDir.length
      ? path.join(portableDir, 'data')
      : app.getPath('userData');
  return path.join(base, 'lumberjack.log');
}

/**
 * Close the log stream safely
 */
function closeLogStream(): void {
  try {
    logStream?.end?.();
  } catch {
    // Ignore errors
  }
  logStream = null;
  logBytes = 0;
  logPath = '';
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
    logPath = p;
  } catch (err) {
    log.error('Log-Datei kann nicht geöffnet werden:', err instanceof Error ? err.message : String(err));
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
        } catch {
          // Ignore errors
        }
      }
    }
    
    if (backups >= 1 && fs.existsSync(p)) {
      try {
        fs.renameSync(p, `${p}.1`);
      } catch {
        // Ignore errors
      }
    }
  } catch {
    // Ignore errors
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
    log.error('Fehler beim Schreiben in Logdatei:', err instanceof Error ? err.message : String(err));
  }
}

function sendMenuCmd(cmd: { type: string; tab?: string }): void {
  if (!isRendererReady()) {
    pendingMenuCmds.push(cmd);
    return;
  }
  try {
    mainWindow?.webContents.send('menu:cmd', cmd);
  } catch {
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

perfService.mark('main-loaded');

// Set up network service callback
networkService.setLogCallback((entries: LogEntry[]) => {
  sendAppend(entries);
});

// Set up parsers for network service (lazy loaded)
setImmediate(() => {
  const parsers = getParsers();
  networkService.setParsers({
    parseJsonFile: parsers.parseJsonFile,
    parseTextLines: parsers.parseTextLines,
    toEntry: parsers.toEntry,
  });
});

// Register IPC handlers
registerIpcHandlers(settingsService, networkService, getParsers, getAdmZip);

// Helper: send appended logs to renderer
function sendAppend(entries: LogEntry[]): void {
  try {
    writeEntriesToFile(entries);
  } catch {
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
      const exists = await fs.promises.access(p).then(() => true).catch(() => false);
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
          } catch {
            cachedIconPath = p;
            return p;
          }
        }
        cachedIconPath = p;
        return p;
      }
    } catch {
      // Continue to next candidate
    }
  }

  cachedIconPath = '';
  return null;
}

function resolveIconPath(): string | null {
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
      if (fs.existsSync(p)) {
        if (p.includes('.asar' + path.sep) || p.endsWith('.asar') || p.includes('.asar/')) {
          try {
            const buf = fs.readFileSync(p);
            const outDir = path.join(app.getPath('userData'), 'assets');
            fs.mkdirSync(outDir, { recursive: true });
            const outPath = path.join(outDir, 'app-icon.ico');
            fs.writeFileSync(outPath, buf);
            cachedIconPath = outPath;
            return outPath;
          } catch {
            cachedIconPath = p;
            return p;
          }
        }
        cachedIconPath = p;
        return p;
      }
    } catch {
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
    } catch {
      // Continue to next candidate
    }
  }
  return null;
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
          label: 'Öffnen…',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenuCmd({ type: 'open-files' }),
        },
        {
          label: 'Einstellungen…',
          accelerator: 'CmdOrCtrl+,',
          click: () => sendMenuCmd({ type: 'open-settings' }),
        },
        { type: 'separator' as const },
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
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
        { role: 'forcereload' as const },
        { role: 'toggledevtools' as const },
        { type: 'separator' as const },
        { role: 'resetzoom' as const },
        { role: 'zoomin' as const },
        { role: 'zoomout' as const },
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
}

perfService.mark('pre-window-creation');

function createWindow(): void {
  perfService.mark('window-creation-start');
  
  const settings = settingsService.get();
  const { width, height, x, y } = settings.windowBounds || {};

  mainWindow = new BrowserWindow({
    width: width || 1200,
    height: height || 800,
    ...(x != null && y != null ? { x, y } : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });

  perfService.mark('window-created');

  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    perfService.mark('renderer-loaded');
    
    if (pendingMenuCmds.length) {
      for (const cmd of pendingMenuCmds) {
        try {
          mainWindow?.webContents.send('menu:cmd', cmd);
        } catch {
          // Ignore errors
        }
      }
      pendingMenuCmds = [];
    }
    flushPendingAppends();
  });

  mainWindow.once('ready-to-show', () => {
    perfService.mark('window-ready-to-show');
    perfService.checkStartupPerformance(5000);
    mainWindow?.show();

    // Defer icon loading completely after window is visible (Windows performance optimization)
    if (process.platform === 'win32') {
      setImmediate(async () => {
        try {
          perfService.mark('icon-load-start');
          const iconPath = await resolveIconPathAsync();
          perfService.mark('icon-load-end');
          
          if (iconPath && mainWindow && !mainWindow.isDestroyed()) {
            try {
              mainWindow.setIcon(iconPath);
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

  mainWindow.on('close', () => {
    try {
      const bounds = mainWindow?.getBounds();
      if (bounds) {
        const settings = settingsService.get();
        settings.windowBounds = bounds;
        settingsService.update(settings);
        void settingsService.save();
      }
    } catch {
      // Ignore errors
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
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
  
  if (devUrl) {
    log.info('Loading dev server URL:', devUrl);
    void mainWindow.loadURL(devUrl);
  } else {
    const resPath = process.resourcesPath || '';
    const distCandidates = [
      path.join(__dirname, 'dist', 'index.html'),
      path.join(resPath, 'app.asar.unpacked', 'dist', 'index.html'),
      path.join(resPath, 'app.asar', 'dist', 'index.html'),
      path.join(resPath, 'dist', 'index.html'),
    ];

    let loaded = false;
    for (const candidate of distCandidates) {
      try {
        const exists = fs.existsSync(candidate);
        log.info('Checking for dist index at', candidate, 'exists=', exists);
        if (exists) {
          log.info('Loading dist index from', candidate);
          try {
            void mainWindow.loadFile(candidate);
            loaded = true;
            break;
          } catch (e) {
            log.error('Failed to load file', candidate, e instanceof Error ? e.message : String(e));
          }
        }
      } catch (e) {
        log.warn('Error while checking candidate', candidate, e instanceof Error ? e.message : String(e));
      }
    }

    if (!loaded) {
      log.info('No production dist index.html found; falling back to root index.html (likely dev)');
      try {
        void mainWindow.loadFile('index.html');
      } catch (e) {
        log.error('Failed to load fallback index.html:', e instanceof Error ? e.message : String(e));
      }
    }
  }

  try {
    const wc = mainWindow.webContents;

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
    buildMenu();
    await settingsService.load();
    const settings = settingsService.get();
    if (settings.logToFile) openLogStream();
    updateMenu();
    perfService.mark('settings-loaded');
  });
}

// Unter Windows AppUserModelID setzen
if (process.platform === 'win32') {
  try {
    app.setAppUserModelId('de.hhla.lumberjack');
  } catch {
    // Ignore errors
  }
}

perfService.mark('app-ready-handler-registered');

void app.whenReady().then(async () => {
  perfService.mark('app-ready');
  
  // Load settings asynchronously before window creation (critical for Windows performance)
  perfService.mark('settings-load-start');
  await settingsService.load();
  perfService.mark('settings-loaded');
  
  if (process.platform === 'darwin' && app.dock) {
    const macIconPath = resolveMacIconPath();
    if (macIconPath) {
      try {
        const img = nativeImage.createFromPath(macIconPath);
        if (!img.isEmpty()) app.dock.setIcon(img);
      } catch (e) {
        log.warn('Dock-Icon konnte nicht gesetzt werden:', e instanceof Error ? e.message : String(e));
      }
    }
  }

  createWindow();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
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
