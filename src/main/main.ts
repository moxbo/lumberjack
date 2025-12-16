/**
 * Main Process (TypeScript)
 * Entry point for the Electron application with modern standards
 */

import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  type NativeImage,
} from "electron";

// ============================================================================
// STARTUP OPTIMIZATIONS (must be before any other code)
// ============================================================================

// Track startup time for performance monitoring
const processStartTime = Date.now();

// GPU/Hardware Acceleration: Allow disabling for problematic systems (VMs, old drivers)
// Users can set LUMBERJACK_DISABLE_GPU=1 to skip hardware acceleration
if (process.env.LUMBERJACK_DISABLE_GPU === "1") {
  app.disableHardwareAcceleration();
  console.log(
    "[startup] Hardware acceleration disabled via LUMBERJACK_DISABLE_GPU",
  );
}

// V8 Optimizations for faster JavaScript execution
// --turbo-fast-api-calls: Faster native API calls
// --lite-mode: Reduced memory usage for faster startup (optional)
if (!process.env.LUMBERJACK_DISABLE_V8_OPTS) {
  app.commandLine.appendSwitch("js-flags", "--turbo-fast-api-calls");
}

// Disable Chromium features that slow down startup on Windows
if (process.platform === "win32") {
  // Disable background timer throttling for consistent performance
  app.commandLine.appendSwitch("disable-background-timer-throttling");
  // Disable renderer backgrounding to prevent slowdowns when window loses focus briefly during startup
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
}
import { spawn } from "node:child_process";
import * as path from "path";
import * as fs from "fs";
import log from "electron-log/main";
import { crashReporter } from "electron";
import type { LogEntry } from "../types/ipc";
import { SettingsService } from "../services/SettingsService";
import { NetworkService } from "../services/NetworkService";
import { PerformanceService } from "../services/PerformanceService";
import { AdaptiveBatchService } from "../services/AdaptiveBatchService";
import { AsyncFileWriter } from "../services/AsyncFileWriter";
import { HealthMonitor } from "../services/HealthMonitor";
import { LoggingStrategy, LogLevel } from "../services/LoggingStrategy";

// Initialize crash reporter early to capture crashes
// Crash dumps are stored locally in app.getPath('crashDumps')
try {
  crashReporter.start({
    submitURL: "", // No remote submission - local only
    uploadToServer: false,
    compress: false,
  });
  console.warn(
    "[crash-reporter] Initialized, crashes will be saved to:",
    app.getPath("crashDumps"),
  );
} catch (e) {
  console.error("[crash-reporter] Failed to initialize:", e);
}
import { FeatureFlags } from "../services/FeatureFlags";
import { ShutdownCoordinator } from "../services/ShutdownCoordinator";
import { registerIpcHandlers } from "./ipcHandlers";
import { getSharedMainApi } from "./sharedMainApi";

// Import utility modules
import {
  isDev as isDevEnv,
  MULTI_INSTANCE_FLAG,
  NEW_WINDOW_FLAG,
  DEFAULT_MAX_PENDING_APPENDS,
  MIN_PENDING_APPENDS,
  MAX_BATCH_ENTRIES,
  MEMORY_HIGH_THRESHOLD,
  MEMORY_LOW_THRESHOLD,
  LOG_FILE_MAX_SIZE,
  APP_ID_WINDOWS,
  MEMORY_CHECK_INTERVAL_MS,
} from "./util/constants";
import { prepareRenderBatch } from "./util/logEntryUtils";
import {
  resolveIconPathSync,
  resolveIconPathAsync,
  resolveMacIconPath,
  canAccessFile,
  isValidIcoFile,
} from "./util/iconResolver";
import { showAboutDialog } from "./util/dialogs";

// Environment (use imported constant)
const isDev = isDevEnv;
const isMultiInstanceLaunch = process.argv.includes(MULTI_INSTANCE_FLAG);

// Initialize logging as early as possible to catch startup crashes
log.initialize();

// Configure log levels
log.transports.console.level = "debug";
// In production, only log info and above to file (not debug/silly)
log.transports.file.level = isDev ? false : "info";

// Configure file transport for immediate writes to prevent data loss on crashes
if (log.transports.file.level !== false) {
  // Force sync writes - logs written immediately to disk without buffering
  log.transports.file.sync = true;
  // Reduce buffer size to ensure more frequent disk writes
  log.transports.file.maxSize = LOG_FILE_MAX_SIZE;

  // Verify log directory is accessible and writable
  try {
    const logPath = log.transports.file.getFile().path;
    const logDir = path.dirname(logPath);

    // Ensure directory exists
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Test write permissions with a temp file
    const testFile = path.join(logDir, ".write-test");
    try {
      fs.writeFileSync(testFile, "test", "utf8");
      fs.unlinkSync(testFile);
    } catch (e) {
      console.error(
        "[FATAL] Log directory not writable:",
        logDir,
        e instanceof Error ? e.message : String(e),
      );
      // Continue anyway - logs will go to console
    }
  } catch (e) {
    console.error(
      "[FATAL] Failed to verify log directory:",
      e instanceof Error ? e.message : String(e),
    );
    // Continue anyway - logs will go to console
  }
}

// Log startup immediately to help diagnose early crashes
log.info("[diag] ========================================");
log.info("[diag] Application starting", {
  version: app.getVersion?.() || "unknown",
  platform: process.platform,
  arch: process.arch,
  nodeVersion: process.versions.node,
  electronVersion: process.versions.electron,
  pid: process.pid,
  isDev,
  startupElapsed: `${Date.now() - processStartTime}ms`,
  logPath:
    log.transports.file.level !== false
      ? log.transports.file.getFile().path
      : "disabled",
});

// Set AppUserModelId for Windows taskbar and notifications
// This must be done early in the app lifecycle
if (process.platform === "win32") {
  try {
    app.setAppUserModelId(APP_ID_WINDOWS);
    log.info("[icon] AppUserModelId set to:", APP_ID_WINDOWS);
  } catch (e) {
    log.warn(
      "[icon] Failed to set AppUserModelId:",
      e instanceof Error ? e.message : String(e),
    );
  }
}

// Services
const perfService = new PerformanceService();
const settingsService = new SettingsService();
const networkService = new NetworkService();
const adaptiveBatchService = new AdaptiveBatchService();
const healthMonitor = new HealthMonitor();
const loggingStrategy = new LoggingStrategy();
const featureFlags = new FeatureFlags();
const shutdownCoordinator = new ShutdownCoordinator();

// Register health checks for monitoring
healthMonitor.registerCheck("memory", async () => {
  const mem = process.memoryUsage();
  const heapPercent = mem.heapUsed / mem.heapTotal;
  return heapPercent < 0.9; // Healthy if heap usage below 90%
});

healthMonitor.registerCheck("network", async () => {
  const tcp = networkService.getTcpStatus();
  // Healthy if TCP not running or running successfully
  return !tcp.running || tcp.running;
});

// Start periodic health monitoring in production
if (!isDev) {
  setInterval(() => {
    healthMonitor.runChecks().catch((err) => {
      log.error(
        "[health] Health check failed:",
        err instanceof Error ? err.message : String(err),
      );
    });
  }, 60000); // Check every minute
}

// Configure logging strategy based on environment
if (isDev) {
  loggingStrategy.setLevel(LogLevel.DEBUG);
  loggingStrategy.setCategoryLevel("parser", LogLevel.TRACE);
  loggingStrategy.setCategoryLevel("worker", LogLevel.DEBUG);
} else {
  loggingStrategy.setLevel(LogLevel.WARN);
}

// Lazy modules

let AdmZip: typeof import("adm-zip") | null = null;

function getAdmZip(): typeof import("adm-zip") {
  if (!AdmZip) {
    AdmZip = require("adm-zip") as typeof import("adm-zip");
  }
  return AdmZip as typeof import("adm-zip");
}

let parsers: typeof import("./parsers.cjs") | null = null;
function getParsers(): typeof import("./parsers.cjs") {
  if (!parsers) {
    const appRoot = app.getAppPath();
    // In production (packaged), parsers.cjs is in dist/main/
    // In development, it's built to src/main/
    const parserPath = app.isPackaged
      ? path.join(appRoot, "dist", "main", "parsers.cjs")
      : path.join(appRoot, "src", "main", "parsers.cjs");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    parsers = require(parserPath) as typeof import("./parsers.cjs");
  }
  return parsers;
}

// Windows/Meta
let mainWindow: BrowserWindow | null = null;
const iconPlay: NativeImage | null = null;
const iconStop: NativeImage | null = null;
const windows = new Set<BrowserWindow>();
const loadedWindows = new Set<number>(); // Track windows that have finished loading

// Quit-Bestätigung
let quitConfirmed = false;
let quitPromptInProgress = false;
async function confirmQuitLocal(
  target?: BrowserWindow | null,
): Promise<boolean> {
  if (quitConfirmed) return true;
  if (quitPromptInProgress) return false;
  quitPromptInProgress = true;
  try {
    const win =
      target && !target.isDestroyed()
        ? target
        : BrowserWindow.getFocusedWindow?.();
    const options: Electron.MessageBoxOptions = {
      type: "question",
      buttons: ["Abbrechen", "Beenden"],
      defaultId: 0,
      cancelId: 0,
      title: "Anwendung beenden",
      message: "Möchtest du Lumberjack wirklich beenden?",
      noLink: true,
      normalizeAccessKeys: true,
    };
    const res = win
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options);
    const ok = res.response === 1; // 'Beenden'
    if (ok) quitConfirmed = true;
    return ok;
  } catch (e) {
    log.warn(
      "Quit-Dialog fehlgeschlagen:",
      e instanceof Error ? e.message : String(e),
    );
    return false;
  } finally {
    quitPromptInProgress = false;
  }
}

type WindowMeta = {
  baseTitle?: string | null;
  canTcpControl?: boolean;
};
const windowMeta = new Map<number, WindowMeta>();

function getDefaultBaseTitle(): string {
  return "Lumberjack";
}
function getWindowBaseTitle(win: BrowserWindow): string {
  const meta = windowMeta.get(win.id);
  const base = (meta?.baseTitle || "").trim();
  return base || getDefaultBaseTitle();
}
function setWindowBaseTitle(
  win: BrowserWindow,
  title: string | null | undefined,
): void {
  const t = (title ?? "").toString().trim();
  const meta = windowMeta.get(win.id) || {};
  meta.baseTitle = t || null;
  windowMeta.set(win.id, meta);
}
function getWindowCanTcpControl(
  win: BrowserWindow | null | undefined,
): boolean {
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
      "setTcpOwnerWindowId applyWindowTitles/updateMenu failed:",
      e instanceof Error ? e.message : String(e),
    );
  }
}
function getTcpOwnerWindowId(): number | null {
  return tcpOwnerWindowId;
}

const lumberjackGlobals = globalThis as typeof globalThis & {
  lumberjack?: {
    setTcpOwnerWindowId?: (winId: number | null) => void;
    getTcpOwnerWindowId?: () => number | null;
    applyWindowTitles?: () => void;
    getWindowBaseTitle?: (winId: number) => string;
    setWindowBaseTitle?: (winId: number, title: string) => void;
    getWindowCanTcpControl?: (winId: number) => boolean;
    setWindowCanTcpControl?: (winId: number, allowed: boolean) => void;
    updateAppMenu?: () => void;
  };
};
if (!lumberjackGlobals.lumberjack) {
  lumberjackGlobals.lumberjack = {};
}
const sharedApi = getSharedMainApi();
sharedApi.getTcpOwnerWindowId = getTcpOwnerWindowId;
sharedApi.applyWindowTitles = applyWindowTitles;
sharedApi.getWindowBaseTitle = (winId: number) => {
  try {
    const w = BrowserWindow.fromId?.(winId);
    if (w) return windowMeta.get(winId)?.baseTitle || "";
  } catch (e) {
    log.error(
      "getWindowBaseTitle failed:",
      e instanceof Error ? e.message : String(e),
    );
  }
  return "";
};
sharedApi.setWindowBaseTitle = (winId: number, title: string) => {
  try {
    const w = BrowserWindow.fromId?.(winId);
    if (w) setWindowBaseTitle(w, title);
  } catch (e) {
    log.error(
      "setWindowBaseTitle failed:",
      e instanceof Error ? e.message : String(e),
    );
  }
};
sharedApi.getWindowCanTcpControl = (winId: number) => {
  try {
    const w = BrowserWindow.fromId?.(winId);
    return getWindowCanTcpControl(w);
  } catch {
    log.error("getWindowCanTcpControl failed");
    return true;
  }
};
sharedApi.setWindowCanTcpControl = (winId: number, allowed: boolean) => {
  try {
    const w = BrowserWindow.fromId?.(winId);
    if (w) setWindowCanTcpControl(w, allowed);
  } catch (e) {
    log.error(
      "setWindowCanTcpControl failed:",
      e instanceof Error ? e.message : String(e),
    );
  }
};
sharedApi.updateAppMenu = updateMenu;

function applyWindowTitles(): void {
  const tcp = networkService.getTcpStatus();
  for (const w of windows) {
    try {
      if (w.isDestroyed()) continue;
      const base = getWindowBaseTitle(w);
      const isOwner = tcpOwnerWindowId != null && w.id === tcpOwnerWindowId;
      const title =
        tcp.running && tcp.port && isOwner ? `${base} — TCP:${tcp.port}` : base;
      w.setTitle(title);
    } catch (e) {
      log.warn(
        "applyWindowTitles failed:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }
}

// Expose for ipcHandlers
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).__applyWindowTitles = applyWindowTitles;

// Buffers with adaptive memory limits
let MAX_PENDING_APPENDS = DEFAULT_MAX_PENDING_APPENDS;
let pendingAppends: LogEntry[] = [];
const pendingMenuCmdsByWindow = new Map<
  number,
  Array<{ type: string; tab?: string }>
>();
let lastFocusedWindowId: number | null = null;
const pendingAppendsByWindow = new Map<number, LogEntry[]>();

// Adaptive Memory Management
// Periodically adjust buffer sizes based on memory usage
setInterval(() => {
  try {
    const mem = process.memoryUsage();
    const heapUsed = mem.heapUsed;
    const heapTotal = mem.heapTotal;
    const heapPercent = heapUsed / heapTotal;

    if (heapPercent > MEMORY_HIGH_THRESHOLD) {
      // High memory usage: reduce buffer
      const newLimit = Math.max(
        MIN_PENDING_APPENDS,
        Math.floor(MAX_PENDING_APPENDS * 0.5),
      );
      if (newLimit !== MAX_PENDING_APPENDS) {
        loggingStrategy.logMessage(
          "memory",
          LogLevel.WARN,
          `Buffer reduced due to high memory usage: ${MAX_PENDING_APPENDS} -> ${newLimit}`,
          { heapPercent: Math.round(heapPercent * 100) + "%" },
        );
        MAX_PENDING_APPENDS = newLimit;

        // Trim existing buffers if needed
        if (pendingAppends.length > MAX_PENDING_APPENDS) {
          const overflow = pendingAppends.length - MAX_PENDING_APPENDS;
          pendingAppends.splice(0, overflow);
        }
      }
    } else if (
      heapPercent < MEMORY_LOW_THRESHOLD &&
      MAX_PENDING_APPENDS < DEFAULT_MAX_PENDING_APPENDS
    ) {
      // Low memory usage: increase buffer back to normal
      const newLimit = Math.min(
        DEFAULT_MAX_PENDING_APPENDS,
        Math.floor(MAX_PENDING_APPENDS * 1.5),
      );
      if (newLimit !== MAX_PENDING_APPENDS) {
        loggingStrategy.logMessage(
          "memory",
          LogLevel.INFO,
          `Buffer increased: ${MAX_PENDING_APPENDS} -> ${newLimit}`,
          { heapPercent: Math.round(heapPercent * 100) + "%" },
        );
        MAX_PENDING_APPENDS = newLimit;
      }
    }
  } catch (e) {
    log.error(
      "[memory] Adaptive buffer adjustment failed:",
      e instanceof Error ? e.message : String(e),
    );
  }
}, MEMORY_CHECK_INTERVAL_MS);

// truncateEntryForRenderer and prepareRenderBatch are now imported from ./util/logEntryUtils

// [FREEZE FIX] Track batch sends for diagnostics
const batchSendStats = { total: 0, failed: 0, lastSendTime: 0 };
function sendBatchesAsyncTo(
  wc: Electron.WebContents,
  channel: string,
  batches: LogEntry[][],
): void {
  if (!batches || batches.length === 0) return;

  const batchCount = batches.length;
  const totalEntries = batches.reduce((sum, b) => sum + (b?.length || 0), 0);
  const startTime = Date.now();

  batches.forEach((batch, idx) => {
    // Use adaptive delay from AdaptiveBatchService
    const delay = adaptiveBatchService.getDelay() * idx;

    setTimeout(() => {
      try {
        if (!wc || wc.isDestroyed?.()) {
          try {
            log.silly("[freeze-diag] wc destroyed before batch send:", {
              idx,
              batchCount,
            });
          } catch {
            /* empty */
          }
          return;
        }

        // Only log IPC batches at silly level (lowest) to avoid flooding console
        log.silly(
          `[ipc-diag] Sending IPC batch on channel "${channel}": ${batch?.length || 0} entries`,
        );
        wc.send(channel, batch);
        batchSendStats.total++;
        batchSendStats.lastSendTime = Date.now();

        // Adjust adaptive delay based on last batch
        if (idx === batchCount - 1) {
          // Adjust delay based on last batch processing time
          const totalProcessingTime = Date.now() - startTime;
          adaptiveBatchService.adjustDelay(
            totalProcessingTime,
            batchCount,
            totalEntries,
          );
        }

        // Log every 10th successful send or if batch takes too long
        if (batchSendStats.total % 10 === 0) {
          try {
            const elapsed = Date.now() - startTime;
            if (elapsed > 100) {
              log.silly("[freeze-diag] batch send taking time:", {
                batchIdx: idx,
                batchCount,
                totalEntries,
                elapsedMs: elapsed,
                adaptiveDelay: adaptiveBatchService.getDelay(),
              });
            }
          } catch {
            /* empty */
          }
        }
      } catch (e) {
        batchSendStats.failed++;
        // Ignorieren; erneuter Versand erfolgt später ggf. über Buffer
        try {
          if (batchSendStats.failed % 5 === 0) {
            log.warn(
              "[freeze-diag] batch send error (recurring):",
              e instanceof Error ? e.message : String(e),
            );
          }
        } catch {}
      }
    }, delay);
  });
}

// File logging
let logStream: fs.WriteStream | null = null;
let asyncFileWriter: AsyncFileWriter | null = null;
let logBytes = 0;
function defaultLogFilePath(): string {
  const base = app.getPath("userData");
  return path.join(base, "lumberjack.log");
}
function closeLogStream(): void {
  try {
    logStream?.end?.();
  } catch (e) {
    log.error(
      "Fehler beim Schließen des Log-Streams:",
      e instanceof Error ? e.message : String(e),
    );
  }
  logStream = null;

  // Just release async file writer reference without clearing queue
  // Pending writes will be lost but this is expected during rotation
  asyncFileWriter = null;

  logBytes = 0;
}
function openLogStream(): void {
  const settings = settingsService.get();
  if (!settings.logToFile) return;
  const p =
    (settings.logFilePath && String(settings.logFilePath).trim()) ||
    defaultLogFilePath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const st = fs.existsSync(p) ? fs.statSync(p) : null;
    logBytes = st ? st.size : 0;
    logStream = fs.createWriteStream(p, { flags: "a" });

    // Initialize AsyncFileWriter for non-blocking writes
    asyncFileWriter = new AsyncFileWriter(p);
  } catch (err) {
    log.error(
      "Log-Datei kann nicht geöffnet werden:",
      err instanceof Error ? err.message : String(err),
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
    const p =
      (settings.logFilePath && String(settings.logFilePath).trim()) ||
      defaultLogFilePath();
    const backups = Math.max(0, Number(settings.logMaxBackups || 0) || 0);
    for (let i = backups - 1; i >= 1; i--) {
      const src = `${p}.${i}`;
      const dst = `${p}.${i + 1}`;
      if (fs.existsSync(src)) {
        try {
          fs.renameSync(src, dst);
        } catch (e) {
          log.error(
            "Log rotation rename failed:",
            e instanceof Error ? e.message : String(e),
          );
        }
      }
    }
    if (backups >= 1 && fs.existsSync(p)) {
      try {
        fs.renameSync(p, `${p}.1`);
      } catch (e) {
        log.error(
          "Log rotation rename failed:",
          e instanceof Error ? e.message : String(e),
        );
      }
    }
  } catch (e) {
    log.error(
      "Log rotation failed:",
      e instanceof Error ? e.message : String(e),
    );
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

    // Pre-serialize all entries and calculate total size
    const lines: string[] = [];
    let totalBytes = 0;
    for (const e of entries) {
      const line = JSON.stringify(e) + "\n";
      lines.push(line);
      totalBytes += line.length;
    }

    // Check rotation once for the entire batch
    rotateIfNeeded(totalBytes);
    if (!logStream) openLogStream();
    if (!logStream) return;

    // Use AsyncFileWriter if available for non-blocking writes
    if (asyncFileWriter) {
      // Write all lines as a single batch
      const batch = lines.join("");
      asyncFileWriter.write(batch).catch((err) => {
        // Only log if it's not a queue-cleared situation (expected during rotation)
        const msg = err instanceof Error ? err.message : String(err);
        if (msg !== "Queue cleared") {
          log.error("Async write failed:", msg);
        }
      });
      logBytes += totalBytes;
    } else {
      // Fallback to sync writes if AsyncFileWriter not available
      for (const line of lines) {
        if (!logStream) openLogStream();
        if (!logStream) return;
        logStream.write(line);
      }
      logBytes += totalBytes;
    }
  } catch (err) {
    log.error(
      "Fehler beim Schreiben in Logdatei:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

// Menu command routing (per-window)
function sendMenuCmd(
  cmd: { type: string; tab?: string },
  targetWin?: BrowserWindow | null,
): void {
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
    target.webContents?.send("menu:cmd", cmd);
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
    // Check if main window has finished loading at least once
    return loadedWindows.has(mainWindow.id);
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
  if (!isRendererReady()) {
    log.silly("[flush-diag] Renderer not ready, skipping flush");
    return;
  }
  if (!pendingAppends.length) return;
  const wc = mainWindow?.webContents;
  if (!wc) {
    log.silly("[flush-diag] No webContents, skipping flush");
    return;
  }
  log.silly(
    `[flush-diag] Flushing ${pendingAppends.length} pending appends to main window`,
  );
  try {
    const batches: LogEntry[][] = [];
    for (let i = 0; i < pendingAppends.length; i += MAX_BATCH_ENTRIES) {
      const slice = pendingAppends.slice(i, i + MAX_BATCH_ENTRIES);
      batches.push(prepareRenderBatch(slice));
    }
    // gestaffelt senden, damit der Event-Loop atmen kann
    sendBatchesAsyncTo(wc, "logs:append", batches);
    log.silly(`[flush-diag] Sent ${batches.length} batches to main window`);
  } catch (err) {
    // nicht leeren, damit später erneut versucht werden kann
    log.silly(
      "[flush-diag] Error flushing, will retry:",
      err instanceof Error ? err.message : String(err),
    );
    return;
  }
  pendingAppends = [];
}
function isWindowReady(win: BrowserWindow | null | undefined): boolean {
  try {
    if (!win || win.isDestroyed()) return false;
    const wc = win.webContents;
    if (!wc || wc.isDestroyed()) return false;
    // Check if the window has finished loading at least once
    // This is more reliable than isLoading() which can be true during resource loads
    return loadedWindows.has(win.id);
  } catch {
    return false;
  }
}
function enqueueAppendsFor(winId: number, entries: LogEntry[]): void {
  if (!entries || !entries.length) return;
  const list = pendingAppendsByWindow.get(winId) || [];
  const room = Math.max(0, MAX_PENDING_APPENDS - list.length);
  const toPush =
    entries.length <= room ? entries : entries.slice(entries.length - room);
  const updated = list.concat(toPush);
  if (updated.length > MAX_PENDING_APPENDS)
    updated.splice(0, updated.length - MAX_PENDING_APPENDS);
  pendingAppendsByWindow.set(winId, updated);
}
function flushPendingAppendsFor(win: BrowserWindow): void {
  if (!isWindowReady(win)) {
    log.silly(`[flush-diag] Window ${win.id} not ready, skipping flush`);
    return;
  }
  const buf = pendingAppendsByWindow.get(win.id);
  if (!buf || !buf.length) return;
  log.silly(
    `[flush-diag] Flushing ${buf.length} pending appends for window ${win.id}`,
  );
  const wc = win.webContents;
  try {
    const batches: LogEntry[][] = [];
    for (let i = 0; i < buf.length; i += MAX_BATCH_ENTRIES) {
      const slice = buf.slice(i, i + MAX_BATCH_ENTRIES);
      batches.push(prepareRenderBatch(slice));
    }
    sendBatchesAsyncTo(wc, "logs:append", batches);
    log.silly(
      `[flush-diag] Sent ${batches.length} batches to window ${win.id}`,
    );
  } catch (e) {
    log.error(
      "flushPendingAppendsFor send failed:",
      e instanceof Error ? e.message : String(e),
    );
    return;
  }
  pendingAppendsByWindow.delete(win.id);
}

// NetworkService callback → route to right window(s)
function sendAppend(entries: LogEntry[]): void {
  try {
    // volle Daten in Datei (ohne Kürzung)
    writeEntriesToFile(entries);
  } catch {
    // Intentionally empty - ignore errors
  }

  const isTcpEntry = (e: LogEntry) =>
    typeof e?.source === "string" && e.source.startsWith("tcp:");
  const tcpEntries: LogEntry[] = [];
  const otherEntries: LogEntry[] = [];
  for (const e of entries) (isTcpEntry(e) ? tcpEntries : otherEntries).push(e);

  log.debug(
    `[tcp-diag] sendAppend called: ${entries.length} total, ${tcpEntries.length} TCP, ${otherEntries.length} other`,
  );

  const sendEntriesToWc = (wc: Electron.WebContents, arr: LogEntry[]): void => {
    if (!Array.isArray(arr) || arr.length === 0) return;
    const batches: LogEntry[][] = [];
    for (let i = 0; i < arr.length; i += MAX_BATCH_ENTRIES) {
      const slice = arr.slice(i, i + MAX_BATCH_ENTRIES);
      batches.push(prepareRenderBatch(slice));
    }
    sendBatchesAsyncTo(wc, "logs:append", batches);
  };

  // TCP → owner window only
  if (tcpEntries.length) {
    const ownerId = getTcpOwnerWindowId();
    log.debug(`[tcp-diag] TCP owner window ID: ${ownerId}`);
    const ownerWin =
      ownerId != null ? BrowserWindow.fromId?.(ownerId) || null : null;
    if (ownerWin && isWindowReady(ownerWin)) {
      log.debug(
        `[tcp-diag] Sending ${tcpEntries.length} TCP entries directly to owner window ${ownerWin.id}`,
      );
      try {
        sendEntriesToWc(ownerWin.webContents, tcpEntries);
      } catch (err) {
        log.debug(
          `[tcp-diag] Failed to send directly, enqueueing for window ${ownerWin.id}:`,
          err instanceof Error ? err.message : String(err),
        );
        enqueueAppendsFor(ownerWin.id, tcpEntries);
      }
    } else if (ownerWin) {
      log.debug(
        `[tcp-diag] Owner window ${ownerWin.id} not ready, enqueueing ${tcpEntries.length} TCP entries`,
      );
      enqueueAppendsFor(ownerWin.id, tcpEntries);
    }
    // else: no owner → route to main
    else {
      log.debug(
        `[tcp-diag] No owner window, routing ${tcpEntries.length} TCP entries to main window`,
      );
      otherEntries.push(...tcpEntries);
    }
  }

  // Non-TCP → primary window (bestehendes Verhalten)
  if (otherEntries.length) {
    if (!isRendererReady()) {
      log.debug(
        `[tcp-diag] Main renderer not ready, enqueueing ${otherEntries.length} entries`,
      );
      enqueueAppends(otherEntries);
      return;
    }
    try {
      const wc = mainWindow?.webContents as any;
      if (wc) {
        log.debug(
          `[tcp-diag] Sending ${otherEntries.length} entries to main window`,
        );
        sendEntriesToWc(wc, otherEntries);
      } else {
        log.debug(
          `[tcp-diag] No main window webContents, enqueueing ${otherEntries.length} entries`,
        );
        enqueueAppends(otherEntries);
      }
    } catch (err) {
      log.debug(
        `[tcp-diag] Error sending to main window, enqueueing:`,
        err instanceof Error ? err.message : String(err),
      );
      enqueueAppends(otherEntries);
    }
  }
}

// Icon/dist path caching is now handled in ./util/iconResolver
// Using imported functions: resolveIconPathSync, resolveIconPathAsync, resolveMacIconPath, canAccessFile, isValidIcoFile
let cachedDistIndexPath: string | null = null;

// showAboutDialog and showHelpDialog are now imported from ./util/dialogs

// Menu
function buildMenu(): void {
  const isMac = process.platform === "darwin";
  const tcpStatus = networkService.getTcpStatus();
  const focused = BrowserWindow.getFocusedWindow?.() || null;
  const canTcp = getWindowCanTcpControl(focused);
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "Datei",
      submenu: [
        {
          label: "Neues Fenster",
          accelerator: "CmdOrCtrl+N",
          click: () => openWindowInNewProcess(),
        },
        { type: "separator" as const },
        {
          label: "Öffnen…",
          accelerator: "CmdOrCtrl+O",
          click: (_mi, win) =>
            sendMenuCmd(
              { type: "open-files" },
              (win as BrowserWindow | null | undefined) || null,
            ),
        },
        {
          label: "Einstellungen…",
          accelerator: "CmdOrCtrl+,",
          click: (_mi, win) =>
            sendMenuCmd(
              { type: "open-settings" },
              (win as BrowserWindow | null | undefined) || null,
            ),
        },
        {
          label: "Fenster-Titel setzen…",
          click: (_mi, win) =>
            sendMenuCmd(
              { type: "window-title" },
              (win as BrowserWindow | null | undefined) || null,
            ),
        },
        { type: "separator" as const },
        (isMac
          ? { role: "close" as const }
          : { role: "quit" as const }) as never,
      ],
    },
    {
      label: "Bearbeiten",
      submenu: [
        { role: "undo" as const, label: "Widerrufen" },
        { role: "redo" as const, label: "Wiederholen" },
        { type: "separator" as const },
        { role: "cut" as const, label: "Ausschneiden" },
        { role: "copy" as const, label: "Kopieren" },
        { role: "paste" as const, label: "Einfügen" },
        { role: "selectAll" as const, label: "Alles auswählen" },
      ],
    },
    {
      label: "Netzwerk",
      submenu: [
        {
          label: "HTTP einmal laden…",
          click: (_mi, win) =>
            sendMenuCmd(
              { type: "http-load" },
              (win as BrowserWindow | null | undefined) || null,
            ),
        },
        {
          label: "HTTP Poll starten…",
          click: (_mi, win) =>
            sendMenuCmd(
              { type: "http-start-poll" },
              (win as BrowserWindow | null | undefined) || null,
            ),
        },
        {
          label: "HTTP Poll stoppen",
          click: (_mi, win) =>
            sendMenuCmd(
              { type: "http-stop-poll" },
              (win as BrowserWindow | null | undefined) || null,
            ),
        },
        { type: "separator" as const },
        {
          id: "tcp-toggle",
          label: tcpStatus.running ? "⏹ TCP stoppen" : "⏵ TCP starten",
          icon: tcpStatus.running
            ? (iconStop ?? undefined)
            : (iconPlay ?? undefined),
          click: (_mi, win) =>
            sendMenuCmd(
              { type: tcpStatus.running ? "tcp-stop" : "tcp-start" },
              (win as BrowserWindow | null | undefined) || null,
            ),
          enabled: canTcp,
        },
      ],
    },
    {
      label: "Ansicht",
      submenu: [
        {
          label: "Follow-Modus",
          type: "checkbox" as const,
          checked: settingsService.get().follow,
          accelerator: "CmdOrCtrl+F",
          click: (_mi, win) =>
            sendMenuCmd(
              { type: "toggle-follow" },
              (win as BrowserWindow | null | undefined) || null,
            ),
        },
        { type: "separator" as const },
        { role: "reload" as const },
        { role: "forceReload" as const },
        ...(isDev ? [{ role: "toggleDevTools" as const }] : []),
        { type: "separator" as const },
        { role: "resetZoom" as const },
        { role: "zoomIn" as const },
        { role: "zoomOut" as const },
        { type: "separator" as const },
        { role: "togglefullscreen" as const },
      ],
    },
    {
      label: "Hilfe",
      submenu: [
        { label: "Über Lumberjack…", click: () => showAboutDialog() },
        {
          label: "Hilfe / Anleitung…",
          accelerator: "F1",
          click: (_mi, win) =>
            sendMenuCmd(
              { type: "show-help" },
              (win as BrowserWindow | null | undefined) || null,
            ),
        },
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

  // Resolve icon path early and create nativeImage for reliable icon loading
  const getWindowIcon = (): { icon?: NativeImage | string } => {
    if (process.platform === "darwin") {
      const iconPath = resolveMacIconPath();
      if (iconPath) {
        log.info?.("[window] macOS icon path resolved:", iconPath);
        const icon = nativeImage.createFromPath(iconPath);
        if (!icon.isEmpty()) {
          log.info?.("[window] macOS nativeImage created successfully");
          return { icon };
        }
        log.warn?.("[window] macOS nativeImage is empty, using path directly");
        return { icon: iconPath };
      }
      log.warn?.("[window] No macOS icon path found");
      return {};
    } else if (process.platform === "win32") {
      const iconPath = resolveIconPathSync();
      if (iconPath) {
        log.info?.("[window] Windows icon path resolved:", iconPath);
        try {
          const icon = nativeImage.createFromPath(iconPath);
          if (!icon.isEmpty()) {
            log.info?.(
              "[window] Windows nativeImage created successfully, size:",
              icon.getSize(),
            );
            return { icon };
          }
          log.warn?.(
            "[window] Windows nativeImage is empty, using path directly",
          );
          // Fallback: return the path directly - Electron can also accept a path string
          return { icon: iconPath };
        } catch (e) {
          log.error?.("[window] Failed to create nativeImage:", e);
          // Fallback: return the path directly
          return { icon: iconPath };
        }
      }
      log.warn?.("[window] No Windows icon path found");
      return {};
    }
    return {};
  };

  const windowIconOpts = getWindowIcon();
  log.info?.(
    "[window] Window icon options:",
    windowIconOpts.icon ? "icon set" : "no icon",
  );

  const win = new BrowserWindow({
    width: width || 1200,
    height: height || 800,
    ...(x != null && y != null ? { x, y } : {}),
    title: getDefaultBaseTitle(),
    // Icon bereits beim Erzeugen setzen (wichtig für Taskbar/Alt-Tab unter Windows und Dock auf macOS)
    ...windowIconOpts,
    webPreferences: {
      preload: (() => {
        // Try multiple preload paths
        const candidates = [
          path.join(
            app.getAppPath(),
            "release",
            "app",
            "dist",
            "preload",
            "preload.js",
          ),
          path.join(app.getAppPath(), "dist", "preload", "preload.js"),
          path.join(__dirname, "..", "preload", "preload.js"),
        ];
        for (const p of candidates) {
          try {
            if (fs.existsSync(p)) return p;
          } catch {
            /* ignore */
          }
        }
        return candidates[0]; // fallback
      })(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // Sandbox enabled for enhanced security
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: false, // Prevents slowdown during startup when window briefly loses focus
    },
    show: false,
    backgroundColor: "#0f1113",
  });

  // Abfangen des Schließens des letzten Fensters (Win/Linux) → Beenden bestätigen

  // [Windows Taskbar] Set icon immediately after window creation for early taskbar display
  if (process.platform === "win32") {
    try {
      const iconPath = resolveIconPathSync();
      if (iconPath) {
        try {
          // Validate file access before setting
          if (canAccessFile(iconPath) && isValidIcoFile(iconPath)) {
            // Use nativeImage for more reliable icon loading
            const icon = nativeImage.createFromPath(iconPath);
            if (!icon.isEmpty()) {
              win.setIcon(icon);
              log.info?.(
                "[icon] Windows icon set immediately at window creation:",
                iconPath,
              );
            } else {
              log.warn?.("[icon] nativeImage is empty for path:", iconPath);
            }
          } else {
            log.warn?.(
              "[icon] Icon file exists but failed validation checks:",
              iconPath,
            );
          }
        } catch (e) {
          log.debug?.(
            "[icon] Immediate Windows icon set failed, will retry in ready-to-show:",
            e instanceof Error ? e.message : String(e),
          );
        }
      } else {
        log.warn?.("[icon] No icon path resolved at window creation");
      }
    } catch (e) {
      log.debug?.(
        "[icon] Error setting immediate Windows icon:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  // Abfangen des Schließens des letzten Fensters (Win/Linux) → Beenden bestätigen
  win.on("close", async (e) => {
    try {
      if (process.platform === "darwin") return; // Auf macOS beendet das Schließen nicht die App
      // Ist dies das letzte Fenster?
      const others = BrowserWindow.getAllWindows().filter(
        (w) => w.id !== win.id,
      );
      const isLast = others.length === 0;
      if (!isLast) return; // Nur beim letzten Fenster nachfragen
      if (quitConfirmed) return;
      e.preventDefault();
      const ok = await confirmQuitLocal(win);
      if (ok) {
        // Fenster wirklich schließen und Quit fortsetzen
        // Markiere als bestätigt, dann zerstören → before-quit wird nicht erneut blockieren
        quitConfirmed = true;
        // destroy() um weitere close-Hooks zu umgehen
        win.destroy();
      }
    } catch (err) {
      log.warn(
        "close-confirm failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
  });

  windowMeta.set(win.id, { canTcpControl: true, baseTitle: null });
  if (settings.isMaximized) win.maximize();

  windows.add(win);
  if (!mainWindow || makePrimary) mainWindow = win;

  setImmediate(() => applyWindowTitles());

  try {
    win.on("focus", () => {
      lastFocusedWindowId = win.id;
      updateMenu();
    });
    win.on("blur", () => updateMenu());
  } catch {
    // Intentionally empty - ignore errors
  }

  win.webContents.on("will-navigate", (event) => event.preventDefault());

  win.webContents.on("did-finish-load", () => {
    // Mark window as loaded so isWindowReady() will return true
    loadedWindows.add(win.id);
    log.debug(
      `[window-ready] Window ${win.id} finished loading, marked as ready`,
    );

    applyWindowTitles();

    // Flush queued menu cmds for this window
    try {
      const queued = pendingMenuCmdsByWindow.get(win.id);
      if (queued && queued.length) {
        for (const cmd of queued) {
          try {
            win.webContents.send("menu:cmd", cmd);
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

  win.once("ready-to-show", () => {
    // Log startup performance
    const readyToShowTime = Date.now() - processStartTime;
    log.info(`[PERF] Window ready-to-show: ${readyToShowTime}ms`);
    if (readyToShowTime > 3000) {
      log.warn(
        `[PERF] Slow startup detected (${readyToShowTime}ms). Consider checking antivirus exclusions.`,
      );
    }

    if (!win.isVisible()) win.show();

    // macOS: Dock-Icon setzen
    if (process.platform === "darwin") {
      try {
        const macIconPath = resolveMacIconPath();
        if (macIconPath) {
          try {
            log.info(
              "[icon] Loading macOS icon for ready-to-show:",
              macIconPath,
            );
            // Versuche, die Datei direkt als Buffer zu lesen und zu laden
            try {
              const iconBuffer = fs.readFileSync(macIconPath);
              const img = nativeImage.createFromBuffer(iconBuffer);
              if (!img.isEmpty()) {
                app.dock?.setIcon(img);
                log.info(
                  "[icon] app.dock.setIcon applied in ready-to-show via buffer",
                );
              } else {
                log.warn("[icon] macOS nativeImage is empty from buffer");
              }
            } catch {
              // Fallback: Versuche mit Pfad
              const img = nativeImage.createFromPath(macIconPath);
              if (!img.isEmpty()) {
                app.dock?.setIcon(img);
                log.info(
                  "[icon] app.dock.setIcon applied in ready-to-show via path",
                );
              } else {
                log.warn("[icon] macOS nativeImage is empty from path");
              }
            }
          } catch (imgErr) {
            log.warn(
              "[icon] Error creating nativeImage for macOS:",
              imgErr instanceof Error ? imgErr.message : String(imgErr),
            );
          }
        } else {
          try {
            log.warn?.("[icon] No macOS icon resolved for ready-to-show dock");
          } catch {
            // Intentionally empty - ignore errors
          }
        }
      } catch (e) {
        try {
          log.warn?.(
            "[icon] macOS dock icon error in ready-to-show:",
            e instanceof Error ? e.message : String(e),
          );
        } catch {
          // Intentionally empty - ignore errors
        }
      }
    }

    if (process.platform === "win32") {
      setImmediate(async () => {
        try {
          const iconPath = await resolveIconPathAsync();
          if (iconPath && !win.isDestroyed()) {
            try {
              // Try with path first (most reliable)
              win.setIcon(iconPath);
              try {
                log.info?.("[icon] BrowserWindow.setIcon applied:", iconPath);
              } catch {
                // Intentionally empty - ignore errors
              }
            } catch (pathErr) {
              const nativeImageResult = (() => {
                try {
                  const iconBuffer = fs.readFileSync(iconPath);
                  const img = nativeImage.createFromBuffer(iconBuffer);
                  return img.isEmpty() ? null : img;
                } catch {
                  return null;
                }
              })();
              if (nativeImageResult) {
                win.setIcon(nativeImageResult);
              } else {
                log.warn?.(
                  "[icon] BrowserWindow.setIcon failed:",
                  pathErr instanceof Error ? pathErr.message : String(pathErr),
                );
              }
            }
          } else {
            try {
              log.warn?.("[icon] No iconPath resolved for setIcon");
            } catch {
              // Intentionally empty - ignore errors
            }
          }
        } catch (e) {
          try {
            log.warn?.(
              "[icon] resolve/set icon error:",
              e instanceof Error ? e.message : String(e),
            );
          } catch {
            // Intentionally empty - ignore errors
          }
        }
      });
    }
  });

  win.on("maximize", () => {
    try {
      const s = settingsService.get();
      s.isMaximized = true;
      settingsService.update(s);
      void settingsService.save();
    } catch {
      // Intentionally empty - ignore errors
    }
  });
  win.on("unmaximize", () => {
    try {
      const s = settingsService.get();
      s.isMaximized = false;
      settingsService.update(s);
      void settingsService.save();
    } catch {
      // Intentionally empty - ignore errors
    }
  });

  win.on("close", () => {
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

  win.on("closed", () => {
    windows.delete(win);
    windowMeta.delete(win.id);
    pendingAppendsByWindow.delete(win.id);
    loadedWindows.delete(win.id); // Remove from loaded windows set
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
      const resPath = process.resourcesPath || "";
      const distCandidates = [
        // Primary paths for development (npm run start)
        path.join(
          app.getAppPath(),
          "release",
          "app",
          "dist",
          "renderer",
          "index.html",
        ),
        path.join(__dirname, "..", "renderer", "index.html"),
        path.join(app.getAppPath(), "dist", "renderer", "index.html"),
        path.join(
          process.cwd(),
          "release",
          "app",
          "dist",
          "renderer",
          "index.html",
        ),
        path.join(process.cwd(), "dist", "renderer", "index.html"),
        // Production paths (packaged app)
        path.join(
          resPath,
          "app.asar.unpacked",
          "dist",
          "renderer",
          "index.html",
        ),
        path.join(resPath, "app.asar", "dist", "renderer", "index.html"),
        path.join(resPath, "dist", "renderer", "index.html"),
        // Legacy paths for backward compatibility
        path.join(__dirname, "dist", "index.html"),
        path.join(app.getAppPath(), "dist", "index.html"),
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
          void win.loadFile("index.html");
          cachedDistIndexPath = "index.html";
        } catch {
          // Intentionally empty - ignore errors
        }
      }
    }
  }

  try {
    const wc = win.webContents;
    wc.on("did-fail-load", (_e, errorCode, errorDescription) => {
      // Error code constants from Chromium
      const ERR_ABORTED = -3;

      log.error("[diag] Renderer did-fail-load:", {
        errorCode,
        errorDescription,
        url: wc.getURL?.(),
      });
      // Don't exit on renderer load failure - attempt recovery
      try {
        if (errorCode === ERR_ABORTED) {
          // ERR_ABORTED - usually harmless (user navigation or redirect)
          return;
        }
        // For critical errors, try reloading after a delay
        if (!win.isDestroyed() && !quitConfirmed) {
          setTimeout(() => {
            try {
              if (!win.isDestroyed()) {
                log.info(
                  "[diag] Attempting renderer reload after load failure",
                );
                win.reload();
              }
            } catch (e) {
              log.error(
                "[diag] Renderer reload failed:",
                e instanceof Error ? e.message : String(e),
              );
            }
          }, 1000);
        }
      } catch (e) {
        log.error(
          "[diag] Error handling did-fail-load:",
          e instanceof Error ? e.message : String(e),
        );
      }
    });

    // Per-window renderer crash handler with recovery logic
    wc.on("render-process-gone", (_e, details) => {
      log.error("[diag] Renderer gone (window-specific):", {
        reason: details.reason,
        exitCode: details.exitCode,
      });

      // Auto-Recovery: Versuche bei Crash/Exit den Renderer neu zu laden oder ein neues Fenster zu erstellen,
      // sofern der Benutzer das Beenden nicht bestätigt hat.
      try {
        if (quitConfirmed) {
          log.info("[diag] Renderer gone but quit confirmed - not recovering");
          return;
        }

        // Different recovery strategies based on exit reason
        const shouldRecover =
          details.reason === "crashed" ||
          details.reason === "oom" ||
          details.reason === "launch-failed" ||
          details.reason === "integrity-failure";

        if (!shouldRecover) {
          log.info(
            "[diag] Renderer gone reason does not require recovery:",
            details.reason,
          );
          return;
        }

        log.info("[diag] Attempting renderer recovery...");

        // Wait a bit before recovery to avoid rapid crash loops
        setTimeout(() => {
          try {
            if (!win.isDestroyed()) {
              // Reload only if window still exists
              log.info("[diag] Reloading existing window");
              win.reload();
            } else {
              // Create new window if old one is destroyed
              log.info("[diag] Creating new window to replace destroyed one");
              createWindow({ makePrimary: win === mainWindow });
            }
          } catch (e) {
            log.error(
              "[diag] Recovery failed:",
              e instanceof Error ? e.message : String(e),
            );
            // Last resort: try creating a new window
            try {
              createWindow({ makePrimary: true });
            } catch (e2) {
              log.error(
                "[diag] Last resort window creation failed:",
                e2 instanceof Error ? e2.message : String(e2),
              );
            }
          }
        }, 500);
      } catch (e) {
        log.error(
          "[diag] Error in render-process-gone handler:",
          e instanceof Error ? e.message : String(e),
        );
      }
    });
    if (isDev || process.env.LJ_DEBUG_RENDERER === "1") {
      try {
        wc.openDevTools({ mode: "bottom" });
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
perfService.mark("main-loaded");
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
try {
  registerIpcHandlers(settingsService, networkService, getParsers, getAdmZip);
  log.info("[diag] IPC handlers registered successfully");
} catch (err) {
  log.error(
    "[diag] CRITICAL: Failed to register IPC handlers:",
    err instanceof Error ? err.stack : String(err),
  );
}

// Fallback: react to tcp:status broadcasts
try {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { ipcMain } = require("electron");
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  ipcMain.on("tcp:status", () => {
    try {
      applyWindowTitles();
      updateMenu();
    } catch (err) {
      log.error(
        "[diag] Error in tcp:status handler:",
        err instanceof Error ? err.message : String(err),
      );
    }
  });
} catch (err) {
  log.error(
    "[diag] Failed to register tcp:status handler:",
    err instanceof Error ? err.message : String(err),
  );
}

// [CRITICAL FIX] Periodic flush of pending appends to renderer
// This ensures buffered log entries are sent to UI regularly
// Without this timer, logs can be delayed indefinitely in pendingAppends buffer
const PENDING_APPEND_FLUSH_INTERVAL_MS = 100; // Flush every 100ms for responsive UI
let flushTimerCount = 0;
setInterval(() => {
  try {
    flushTimerCount++;
    const hasPending = pendingAppends.length > 0;
    const hasWindowPending = Array.from(windows).some((w) => {
      const buf = pendingAppendsByWindow.get(w.id);
      return buf && buf.length > 0;
    });

    if (flushTimerCount % 10 === 1 || hasPending || hasWindowPending) {
      log.silly(
        `[flush-timer] Run #${flushTimerCount}: pendingAppends=${pendingAppends.length}, windows=${windows.size}, hasWindowPending=${hasWindowPending}`,
      );
    }

    // Flush main window buffer
    flushPendingAppends();

    // Flush per-window buffers for multi-window scenarios
    for (const win of windows) {
      try {
        if (!win.isDestroyed()) {
          flushPendingAppendsFor(win);
        }
      } catch {
        // Ignore errors for individual windows
      }
    }
  } catch (err) {
    // Ignore errors to prevent timer from being cancelled
    try {
      log.silly(
        "[flush-timer] Periodic flush error (continuing):",
        err instanceof Error ? err.message : String(err),
      );
    } catch {
      // Ignore logging errors
    }
  }
}, PENDING_APPEND_FLUSH_INTERVAL_MS);

// App lifecycle
if (process.platform === "win32") {
  try {
    app.setAppUserModelId(APP_ID_WINDOWS);
  } catch {
    // Intentionally empty - ignore errors
  }
}

// Log flushing configuration constants
const LOG_FLUSH_INTERVAL_MS = 5000; // Flush logs every 5 seconds
const LOG_FLUSH_TIMEOUT_MS = 100; // Wait 100ms for flush on signal before exit

// Type-safe log transport interface for flushing
interface LogTransportWithFlush {
  file?: {
    flush?: () => void;
  };
}

// Helper function to force flush logs to disk
// This is critical for ensuring crash logs are written before process termination
function forceFlushLogs(): void {
  try {
    // Electron-log automatically flushes on error/fatal, but we force it here
    // to ensure all logs reach disk before exit
    const transport = log as unknown as LogTransportWithFlush;
    if (transport?.file?.flush) {
      transport.file.flush();
    }
  } catch (e) {
    // Last resort: write to stderr if log flushing fails
    console.error("[FATAL] Failed to flush logs:", e);
  }
}

// Global diagnostics for unexpected exits/crashes
// Track exit source for debugging
// Note: These are safe to use in Node.js main process which is single-threaded.
// Events are processed sequentially, so no race conditions can occur.
let exitSource = "unknown";
let exitDetails: Record<string, unknown> | null = null;

try {
  process.on("uncaughtException", (err, origin) => {
    try {
      exitSource = "uncaughtException";
      exitDetails = { origin, error: err?.stack || String(err) };

      // Detect potential installer conflicts (Windows Node.js installer interference)
      const errorMsg = String(err?.message || "").toLowerCase();
      const errorCode = (err as NodeJS.ErrnoException)?.code;
      const isInstallerConflict =
        errorMsg.includes("installer") ||
        errorMsg.includes("ebusy") ||
        errorMsg.includes("busy") ||
        errorMsg.includes("in use") ||
        errorCode === "EBUSY" ||
        errorCode === "EACCES" ||
        errorCode === "EPERM";

      if (isInstallerConflict) {
        log.warn(
          "[installer-conflict] Potential installer interference detected",
          {
            errorCode,
            errorMessage: err?.message,
            hint: "This may be caused by Node.js installer running simultaneously. See docs/NODE_INSTALLER_CONFLICT.md",
          },
        );
        console.warn(
          "[WARNUNG] Möglicher Installer-Konflikt erkannt. Dies kann durch gleichzeitige Node.js-Installation verursacht werden.",
        );
      }

      log.error("[diag] uncaughtException", {
        origin,
        error: err?.stack || String(err),
        name: err?.name,
        message: err?.message,
        code: errorCode,
        installerConflict: isInstallerConflict,
      });
      // Log to stderr as well for visibility
      console.error(
        "[FATAL] uncaughtException:",
        err?.name,
        err?.message,
        "\nStack:",
        err?.stack,
      );
      // Force flush to ensure error is written to disk
      forceFlushLogs();
    } catch {
      // ignore logging errors
    }
    // DO NOT EXIT - let the app continue if possible
    // The default behavior would exit with code 1, but we prevent that
  });

  process.on("unhandledRejection", (reason, promise) => {
    try {
      exitSource = "unhandledRejection";
      const msg =
        reason instanceof Error
          ? reason.stack || reason.message
          : String(reason);
      exitDetails = { reason: msg, promise: String(promise) };
      log.error("[diag] unhandledRejection", {
        reason: msg,
        promise: String(promise),
      });
      // Log to stderr as well
      console.error("[FATAL] unhandledRejection:", msg);
      // Force flush to ensure error is written to disk
      forceFlushLogs();
    } catch {
      // ignore logging errors
    }
    // DO NOT EXIT - log and continue
  });

  // OS-level signal handlers - catch process termination signals
  // These are critical for logging when the OS or user terminates the process
  const signals = ["SIGTERM", "SIGINT", "SIGHUP"] as const;
  signals.forEach((signal) => {
    try {
      process.on(signal, () => {
        try {
          exitSource = signal;
          log.warn(`[diag] Received ${signal} signal - process terminating`, {
            signal,
            pid: process.pid,
            uptime: process.uptime(),
          });
          // Force flush to ensure signal is logged
          forceFlushLogs();
          // Give logs a moment to flush, then exit gracefully
          setTimeout(() => {
            try {
              app.quit();
            } catch {
              process.exit(0);
            }
          }, LOG_FLUSH_TIMEOUT_MS);
        } catch (e) {
          console.error(`[FATAL] Error handling ${signal}:`, e);
          process.exit(0);
        }
      });
    } catch (e) {
      log.error(`[diag] Failed to register ${signal} handler:`, e);
    }
  });

  process.on("warning", (warning) => {
    try {
      log.warn("[diag] process warning:", {
        name: warning.name,
        message: warning.message,
        stack: warning.stack,
      });
    } catch {
      // ignore logging errors
    }
  });

  process.on("beforeExit", (code) => {
    try {
      log.info("[diag] beforeExit", {
        code,
        exitSource,
        exitDetails,
        quitConfirmed,
      });
      if (code !== 0) {
        log.warn(
          `[diag] beforeExit non-zero code detected: ${code}, source: ${exitSource}`,
        );
      }
      // Force flush on exit
      forceFlushLogs();
    } catch {
      // ignore logging errors
    }
  });

  process.on("exit", (code) => {
    try {
      log.info("[diag] process exit", {
        code,
        exitSource,
        quitConfirmed,
        hasDetails: !!exitDetails,
      });
      if (code !== 0) {
        log.error("[diag] exit details:", exitDetails);
      }
      // Final flush attempt
      forceFlushLogs();
    } catch {
      // ignore logging errors
    }
  });

  // Electron-level crash diagnostics
  try {
    app.on("child-process-gone", (_event, details) => {
      try {
        exitSource = "child-process-gone";
        exitDetails = details as unknown as Record<string, unknown>;

        // Check if this might be related to installer interference
        const reason = details.reason as string;
        const isUnusualExit =
          details.exitCode !== 0 &&
          reason !== "clean-exit" &&
          reason !== "normal-termination";

        if (isUnusualExit) {
          log.warn(
            "[installer-conflict] Child process crashed unexpectedly. This may indicate system interference.",
            {
              type: details.type,
              reason: details.reason,
              exitCode: details.exitCode,
              hint: "If Node.js installer is running, close Lumberjack and wait for installation to complete.",
            },
          );
        }

        log.error("[diag] child-process-gone:", {
          type: details.type,
          reason: details.reason,
          exitCode: details.exitCode,
          serviceName: details.serviceName,
          name: details.name,
        });
        // Force flush on critical errors
        forceFlushLogs();
      } catch {
        // ignore logging errors
      }
    });

    // @ts-expect-error: legacy event in some versions
    app.on("gpu-process-crashed", (_e, killed) => {
      try {
        exitSource = "gpu-process-crashed";
        exitDetails = { killed };
        log.error("[diag] gpu-process-crashed, killed:", killed);
        // Force flush on critical errors
        forceFlushLogs();
      } catch {
        // ignore logging errors
      }
    });

    // App-level render process crash handler for exit tracking
    // Note: This is separate from the per-window handler above which handles recovery
    app.on("render-process-gone", (_event, _webContents, details) => {
      try {
        exitSource = "render-process-gone";
        exitDetails = details as unknown as Record<string, unknown>;
        log.error("[diag] render-process-gone (app-level):", {
          reason: details.reason,
          exitCode: details.exitCode,
        });
        // Force flush on critical errors
        forceFlushLogs();
      } catch {
        // ignore logging errors
      }
    });
  } catch {
    // ignore if events not available
  }

  // Periodic log flushing to reduce data loss window
  // Periodic log flushing to reduce data loss window
  setInterval(() => {
    try {
      forceFlushLogs();
    } catch {
      // ignore flush errors
    }
  }, LOG_FLUSH_INTERVAL_MS);
} catch {
  // ignore handler setup errors
}

const gotLock = isMultiInstanceLaunch ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  try {
    log.warn(
      "[diag] requestSingleInstanceLock failed – quitting existing instance",
    );
  } catch {
    // ignore
  }
  // Für Zweitinstanzen explizit mit Code 0 beenden
  try {
    if (process && typeof process.exitCode === "number") {
      process.exitCode = 0;
    }
  } catch {
    // ignore
  }
  app.exit(0);
} else if (!isMultiInstanceLaunch) {
  app.on("second-instance", (_event, argv) => {
    try {
      log.info("[diag] second-instance with argv:", argv);
    } catch {
      // ignore
    }
    if (argv.some((a) => a === NEW_WINDOW_FLAG)) {
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
} else {
  log.info("[multi-instance] Running without single instance lock");
}

// Open a new window in a separate process
function openWindowInNewProcess(): void {
  try {
    const sanitizedArgs = process.argv
      .slice(1)
      .filter((arg) => arg !== MULTI_INSTANCE_FLAG && arg !== NEW_WINDOW_FLAG);
    if (!sanitizedArgs.length && !app.isPackaged) {
      const fallback = process.argv[1] || app.getAppPath();
      sanitizedArgs.push(fallback);
    }
    const childArgs = [...sanitizedArgs, MULTI_INSTANCE_FLAG, NEW_WINDOW_FLAG];
    const child = spawn(process.execPath, childArgs, {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
      windowsHide: false,
      env: { ...process.env },
    });
    child.unref();
    log.info("[multi-instance] Spawned new process", {
      pid: child.pid,
      args: childArgs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[multi-instance] Failed to spawn new process:", message);
    dialog.showErrorBox(
      "Neues Fenster fehlgeschlagen",
      "Es konnte kein weiterer Prozess gestartet werden.\n\n" + message,
    );
  }
}

// Bestätigung bei Cmd+Q / Beenden-Menü (plattformübergreifend)

app.on("before-quit", async (e) => {
  try {
    log.info("[diag] before-quit fired; quitConfirmed=", quitConfirmed);
    // Flush logs immediately on quit attempt
    forceFlushLogs();
  } catch (err) {
    log.error(
      "[diag] Error logging before-quit:",
      err instanceof Error ? err.message : String(err),
    );
  }

  try {
    if (quitConfirmed) {
      log.info("[diag] Quit already confirmed, proceeding");
      forceFlushLogs();
      return;
    }

    e.preventDefault();
    const focused = BrowserWindow.getFocusedWindow?.() || mainWindow || null;
    const ok = await confirmQuitLocal(focused || undefined);

    if (ok) {
      log.info("[diag] User confirmed quit");
      quitConfirmed = true;
      forceFlushLogs();
      // Erneut quit anstoßen; before-quit greift jetzt nicht mehr
      app.quit();
    } else {
      log.info("[diag] User cancelled quit");
      forceFlushLogs();
    }
  } catch (err) {
    log.error(
      "[diag] before-quit handler error:",
      err instanceof Error ? err.stack : String(err),
    );
    forceFlushLogs();
    // Don't quit on error - let user try again
  }
});

// Extra diagnostics
try {
  app.on("will-quit", (e) => {
    try {
      log.info("[diag] will-quit fired; defaultPrevented=", e.defaultPrevented);
      forceFlushLogs();
    } catch (err) {
      log.error(
        "[diag] Error in will-quit:",
        err instanceof Error ? err.message : String(err),
      );
    }
  });
} catch (err) {
  log.error(
    "[diag] Failed to register will-quit handler:",
    err instanceof Error ? err.message : String(err),
  );
}

app.on("window-all-closed", () => {
  try {
    log.info(
      "[diag] window-all-closed; windows left:",
      BrowserWindow.getAllWindows().length,
      "platform:",
      process.platform,
    );
    forceFlushLogs();
  } catch (e) {
    log.error(
      "[diag] Error logging window-all-closed:",
      e instanceof Error ? e.message : String(e),
    );
  }

  if (process.platform !== "darwin") {
    // Unerwartetes Schließen aller Fenster? → Nicht beenden, sondern wiederherstellen,
    // außer der Benutzer hat das Beenden bestätigt.
    if (!quitConfirmed) {
      try {
        log.info("[diag] Recreating window after all windows closed");
        createWindow({ makePrimary: true });
        return;
      } catch (e) {
        log.error(
          "[diag] Failed to recreate window:",
          e instanceof Error ? e.stack : String(e),
        );
        // Continue to quit if we can't recover
      }
    }

    // Vor dem Beenden Exit-Code 0 sicherstellen
    log.info("[diag] Quitting application normally");
    app.quit();
  }
});

app.on("quit", async () => {
  try {
    log.info("[diag] app quit fired; starting graceful shutdown");

    // Use shutdown coordinator for organized cleanup
    await shutdownCoordinator.shutdown();
  } catch (e) {
    log.error(
      "[diag] Error during quit cleanup:",
      e instanceof Error ? e.message : String(e),
    );
    // Attempt flush even if cleanup failed
    try {
      forceFlushLogs();
    } catch {
      // ignore
    }
  }
});

// [FREEZE FIX] Event Loop Activity Monitor
// Detect if main thread is blocked for extended periods
let lastActivityTime = Date.now();
let frozenIntervalCount = 0;
const FROZEN_THRESHOLD_MS = 2000; // 2 second freeze threshold

setInterval(() => {
  const now = Date.now();
  const timeSinceLastActivity = now - lastActivityTime;

  if (timeSinceLastActivity > FROZEN_THRESHOLD_MS) {
    frozenIntervalCount++;
    if (frozenIntervalCount === 1 || frozenIntervalCount % 5 === 0) {
      try {
        log.warn("[freeze-monitor] Potential main thread freeze detected:", {
          frozenMs: timeSinceLastActivity,
          occurrenceCount: frozenIntervalCount,
          timestamp: new Date().toISOString(),
        });
      } catch {}
    }
  } else {
    if (frozenIntervalCount > 0) {
      try {
        log.info("[freeze-monitor] Main thread responsive again after", {
          frozenFor: frozenIntervalCount,
          checks: "interval cycles",
        });
      } catch {}
      frozenIntervalCount = 0;
    }
    lastActivityTime = now;
  }
}, 1000); // Check every second

// Mark activity on important async operations
process.on("beforeExit", () => {
  lastActivityTime = Date.now();
  try {
    log.info("[freeze-monitor] beforeExit: marking activity");
  } catch {
    /* empty */
  }
});

// Export for IPC handlers and external modules
export { settingsService, networkService, getParsers, getAdmZip, featureFlags };

// ============================================================================
// APP INITIALIZATION - Create the first window when Electron is ready
// ============================================================================
app
  .whenReady()
  .then(() => {
    log.info("[diag] app.whenReady() fired - creating initial window");

    // IPC handlers are already registered at module load time (line ~1685)

    // Create the main window
    try {
      createWindow({ makePrimary: true });
      log.info("[diag] Initial window created successfully");
    } catch (err) {
      log.error(
        "[diag] Failed to create initial window:",
        err instanceof Error ? err.stack : String(err),
      );
    }

    // macOS: Re-create window when dock icon is clicked and no windows are open
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        log.info("[diag] activate event - recreating window");
        createWindow({ makePrimary: true });
      }
    });
  })
  .catch((err) => {
    log.error(
      "[diag] app.whenReady() failed:",
      err instanceof Error ? err.stack : String(err),
    );
  });
