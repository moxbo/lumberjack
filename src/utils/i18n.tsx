import { createContext } from "preact";
import { useContext, useState, useEffect } from "preact/hooks";
import type { ComponentChildren, JSX } from "preact";
import de from "../locales/de.json";
import en from "../locales/en.json";

export type Locale = "de" | "en";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const translations: Record<Locale, Record<string, unknown>> = {
  de,
  en,
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
  const [locale, setLocaleState] = useState<Locale>(() => {
    // Try to load from localStorage
    if (typeof window !== "undefined" && window.localStorage) {
      const saved = localStorage.getItem("lumberjack-locale");
      if (saved === "de" || saved === "en") {
        return saved;
      }
    }
    // Fallback to browser language
    if (typeof navigator !== "undefined" && navigator.language) {
      const browserLang = navigator.language.toLowerCase();
      if (browserLang.startsWith("de")) return "de";
      if (browserLang.startsWith("en")) return "en";
    }
    return defaultLocale;
  });

  const setLocale = (newLocale: Locale) => {
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
  };

  // Update HTML lang attribute on mount and locale change
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const t = (key: string, params?: Record<string, string | number>): string => {
    const keys = key.split(".");
    let value: unknown = translations[locale];

    for (const k of keys) {
      if (value && typeof value === "object" && k in value) {
        value = (value as Record<string, unknown>)[k];
      } else {
        // Fallback to key if translation not found
        return key;
      }
    }

    if (typeof value !== "string") {
      return key;
    }

    // Simple parameter replacement
    if (params) {
      return value.replace(/\{\{(\w+)\}\}/g, (_match, paramKey: string) => {
        return params[paramKey] !== undefined
          ? String(params[paramKey])
          : _match;
      });
    }

    return value;
  };

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}
