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
    const year = new Date().getFullYear();

    const detail = [
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `Version: ${version}`,
      `Build: ${env}`,
      ``,
      `━━━━━━━━━━ Technische Details ━━━━━━━━━━`,
      `Electron: ${process.versions.electron}`,
      `Chromium: ${process.versions.chrome}`,
      `Node.js: ${process.versions.node}`,
      `V8: ${process.versions.v8}`,
      ``,
      `━━━━━━━━━━━━━ System ━━━━━━━━━━━━━`,
      `OS: ${os.type()} ${os.release()}`,
      `Architektur: ${process.arch}`,
      `Speicher: ${Math.round(os.totalmem() / (1024 * 1024 * 1024))} GB`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `Lumberjack ist ein leistungsstarker Log-Viewer`,
      `für Entwickler und DevOps-Teams.`,
      ``,
      `© ${year} - Open Source Software`,
    ].join("\n");

    const options: Electron.MessageBoxOptions = {
      type: "info",
      title: `Über ${name}`,
      message: `🪓 ${name}`,
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
      "━━━━━━━━━━━━ ÜBERSICHT ━━━━━━━━━━━━",
      "Lumberjack ist ein Log-Viewer für große Datenmengen",
      "und Live-Quellen mit Fokus auf Performance.",
      "",
      "━━━━━━━━━━━ DATENQUELLEN ━━━━━━━━━━━",
      "📁 Dateien: .log, .json, .jsonl, .txt und .zip",
      "   → Öffnen via Menü oder Drag & Drop",
      "",
      "🌐 HTTP: Einmaliges Laden oder periodisches Polling",
      "   → Automatische Deduplizierung bei Polling",
      "",
      "📡 TCP: Live-Log-Server für Echtzeit-Streams",
      "   → Port konfigurierbar in Einstellungen",
      "",
      "🔍 Elasticsearch: Logs aus ES-Clustern abrufen",
      "   → Mit Zeitfilter und Feldsuche",
      "",
      "━━━━━━━━━━ VOLLTEXTSUCHE ━━━━━━━━━━",
      "Syntax für die Nachrichtensuche:",
      "",
      "  ODER:  foo|bar      → enthält 'foo' ODER 'bar'",
      "  UND:   foo&bar      → enthält 'foo' UND 'bar'",
      "  NICHT: !foo         → enthält NICHT 'foo'",
      "  Kombination: foo&!bar → 'foo' aber NICHT 'bar'",
      "",
      "Optionen (⚙️ Button neben Suchfeld):",
      "  • Case-insensitiv (Standard)",
      "  • Case-sensitiv",
      "  • Regex-Modus",
      "",
      "━━━━━━━━━━━━ FILTER ━━━━━���━━━━━━",
      "🎛️ Filter-Button: Ausklappbare Filterleiste",
      "   • Level: TRACE, DEBUG, INFO, WARN, ERROR, FATAL",
      "   • Logger: Substring-Suche im Logger-Namen",
      "   • Thread: Filtern nach Thread-Name",
      "   • Message: Volltextsuche (siehe oben)",
      "",
      "🏷️ DC-Filter: Mapped Diagnostic Context (MDC)",
      "   • TraceID, SpanID und benutzerdefinierte Keys",
      "   • Quick-Add für häufige Keys",
      "",
      "━━━━━━━━ TASTATURKÜRZEL ━━━━━━━━",
      "⌘/Ctrl + F     Suchfeld fokussieren",
      "⌘/Ctrl + ⇧ + F Filter ein-/ausblenden",
      "j / k          Navigation (Vim-Style)",
      "g / G          Zum Anfang/Ende",
      "n / N          Nächster/Vorheriger Treffer",
      "↑ / ↓          Navigation (Standard)",
      "Home / End     Zum Anfang/Ende",
      "Escape         Auswahl aufheben",
      "",
      "━━━━━━━━━ WEITERE TIPPS ━━━━━━━━━",
      "• Rechtsklick auf Zeilen für Kontextmenü",
      "• Markierungen mit Farben für wichtige Einträge",
      "• Detail-Panel-Höhe per Drag anpassen",
      "• Spaltenbreiten per Drag anpassbar",
    ];

    const options: Electron.MessageBoxOptions = {
      type: "info",
      title: "Hilfe & Anleitung",
      message: "🪓 Lumberjack - Hilfe",
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
