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
import * as path from "path";
import * as fs from "fs";
import log from "electron-log/main";
import type { LogEntry } from "../types/ipc";
import { SettingsService } from "../services/SettingsService";
import { NetworkService } from "../services/NetworkService";
import { PerformanceService } from "../services/PerformanceService";
import { registerIpcHandlers } from "./ipcHandlers";
import os from "node:os";

// Environment
const isDev =
  process.env.NODE_ENV === "development" ||
  Boolean(process.env.VITE_DEV_SERVER_URL);
log.initialize();
log.transports.console.level = "debug";
// Schreibe in Nicht-Dev alle Level in die Datei
log.transports.file.level = isDev ? false : "silly";

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
    AdmZip = require("adm-zip");
  }
  return AdmZip;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let parsers: any = null;
function getParsers(): typeof import("./parsers.cjs") {
  if (!parsers) {
    const appRoot = app.getAppPath();
    const parserPath = path.join(appRoot, "src", "main", "parsers.cjs");
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

// Quit-Bestätigung
let quitConfirmed = false;
let quitPromptInProgress = false;
async function confirmQuit(target?: BrowserWindow | null): Promise<boolean> {
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).__getWindowBaseTitle = (winId: number) => {
  try {
    const w = BrowserWindow.fromId?.(winId);
    if (w) return windowMeta.get(winId)?.baseTitle || "";
  } catch (e) {
    log.error(
      "__getWindowBaseTitle failed:",
      e instanceof Error ? e.message : String(e),
    );
  }
  return "";
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).__setWindowBaseTitle = (winId: number, title: string) => {
  try {
    const w = BrowserWindow.fromId?.(winId);
    if (w) setWindowBaseTitle(w, title);
  } catch (e) {
    log.error(
      "__setWindowBaseTitle failed:",
      e instanceof Error ? e.message : String(e),
    );
  }
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).__getWindowCanTcpControl = (winId: number) => {
  try {
    const w = BrowserWindow.fromId?.(winId);
    return getWindowCanTcpControl(w);
  } catch {
    log.error("__getWindowCanTcpControl failed");
    return true;
  }
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).__setWindowCanTcpControl = (
  winId: number,
  allowed: boolean,
) => {
  try {
    const w = BrowserWindow.fromId?.(winId);
    if (w) setWindowCanTcpControl(w, allowed);
  } catch (e) {
    log.error(
      "__setWindowCanTcpControl failed:",
      e instanceof Error ? e.message : String(e),
    );
  }
};

// Buffers
const MAX_PENDING_APPENDS = 5000;
let pendingAppends: LogEntry[] = [];
const pendingMenuCmdsByWindow = new Map<
  number,
  Array<{ type: string; tab?: string }>
>();
let lastFocusedWindowId: number | null = null;
const pendingAppendsByWindow = new Map<number, LogEntry[]>();

// UI-freundliche Batch-/Trunkierungs-Parameter
const MAX_BATCH_ENTRIES = 200;
const MAX_MESSAGE_LENGTH = 10 * 1024; // 10 KB pro Textfeld
const BATCH_SEND_DELAY_MS = 8; // kleine Verzögerung zwischen Batches

function truncateEntryForRenderer(entry: LogEntry): LogEntry {
  try {
    if (!entry || typeof entry !== "object") return entry;
    const copy: any = { ...(entry as any) };
    const fields = ["message", "raw", "msg", "body", "message_raw", "text"];
    let truncated = false;
    for (const f of fields) {
      if (typeof copy[f] === "string" && copy[f].length > MAX_MESSAGE_LENGTH) {
        copy[f] = copy[f].slice(0, MAX_MESSAGE_LENGTH) + "… [truncated]";
        truncated = true;
      }
    }
    if (truncated && !copy._truncated) copy._truncated = true;
    return copy as LogEntry;
  } catch {
    return entry;
  }
}
function prepareRenderBatch(entries: LogEntry[]): LogEntry[] {
  try {
    if (!Array.isArray(entries) || entries.length === 0) return entries;
    return entries.map(truncateEntryForRenderer);
  } catch {
    return entries;
  }
}
function sendBatchesAsyncTo(
  wc: any,
  channel: string,
  batches: LogEntry[][],
): void {
  batches.forEach((batch, idx) => {
    setTimeout(() => {
      try {
        wc.send(channel, batch);
      } catch {
        // Ignorieren; erneuter Versand erfolgt später ggf. über Buffer
      }
    }, idx * BATCH_SEND_DELAY_MS);
  });
}

// File logging
let logStream: fs.WriteStream | null = null;
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
    for (const e of entries) {
      const line = JSON.stringify(e) + "\n";
      rotateIfNeeded(line.length);
      if (!logStream) openLogStream();
      if (!logStream) return;
      logStream.write(line);
      logBytes += line.length;
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
  try {
    const batches: LogEntry[][] = [];
    for (let i = 0; i < pendingAppends.length; i += MAX_BATCH_ENTRIES) {
      const slice = pendingAppends.slice(i, i + MAX_BATCH_ENTRIES);
      batches.push(prepareRenderBatch(slice));
    }
    // gestaffelt senden, damit der Event-Loop atmen kann
    sendBatchesAsyncTo(wc, "logs:append", batches);
  } catch {
    // nicht leeren, damit später erneut versucht werden kann
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
  const toPush =
    entries.length <= room ? entries : entries.slice(entries.length - room);
  const updated = list.concat(toPush);
  if (updated.length > MAX_PENDING_APPENDS)
    updated.splice(0, updated.length - MAX_PENDING_APPENDS);
  pendingAppendsByWindow.set(winId, updated);
}
function flushPendingAppendsFor(win: BrowserWindow): void {
  if (!isWindowReady(win)) return;
  const buf = pendingAppendsByWindow.get(win.id);
  if (!buf || !buf.length) return;
  const wc = win.webContents;
  try {
    const batches: LogEntry[][] = [];
    for (let i = 0; i < buf.length; i += MAX_BATCH_ENTRIES) {
      const slice = buf.slice(i, i + MAX_BATCH_ENTRIES);
      batches.push(prepareRenderBatch(slice));
    }
    sendBatchesAsyncTo(wc, "logs:append", batches);
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

  const sendEntriesToWc = (wc: any, arr: LogEntry[]) => {
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
    const ownerWin =
      ownerId != null ? BrowserWindow.fromId?.(ownerId) || null : null;
    if (ownerWin && isWindowReady(ownerWin)) {
      try {
        sendEntriesToWc(ownerWin.webContents, tcpEntries);
      } catch {
        enqueueAppendsFor(ownerWin.id, tcpEntries);
      }
    } else if (ownerWin) {
      enqueueAppendsFor(ownerWin.id, tcpEntries);
    }
    // else: no owner → route to main
    else {
      otherEntries.push(...tcpEntries);
    }
  }

  // Non-TCP → primary window (bestehendes Verhalten)
  if (otherEntries.length) {
    if (!isRendererReady()) {
      enqueueAppends(otherEntries);
      return;
    }
    try {
      const wc = mainWindow?.webContents as any;
      if (wc) sendEntriesToWc(wc, otherEntries);
      else enqueueAppends(otherEntries);
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
  const resPath = process.resourcesPath || "";
  const candidates = [
    path.join(resPath, "app.asar.unpacked", "images", "icon.ico"),
    path.join(resPath, "images", "icon.ico"),
    path.join(__dirname, "images", "icon.ico"),
    path.join(app.getAppPath?.() || "", "images", "icon.ico"),
    path.join(process.cwd(), "images", "icon.ico"),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) {
        cachedIconPath = p;
        try {
          log.debug?.("[icon] resolveIconPathSync hit:", p);
        } catch (e) {
          log.error(
            "[icon] resolveIconPathSync log error:",
            e instanceof Error ? e.message : String(e),
          );
        }
        return p;
      }
    } catch (e) {
      log.error(
        "[icon] resolveIconPathSync exists check error:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }
  try {
    log.warn?.("[icon] resolveIconPathSync: no candidate exists");
  } catch (e) {
    log.error(
      "[icon] resolveIconPathSync log error:",
      e instanceof Error ? e.message : String(e),
    );
  }
  cachedIconPath = "";
  return null;
}
async function resolveIconPathAsync(): Promise<string | null> {
  if (cachedIconPath !== null) return cachedIconPath;
  const resPath = process.resourcesPath || "";
  const candidates = [
    path.join(resPath, "app.asar.unpacked", "images", "icon.ico"),
    path.join(resPath, "images", "icon.ico"),
    path.join(__dirname, "images", "icon.ico"),
    path.join(app.getAppPath?.() || "", "images", "icon.ico"),
    path.join(process.cwd(), "images", "icon.ico"),
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
          log.debug?.("[icon] resolveIconPathAsync hit:", p);
        } catch (e) {
          log.error(
            "[icon] resolveIconPathAsync log error:",
            e instanceof Error ? e.message : String(e),
          );
        }
        return p;
      }
    } catch (e) {
      log.error(
        "[icon] resolveIconPathAsync exists check error:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }
  try {
    log.warn?.("[icon] resolveIconPathAsync: no candidate exists");
  } catch (e) {
    log.error(
      "[icon] resolveIconPathAsync log error:",
      e instanceof Error ? e.message : String(e),
    );
  }
  cachedIconPath = "";
  return null;
}
function resolveMacIconPath(): string | null {
  const resPath = process.resourcesPath || "";
  const candidates = [
    path.join(resPath, "app.asar.unpacked", "images", "icon.icns"),
    path.join(resPath, "images", "icon.icns"),
    path.join(__dirname, "images", "icon.icns"),
    path.join(process.cwd(), "images", "icon.icns"),
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

// About/Help Dialoge
function showAboutDialog(): void {
  try {
    const win = BrowserWindow.getFocusedWindow();
    const name = app.getName();
    const version = app.getVersion();
    const env = isDev ? "Development" : "Production";
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
    ].join("\n");

    const options: Electron.MessageBoxOptions = {
      type: "info",
      title: `Über ${name}`,
      message: name,
      detail,
      buttons: ["OK"],
      noLink: true,
      normalizeAccessKeys: true,
    };
    if (win) void dialog.showMessageBox(win, options);
    else void dialog.showMessageBox(options);
  } catch (e) {
    log.warn(
      "About-Dialog fehlgeschlagen:",
      e instanceof Error ? e.message : String(e),
    );
  }
}

function showHelpDialog(): void {
  try {
    const win = BrowserWindow.getFocusedWindow();
    const lines: string[] = [];
    lines.push(
      "Lumberjack ist ein Log-Viewer mit Fokus auf große Datenmengen und Live-Quellen.",
    );
    lines.push("");
    lines.push("Funktionen:");
    lines.push(
      ' • Dateien öffnen (Menü "Datei → Öffnen…"), Drag & Drop von .log/.json/.jsonl/.txt und .zip',
    );
    lines.push(
      " • ZIPs werden entpackt und geeignete Dateien automatisch geparst",
    );
    lines.push(
      " • TCP-Log-Server: Start/Stopp, eingehende Zeilen werden live angezeigt",
    );
    lines.push(
      " • HTTP: Einmal laden oder periodisches Polling mit Deduplizierung",
    );
    lines.push(" • Elasticsearch: Logs anhand von URL/Query abrufen");
    lines.push(
      " • Filter: Zeitfilter, MDC/DiagnosticContext-Filter, Volltextsuche",
    );
    lines.push(" • Markieren/Färben einzelner Einträge, Kontextmenü pro Zeile");
    lines.push(" • Protokollierung in Datei (rotierend) optional aktivierbar");
    lines.push("");
    lines.push("Filter-Syntax (Volltextsuche in Nachrichten):");
    lines.push(" • ODER: Verwende | um Alternativen zu trennen, z. B. foo|bar");
    lines.push(
      " • UND: Verwende & um Bedingungen zu verknüpfen, z. B. foo&bar",
    );
    lines.push(
      " • NICHT: Setze ! vor einen Begriff für Negation, z. B. foo&!bar",
    );
    lines.push(
      " • Mehrfache ! toggeln die Negation (z. B. !!foo entspricht foo)",
    );
    lines.push(
      " • Groß-/Kleinschreibung wird ignoriert, es wird nach Teilstrings gesucht",
    );
    lines.push(" • Beispiele:");
    lines.push('    – QcStatus&!CB23  → enthält "QcStatus" und NICHT "CB23"');
    lines.push('    – error|warn      → enthält "error" ODER "warn"');
    lines.push(
      '    – foo&bar         → enthält sowohl "foo" als auch "bar" (Reihenfolge egal)',
    );
    lines.push("");
    lines.push("Tipps:");
    lines.push(' • Menü "Netzwerk" für HTTP/TCP Aktionen und Konfiguration');
    lines.push(
      " • Einstellungen enthalten Pfade, Limits und Anmeldedaten (verschlüsselt gespeichert)",
    );

    const options: Electron.MessageBoxOptions = {
      type: "info",
      title: "Hilfe / Anleitung",
      message: "Hilfe & Funktionen",
      detail: lines.join("\n"),
      buttons: ["OK"],
      noLink: true,
      normalizeAccessKeys: true,
    };
    if (win) void dialog.showMessageBox(win, options);
    else void dialog.showMessageBox(options);
  } catch (e) {
    log.warn(
      "Hilfe-Dialog fehlgeschlagen:",
      e instanceof Error ? e.message : String(e),
    );
  }
}

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
          click: () => createWindow({ makePrimary: false }),
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
        { label: "Hilfe / Anleitung…", click: () => showHelpDialog() },
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
    ...(process.platform === "win32"
      ? (() => {
          const iconPath = resolveIconPathSync();
          return iconPath ? { icon: iconPath } : {};
        })()
      : {}),
    webPreferences: {
      preload: path.join(app.getAppPath(), "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
    backgroundColor: "#0f1113",
  });

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
      const ok = await confirmQuit(win);
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
    if (!win.isVisible()) win.show();
    if (process.platform === "win32") {
      setImmediate(async () => {
        try {
          const iconPath = await resolveIconPathAsync();
          if (iconPath && !win.isDestroyed()) {
            try {
              win.setIcon(iconPath);
              try {
                log.debug?.("[icon] BrowserWindow.setIcon applied:", iconPath);
              } catch {
                // Intentionally empty - ignore errors
              }
            } catch (e) {
              try {
                log.warn?.(
                  "[icon] BrowserWindow.setIcon failed:",
                  e instanceof Error ? e.message : String(e),
                );
              } catch {
                // Intentionally empty - ignore errors
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
        path.join(__dirname, "dist", "index.html"),
        path.join(app.getAppPath(), "dist", "index.html"),
        path.join(process.cwd(), "dist", "index.html"),
        path.join(resPath, "app.asar.unpacked", "dist", "index.html"),
        path.join(resPath, "app.asar", "dist", "index.html"),
        path.join(resPath, "dist", "index.html"),
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
      log.error("[diag] Renderer did-fail-load:", {
        errorCode,
        errorDescription,
        url: wc.getURL?.(),
      });
      // Don't exit on renderer load failure - attempt recovery
      try {
        if (errorCode === -3) {
          // ERR_ABORTED - usually harmless
          return;
        }
        // For critical errors, try reloading after a delay
        if (!win.isDestroyed() && !quitConfirmed) {
          setTimeout(() => {
            try {
              if (!win.isDestroyed()) {
                log.info("[diag] Attempting renderer reload after load failure");
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

    wc.on("render-process-gone", (_e, details) => {
      log.error("[diag] Renderer gone:", {
        reason: details.reason,
        exitCode: details.exitCode,
      });

      // Auto-Recovery: Versuche bei Crash/Exit den Renderer neu zu laden oder ein neues Fenster zu erstellen,
      // sofern der Benutzer das Beenden nicht bestätigt hat.
      try {
        if (quitConfirmed) {
          log.info(
            "[diag] Renderer gone but quit confirmed - not recovering",
          );
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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-require-imports
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

// App lifecycle
if (process.platform === "win32") {
  try {
    app.setAppUserModelId("de.hhla.lumberjack");
  } catch {
    // Intentionally empty - ignore errors
  }
}

// Global diagnostics for unexpected exits/crashes
// Track exit source for debugging
let exitSource = "unknown";
let exitDetails: any = null;

try {
  process.on("uncaughtException", (err, origin) => {
    try {
      exitSource = "uncaughtException";
      exitDetails = { origin, error: err?.stack || String(err) };
      log.error("[diag] uncaughtException", {
        origin,
        error: err?.stack || String(err),
        name: err?.name,
        message: err?.message,
      });
      // Log to stderr as well for visibility
      console.error(
        "[FATAL] uncaughtException:",
        err?.name,
        err?.message,
        "\nStack:",
        err?.stack,
      );
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
    } catch {
      // ignore logging errors
    }
    // DO NOT EXIT - log and continue
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
      if (exitDetails) {
        log.error("[diag] exit details:", exitDetails);
      }
    } catch {
      // ignore logging errors
    }
  });

  // Electron-level crash diagnostics
  try {
    // @ts-expect-error: event may not exist in all Electron versions
    app.on("child-process-gone", (_event, details) => {
      try {
        exitSource = "child-process-gone";
        exitDetails = details;
        log.error("[diag] child-process-gone:", {
          type: details.type,
          reason: details.reason,
          exitCode: details.exitCode,
          serviceName: details.serviceName,
          name: details.name,
        });
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
      } catch {
        // ignore logging errors
      }
    });

    app.on("render-process-gone", (_event, webContents, details) => {
      try {
        exitSource = "render-process-gone";
        exitDetails = details;
        log.error("[diag] render-process-gone:", {
          reason: details.reason,
          exitCode: details.exitCode,
        });
      } catch {
        // ignore logging errors
      }
    });
  } catch {
    // ignore if events not available
  }
} catch {
  // ignore handler setup errors
}

const gotLock = app.requestSingleInstanceLock();
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
} else {
  app.on("second-instance", (_event, argv) => {
    try {
      log.info("[diag] second-instance with argv:", argv);
    } catch {
      // ignore
    }
    if (argv.some((a) => a === "--new-window")) {
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

void app
  .whenReady()
  .then(() => {
    try {
      if (process.platform === "darwin" && app.dock) {
        const macIconPath = resolveMacIconPath();
        if (macIconPath) {
          try {
            const img = nativeImage.createFromPath(macIconPath);
            if (!img.isEmpty()) app.dock.setIcon(img);
          } catch (e) {
            log.warn(
              "[diag] Failed to set dock icon:",
              e instanceof Error ? e.message : String(e),
            );
          }
        }
        try {
          const dockMenu = Menu.buildFromTemplate([
            {
              label: "Neues Fenster",
              click: () => createWindow({ makePrimary: false }),
            },
          ]);
          app.dock.setMenu(dockMenu);
        } catch (e) {
          log.warn(
            "[diag] Failed to set dock menu:",
            e instanceof Error ? e.message : String(e),
          );
        }
      }

      createWindow({ makePrimary: true });

      try {
        app.on("browser-window-focus", () => updateMenu());
        app.on("browser-window-blur", () => updateMenu());
      } catch (e) {
        log.warn(
          "[diag] Failed to set window focus handlers:",
          e instanceof Error ? e.message : String(e),
        );
      }

      if (process.argv.some((a) => a === "--new-window")) {
        createWindow({ makePrimary: false });
      }
    } catch (e) {
      log.error(
        "[diag] Error in app.whenReady handler:",
        e instanceof Error ? e.stack : String(e),
      );
      // Try to create window anyway as last resort
      try {
        createWindow({ makePrimary: true });
      } catch (e2) {
        log.error(
          "[diag] Critical: Failed to create initial window:",
          e2 instanceof Error ? e2.stack : String(e2),
        );
      }
    }
  })
  .catch((err) => {
    log.error(
      "[diag] app.whenReady() rejected:",
      err instanceof Error ? err.stack : String(err),
    );
    // Don't exit - try to continue anyway
  });

// Bestätigung bei Cmd+Q / Beenden-Menü (plattformübergreifend)
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.on("before-quit", async (e) => {
  try {
    log.info("[diag] before-quit fired; quitConfirmed=", quitConfirmed);
  } catch (err) {
    log.error(
      "[diag] Error logging before-quit:",
      err instanceof Error ? err.message : String(err),
    );
  }

  try {
    if (quitConfirmed) {
      log.info("[diag] Quit already confirmed, proceeding");
      return;
    }

    e.preventDefault();
    const focused = BrowserWindow.getFocusedWindow?.() || mainWindow || null;
    const ok = await confirmQuit(focused || undefined);

    if (ok) {
      log.info("[diag] User confirmed quit");
      quitConfirmed = true;
      // Erneut quit anstoßen; before-quit greift jetzt nicht mehr
      app.quit();
    } else {
      log.info("[diag] User cancelled quit");
    }
  } catch (err) {
    log.error(
      "[diag] before-quit handler error:",
      err instanceof Error ? err.stack : String(err),
    );
    // Don't quit on error - let user try again
  }
});

// Extra diagnostics
try {
  app.on("will-quit", (e) => {
    try {
      log.info("[diag] will-quit fired; defaultPrevented=", e.defaultPrevented);
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

app.on("quit", () => {
  try {
    log.info("[diag] app quit fired; cleaning up");
    closeLogStream();
    networkService.cleanup();
  } catch (e) {
    log.error(
      "[diag] Error during quit cleanup:",
      e instanceof Error ? e.message : String(e),
    );
  }
});

// Export for IPC handlers
export { settingsService, networkService, getParsers, getAdmZip };
