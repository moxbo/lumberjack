/**
 * i18n Service for Main Process (Electron)
 *
 * Uses the shared i18nCore module for translation logic.
 * This file handles file system loading of locale files which is only
 * available in the main process.
 */

import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import log from "electron-log/main";
import { translate, type Locale, type TranslationData } from "./i18nCore";

// Re-export types for convenience
export type { Locale, TranslationData };

let currentLocale: Locale = "de";
let translations: TranslationData = {};

/**
 * Load translations from locale files (main process only - uses fs)
 */
function loadTranslations(locale: Locale): TranslationData {
  try {
    const appPath = app.getAppPath();
    // Try multiple paths for packaged vs development
    const possiblePaths = [
      path.join(appPath, "dist", "locales", `${locale}.json`),
      path.join(appPath, "src", "locales", `${locale}.json`),
      path.join(__dirname, "..", "locales", `${locale}.json`),
      path.join(__dirname, "..", "..", "locales", `${locale}.json`),
      path.join(__dirname, "locales", `${locale}.json`),
    ];

    for (const filePath of possiblePaths) {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(content) as TranslationData;
      }
    }

    log.warn(`[i18n] No translation file found for locale: ${locale}`);
    return {};
  } catch (err) {
    log.error(
      `[i18n] Failed to load translations for ${locale}:`,
      err instanceof Error ? err.message : String(err),
    );
    return {};
  }
}

/**
 * Initialize i18n with a locale
 */
export function initI18n(locale?: Locale): void {
  currentLocale = locale ?? "de";
  translations = loadTranslations(currentLocale);
  log.info(`[i18n] Initialized with locale: ${currentLocale}`);
}

/**
 * Set the current locale
 */
export function setLocale(locale: Locale): void {
  if (locale !== currentLocale) {
    currentLocale = locale;
    translations = loadTranslations(currentLocale);
    log.info(`[i18n] Locale changed to: ${currentLocale}`);
  }
}

/**
 * Get current locale
 */
export function getLocale(): Locale {
  return currentLocale;
}

/**
 * Get a translation by key path (e.g., "main.quit.title")
 * Supports interpolation with {{variable}} syntax
 */
export function t(
  keyPath: string,
  params?: Record<string, string | number>,
): string {
  const result = translate(translations, keyPath, params);
  if (result === keyPath && Object.keys(translations).length > 0) {
    log.warn(`[i18n] Missing translation: ${keyPath}`);
  }
  return result;
}

/**
 * Shorthand for main process translations
 */
export const mainT = {
  quit: {
    title: (): string => t("main.quit.title"),
    message: (): string => t("main.quit.message"),
    cancel: (): string => t("main.quit.cancel"),
    confirm: (): string => t("main.quit.confirm"),
  },
  menu: {
    file: (): string => t("main.menu.file"),
    openFile: (): string => t("main.menu.openFile"),
    newWindow: (): string => t("main.menu.newWindow"),
    closeWindow: (): string => t("main.menu.closeWindow"),
    quit: (): string => t("main.menu.quit"),
    edit: (): string => t("main.menu.edit"),
    undo: (): string => t("main.menu.undo"),
    redo: (): string => t("main.menu.redo"),
    cut: (): string => t("main.menu.cut"),
    copy: (): string => t("main.menu.copy"),
    paste: (): string => t("main.menu.paste"),
    selectAll: (): string => t("main.menu.selectAll"),
    view: (): string => t("main.menu.view"),
    reload: (): string => t("main.menu.reload"),
    forceReload: (): string => t("main.menu.forceReload"),
    toggleDevTools: (): string => t("main.menu.toggleDevTools"),
    resetZoom: (): string => t("main.menu.resetZoom"),
    zoomIn: (): string => t("main.menu.zoomIn"),
    zoomOut: (): string => t("main.menu.zoomOut"),
    toggleFullscreen: (): string => t("main.menu.toggleFullscreen"),
    window: (): string => t("main.menu.window"),
    minimize: (): string => t("main.menu.minimize"),
    zoom: (): string => t("main.menu.zoom"),
    front: (): string => t("main.menu.front"),
    help: (): string => t("main.menu.help"),
    about: (): string => t("main.menu.about"),
    tcp: (): string => t("main.menu.tcp"),
    tcpStart: (port: number): string =>
      t("main.menu.tcpStart", { port: String(port) }),
    tcpStop: (): string => t("main.menu.tcpStop"),
    setTitle: (): string => t("main.menu.setTitle"),
  },
  about: {
    title: (): string => t("main.about.title"),
    version: (): string => t("main.about.version"),
    electron: (): string => t("main.about.electron"),
    chrome: (): string => t("main.about.chrome"),
    node: (): string => t("main.about.node"),
  },
};
