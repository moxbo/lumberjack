/**
 * IPC Handlers
 * Handles IPC communication between main and renderer processes
 */

import { ipcMain, dialog, BrowserWindow } from "electron";
import log from "electron-log/main";
import * as path from "path";
import * as fs from "fs";
import { getSharedMainApi } from "./sharedMainApi";
import { t } from "../locales/mainI18n";
import {
  Settings,
  ElasticSearchOptions,
  ParseResult,
  SettingsResult,
  DroppedFile,
  WindowPermsResult,
  Result,
  ExportViewOptions,
  ExportResult,
  LogEntry,
} from "../types/ipc";
import type { SettingsService } from "../services/SettingsService";
import type { NetworkService } from "../services/NetworkService";
import type { FeatureFlags } from "../services/FeatureFlags";

// Type declarations for global namespace functions
declare global {
  var __applyWindowTitles: (() => void) | undefined;
  var __updateAppMenu: (() => void) | undefined;
  var __getWindowCanTcpControl: ((windowId: number) => boolean) | undefined;
  var __setTcpOwnerWindowId: ((windowId: number | null) => void) | undefined;
}

// Type for parser functions from parsers.cjs
interface ParsersModule {
  parsePaths: (paths: string[]) => LogEntry[];
  parseJsonFile: (name: string, data: string) => LogEntry[];
  parseTextLines: (name: string, data: string) => LogEntry[];
  fetchElasticPitPage: (
    opts: ElasticSearchOptions,
  ) => Promise<ElasticPitPageResult>;
  closeElasticPitSession: (sessionId: string) => Promise<void>;
}

interface ElasticPitPageResult {
  entries: LogEntry[];
  total: number | null;
  hasMore: boolean;
  nextSearchAfter: Array<string | number> | null;
  pitSessionId: string;
}

// AdmZip entry interface
interface ZipEntry {
  entryName: string;
  isDirectory: boolean;
  getData: () => Buffer;
}

export function registerIpcHandlers(
  settingsService: SettingsService,
  networkService: NetworkService,
  getParsers: () => ParsersModule,
  getAdmZip: () => typeof import("adm-zip"),
  featureFlags?: FeatureFlags,
): void {
  const sharedApi = getSharedMainApi();

  function updateWindowTitles(): void {
    try {
      sharedApi.applyWindowTitles?.();
      const fn = global.__applyWindowTitles;
      if (typeof fn === "function") fn();
    } catch (e) {
      log.warn(
        "updateWindowTitles helper failed:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  function updateAppMenu(): void {
    try {
      sharedApi.updateAppMenu?.();
      const upd = global.__updateAppMenu;
      if (typeof upd === "function") upd();
    } catch (e) {
      log.warn(
        "updateAppMenu helper failed:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  ipcMain.handle("windowTitle:get", (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) {
        const title = sharedApi.getWindowBaseTitle?.(win.id) ?? "";
        return { ok: true, title };
      }
      return { ok: true, title: "" };
    } catch (err) {
      log.error(
        "Error getting window title:",
        err instanceof Error ? err.message : String(err),
      );
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle("windowTitle:set", (event, title: string) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) {
        sharedApi.setWindowBaseTitle?.(win.id, String(title ?? ""));
      }
      updateWindowTitles();
      return { ok: true };
    } catch (err) {
      log.error(
        "Error setting window title:",
        err instanceof Error ? err.message : String(err),
      );
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle("windowPerms:get", (event): WindowPermsResult => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      const allowed = win
        ? sharedApi.getWindowCanTcpControl?.(win.id) !== false
        : true;
      return { ok: true, canTcpControl: allowed };
    } catch (err) {
      log.error(
        "Error getting window perms:",
        err instanceof Error ? err.message : String(err),
      );
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle(
    "windowPerms:set",
    (event, patch: { canTcpControl?: boolean }): Result<void> => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win && typeof patch?.canTcpControl === "boolean") {
          sharedApi.setWindowCanTcpControl?.(win.id, patch.canTcpControl);
          updateAppMenu();
        }
        return { ok: true };
      } catch (err) {
        log.error(
          "Error setting window perms:",
          err instanceof Error ? err.message : String(err),
        );
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // Settings handlers
  ipcMain.handle("settings:get", (): SettingsResult => {
    try {
      const settings = settingsService.get();
      return { ok: true, settings };
    } catch (err) {
      log.error(
        "Error getting settings:",
        err instanceof Error ? err.message : String(err),
      );
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle(
    "settings:set",
    (_event, patch: Partial<Settings>): SettingsResult => {
      try {
        if (!patch || typeof patch !== "object") {
          return { ok: false, error: t("main.errors.invalidPatch") };
        }

        type SettingsPatch = Partial<Settings> & {
          elasticPassPlain?: string;
          elasticPassClear?: boolean;
        };
        const typedPatch = patch as SettingsPatch;
        const passPlain = typedPatch.elasticPassPlain;
        const passClear = !!typedPatch.elasticPassClear;

        const clone: Partial<Settings> = { ...patch };
        delete (clone as SettingsPatch).elasticPassPlain;
        delete (clone as SettingsPatch).elasticPassClear;

        const validation = settingsService.validate(clone);
        if (!validation.success) {
          return { ok: false, error: validation.error };
        }

        const updated = settingsService.update(clone);

        if (passClear) {
          updated.elasticPassEnc = "";
        } else if (passPlain && passPlain.trim()) {
          updated.elasticPassEnc = settingsService.encryptSecret(
            passPlain.trim(),
          );
        }
        if (passClear || passPlain) {
          settingsService.update(updated);
        }

        const saved = settingsService.saveSync();
        if (!saved) {
          return { ok: false, error: t("main.errors.saveFailed") };
        }

        updateWindowTitles();

        // Update menu if follow status changed (to show checkmark)
        if (typeof patch.follow === "boolean" && sharedApi.updateAppMenu) {
          sharedApi.updateAppMenu();
        }

        return { ok: true, settings: settingsService.get() };
      } catch (err) {
        log.error(
          "Error setting settings:",
          err instanceof Error ? err.message : String(err),
        );
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // Dialog handlers
  ipcMain.handle("dialog:openFiles", async (): Promise<string[]> => {
    const mainWindow = BrowserWindow.getFocusedWindow();
    if (!mainWindow) return [];

    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: t("main.dialogs.openLogs"),
          extensions: ["log", "json", "jsonl", "txt", "zip"],
        },
        { name: t("main.dialogs.openAllFiles"), extensions: ["*"] },
      ],
    });

    if (res.canceled) return [];
    return res.filePaths || [];
  });

  ipcMain.handle("dialog:chooseLogFile", async (): Promise<string> => {
    const mainWindow = BrowserWindow.getFocusedWindow();
    if (!mainWindow) return "";

    const settings = settingsService.get();
    const defaultPath =
      settings.logFilePath && String(settings.logFilePath).trim();

    const res = await dialog.showSaveDialog(mainWindow, {
      title: t("main.dialogs.chooseLogFile"),
      defaultPath: defaultPath || undefined,
      filters: [
        {
          name: t("main.dialogs.logFiles"),
          extensions: ["log", "jsonl", "txt"],
        },
        { name: t("main.dialogs.allFiles"), extensions: ["*"] },
      ],
    });

    if (res.canceled) return "";
    return res.filePath || "";
  });

  // Export view handler - choose path first, then save
  ipcMain.handle(
    "dialog:chooseExportPath",
    async (): Promise<{
      ok: boolean;
      filePath?: string;
      format?: "html" | "txt" | "json";
      error?: string;
    }> => {
      const mainWindow = BrowserWindow.getFocusedWindow();
      if (!mainWindow) {
        return { ok: false, error: t("main.errors.noWindow") };
      }

      try {
        // Show all formats in save dialog
        const filters: { name: string; extensions: string[] }[] = [
          { name: "HTML", extensions: ["html", "htm"] },
          { name: t("main.dialogs.textFiles"), extensions: ["txt"] },
          { name: "JSON", extensions: ["json"] },
          { name: t("main.dialogs.allFiles"), extensions: ["*"] },
        ];

        const defaultName = `lumberjack-export-${new Date().toISOString().slice(0, 10)}.html`;

        const res = await dialog.showSaveDialog(mainWindow, {
          title: t("main.dialogs.exportView"),
          defaultPath: defaultName,
          filters,
        });

        if (res.canceled || !res.filePath) {
          return { ok: false, error: "canceled" };
        }

        // Determine format from file extension
        const ext = path.extname(res.filePath).toLowerCase();
        let format: "html" | "txt" | "json" = "html";
        if (ext === ".txt") {
          format = "txt";
        } else if (ext === ".json") {
          format = "json";
        }

        return { ok: true, filePath: res.filePath, format };
      } catch (err) {
        log.error(
          "Error choosing export path:",
          err instanceof Error ? err.message : String(err),
        );
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // Save export file handler
  ipcMain.handle(
    "dialog:saveExportFile",
    async (
      _event,
      filePath: string,
      content: string,
    ): Promise<ExportResult> => {
      try {
        await fs.promises.writeFile(filePath, content, "utf-8");
        log.info("[export] View exported to:", filePath);
        return { ok: true, filePath };
      } catch (err) {
        log.error(
          "Error saving export file:",
          err instanceof Error ? err.message : String(err),
        );
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // Legacy export view handler (kept for compatibility)
  ipcMain.handle(
    "dialog:exportView",
    async (
      _event,
      content: string,
      options: ExportViewOptions,
    ): Promise<ExportResult> => {
      const mainWindow = BrowserWindow.getFocusedWindow();
      if (!mainWindow) {
        return { ok: false, error: t("main.errors.noWindow") };
      }

      try {
        // Show all formats in save dialog
        const filters: { name: string; extensions: string[] }[] = [
          { name: "HTML", extensions: ["html", "htm"] },
          { name: t("main.dialogs.textFiles"), extensions: ["txt"] },
          { name: "JSON", extensions: ["json"] },
          { name: t("main.dialogs.allFiles"), extensions: ["*"] },
        ];

        const defaultFormat = options.format || "html";
        const defaultName = `lumberjack-export-${new Date().toISOString().slice(0, 10)}.${defaultFormat}`;

        const res = await dialog.showSaveDialog(mainWindow, {
          title: t("main.dialogs.exportView"),
          defaultPath: defaultName,
          filters,
        });

        if (res.canceled || !res.filePath) {
          return { ok: false, error: "canceled" };
        }

        await fs.promises.writeFile(res.filePath, content, "utf-8");
        log.info("[export] View exported to:", res.filePath);

        return { ok: true, filePath: res.filePath };
      } catch (err) {
        log.error(
          "Error exporting view:",
          err instanceof Error ? err.message : String(err),
        );
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // Log parsing handlers

  ipcMain.handle(
    "logs:parsePaths",
    async (_event, filePaths: string[]): Promise<ParseResult> => {
      try {
        const { parsePaths } = getParsers();
        const entries: LogEntry[] = parsePaths(filePaths);

        // Log parsing summary
        log.info(
          `[parse] Parsed ${entries.length} entries from ${filePaths.length} file(s)`,
        );

        // Log large message info if any
        const largeEntries = entries.filter((e: LogEntry) => e._truncated);
        if (largeEntries.length > 0) {
          log.info(
            `[parse] ${largeEntries.length} entries with large messages (truncated for display)`,
          );
        }

        return { ok: true, entries };
      } catch (err) {
        log.error(
          "Error parsing paths:",
          err instanceof Error ? err.message : String(err),
        );
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    "logs:parseRaw",
    async (_event, files: DroppedFile[]): Promise<ParseResult> => {
      try {
        if (!Array.isArray(files) || !files.length)
          return { ok: true, entries: [] };

        const { parseJsonFile, parseTextLines } = getParsers();
        const ZipClass = getAdmZip();
        const all: LogEntry[] = [];
        for (const f of files) {
          const name = String(f?.name || "");
          const enc = String(f?.encoding || "utf8");
          const data = String(f?.data || "");
          const ext = path.extname(name).toLowerCase();
          if (!name || !data) continue;
          if (ext === ".zip") {
            const buf = Buffer.from(data, enc === "base64" ? "base64" : "utf8");
            // AdmZip accepts Buffer but type definitions may be incomplete
            const zip = new ZipClass(buf as unknown as string);
            for (const zEntry of zip.getEntries() as ZipEntry[]) {
              const ename = zEntry.entryName;
              const eext = path.extname(ename).toLowerCase();
              if (
                !zEntry.isDirectory &&
                (eext === ".log" ||
                  eext === ".json" ||
                  eext === ".jsonl" ||
                  eext === ".txt")
              ) {
                const text = zEntry.getData().toString("utf8");
                const parsed: LogEntry[] =
                  eext === ".json"
                    ? parseJsonFile(ename, text)
                    : parseTextLines(ename, text);
                for (const e of parsed) {
                  e.source = `${name}::${ename}`;
                }
                all.push(...parsed);
              }
            }
          } else if (ext === ".json") {
            const entries: LogEntry[] = parseJsonFile(name, data);
            all.push(...entries);
          } else {
            const entries: LogEntry[] = parseTextLines(name, data);
            all.push(...entries);
          }
        }
        return { ok: true, entries: all };
      } catch (err) {
        log.error(
          "Error parsing raw drops:",
          err instanceof Error ? err.message : String(err),
        );
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // TCP handlers
  ipcMain.on("tcp:start", (event, { port }: { port: number }) => {
    (async () => {
      try {
        // Check if TCP_SERVER feature is enabled
        if (featureFlags && !featureFlags.isEnabled("TCP_SERVER")) {
          const reason = featureFlags.getDisableReason("TCP_SERVER");
          const msg = t("main.errors.tcpDisabled");
          event.reply("tcp:status", {
            ok: false,
            message: reason ? `${msg}: ${reason}` : msg,
            running: false,
          });
          return;
        }

        const win = BrowserWindow.fromWebContents(event.sender);
        const canFn = global.__getWindowCanTcpControl;
        const allowed =
          win && typeof canFn === "function" ? !!canFn(win.id) : true;
        if (!allowed) {
          if (win) sharedApi.setTcpOwnerWindowId?.(win.id);
          event.reply("tcp:status", {
            ok: false,
            message: t("main.errors.tcpWindowNotAllowed"),
          });
          return;
        }
        const status = await networkService.startTcpServer(port);
        event.reply("tcp:status", status);

        if (status.ok && win) {
          // Nur speichern, wenn sich der Port tatsächlich geändert hat
          const prevSettings = settingsService.get();
          if (prevSettings.tcpPort !== port) {
            settingsService.update({ tcpPort: port });
            void settingsService.save();
          } else {
            // Keine Änderung – kein persistenter Save nötig
          }
          // Eigentümer auf dieses Fenster setzen (ephemeral, nicht persistiert)
          try {
            global.__setTcpOwnerWindowId?.(win.id);
          } catch {
            // Intentionally empty - ignore errors
          }
        }

        // Titel und Menü aktualisieren
        updateAppMenu();
        setTimeout(updateWindowTitles, 50);
        setTimeout(updateWindowTitles, 200);
      } catch (err) {
        log.error(
          "Error starting TCP server:",
          err instanceof Error ? err.message : String(err),
        );
        event.reply("tcp:status", {
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        });
        sharedApi.setTcpOwnerWindowId?.(null);
      }
    })().catch(() => {});
  });

  ipcMain.on("tcp:stop", (event) => {
    (async () => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender);
        const canFn = global.__getWindowCanTcpControl;
        const allowed =
          win && typeof canFn === "function" ? !!canFn(win.id) : true;
        if (!allowed) {
          event.reply("tcp:status", {
            ok: false,
            message: t("main.errors.tcpWindowNotAllowed"),
          });
          return;
        }
        const status = await networkService.stopTcpServer();
        event.reply("tcp:status", status);
        if (status.ok) {
          try {
            global.__setTcpOwnerWindowId?.(null);
          } catch {
            // Intentionally empty - ignore errors
          }
        }
        // Titel und Menü aktualisieren
        updateWindowTitles();
        updateAppMenu();
        setTimeout(updateWindowTitles, 50);
        setTimeout(updateWindowTitles, 200);
      } catch (err) {
        log.error(
          "Error stopping TCP server:",
          err instanceof Error ? err.message : String(err),
        );
        event.reply("tcp:status", {
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })().catch(() => {});
  });

  // HTTP handlers
  ipcMain.handle(
    "http:loadOnce",
    async (_event, url: string): Promise<ParseResult> => {
      // Check if HTTP_POLLING feature is enabled
      if (featureFlags && !featureFlags.isEnabled("HTTP_POLLING")) {
        const reason = featureFlags.getDisableReason("HTTP_POLLING");
        const msg = t("main.errors.httpDisabled");
        return {
          ok: false,
          error: reason ? `${msg}: ${reason}` : msg,
        };
      }
      return await networkService.httpLoadOnce(url);
    },
  );

  ipcMain.handle(
    "http:startPoll",
    async (
      _event,
      { url, intervalSec }: { url: string; intervalSec: number },
    ) => {
      // Check if HTTP_POLLING feature is enabled
      if (featureFlags && !featureFlags.isEnabled("HTTP_POLLING")) {
        const reason = featureFlags.getDisableReason("HTTP_POLLING");
        const msg = t("main.errors.httpDisabled");
        return {
          ok: false,
          error: reason ? `${msg}: ${reason}` : msg,
        };
      }
      return await networkService.httpStartPoll(url, intervalSec);
    },
  );

  ipcMain.handle("http:stopPoll", async (_event, id: number) => {
    log.info(`[ipc] http:stopPoll called with id=${id}`);
    const result = networkService.httpStopPoll(id);
    log.info(`[ipc] http:stopPoll result: ${JSON.stringify(result)}`);
    return result;
  });

  // Elasticsearch handler
  ipcMain.handle(
    "elastic:search",
    async (_event, opts: ElasticSearchOptions): Promise<ParseResult> => {
      // Check if ELASTICSEARCH feature is enabled
      if (featureFlags && !featureFlags.isEnabled("ELASTICSEARCH")) {
        const reason = featureFlags.getDisableReason("ELASTICSEARCH");
        const msg = t("main.errors.elasticDisabled");
        return {
          ok: false,
          error: reason ? `${msg}: ${reason}` : msg,
        };
      }

      try {
        const settings = settingsService.get();
        const { fetchElasticPitPage } = getParsers();

        const url = opts.url || settings.elasticUrl || "";
        const requestedSize = Number(opts.size ?? settings.elasticSize ?? 1000);
        // Page size for each ES request (max 10000 per ES default, but we paginate)
        // Use smaller page size for pagination efficiency
        const pageSize = Math.max(
          1,
          Math.min(
            10000,
            Number.isFinite(requestedSize) ? requestedSize : 1000,
          ),
        );

        const derivedAuth = (() => {
          const user = settings.elasticUser || "";
          const pass = settingsService.decryptSecret(
            settings.elasticPassEnc || "",
          );
          if (user && pass) {
            return { type: "basic", username: user, password: pass } as const;
          }
          return undefined;
        })();

        const mergedOpts: ElasticSearchOptions = {
          ...opts,
          url,
          size: pageSize,
          auth: opts.auth ?? derivedAuth,
          // defaults for PIT/retries
          keepAlive: opts.keepAlive || "1m",
          trackTotalHits: opts.trackTotalHits ?? false,
          timeoutMs: opts.timeoutMs ?? 45000,
          maxRetries: opts.maxRetries ?? 4,
          backoffBaseMs: opts.backoffBaseMs ?? 300,
        } as ElasticSearchOptions;

        if (!mergedOpts.url) {
          return {
            ok: false,
            error: t("main.errors.elasticUrlNotConfigured"),
          };
        }

        // Vorab: finale Request-URL (Basis + _search) für Logging berechnen
        const base = String(mergedOpts.url).replace(/\/$/, "");
        const fullUrl = `${base}/_search`;

        // Outgoing Request ins Log schreiben (ohne Secrets)
        const mode: "relative" | "absolute" = mergedOpts.duration
          ? "relative"
          : "absolute";
        log.info("[elastic:search] request", {
          url: mergedOpts.url,
          fullUrl,
          index: mergedOpts.index ?? "_all",
          size: mergedOpts.size,
          sort: mergedOpts.sort,
          mode,
          from: mergedOpts.from,
          to: mergedOpts.to,
          application_name: mergedOpts.application_name,
          logger: mergedOpts.logger,
          level: mergedOpts.level,
          environment: mergedOpts.environment,
          allowInsecureTLS: !!mergedOpts.allowInsecureTLS,
          searchAfter: Array.isArray(mergedOpts.searchAfter)
            ? mergedOpts.searchAfter
            : undefined,
          pitSessionId: mergedOpts.pitSessionId || undefined,
          keepAlive: mergedOpts.keepAlive,
          trackTotalHits: mergedOpts.trackTotalHits,
        });

        const page = await fetchElasticPitPage(mergedOpts);

        return {
          ok: true,
          entries: page.entries,
          hasMore: page.hasMore,
          nextSearchAfter: page.nextSearchAfter,
          total: page.total == null ? undefined : page.total,
          pitSessionId: page.pitSessionId,
        } as ParseResult;
      } catch (err) {
        try {
          // Wenn möglich, URL im Fehler mitloggen (ohne Credentials)
          const u = (
            opts?.url ||
            settingsService.get()?.elasticUrl ||
            ""
          ).toString();
          const base = u ? u.replace(/\/$/, "") : "";
          const fullUrl = base ? `${base}/_search` : "";
          log.error("[elastic:search] failed", {
            message: err instanceof Error ? err.message : String(err),
            url: u || undefined,
            fullUrl: fullUrl || undefined,
          });
        } catch {
          // ignore logging issues
        }
        log.error(
          "Elasticsearch search failed:",
          err instanceof Error ? err.message : String(err),
        );
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // Explizites PIT-Schließen
  ipcMain.handle("elastic:closePit", async (_event, sessionId: string) => {
    try {
      const { closeElasticPitSession } = getParsers();
      await closeElasticPitSession(String(sessionId || ""));
      return { ok: true };
    } catch (err) {
      log.warn(
        "elastic:closePit failed:",
        err instanceof Error ? err.message : String(err),
      );
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // Error logging from renderer
  ipcMain.handle("logError", (_event, errorData: Record<string, unknown>) => {
    try {
      const errData = errorData as Record<
        string,
        Record<string, unknown> | string
      >;
      log.error("[renderer] Error caught by ErrorBoundary:", {
        error: errData.error,
        errorInfo: errData.errorInfo,
        timestamp: errData.timestamp,
      });
      return { ok: true };
    } catch (err) {
      log.warn(
        "logError handler failed:",
        err instanceof Error ? err.message : String(err),
      );
      return { ok: false };
    }
  });

  // FeatureFlags handlers
  ipcMain.handle("featureFlags:getAll", () => {
    if (!featureFlags) {
      return { features: {}, stats: { total: 0, enabled: 0, disabled: 0 } };
    }
    const allFeatures = featureFlags.getAllFeatures();
    const featuresObj: Record<string, { enabled: boolean; reason?: string }> =
      {};
    for (const [key, value] of allFeatures) {
      featuresObj[key] = value;
    }
    return {
      features: featuresObj,
      stats: featureFlags.getStats(),
    };
  });

  ipcMain.handle("featureFlags:isEnabled", (_event, feature: string) => {
    return featureFlags?.isEnabled(feature) ?? true;
  });

  ipcMain.handle(
    "featureFlags:disable",
    (_event, { feature, reason }: { feature: string; reason?: string }) => {
      if (featureFlags) {
        featureFlags.disable(feature, reason);
        return { ok: true };
      }
      return { ok: false, error: t("main.errors.featureFlagsNotAvailable") };
    },
  );

  ipcMain.handle("featureFlags:enable", (_event, feature: string) => {
    if (featureFlags) {
      featureFlags.enable(feature);
      return { ok: true };
    }
    return { ok: false, error: t("main.errors.featureFlagsNotAvailable") };
  });

  ipcMain.handle("featureFlags:resetAll", () => {
    if (featureFlags) {
      featureFlags.resetAll();
      return { ok: true };
    }
    return { ok: false, error: t("main.errors.featureFlagsNotAvailable") };
  });
}
