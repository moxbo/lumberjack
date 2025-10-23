const { app, BrowserWindow, ipcMain, dialog, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
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
    parsers = require('./src/parsers');
  }
  return parsers;
}
const {
  getDefaultSettings,
  parseSettingsJSON,
  stringifySettingsJSON,
  mergeSettings,
} = require('./src/utils/settings');

let mainWindow;
let tcpServer = null;
let tcpRunning = false;
let httpPollers = new Map(); // id -> {timer, url, seen}
let httpPollerSeq = 1;

// settings with defaults from schema
let settings = getDefaultSettings();

const settingsPath = () => {
  // Use a local data folder next to the portable EXE if available
  // electron-builder portable sets PORTABLE_EXECUTABLE_DIR at runtime
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir && typeof portableDir === 'string' && portableDir.length) {
    return path.join(portableDir, 'data', 'settings.json');
  }
  return path.join(app.getPath('userData'), 'settings.json');
};

/**
 * Load settings with validation and error handling (async for better startup)
 */
async function loadSettings() {
  try {
    const p = settingsPath();
    if (!fs.existsSync(p)) {
      console.log('Settings file not found, using defaults');
      return;
    }

    const raw = await fs.promises.readFile(p, 'utf8');
    const result = parseSettingsJSON(raw);

    if (result.success) {
      settings = result.settings;
      console.log('Settings loaded successfully');
    } else {
      console.error('Failed to parse settings:', result.error);
      console.log('Using default settings');
    }
  } catch (err) {
    console.error('Error loading settings:', err.message);
    console.log('Using default settings');
  }
}

/**
 * Save settings with validation and error handling
 */
function saveSettings() {
  try {
    const result = stringifySettingsJSON(settings);

    if (!result.success) {
      console.error('Failed to stringify settings:', result.error);
      return false;
    }

    const p = settingsPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, result.json, 'utf8');
    console.log('Settings saved successfully');
    return true;
  } catch (err) {
    console.error('Error saving settings:', err.message);
    return false;
  }
}

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
  if (!settings.logToFile) return;
  const p = (settings.logFilePath && String(settings.logFilePath).trim()) || defaultLogFilePath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const st = fs.existsSync(p) ? fs.statSync(p) : null;
    logBytes = st ? st.size : 0;
    logStream = fs.createWriteStream(p, { flags: 'a' });
    logPath = p;
  } catch (err) {
    console.error('Log-Datei kann nicht geöffnet werden:', err.message);
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
    console.error('Fehler beim Schreiben in Logdatei:', err.message);
  }
}

let pendingMenuCmds = [];
function sendMenuCmd(cmd) {
  if (!mainWindow) return;
  const wc = mainWindow.webContents;
  if (wc.isLoading()) {
    pendingMenuCmds.push(cmd);
    return;
  }
  wc.send('menu:cmd', cmd);
}

// Lazy load icons only when needed (removed canvas dependency for faster startup)
let iconPlay = null;
let iconStop = null;

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
            return outPath;
          } catch (e) {
            // Fallback: trotzdem Originalpfad zurückgeben
            return p;
          }
        }
        return p;
      }
    } catch {}
  }
  return null;
}

function createWindow() {
  // Create window immediately with default settings for faster startup
  const { width, height, x, y } = settings.windowBounds || {};

  // Icon nur unter Windows setzen
  let winIconOpt = {};
  if (process.platform === 'win32') {
    const iconPath = resolveIconPath();
    if (iconPath) {
      console.log('App-Icon verwendet:', iconPath);
      // Unter Windows bevorzugt Electron einen Dateipfad zur ICO
      winIconOpt = { icon: iconPath };
    } else {
      console.warn('Kein Icon gefunden (images/icon.ico).');
    }
  }

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
    ...winIconOpt,
  });

  // Verhindert, dass ein Datei-/Link-Drop die App zu einer Datei/URL navigiert
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
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
  });

  // Show window as soon as it's ready to paint
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // persist bounds on close
  mainWindow.on('close', () => {
    try {
      settings.windowBounds = mainWindow.getBounds();
    } catch {}
    saveSettings();
  });

  // Build menu first (without icons for speed)
  buildMenu();

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    const distIndex = path.join(__dirname, 'dist', 'index.html');
    if (fs.existsSync(distIndex)) mainWindow.loadFile(distIndex);
    else mainWindow.loadFile('index.html');
  }

  // Load settings and initialize features asynchronously after window is created
  setImmediate(async () => {
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
    // Return a deep copy to prevent accidental mutations
    return { ok: true, settings: structuredClone(settings) };
  } catch (err) {
    console.error('Error getting settings:', err.message);
    return { ok: false, error: err.message };
  }
});

/**
 * IPC: Update settings with validation
 */
ipcMain.handle('settings:set', (_event, patch) => {
  try {
    if (!patch || typeof patch !== 'object') {
      return { ok: false, error: 'Invalid patch: not an object' };
    }

    const before = {
      logToFile: settings.logToFile,
      logFilePath: settings.logFilePath,
      logMaxBytes: settings.logMaxBytes,
      logMaxBackups: settings.logMaxBackups,
    };

    // Merge with validation
    settings = mergeSettings(patch, settings);

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
    console.error('Error setting settings:', err.message);
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
  if (!mainWindow) return;
  try {
    writeEntriesToFile(entries);
  } catch {}
  mainWindow.webContents.send('logs:append', entries);
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
  try {
    if (typeof fetch === 'function') {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.text();
    }
  } catch (e) {
    throw e;
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
