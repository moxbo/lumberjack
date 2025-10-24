const { app, BrowserWindow, ipcMain, dialog, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const log = require('electron-log/main');
const crypto = require('crypto');
const { safeStorage } = require('electron');

// Configure electron-log based on environment
const isDev = process.env.NODE_ENV === 'development' || process.env.VITE_DEV_SERVER_URL;
log.initialize();
log.transports.console.level = 'debug';
// In development, disable file logging; in production, enable it
log.transports.file.level = isDev ? false : 'info';

// Track startup performance
const startTime = Date.now();
// Lazy-load heavy modules only when needed
let AdmZip = null;
function getAdmZip() {
  if (!AdmZip) {
    AdmZip = require('adm-zip');
  }
  return AdmZip;
}
// Lazy-load parsers only when files are opened
let parsers = null;
function getParsers() {
  if (!parsers) {
    parsers = require('./parsers.cjs');
  }
  return parsers;
}
// Lazy-load settings utilities only when needed
let settingsUtils = null;
function getSettingsUtils() {
  if (!settingsUtils) {
    settingsUtils = require('../utils/settings.cjs');
  }
  return settingsUtils;
}

let mainWindow;
let tcpServer = null;
let tcpRunning = false;
let httpPollers = new Map(); // id -> {timer, url, seen}
let httpPollerSeq = 1;

// settings with defaults from schema (initialized lazily on first use)
let settings = null;
let settingsLoaded = false;

// Ensure settings is initialized
function ensureSettings() {
  if (settings === null) {
    const { getDefaultSettings } = getSettingsUtils();
    settings = getDefaultSettings();
  }
  return settings;
}

function settingsPath() {
  return settings_path_compat();
}
const settings_path_compat = () => {
  // Use a local data folder next to the portable EXE if available
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir && typeof portableDir === 'string' && portableDir.length) {
    return path.join(portableDir, 'data', 'settings.json');
  }
  return path.join(app.getPath('userData'), 'settings.json');
};

function loadSettingsSyncSafe() {
  try {
    ensureSettings();
    const p = settingsPath();
    if (!fs.existsSync(p)) {
      settingsLoaded = true; // nothing to load
      return;
    }
    const raw = fs.readFileSync(p, 'utf8');
    const { parseSettingsJSON } = getSettingsUtils();
    const result = parseSettingsJSON(raw);
    if (result.success) {
      settings = result.settings;
    }
    settingsLoaded = true;
  } catch (e) {
    settingsLoaded = true; // avoid repeated sync loads
  }
}

/**
 * Load settings with validation and error handling (async for better startup)
 */
async function loadSettings() {
  try {
    // Initialize settings with defaults if not already done
    ensureSettings();

    const p = settingsPath();
    log.info('Settings loaded from', p);
    if (!fs.existsSync(p)) {
      log.info('Settings file not found, using defaults');
      settingsLoaded = true;
      return;
    }

    const raw = await fs.promises.readFile(p, 'utf8');
    const { parseSettingsJSON } = getSettingsUtils();
    const result = parseSettingsJSON(raw);

    if (result.success) {
      settings = result.settings;
      log.info('Settings loaded successfully');
    } else {
      log.error('Failed to parse settings:', result.error);
      log.info('Using default settings');
    }
  } catch (err) {
    log.error('Error loading settings:', err.message);
    log.info('Using default settings');
  } finally {
    settingsLoaded = true;
  }
}

/**
 * Save settings with validation and error handling
 */
function saveSettings() {
  try {
    const { stringifySettingsJSON } = getSettingsUtils();
    const result = stringifySettingsJSON(settings);

    if (!result.success) {
      log.error('Failed to stringify settings:', result.error);
      return false;
    }

    const p = settingsPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, result.json, 'utf8');
    log.info('Settings saved successfully');
    return true;
  } catch (err) {
    log.error('Error saving settings:', err.message);
    return false;
  }
}

// Cache the resolved icon path to avoid repeated filesystem operations
let cachedIconPath = null;

// Datei-Logging: Stream + Rotation
function defaultLogFilePath() {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  const base =
    portableDir && typeof portableDir === 'string' && portableDir.length
      ? path.join(portableDir, 'data')
      : app.getPath('userData');
  return path.join(base, 'lumberjack.log');
}
let logStream = null;
let logBytes = 0;
let logPath = '';
function closeLogStream() {
  try {
    logStream?.end?.();
  } catch {}
  logStream = null;
  logBytes = 0;
  logPath = '';
}
function openLogStream() {
  ensureSettings();
  if (!settings.logToFile) return;
  const p = (settings.logFilePath && String(settings.logFilePath).trim()) || defaultLogFilePath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const st = fs.existsSync(p) ? fs.statSync(p) : null;
    logBytes = st ? st.size : 0;
    logStream = fs.createWriteStream(p, { flags: 'a' });
    logPath = p;
  } catch (err) {
    log.error('Log-Datei kann nicht geöffnet werden:', err.message);
    closeLogStream();
  }
}
function rotateIfNeeded(extraBytes) {
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
        } catch {}
      }
    }
    if (backups >= 1 && fs.existsSync(p)) {
      try {
        fs.renameSync(p, `${p}.1`);
      } catch {}
    }
  } catch {}
  openLogStream();
}
function writeEntriesToFile(entries) {
  try {
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
    log.error('Fehler beim Schreiben in Logdatei:', err.message);
  }
}

let pendingMenuCmds = [];
function sendMenuCmd(cmd) {
  if (!isRendererReady()) {
    pendingMenuCmds.push(cmd);
    return;
  }
  try {
    mainWindow.webContents.send('menu:cmd', cmd);
  } catch {
    // Im Zweifel puffern (z. B. Reload mitten im Senden)
    pendingMenuCmds.push(cmd);
  }
}

// Lazy load icons only when needed (removed canvas dependency for faster startup)
let iconPlay = null;
let iconStop = null;

// Puffer für Logs, wenn der Renderer (neu) lädt oder das Fenster nicht bereit ist
const MAX_PENDING_APPENDS = 5000;
let pendingAppends = [];
function isRendererReady() {
  try {
    if (!mainWindow) return false;
    if (mainWindow.isDestroyed && mainWindow.isDestroyed()) return false;
    const wc = mainWindow.webContents;
    if (!wc) return false;
    if (wc.isDestroyed && wc.isDestroyed()) return false;
    return !wc.isLoading?.();
  } catch {
    return false;
  }
}
function enqueueAppends(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  // begrenze auf MAX_PENDING_APPENDS (älteste zuerst verwerfen)
  const room = Math.max(0, MAX_PENDING_APPENDS - pendingAppends.length);
  if (entries.length <= room) {
    pendingAppends.push(...entries);
  } else {
    // verwerfe Überschuss am Anfang
    const take = entries.slice(entries.length - room);
    const overflow = pendingAppends.length + take.length - MAX_PENDING_APPENDS;
    if (overflow > 0) pendingAppends.splice(0, overflow);
    pendingAppends.push(...take);
  }
}
function flushPendingAppends() {
  if (!isRendererReady()) return;
  if (!pendingAppends.length) return;
  const wc = mainWindow.webContents;
  // in moderaten Paketen senden
  const CHUNK = 1000;
  try {
    for (let i = 0; i < pendingAppends.length; i += CHUNK) {
      const slice = pendingAppends.slice(i, i + CHUNK);
      wc.send('logs:append', slice);
    }
  } catch {
    // Wenn während des Flushs ein Reload begonnen hat, behalten wir die restlichen im Puffer
    return;
  }
  pendingAppends = [];
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'Datei',
      submenu: [
        {
          label: '\u00d6ffnen\u2026',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenuCmd({ type: 'open-files' }),
        },
        {
          label: 'Einstellungen\u2026',
          accelerator: 'CmdOrCtrl+,',
          click: () => sendMenuCmd({ type: 'open-settings' }),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Netzwerk',
      submenu: [
        { label: 'HTTP einmal laden\u2026', click: () => sendMenuCmd({ type: 'http-load' }) },
        { label: 'HTTP Poll starten\u2026', click: () => sendMenuCmd({ type: 'http-start-poll' }) },
        { label: 'HTTP Poll stoppen', click: () => sendMenuCmd({ type: 'http-stop-poll' }) },
        { type: 'separator' },
        {
          label: 'HTTP URL festlegen\u2026',
          click: () => sendMenuCmd({ type: 'open-settings', tab: 'http' }),
        },
        {
          label: 'TCP Port konfigurieren\u2026',
          click: () => sendMenuCmd({ type: 'tcp-configure' }),
        },
        { type: 'separator' },
        {
          id: 'tcp-toggle',
          label: tcpRunning ? '\u23f9 TCP stoppen' : '\u23f5 TCP starten',
          icon: tcpRunning ? iconStop || undefined : iconPlay || undefined,
          click: () => sendMenuCmd({ type: tcpRunning ? 'tcp-stop' : 'tcp-start' }),
        },
      ],
    },
    {
      label: 'Ansicht',
      submenu: [
        { role: 'reload' },
        { role: 'forcereload' },
        { role: 'toggledevtools' },
        { type: 'separator' },
        { role: 'resetzoom' },
        { role: 'zoomin' },
        { role: 'zoomout' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function updateMenu() {
  buildMenu();
}

function resolveIconPath() {
  if (cachedIconPath !== null) {
    return cachedIconPath;
  }

  const resPath = process.resourcesPath || '';
  const candidates = [
    // Bevorzuge entpackte Ressourcen
    path.join(resPath, 'app.asar.unpacked', 'images', 'icon.ico'),
    path.join(resPath, 'images', 'icon.ico'),
    // Danach Pfad innerhalb des asar (funktioniert nicht immer zuverlässig unter Windows)
    path.join(__dirname, 'images', 'icon.ico'),
    // Fallback: Projekt-Root im Dev
    path.join(process.cwd(), 'images', 'icon.ico'),
  ];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        // Wenn die Datei innerhalb von app.asar liegt, extrahiere sie in userData für Windows
        if (p.includes('.asar' + path.sep) || p.endsWith('.asar') || p.includes('.asar/')) {
          try {
            const buf = fs.readFileSync(p);
            const outDir = path.join(app.getPath('userData'), 'assets');
            fs.mkdirSync(outDir, { recursive: true });
            const outPath = path.join(outDir, 'app-icon.ico');
            fs.writeFileSync(outPath, buf);
            cachedIconPath = outPath;
            return outPath;
          } catch (e) {
            // Fallback: trotzdem Originalpfad zurückgeben
            cachedIconPath = p;
            return p;
          }
        }
        cachedIconPath = p;
        return p;
      }
    } catch {}
  }

  cachedIconPath = '';
  return null;
}

function resolveMacIconPath() {
  const resPath = process.resourcesPath || '';
  const candidates = [
    // bevorzugt entpackte Ressourcen
    path.join(resPath, 'app.asar.unpacked', 'images', 'icon.icns'),
    path.join(resPath, 'images', 'icon.icns'),
    // innerhalb asar
    path.join(__dirname, 'images', 'icon.icns'),
    // Fallback: Projekt-Root im Dev
    path.join(process.cwd(), 'images', 'icon.icns'),
    // als letzter Fallback eine große PNG
    path.join(resPath, 'images', 'lumberjack_v4_dark_1024.png'),
    path.join(__dirname, 'images', 'lumberjack_v4_dark_1024.png'),
    path.join(process.cwd(), 'images', 'lumberjack_v4_dark_1024.png'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

// Secret encryption helpers for storing passwords securely in settings
function encryptSecret(plain) {
  try {
    if (
      safeStorage &&
      typeof safeStorage.isEncryptionAvailable === 'function' &&
      safeStorage.isEncryptionAvailable()
    ) {
      const buf = safeStorage.encryptString(String(plain));
      return 'ss1:' + Buffer.from(buf).toString('base64');
    }
  } catch (e) {
    // fall through to AES
  }
  try {
    const key = crypto
      .createHash('sha256')
      .update(app.getPath('userData') + '|lumberjack')
      .digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return 'gcm1:' + Buffer.concat([iv, tag, enc]).toString('base64');
  } catch (e) {
    return '';
  }
}
function decryptSecret(enc) {
  if (!enc || typeof enc !== 'string') return '';
  try {
    if (enc.startsWith('ss1:')) {
      const b = Buffer.from(enc.slice(4), 'base64');
      if (safeStorage && typeof safeStorage.decryptString === 'function') {
        return safeStorage.decryptString(b);
      }
      return '';
    }
    if (enc.startsWith('gcm1:')) {
      const buf = Buffer.from(enc.slice(5), 'base64');
      const iv = buf.subarray(0, 12);
      const tag = buf.subarray(12, 28);
      const data = buf.subarray(28);
      const key = crypto
        .createHash('sha256')
        .update(app.getPath('userData') + '|lumberjack')
        .digest();
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    }
  } catch (e) {
    return '';
  }
  return '';
}

function createWindow() {
  // Create window immediately with default settings for faster startup
  ensureSettings();
  const { width, height, x, y } = settings.windowBounds || {};

  mainWindow = new BrowserWindow({
    width: width || 1200,
    height: height || 800,
    ...(x != null && y != null ? { x, y } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false, // Don't show until ready for smoother experience
  });

  // Verhindert, dass ein Datei-/Link-Drop die App zu einer Datei/URL navigiert
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  mainWindow.webContents.on('did-start-loading', () => {
    // Während Reload nicht senden
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingMenuCmds.length) {
      for (const cmd of pendingMenuCmds) {
        try {
          mainWindow.webContents.send('menu:cmd', cmd);
        } catch {}
      }
      pendingMenuCmds = [];
    }
    // Nach erfolgreichem Laden aufgelaufene Logs senden
    flushPendingAppends();
  });

  // Show window as soon as it's ready to paint
  mainWindow.once('ready-to-show', () => {
    const readyTime = Date.now() - startTime;
    log.info(`Window ready in ${readyTime}ms`);
    mainWindow.show();

    // Set icon asynchronously after window is shown (Windows only)
    if (process.platform === 'win32') {
      setImmediate(() => {
        const iconPath = resolveIconPath();
        if (iconPath) {
          try {
            mainWindow.setIcon(iconPath);
            log.info('App-Icon verwendet:', iconPath);
          } catch (err) {
            log.warn('Could not set icon:', err.message);
          }
        } else {
          log.warn('Kein Icon gefunden (images/icon.ico).');
        }
      });
    }
  });

  // persist bounds on close
  mainWindow.on('close', () => {
    try {
      settings.windowBounds = mainWindow.getBounds();
    } catch {}
    saveSettings();
  });

  mainWindow.on('closed', () => {
    // Fenster ist weg; weitere Sends werden gepuffert
    // (Auf macOS kann später ein neues Fenster erscheinen und den Puffer flushen)
  });

  // Load URL immediately for faster perceived startup
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  // Diagnostic logs to help packaged builds: show key paths and which file we try to load
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
    mainWindow.loadURL(devUrl);
  } else {
    // Check multiple candidate locations for the production-built index.html
    const resPath = process.resourcesPath || '';
    const distCandidates = [
      // Typical when running from packaged asar (relative to __dirname)
      path.join(__dirname, 'dist', 'index.html'),
      // If app was unpacked by electron-builder into resources/app.asar.unpacked
      path.join(resPath, 'app.asar.unpacked', 'dist', 'index.html'),
      // Inside the asar archive
      path.join(resPath, 'app.asar', 'dist', 'index.html'),
      // Directly under resources (some builders put dist there)
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
            mainWindow.loadFile(candidate);
            loaded = true;
            break;
          } catch (e) {
            log.error('Failed to load file', candidate, e?.message || e);
          }
        }
      } catch (e) {
        log.warn('Error while checking candidate', candidate, e?.message || e);
      }
    }

    if (!loaded) {
      log.info('No production dist index.html found; falling back to root index.html (likely dev)');
      try {
        mainWindow.loadFile('index.html');
      } catch (e) {
        log.error('Failed to load fallback index.html:', e?.message || e);
      }
    }
  }

  // Attach renderer failure handlers and console forwarding for diagnostics
  try {
    const wc = mainWindow.webContents;

    wc.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      log.error('Renderer did-fail-load:', {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
      });
    });

    // Newer Electron versions emit 'render-process-gone' for renderer crashes
    wc.on('render-process-gone', (event, details) => {
      log.error('Renderer process gone:', details);
    });

    wc.on('crashed', () => {
      log.error('Renderer crashed');
    });

    // Forward renderer console messages to main log to capture runtime errors during startup
    wc.on('console-message', (...args) => {
      try {
        let level, message, line, sourceId;
        const maybeParams = args[1];
        if (
          maybeParams &&
          typeof maybeParams === 'object' &&
          ('message' in maybeParams || 'level' in maybeParams)
        ) {
          level = maybeParams.level;
          message = maybeParams.message;
          line = maybeParams.line;
          sourceId = maybeParams.sourceId;
        } else {
          level = args[1];
          message = args[2];
          line = args[3];
          sourceId = args[4];
        }
        const lvlNum = Number(level) || 0; // 0=LOG,1=WARNING,2=ERROR
        const forwardWarnings = process.env.LJ_FORWARD_WARNINGS === '1';
        if (lvlNum < 2 && !forwardWarnings) {
          // Ignore logs and warnings to avoid flooding main log by default
          return;
        }
        const lvl = ['LOG', 'WARNING', 'ERROR'][Math.max(0, Math.min(2, lvlNum))] || 'LOG';
        log.info(`Renderer console (${lvl}) ${sourceId || ''}:${line || 0} - ${message || ''}`);
      } catch (e) {}
    });

    // Open DevTools in development mode or when env var is set
    if (isDev || process.env.LJ_DEBUG_RENDERER === '1') {
      try {
        const reason = isDev ? 'Development mode' : 'LJ_DEBUG_RENDERER=1';
        log.info(`${reason} -> opening DevTools`);
        wc.openDevTools({ mode: 'bottom' });
      } catch (e) {
        log.warn('Could not open DevTools:', e?.message || e);
      }
    }
  } catch (e) {
    log.warn('Failed to attach renderer diagnostics:', e?.message || e);
  }

  // Build menu and load settings asynchronously after window starts loading
  setImmediate(async () => {
    // Build menu first (before settings load)
    buildMenu();

    // Then load settings
    await loadSettings();
    if (settings.logToFile) openLogStream();

    // Update menu with potentially changed settings
    updateMenu();
  });
}

// Unter Windows AppUserModelID setzen (wichtig für Taskbar/Startmenü-Icon und Gruppierung)
if (process.platform === 'win32') {
  try {
    app.setAppUserModelId('de.hhla.lumberjack');
  } catch {}
}

app.whenReady().then(() => {
  // macOS Dock-Icon setzen (nur Dev-relevant; in Builds kommt das aus icon.icns im Bundle)
  if (process.platform === 'darwin' && app.dock) {
    const macIconPath = resolveMacIconPath();
    if (macIconPath) {
      try {
        const img = nativeImage.createFromPath(macIconPath);
        if (!img.isEmpty()) app.dock.setIcon(img);
      } catch (e) {
        log.warn('Dock-Icon konnte nicht gesetzt werden:', e?.message || e);
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
});

// IPC: settings
/**
 * IPC: Get current settings
 */
ipcMain.handle('settings:get', () => {
  try {
    ensureSettings();
    if (!settingsLoaded) {
      loadSettingsSyncSafe();
    }
    // Return a deep copy to prevent accidental mutations
    return { ok: true, settings: structuredClone(settings) };
  } catch (err) {
    log.error('Error getting settings:', err.message);
    return { ok: false, error: err.message };
  }
});

/**
 * IPC: Update settings with validation
 */
ipcMain.handle('settings:set', (_event, patch) => {
  try {
    ensureSettings();
    if (!patch || typeof patch !== 'object') {
      return { ok: false, error: 'Invalid patch: not an object' };
    }

    const before = {
      logToFile: settings.logToFile,
      logFilePath: settings.logFilePath,
      logMaxBytes: settings.logMaxBytes,
      logMaxBackups: settings.logMaxBackups,
    };

    // Handle sensitive fields not in schema: elasticPassPlain and elasticPassClear
    const passPlain = typeof patch.elasticPassPlain === 'string' ? patch.elasticPassPlain : null;
    const passClear = !!patch.elasticPassClear;

    // Build patch sans sensitive transient fields
    const clone = { ...patch };
    delete clone.elasticPassPlain;
    delete clone.elasticPassClear;

    // Merge with validation
    const { mergeSettings } = getSettingsUtils();
    let merged = mergeSettings(clone, settings);

    // Apply password updates after merge
    if (passClear) {
      merged.elasticPassEnc = '';
    } else if (passPlain && passPlain.trim()) {
      merged.elasticPassEnc = encryptSecret(passPlain.trim());
    }

    settings = merged;

    // Save to disk
    const saved = saveSettings();
    if (!saved) {
      return { ok: false, error: 'Failed to save settings to disk' };
    }

    // Handle log stream changes
    const needReopen =
      before.logToFile !== settings.logToFile ||
      before.logFilePath !== settings.logFilePath ||
      before.logMaxBytes !== settings.logMaxBytes ||
      before.logMaxBackups !== settings.logMaxBackups;

    if (needReopen) {
      closeLogStream();
      if (settings.logToFile) {
        openLogStream();
      }
    }

    return { ok: true, settings: structuredClone(settings) };
  } catch (err) {
    log.error('Error setting settings:', err.message);
    return { ok: false, error: err.message };
  }
});

// IPC: open files dialog
ipcMain.handle('dialog:openFiles', async () => {
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
// IPC: choose log file
ipcMain.handle('dialog:chooseLogFile', async () => {
  const def = (settings.logFilePath && String(settings.logFilePath).trim()) || defaultLogFilePath();
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Logdatei wählen',
    defaultPath: def,
    filters: [
      { name: 'Logdateien', extensions: ['log', 'jsonl', 'txt'] },
      { name: 'Alle Dateien', extensions: ['*'] },
    ],
  });
  if (res.canceled) return '';
  return res.filePath || '';
});

// IPC: parse paths
ipcMain.handle('logs:parsePaths', async (_event, filePaths) => {
  try {
    const { parsePaths } = getParsers();
    const entries = parsePaths(filePaths);
    writeEntriesToFile(entries);
    return { ok: true, entries };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// IPC: parse raw dropped files (from renderer)
ipcMain.handle('logs:parseRaw', async (_event, files) => {
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
        // decode base64 to Buffer and iterate entries
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
            parsed.forEach((e) => (e.source = `${name}::${ename}`));
            all.push(...parsed);
          }
        });
      } else if (ext === '.json') {
        const entries = parseJsonFile(name, data);
        all.push(...entries);
      } else {
        // treat as text lines (.log, .txt, .jsonl, or no ext)
        const entries = parseTextLines(name, data);
        all.push(...entries);
      }
    }
    writeEntriesToFile(all);
    return { ok: true, entries: all };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Helper: send appended logs to renderer
function sendAppend(entries) {
  try {
    writeEntriesToFile(entries);
  } catch {}

  // Nur senden, wenn der Renderer bereit ist; sonst puffern
  if (!isRendererReady()) {
    enqueueAppends(entries);
    return;
  }
  try {
    mainWindow.webContents.send('logs:append', entries);
  } catch (e) {
    // z.B. während eines Reloads: puffern
    enqueueAppends(entries);
  }
}

// TCP server controls
ipcMain.on('tcp:start', (_event, { port }) => {
  if (tcpServer) {
    _event.reply('tcp:status', { ok: false, message: 'TCP server already running' });
    return;
  }
  const { toEntry } = getParsers();
  tcpServer = net.createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        // parse JSON line, fallback to plain
        let obj;
        try {
          obj = JSON.parse(line);
        } catch (_) {
          obj = { message: line };
        }
        const entry = toEntry(obj, '', `tcp:${socket.remoteAddress}:${socket.remotePort}`);
        sendAppend([entry]);
      }
    });
    socket.on('error', (err) => {
      sendAppend([
        toEntry({ level: 'ERROR', message: `TCP socket error: ${err.message}` }, '', 'tcp'),
      ]);
    });
  });
  tcpServer.on('error', (err) => {
    _event.reply('tcp:status', { ok: false, message: err.message });
  });
  tcpServer.listen(port, () => {
    tcpRunning = true;
    updateMenu();
    settings.tcpPort = port;
    saveSettings();
    _event.reply('tcp:status', { ok: true, message: `Listening on ${port}` });
  });
});

ipcMain.on('tcp:stop', (_event) => {
  if (!tcpServer) {
    _event.reply('tcp:status', { ok: false, message: 'TCP server not running' });
    return;
  }
  tcpServer.close(() => {
    tcpServer = null;
    tcpRunning = false;
    updateMenu();
    _event.reply('tcp:status', { ok: true, message: 'TCP server stopped' });
  });
});

// HTTP load utils
async function httpFetchText(url) {
  if (typeof fetch === 'function') {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.text();
  }
  throw new Error('fetch unavailable');
}

function dedupeNewEntries(entries, seen) {
  const fresh = [];
  for (const e of entries) {
    const key = JSON.stringify([
      e.timestamp,
      e.level,
      e.logger,
      e.thread,
      e.message,
      e.traceId,
      e.source,
    ]);
    if (!seen.has(key)) {
      seen.add(key);
      fresh.push(e);
    }
  }
  return fresh;
}

ipcMain.handle('http:loadOnce', async (_event, url) => {
  try {
    const { parseJsonFile, parseTextLines } = getParsers();
    const text = await httpFetchText(url);
    // try parse as JSON or NDJSON or text lines
    const isJson = text.trim().startsWith('[') || text.trim().startsWith('{');
    const entries = isJson ? parseJsonFile(url, text) : parseTextLines(url, text);
    writeEntriesToFile(entries);
    return { ok: true, entries };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('http:startPoll', async (_event, { url, intervalMs }) => {
  const id = httpPollerSeq++;
  const seen = new Set();
  const { parseJsonFile, parseTextLines, toEntry } = getParsers();

  async function tick() {
    try {
      const text = await httpFetchText(url);
      const isJson = text.trim().startsWith('[') || text.trim().startsWith('{');
      const entries = isJson ? parseJsonFile(url, text) : parseTextLines(url, text);
      const fresh = dedupeNewEntries(entries, seen);
      if (fresh.length) sendAppend(fresh);
    } catch (err) {
      const e = toEntry(
        { level: 'ERROR', message: `HTTP poll error for ${url}: ${err.message}` },
        '',
        url
      );
      // sendAppend schreibt bereits in die Logdatei
      sendAppend([e]);
    }
  }

  const timer = setInterval(tick, Math.max(500, intervalMs || 5000));
  httpPollers.set(id, { timer, url, seen });
  // fire once immediately
  tick();
  return { ok: true, id };
});

ipcMain.handle('http:stopPoll', async (_event, id) => {
  const p = httpPollers.get(id);
  if (!p) return { ok: false, error: 'not found' };
  clearInterval(p.timer);
  httpPollers.delete(id);
  return { ok: true };
});

// IPC: Elasticsearch search
ipcMain.handle('elastic:search', async (_event, opts) => {
  try {
    ensureSettings();
    const { fetchElasticLogs } = getParsers();
    const s = settings;
    const url = (opts && opts.url) || s.elasticUrl || '';
    const size = (opts && opts.size) || s.elasticSize || 1000;
    const auth = (() => {
      const user = s.elasticUser || '';
      const pass = decryptSecret(s.elasticPassEnc || '');
      if (user && pass) return { type: 'basic', username: user, password: pass };
      return undefined;
    })();
    const mergedOpts = {
      ...opts,
      url,
      size,
      auth: opts?.auth || auth,
    };
    if (!mergedOpts.url) throw new Error('Elasticsearch URL ist nicht konfiguriert');

    const entries = await fetchElasticLogs(mergedOpts);
    writeEntriesToFile(entries);
    return { ok: true, entries };
  } catch (err) {
    log.error('Elasticsearch search failed:', err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
});
