/**
 * Dialog Utilities
 * Reusable dialog functions for About, Help, and Confirmation dialogs
 */

import { app, BrowserWindow, dialog, nativeImage } from "electron";
import log from "electron-log/main";
import os from "node:os";
import { isDev } from "./constants";
import { t } from "../../locales/mainI18n";
import { resolveIconPathSync, resolveMacIconPath } from "./iconResolver";

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
      `${t("main.about.version")}: ${version}`,
      `Build: ${env}`,
      ``,
      `━━━━━━━━━━ ${t("main.about.techDetails")} ━━━━━━━━━━`,
      `${t("main.about.electron")}: ${process.versions.electron}`,
      `${t("main.about.chrome")}: ${process.versions.chrome}`,
      `${t("main.about.node")}: ${process.versions.node}`,
      `V8: ${process.versions.v8}`,
      ``,
      `━━━━━━━━━━━━━ ${t("main.about.system")} ━━━━━━━━━━━━━`,
      `OS: ${os.type()} ${os.release()}`,
      `${t("main.about.architecture")}: ${process.arch}`,
      `${t("main.about.memory")}: ${Math.round(os.totalmem() / (1024 * 1024 * 1024))} GB`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      t("main.about.description"),
      ``,
      `© ${year} - Open Source Software`,
    ].join("\n");

    // Resolve icon for About dialog
    const iconPath =
      process.platform === "darwin"
        ? resolveMacIconPath()
        : resolveIconPathSync();
    const icon = iconPath ? nativeImage.createFromPath(iconPath) : undefined;

    const options: Electron.MessageBoxOptions = {
      type: "info",
      title: t("main.about.title"),
      message: `🪓 ${name}`,
      detail,
      buttons: ["OK"],
      noLink: true,
      normalizeAccessKeys: true,
      ...(icon && !icon.isEmpty() ? { icon } : {}),
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

    const detail = [
      t("main.help.overviewBlock"),
      "",
      t("main.help.dataSourcesBlock"),
      "",
      t("main.help.searchBlock"),
      "",
      t("main.help.filterBlock"),
      "",
      t("main.help.keyboardBlock"),
      "",
      t("main.help.tipsBlock"),
    ].join("\n");

    const options: Electron.MessageBoxOptions = {
      type: "info",
      title: t("main.help.title"),
      message: t("main.help.message"),
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
