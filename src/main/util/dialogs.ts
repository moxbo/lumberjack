/**
 * Dialog Utilities
 * Reusable dialog functions for About, Help, and Confirmation dialogs
 */

import { app, BrowserWindow, dialog } from "electron";
import log from "electron-log/main";
import os from "node:os";
import { isDev } from "./constants";

/**
 * Show the About dialog with application information
 */
export function showAboutDialog(): void {
  try {
    const win = BrowserWindow.getFocusedWindow();
    const name = app.getName();
    const version = app.getVersion();
    const env = isDev ? "Development" : "Production";

    const detail = [
      `Version: ${version}`,
      `Umgebung: ${env}`,
      `Electron: ${process.versions.electron}`,
      `Chromium: ${process.versions.chrome}`,
      `Node.js: ${process.versions.node}`,
      `V8: ${process.versions.v8}`,
      `OS: ${process.platform} ${process.arch} ${os.release()}`,
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

    if (win) {
      void dialog.showMessageBox(win, options);
    } else {
      void dialog.showMessageBox(options);
    }
  } catch (e) {
    log.warn(
      "About-Dialog fehlgeschlagen:",
      e instanceof Error ? e.message : String(e),
    );
  }
}

/**
 * Show the Help dialog with feature documentation
 */
export function showHelpDialog(): void {
  try {
    const win = BrowserWindow.getFocusedWindow();

    const lines: string[] = [
      "Lumberjack ist ein Log-Viewer mit Fokus auf große Datenmengen und Live-Quellen.",
      "",
      "Funktionen:",
      ' • Dateien öffnen (Menü "Datei → Öffnen…"), Drag & Drop von .log/.json/.jsonl/.txt und .zip',
      " • ZIPs werden entpackt und geeignete Dateien automatisch geparst",
      " • TCP-Log-Server: Start/Stopp, eingehende Zeilen werden live angezeigt",
      " • HTTP: Einmal laden oder periodisches Polling mit Deduplizierung",
      " • Elasticsearch: Logs anhand von URL/Query abrufen",
      " • Filter: Zeitfilter, MDC/DiagnosticContext-Filter, Volltextsuche",
      " • Markieren/Färben einzelner Einträge, Kontextmenü pro Zeile",
      " • Protokollierung in Datei (rotierend) optional aktivierbar",
      "",
      "Filter-Syntax (Volltextsuche in Nachrichten):",
      " • ODER: Verwende | um Alternativen zu trennen, z. B. foo|bar",
      " • UND: Verwende & um Bedingungen zu verknüpfen, z. B. foo&bar",
      " • NICHT: Setze ! vor einen Begriff für Negation, z. B. foo&!bar",
      " • Mehrfache ! toggeln die Negation (z. B. !!foo entspricht foo)",
      " • Groß-/Kleinschreibung wird ignoriert, es wird nach Teilstrings gesucht",
      " • Beispiele:",
      '    – QcStatus&!CB23  → enthält "QcStatus" und NICHT "CB23"',
      '    – error|warn      → enthält "error" ODER "warn"',
      '    – foo&bar         → enthält sowohl "foo" als auch "bar" (Reihenfolge egal)',
      "",
      "Tipps:",
      ' • Menü "Netzwerk" für HTTP/TCP Aktionen und Konfiguration',
      " • Einstellungen enthalten Pfade, Limits und Anmeldedaten (verschlüsselt gespeichert)",
    ];

    const options: Electron.MessageBoxOptions = {
      type: "info",
      title: "Hilfe / Anleitung",
      message: "Hilfe & Funktionen",
      detail: lines.join("\n"),
      buttons: ["OK"],
      noLink: true,
      normalizeAccessKeys: true,
    };

    if (win) {
      void dialog.showMessageBox(win, options);
    } else {
      void dialog.showMessageBox(options);
    }
  } catch (e) {
    log.warn(
      "Hilfe-Dialog fehlgeschlagen:",
      e instanceof Error ? e.message : String(e),
    );
  }
}

// State for quit confirmation
let quitConfirmed = false;
let quitPromptInProgress = false;

/**
 * Check if quit has been confirmed
 */
export function isQuitConfirmed(): boolean {
  return quitConfirmed;
}

/**
 * Set quit confirmed state
 */
export function setQuitConfirmed(value: boolean): void {
  quitConfirmed = value;
}

/**
 * Show quit confirmation dialog
 * @returns Promise<boolean> - true if user confirmed quit
 */
export async function confirmQuit(
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

    const ok = res.response === 1; // 'Beenden' button
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
