const { app, BrowserWindow, ipcMain, dialog, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { parsePaths, toEntry } = require('./src/parsers');

let mainWindow;
let tcpServer = null;
let tcpRunning = false;
let httpPollers = new Map(); // id -> {timer, url, seen}
let httpPollerSeq = 1;

// settings
let settings = {
  windowBounds: { width: 1200, height: 800 },
  tcpPort: 5000,
  detailHeight: 300,
  colTs: 220,
  colLvl: 90,
  colLogger: 280,
  httpUrl: '',
  httpInterval: 5000,
  histLogger: [],
  histTrace: [],
  // file logging (neu)
  logToFile: false,
  logFilePath: '',
  logMaxBytes: 5 * 1024 * 1024, // 5 MB
  logMaxBackups: 3,
};
const settingsPath = () => {
  // Use a local data folder next to the portable EXE if available
  // electron-builder portable sets PORTABLE_EXECUTABLE_DIR at runtime
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir && typeof portableDir === 'string' && portableDir.length) {
    const p = path.join(portableDir, 'data', 'settings.json');
    return p;
  }
  return path.join(app.getPath('userData'), 'settings.json');
};
function loadSettings() {
  try {
    const p = settingsPath();
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      settings = { ...settings, ...raw };
    }
  } catch (_) {}
}
function saveSettings() {
  try {
    const p = settingsPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(settings, null, 2), 'utf8');
  } catch (_) {}
}

// Datei-Logging: Stream + Rotation
function defaultLogFilePath() {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  const base = portableDir && typeof portableDir === 'string' && portableDir.length
    ? path.join(portableDir, 'data')
    : app.getPath('userData');
  return path.join(base, 'lumberjack.log');
}
let logStream = null;
let logBytes = 0;
let logPath = '';
function closeLogStream() {
  try { logStream?.end?.(); } catch {}
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
        try { fs.renameSync(src, dst); } catch {}
      }
    }
    if (backups >= 1 && fs.existsSync(p)) {
      try { fs.renameSync(p, `${p}.1`); } catch {}
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

function makeIcon(color) {
  // Simple generated PNG icon (10x10) with a circle; use emoji fallback on macOS menu if icons not shown
  const { createCanvas } = (() => {
    try {
      return require('canvas');
    } catch {
      return {};
    }
  })();
  if (!createCanvas) return null;
  const canvas = createCanvas(16, 16);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 16, 16);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(8, 8, 6, 0, Math.PI * 2);
  ctx.fill();
  try {
    return nativeImage.createFromBuffer(canvas.toBuffer('image/png'));
  } catch {
    return null;
  }
}
const iconPlay = (() => {
  try {
    return makeIcon('#22c55e');
  } catch {
    return null;
  }
})();
const iconStop = (() => {
  try {
    return makeIcon('#ef4444');
  } catch {
    return null;
  }
})();

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

function createWindow() {
  loadSettings();
  if (settings.logToFile) openLogStream();
  const { width, height, x, y } = settings.windowBounds || {};
  mainWindow = new BrowserWindow({
    width: width || 1200,
    height: height || 800,
    ...(x != null && y != null ? { x, y } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
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

  // persist bounds on close
  mainWindow.on('close', () => {
    try {
      settings.windowBounds = mainWindow.getBounds();
    } catch {}
    saveSettings();
  });

  buildMenu();

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    const distIndex = path.join(__dirname, 'dist', 'index.html');
    if (fs.existsSync(distIndex)) mainWindow.loadFile(distIndex);
    else mainWindow.loadFile('index.html');
  }
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
ipcMain.handle('settings:get', () => ({ ...settings }));
ipcMain.handle('settings:set', (_event, patch) => {
  try {
    if (patch && typeof patch === 'object') {
      // only accept known keys
      const allowed = [
        'tcpPort',
        'detailHeight',
        'colTs',
        'colLvl',
        'colLogger',
        'windowBounds',
        'httpUrl',
        'httpInterval',
        'histLogger',
        'histTrace',
        'logToFile',
        'logFilePath',
        'logMaxBytes',
        'logMaxBackups',
      ];
      const before = { logToFile: settings.logToFile, logFilePath: settings.logFilePath };
      for (const k of Object.keys(patch)) {
        if (allowed.includes(k)) settings[k] = patch[k];
      }
      saveSettings();
      const needReopen = before.logToFile !== settings.logToFile || before.logFilePath !== settings.logFilePath;
      if (needReopen) {
        closeLogStream();
        if (settings.logToFile) openLogStream();
      }
    }
    return { ok: true, settings: { ...settings } };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// IPC: open files dialog
ipcMain.handle('dialog:openFiles', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Logs', extensions: ['log', 'json', 'zip'] },
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
    const entries = parsePaths(filePaths);
    writeEntriesToFile(entries);
    return { ok: true, entries };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Helper: send appended logs to renderer
function sendAppend(entries) {
  if (!mainWindow) return;
  try { writeEntriesToFile(entries); } catch {}
  mainWindow.webContents.send('logs:append', entries);
}

// TCP server controls
ipcMain.on('tcp:start', (_event, { port }) => {
  if (tcpServer) {
    _event.reply('tcp:status', { ok: false, message: 'TCP server already running' });
    return;
  }
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
    const text = await httpFetchText(url);
    // try parse as JSON or NDJSON or text lines
    const { parseJsonFile, parseTextLines } = require('./src/parsers');
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
  const { parseJsonFile, parseTextLines } = require('./src/parsers');

  async function tick() {
    try {
      const text = await httpFetchText(url);
      const isJson = text.trim().startsWith('[') || text.trim().startsWith('{');
      const entries = isJson ? parseJsonFile(url, text) : parseTextLines(url, text);
      const fresh = dedupeNewEntries(entries, seen);
      if (fresh.length) sendAppend(fresh);
    } catch (err) {
      const e = toEntry({ level: 'ERROR', message: `HTTP poll error for ${url}: ${err.message}` }, '', url);
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
