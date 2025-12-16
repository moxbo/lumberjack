/**
 * i18n for Renderer Process (Preact/React)
 *
 * Uses the shared i18nCore module for translation logic.
 * This file adds React Context and Hooks for the renderer process.
 */

import { createContext } from "preact";
import {
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "preact/hooks";
import type { ComponentChildren, JSX } from "preact";
import {
  translate,
  detectBrowserLocale,
  type Locale,
  type TranslationData,
} from "../locales/i18nCore";
import de from "../locales/de.json";
import en from "../locales/en.json";

// Re-export types for convenience
export type { Locale };

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const translations: Record<Locale, TranslationData> = {
  de: de as TranslationData,
  en: en as TranslationData,
};

const I18nContext = createContext<I18nContextValue>({
  locale: "de",
  setLocale: () => {},
  t: (key: string) => key,
});

export const useI18n = (): I18nContextValue => useContext(I18nContext);

interface I18nProviderProps {
  children: ComponentChildren;
  defaultLocale?: Locale;
}

export function I18nProvider({
  children,
  defaultLocale = "de",
}: I18nProviderProps): JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(() =>
    detectBrowserLocale(defaultLocale),
  );

  const setLocale = useCallback((newLocale: Locale): void => {
    setLocaleState(newLocale);
    if (typeof window !== "undefined" && window.localStorage) {
      localStorage.setItem("lumberjack-locale", newLocale);
    }
    // Update HTML lang attribute
    if (typeof document !== "undefined") {
      document.documentElement.lang = newLocale;
    }
    // Save to settings
    if (typeof window !== "undefined") {
      const win = window as unknown as Record<string, unknown>;
      const api = win.api as
        | Record<string, (...args: unknown[]) => void>
        | undefined;
      if (api?.settingsSet) {
        try {
          void api.settingsSet({ locale: newLocale });
        } catch (e) {
          console.warn("Failed to save locale to settings:", e);
        }
      }
    }
  }, []);

  // Update HTML lang attribute on mount and locale change
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  // Use the shared translate function from i18nCore
  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      return translate(translations[locale], key, params);
    },
    [locale],
  );

  // Memoize the context value to prevent unnecessary re-renders
  const contextValue = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return (
    <I18nContext.Provider value={contextValue}>{children}</I18nContext.Provider>
  );
}
