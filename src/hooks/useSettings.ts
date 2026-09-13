import { useEffect, useState } from "preact/hooks";
import type { Settings } from "../types/ipc";
import type { SettingsTab, ThemeMode } from "../types/renderer";
import { useStableCallback } from "./useStableCallback";
import {
  normalizeSettingsForm,
  settingsFormPatch,
} from "../utils/settingsForm";
import logger from "../utils/logger";
import { rendererPerf } from "../utils/rendererPerf";
import { nativeConfirm } from "../utils/nativeDialog";
import {
  getSettings,
  patchSettings,
  windowPermsGet,
  appRelaunch,
  autoUpdaterSetAllowPrerelease,
} from "../utils/typedApi";

export type { ThemeMode, SettingsTab } from "../types/renderer";
export type { SettingsFormState as SettingsForm } from "../types/renderer";

export function applyThemeMode(mode: string | null | undefined): void {
  const root = document.documentElement;
  if (!mode || mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
}

interface UseSettingsOptions {
  t: (key: string, params?: Record<string, string | number>) => string;
  showAlert: (message: string) => void;
  onLoaded: (settings: Settings) => void;
}

export function useSettings({ t, showAlert, onLoaded }: UseSettingsOptions) {
  const [settings, setSettings] = useState<Partial<Settings>>({});
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("tcp");
  const [form, setForm] = useState(() => normalizeSettingsForm({}));
  const [originalHeapSizeMB, setOriginalHeapSizeMB] = useState(4096);
  const [canTcpControlWindow, setCanTcpControlWindow] = useState(true);
  const current = normalizeSettingsForm(settings);
  const themeMode = current.themeMode as ThemeMode;
  const follow = settings.follow ?? false;

  const receiveSettings = useStableCallback((loaded: Settings) => {
    setSettings((previous) => ({ ...previous, ...loaded }));
    if (typeof loaded.themeMode === "string") {
      applyThemeMode(normalizeSettingsForm(loaded).themeMode);
    }
  });
  const notifyLoaded = useStableCallback(onLoaded);

  useEffect(() => {
    let cancelled = false;
    let splashTimer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      rendererPerf.mark("settings-load-start");
      try {
        const loaded = await getSettings();
        if (cancelled) return;
        if (loaded) {
          receiveSettings(loaded);
          notifyLoaded(loaded);
          const root = document.documentElement;
          const detail = Number(loaded.detailHeight || 0);
          if (detail)
            root.style.setProperty(
              "--detail-height",
              `${Math.round(detail)}px`,
            );
          for (const [key, value] of [
            ["--col-ts", loaded.colTs],
            ["--col-lvl", loaded.colLvl],
            ["--col-logger", loaded.colLogger],
          ] as const) {
            if (value != null)
              root.style.setProperty(
                key,
                `${Math.round(Number(value) || 0)}px`,
              );
          }
          rendererPerf.mark("settings-loaded");
        } else {
          logger.warn("Failed to load settings: no settings returned");
        }
      } catch (error) {
        logger.error("Error loading settings:", error);
      } finally {
        if (!cancelled) {
          setSettingsLoaded(true);
          const splash = document.getElementById("splash-screen");
          if (splash) {
            splash.classList.add("hidden");
            splashTimer = setTimeout(() => splash.remove(), 300);
          }
        }
      }
      try {
        const perms = await windowPermsGet();
        if (!cancelled && perms?.ok)
          setCanTcpControlWindow(perms.canTcpControl !== false);
      } catch (error) {
        logger.warn("windowPermsGet failed:", error);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(splashTimer);
    };
  }, []);

  const openSettingsModal = useStableCallback(
    async (initialTab?: SettingsTab) => {
      let latest = settings;
      try {
        const loaded = await getSettings();
        if (loaded) {
          latest = { ...latest, ...loaded };
          receiveSettings(loaded);
        }
      } catch (error) {
        logger.warn("Failed to load settings for modal:", error);
      }
      const nextForm = normalizeSettingsForm(latest);
      setForm(nextForm);
      setOriginalHeapSizeMB(nextForm.heapSizeMB);
      setSettingsTab(initialTab || "tcp");
      setShowSettings(true);
    },
  );

  const saveSettingsModal = useStableCallback(async () => {
    const patch = settingsFormPatch(form, current.elasticMaxParallel);
    if (!patch) {
      showAlert(t("errors.invalidTcpPort"));
      return;
    }
    try {
      const result = await patchSettings(patch);
      if (!result?.ok) {
        showAlert(
          t("errors.saveFailed", {
            message: result?.error || t("status.errorUnknown"),
          }),
        );
        return;
      }
      // Password plaintext belongs only in the IPC request, never in settings state.
      const { elasticPassPlain, elasticPassClear, ...saved } = patch;
      setSettings((previous) => ({
        ...previous,
        ...saved,
        elasticPassEnc: elasticPassClear
          ? ""
          : elasticPassPlain
            ? "present"
            : previous.elasticPassEnc,
      }));
      applyThemeMode(patch.themeMode);
      try {
        await autoUpdaterSetAllowPrerelease(form.allowPrerelease);
      } catch (error) {
        logger.warn("Failed to update auto-updater allowPrerelease:", error);
      }
      setShowSettings(false);
      if (patch.heapSizeMB !== originalHeapSizeMB) {
        setTimeout(() => {
          void (async () => {
            if (
              await nativeConfirm(t("settings.performance.restartRequired"))
            ) {
              void appRelaunch();
            }
          })();
        }, 100);
      }
    } catch (error) {
      logger.error("Failed to save settings:", error);
      showAlert(
        t("errors.saveFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });

  const setHttpUrl = useStableCallback((httpUrl: string) =>
    setSettings((previous) => ({ ...previous, httpUrl })),
  );
  const setHttpInterval = useStableCallback((httpPollInterval: number) =>
    setSettings((previous) => ({ ...previous, httpPollInterval })),
  );
  const setFollow = useStableCallback(
    (value: boolean | ((previous: boolean) => boolean)) =>
      setSettings((previous) => ({
        ...previous,
        follow:
          typeof value === "function" ? value(previous.follow ?? false) : value,
      })),
  );
  const setThemeMode = useStableCallback((themeMode: ThemeMode) =>
    setSettings((previous) => ({ ...previous, themeMode })),
  );
  const setHttpTailEmitInitial = useStableCallback(
    (httpTailEmitInitial: boolean) =>
      setSettings((previous) => ({ ...previous, httpTailEmitInitial })),
  );
  const setHttpTailAllowInsecureSSL = useStableCallback(
    (httpTailAllowInsecureSSL: boolean) =>
      setSettings((previous) => ({ ...previous, httpTailAllowInsecureSSL })),
  );
  const closeSettingsModal = useStableCallback(() => {
    applyThemeMode(themeMode);
    setShowSettings(false);
  });

  return {
    settingsLoaded,
    tcpPort: current.tcpPort,
    canTcpControlWindow,
    setCanTcpControlWindow,
    httpUrl: current.httpUrl,
    setHttpUrl,
    httpInterval: current.httpInterval,
    setHttpInterval,
    httpTailEmitInitial: settings.httpTailEmitInitial ?? false,
    setHttpTailEmitInitial,
    httpTailAllowInsecureSSL: settings.httpTailAllowInsecureSSL ?? false,
    setHttpTailAllowInsecureSSL,
    elasticUrl: current.elasticUrl,
    elasticSize: current.elasticSize,
    elasticUser: current.elasticUser,
    elasticHasPass: !!settings.elasticPassEnc?.trim(),
    elasticMaxParallel: current.elasticMaxParallel,
    follow,
    setFollow,
    themeMode,
    setThemeMode,
    applyThemeMode,
    showSettings,
    settingsTab,
    setSettingsTab,
    form,
    setForm,
    openSettingsModal,
    saveSettingsModal,
    closeSettingsModal,
  };
}
