/**
 * Hook for managing application settings
 */
import { useState, useCallback, useEffect } from "preact/hooks";
import logger from "../utils/logger";
import { rendererPerf } from "../utils/rendererPerf";
import { MAX_ELASTIC_HISTORY } from "../constants";

export type ThemeMode = "system" | "light" | "dark";
export type SettingsTab = "tcp" | "http" | "elastic" | "logging" | "appearance";

export interface SettingsForm {
  tcpPort: number;
  httpUrl: string;
  httpInterval: number;
  logToFile: boolean;
  logFilePath: string;
  logMaxMB: number;
  logMaxBackups: number;
  themeMode: string;
  elasticUrl: string;
  elasticSize: number;
  elasticUser: string;
  elasticPassNew: string;
  elasticPassClear: boolean;
  elasticMaxParallel: number;
}

const INITIAL_FORM: SettingsForm = {
  tcpPort: 5000,
  httpUrl: "",
  httpInterval: 5000,
  logToFile: false,
  logFilePath: "",
  logMaxMB: 5,
  logMaxBackups: 3,
  themeMode: "system",
  elasticUrl: "",
  elasticSize: 1000,
  elasticUser: "",
  elasticPassNew: "",
  elasticPassClear: false,
  elasticMaxParallel: 1,
};

function applyThemeMode(mode: string | null | undefined): void {
  const root = document.documentElement;
  if (!mode || mode === "system") {
    root.removeAttribute("data-theme");
    return;
  }
  root.setAttribute("data-theme", mode);
}

export function useSettings() {
  // Theme
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");

  // TCP
  const [tcpPort, setTcpPort] = useState<number>(5000);
  const [tcpStatus, setTcpStatus] = useState<string>("TCP Port geschlossen");
  const [canTcpControlWindow, setCanTcpControlWindow] = useState<boolean>(true);

  // HTTP
  const [httpUrl, setHttpUrl] = useState<string>("");
  const [httpInterval, setHttpInterval] = useState<number>(5000);
  const [httpStatus, setHttpStatus] = useState<string>("HTTP Polling inaktiv");

  // Logging
  const [logToFile, setLogToFile] = useState<boolean>(false);
  const [logFilePath, setLogFilePath] = useState<string>("");
  const [logMaxBytes, setLogMaxBytes] = useState<number>(5 * 1024 * 1024);
  const [logMaxBackups, setLogMaxBackups] = useState<number>(3);

  // Elasticsearch
  const [elasticUrl, setElasticUrl] = useState<string>("");
  const [elasticSize, setElasticSize] = useState<number>(1000);
  const [elasticUser, setElasticUser] = useState<string>("");
  const [elasticHasPass, setElasticHasPass] = useState<boolean>(false);
  const [elasticMaxParallel, setElasticMaxParallel] = useState<number>(1);

  // Elastic History
  const [histAppName, setHistAppName] = useState<string[]>([]);
  const [histEnvironment, setHistEnvironment] = useState<string[]>([]);
  const [histIndex, setHistIndex] = useState<string[]>([]);

  // Settings Modal
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("tcp");
  const [form, setForm] = useState<SettingsForm>(INITIAL_FORM);

  // Follow mode
  const [follow, setFollow] = useState<boolean>(false);

  // Add to elastic history
  const addToHistory = useCallback(
    (kind: "app" | "env" | "index", val: string) => {
      const v = String(val || "").trim();
      if (!v) return;

      if (kind === "app") {
        setHistAppName((prev) => {
          const list = [v, ...prev.filter((x) => x !== v)].slice(
            0,
            MAX_ELASTIC_HISTORY,
          );
          try {
            void window.api.settingsSet({ histAppName: list } as any);
          } catch (e) {
            logger.error("Failed to save histAppName settings:", e);
          }
          return list;
        });
      } else if (kind === "env") {
        setHistEnvironment((prev) => {
          const list = [v, ...prev.filter((x) => x !== v)].slice(
            0,
            MAX_ELASTIC_HISTORY,
          );
          try {
            void window.api.settingsSet({ histEnvironment: list } as any);
          } catch (e) {
            logger.error("Failed to save histEnvironment settings:", e);
          }
          return list;
        });
      } else if (kind === "index") {
        setHistIndex((prev) => {
          const list = [v, ...prev.filter((x) => x !== v)].slice(
            0,
            MAX_ELASTIC_HISTORY,
          );
          try {
            void window.api.settingsSet({ histIndex: list } as any);
          } catch (e) {
            logger.error("Failed to save histIndex settings:", e);
          }
          return list;
        });
      }
    },
    [],
  );

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      rendererPerf.mark("settings-load-start");
      try {
        if (!window.api?.settingsGet) {
          logger.error("window.api.settingsGet is not available.");
          return;
        }
        const result = await window.api.settingsGet();
        if (!result || !result.ok) {
          logger.warn("Failed to load settings:", (result as any)?.error);
          return;
        }
        const r = result.settings as any;
        if (!r) return;

        // TCP
        if (r.tcpPort != null) setTcpPort(Number(r.tcpPort) || 5000);

        // HTTP
        if (typeof r.httpUrl === "string") setHttpUrl(r.httpUrl);
        const interval = r.httpPollInterval ?? r.httpInterval;
        if (interval != null) setHttpInterval(Number(interval) || 5000);

        // Elastic History
        if (Array.isArray(r.histAppName)) setHistAppName(r.histAppName);
        if (Array.isArray(r.histEnvironment))
          setHistEnvironment(r.histEnvironment);
        if (Array.isArray(r.histIndex)) setHistIndex(r.histIndex);

        // Theme
        if (typeof r.themeMode === "string") {
          const mode = ["light", "dark", "system"].includes(r.themeMode)
            ? (r.themeMode as ThemeMode)
            : "system";
          setThemeMode(mode);
          applyThemeMode(mode);
        }

        // Follow
        if (typeof r.follow === "boolean") setFollow(!!r.follow);

        // Layout (CSS variables)
        const root = document.documentElement;
        const detail = Number(r.detailHeight || 0);
        if (detail) {
          root.style.setProperty("--detail-height", `${Math.round(detail)}px`);
        }
        const colMap: Array<[string, unknown]> = [
          ["--col-ts", r.colTs],
          ["--col-lvl", r.colLvl],
          ["--col-logger", r.colLogger],
        ];
        for (const [k, v] of colMap) {
          if (v != null) {
            root.style.setProperty(k, `${Math.round(Number(v) || 0)}px`);
          }
        }

        // Logging
        setLogToFile(!!r.logToFile);
        setLogFilePath(String(r.logFilePath || ""));
        setLogMaxBytes(Number(r.logMaxBytes || 5 * 1024 * 1024));
        setLogMaxBackups(Number(r.logMaxBackups || 3));

        // Elasticsearch
        setElasticUrl(String(r.elasticUrl || ""));
        setElasticSize(Number(r.elasticSize || 1000));
        setElasticUser(String(r.elasticUser || ""));
        setElasticHasPass(!!String(r.elasticPassEnc || "").trim());
        setElasticMaxParallel(Math.max(1, Number(r.elasticMaxParallel || 1)));

        rendererPerf.mark("settings-loaded");
      } catch (e) {
        logger.error("Error loading settings:", e);
      }

      // Per-Window permissions
      try {
        const perms = await window.api?.windowPermsGet?.();
        if (perms?.ok) setCanTcpControlWindow(perms.canTcpControl !== false);
      } catch (e) {
        logger.warn("windowPermsGet failed:", e as any);
      }
    };

    const idleId = requestIdleCallback(() => loadSettings(), { timeout: 100 });
    return () => cancelIdleCallback(idleId);
  }, []);

  // Open settings modal
  const openSettingsModal = useCallback(
    async (initialTab?: SettingsTab) => {
      let curMode = themeMode;
      let curTcpPort = tcpPort;
      let curHttpUrl = httpUrl;
      let curHttpInterval = httpInterval;
      let curLogToFile = logToFile;
      let curLogFilePath = logFilePath;
      let curLogMaxBytes = logMaxBytes;
      let curLogMaxBackups = logMaxBackups;
      let curElasticUrl = elasticUrl;
      let curElasticSize = elasticSize;
      let curElasticUser = elasticUser;
      let curElasticMaxParallel = elasticMaxParallel;

      try {
        if (window.api?.settingsGet) {
          const result = await window.api.settingsGet();
          const r = result?.ok ? (result.settings as any) : null;
          if (r) {
            if (typeof r.themeMode === "string") {
              const mode = ["light", "dark", "system"].includes(r.themeMode)
                ? r.themeMode
                : "system";
              curMode = mode as ThemeMode;
              setThemeMode(mode as ThemeMode);
              applyThemeMode(mode);
            }
            if (typeof r.follow === "boolean") setFollow(!!r.follow);
            if (r.tcpPort != null) {
              curTcpPort = Number(r.tcpPort) || 5000;
              setTcpPort(curTcpPort);
            }
            if (typeof r.httpUrl === "string") {
              curHttpUrl = r.httpUrl;
              setHttpUrl(curHttpUrl);
            }
            const interval = r.httpPollInterval ?? r.httpInterval;
            if (interval != null) {
              curHttpInterval = Number(interval) || 5000;
              setHttpInterval(curHttpInterval);
            }
            if (typeof r.logToFile === "boolean") {
              curLogToFile = r.logToFile;
              setLogToFile(curLogToFile);
            }
            if (typeof r.logFilePath === "string") {
              curLogFilePath = r.logFilePath;
              setLogFilePath(curLogFilePath);
            }
            if (r.logMaxBytes != null) {
              curLogMaxBytes = Number(r.logMaxBytes) || 5 * 1024 * 1024;
              setLogMaxBytes(curLogMaxBytes);
            }
            if (r.logMaxBackups != null) {
              curLogMaxBackups = Number(r.logMaxBackups) || 3;
              setLogMaxBackups(curLogMaxBackups);
            }
            if (typeof r.elasticUrl === "string") {
              curElasticUrl = r.elasticUrl;
              setElasticUrl(curElasticUrl);
            }
            if (r.elasticSize != null) {
              curElasticSize = Number(r.elasticSize) || 1000;
              setElasticSize(curElasticSize);
            }
            if (typeof r.elasticUser === "string") {
              curElasticUser = r.elasticUser;
              setElasticUser(curElasticUser);
            }
            if (r.elasticMaxParallel != null) {
              curElasticMaxParallel = Math.max(
                1,
                Number(r.elasticMaxParallel) || 1,
              );
              setElasticMaxParallel(curElasticMaxParallel);
            }
            if (typeof r.elasticPassEnc === "string") {
              setElasticHasPass(!!r.elasticPassEnc.trim());
            }
          }
        }
      } catch (e) {
        logger.warn("Failed to load settings for modal:", e);
      }

      setForm({
        tcpPort: curTcpPort,
        httpUrl: curHttpUrl,
        httpInterval: curHttpInterval,
        logToFile: curLogToFile,
        logFilePath: curLogFilePath,
        logMaxMB: Math.max(
          1,
          Math.round((curLogMaxBytes || 5 * 1024 * 1024) / (1024 * 1024)),
        ),
        logMaxBackups: curLogMaxBackups,
        themeMode: curMode,
        elasticUrl: curElasticUrl,
        elasticSize: curElasticSize,
        elasticUser: curElasticUser,
        elasticPassNew: "",
        elasticPassClear: false,
        elasticMaxParallel: curElasticMaxParallel || 1,
      });
      setSettingsTab(initialTab || "tcp");
      setShowSettings(true);
    },
    [
      themeMode,
      tcpPort,
      httpUrl,
      httpInterval,
      logToFile,
      logFilePath,
      logMaxBytes,
      logMaxBackups,
      elasticUrl,
      elasticSize,
      elasticUser,
      elasticMaxParallel,
    ],
  );

  // Save settings modal
  const saveSettingsModal = useCallback(async () => {
    const port = Number(form.tcpPort || 0);
    if (!(port >= 1 && port <= 65535)) {
      alert("Ungültiger TCP-Port");
      return false;
    }

    const interval = Math.max(500, Number(form.httpInterval || 5000));
    const toFile = form.logToFile;
    const path = String(form.logFilePath || "").trim();
    const maxMB = Math.max(1, Number(form.logMaxMB || 5));
    const maxBytes = Math.round(maxMB * 1024 * 1024);
    const backups = Math.max(0, Number(form.logMaxBackups || 0));
    const mode = ["light", "dark", "system"].includes(form.themeMode)
      ? form.themeMode
      : "system";

    const patch: any = {
      tcpPort: port,
      httpUrl: String(form.httpUrl || "").trim(),
      httpPollInterval: interval,
      logToFile: toFile,
      logFilePath: path,
      logMaxBytes: maxBytes,
      logMaxBackups: backups,
      themeMode: mode,
      elasticUrl: String(form.elasticUrl || "").trim(),
      elasticSize: Math.max(1, Number(form.elasticSize || 1000)),
      elasticUser: String(form.elasticUser || "").trim(),
      elasticMaxParallel: Math.max(1, Number(form.elasticMaxParallel || 1)),
    };

    const newPass = String(form.elasticPassNew || "").trim();
    if (form.elasticPassClear) patch["elasticPassClear"] = true;
    else if (newPass) patch["elasticPassPlain"] = newPass;

    try {
      const res = await window.api.settingsSet(patch);
      if (!res || !res.ok) {
        alert(
          "Speichern fehlgeschlagen: " +
            ((res as any)?.error || "Unbekannter Fehler"),
        );
        return false;
      }

      setTcpPort(port);
      setHttpUrl(String(form.httpUrl || "").trim());
      setHttpInterval(interval);
      setLogToFile(toFile);
      setLogFilePath(path);
      setLogMaxBytes(maxBytes);
      setLogMaxBackups(backups);
      setThemeMode(mode as ThemeMode);
      applyThemeMode(mode);
      setElasticUrl(String(form.elasticUrl || "").trim());
      setElasticSize(Math.max(1, Number(form.elasticSize || 1000)));
      setElasticUser(String(form.elasticUser || "").trim());
      if (form.elasticPassClear) setElasticHasPass(false);
      else if (newPass) setElasticHasPass(true);
      setShowSettings(false);
      return true;
    } catch (e) {
      logger.error("Failed to save settings:", e);
      alert("Speichern fehlgeschlagen: " + ((e as any)?.message || String(e)));
      return false;
    }
  }, [form]);

  const closeSettingsModal = useCallback(() => {
    applyThemeMode(themeMode);
    setShowSettings(false);
  }, [themeMode]);

  return {
    // Theme
    themeMode,
    setThemeMode,
    applyThemeMode,

    // TCP
    tcpPort,
    setTcpPort,
    tcpStatus,
    setTcpStatus,
    canTcpControlWindow,
    setCanTcpControlWindow,

    // HTTP
    httpUrl,
    setHttpUrl,
    httpInterval,
    setHttpInterval,
    httpStatus,
    setHttpStatus,

    // Logging
    logToFile,
    logFilePath,
    logMaxBytes,
    logMaxBackups,

    // Elasticsearch
    elasticUrl,
    elasticSize,
    elasticUser,
    elasticHasPass,
    elasticMaxParallel,

    // Elastic History
    histAppName,
    histEnvironment,
    histIndex,
    addToHistory,

    // Follow mode
    follow,
    setFollow,

    // Settings Modal
    showSettings,
    setShowSettings,
    settingsTab,
    setSettingsTab,
    form,
    setForm,
    openSettingsModal,
    saveSettingsModal,
    closeSettingsModal,
  };
}
