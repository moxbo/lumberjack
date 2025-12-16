/**
 * i18n Core - Shared translation logic for Main and Renderer processes
 *
 * This module provides the core translation functionality that works in both
 * Electron main process and renderer process (with Preact/React).
 */

export type Locale = "de" | "en";

export interface TranslationData {
  [key: string]: string | TranslationData;
}

/**
 * Get a translation by key path (e.g., "main.quit.title")
 * Supports interpolation with {{variable}} syntax
 */
export function translate(
  translations: TranslationData,
  keyPath: string,
  params?: Record<string, string | number>,
): string {
  const keys = keyPath.split(".");
  let result: TranslationData | string = translations;

  for (const key of keys) {
    if (typeof result === "object" && result !== null && key in result) {
      result = result[key] as TranslationData | string;
    } else {
      // Fallback to key if translation not found
      return keyPath;
    }
  }

  if (typeof result !== "string") {
    return keyPath;
  }

  // Handle interpolation
  if (params) {
    return result.replace(/{{(\w+)}}/g, (_, key: string) => {
      return key in params ? String(params[key]) : `{{${key}}}`;
    });
  }

  return result;
}

/**
 * Detect browser locale (renderer only)
 */
export function detectBrowserLocale(defaultLocale: Locale = "de"): Locale {
  if (typeof window !== "undefined" && window.localStorage) {
    const saved = localStorage.getItem("lumberjack-locale");
    if (saved === "de" || saved === "en") {
      return saved;
    }
  }
  if (typeof navigator !== "undefined" && navigator.language) {
    const browserLang = navigator.language.toLowerCase();
    if (browserLang.startsWith("de")) return "de";
    if (browserLang.startsWith("en")) return "en";
  }
  return defaultLocale;
}
