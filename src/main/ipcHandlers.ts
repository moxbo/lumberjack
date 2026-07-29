/**
 * IPC Handlers
 * Handles IPC communication between main and renderer processes
 */

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification as ElectronNotification,
} from "electron";
import log from "electron-log/main";
import * as path from "path";
import * as fs from "fs";
import { WatchManager } from "./FileWatcher";
import { HttpTailManager } from "./HttpTailManager";
import { getSharedMainApi } from "./sharedMainApi";
import { setLocale, t } from "../locales/mainI18n";
import {
  DroppedFile,
  ElasticSearchOptions,
  ExportResult,
  ExportViewOptions,
  LogEntry,
  ParseResult,
  Result,
  Settings,
  SettingsResult,
  WindowPermsResult,
} from "../types/ipc";
import type { SettingsService } from "../services/SettingsService";
import type { NetworkService } from "../services/NetworkService";
import type { FeatureFlags } from "../services/FeatureFlags";

// Functions are accessed via sharedMainApi (no global namespace needed)

// Type for parser functions from parsers.cjs
interface ParsersModule {
  parsePaths: (paths: string[]) => LogEntry[];
  parsePathsAsync?: (paths: string[]) => Promise<LogEntry[]>;
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
  /**
   * Sprint 5 – C3: hook for routing tail-watcher entries into the same
   * append-pipeline used by TCP/HTTP/Elasticsearch. If omitted, watching is
   * still possible but new entries will only be available via the events
   * emitted to the originating window (`watch:status`).
   */
  enqueueWatchEntries?: (
    entries: LogEntry[],
    senderWebContentsId: number,
  ) => void,
): void {
  const sharedApi = getSharedMainApi();

  function updateWindowTitles(): void {
    try {
      sharedApi.applyWindowTitles?.();
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

  ipcMain.handle("settings:getDefaultLogPath", (): string => {
    try {
      // Get the actual log file path from electron-log
      return log.transports.file.getFile().path;
    } catch {
      // Fallback to standard logs directory
      return path.join(app.getPath("logs"), "main.log");
    }
  });

  ipcMain.handle(
    "settings:set",
    async (_event, patch: Partial<Settings>): Promise<SettingsResult> => {
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

        // Use async save to avoid blocking the main process
        const saved = await settingsService.save();
        if (!saved) {
          return { ok: false, error: t("main.errors.saveFailed") };
        }

        const nextLocale =
          patch.locale === "de" || patch.locale === "en" ? patch.locale : null;
        if (nextLocale) {
          setLocale(nextLocale);
        }

        updateWindowTitles();

        // Rebuild native labels after a locale change and the follow checkmark
        // after a follow-mode change.
        if (
          (typeof patch.follow === "boolean" || nextLocale !== null) &&
          sharedApi.updateAppMenu
        ) {
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
          extensions: ["log", "json", "jsonl", "ndjson", "txt", "zip"],
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
          extensions: ["log", "jsonl", "ndjson", "txt"],
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
      format?: "html" | "txt" | "json" | "ndjson" | "csv" | "md";
      error?: string;
    }> => {
      const mainWindow = BrowserWindow.getFocusedWindow();
      if (!mainWindow) {
        return { ok: false, error: t("main.errors.noWindow") };
      }

      try {
        // Show all formats in save dialog. NDJSON ist der Default (erstes
        // Filter-Item), weil es das verlustfreie, re-importierbare Format ist
        // (HTML ist nur für Read-only-Sharing geeignet).
        const filters: { name: string; extensions: string[] }[] = [
          { name: "NDJSON (newline-delimited JSON)", extensions: ["ndjson"] },
          { name: "JSON", extensions: ["json"] },
          { name: "CSV", extensions: ["csv"] },
          { name: "Markdown", extensions: ["md"] },
          { name: "HTML", extensions: ["html", "htm"] },
          { name: t("main.dialogs.textFiles"), extensions: ["txt"] },
          { name: t("main.dialogs.allFiles"), extensions: ["*"] },
        ];

        // Default filename WITHOUT extension – the OS save dialog will append the
        // extension matching the selected filter (NDJSON, JSON, CSV, ...). Hardcoding
        // an extension here caused the bug where switching the filter kept the
        // original suffix and the content ended up serialized in the wrong format.
        const defaultName = `lumberjack-export-${new Date().toISOString().slice(0, 10)}`;

        const res = await dialog.showSaveDialog(mainWindow, {
          title: t("main.dialogs.exportView"),
          defaultPath: defaultName,
          filters,
        });

        if (res.canceled || !res.filePath) {
          return { ok: false, error: "canceled" };
        }

        // Determine format from file extension. Fallback ist NDJSON (verlustfrei),
        // nicht mehr HTML.
        const ext = path.extname(res.filePath).toLowerCase();
        let format: "html" | "txt" | "json" | "ndjson" | "csv" | "md" =
          "ndjson";
        if (ext === ".html" || ext === ".htm") format = "html";
        else if (ext === ".txt") format = "txt";
        else if (ext === ".json") format = "json";
        else if (ext === ".ndjson") format = "ndjson";
        else if (ext === ".csv") format = "csv";
        else if (ext === ".md" || ext === ".markdown") format = "md";

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
        // Show all formats in save dialog (Legacy-Handler). NDJSON ist Default.
        const filters: { name: string; extensions: string[] }[] = [
          { name: "NDJSON (newline-delimited JSON)", extensions: ["ndjson"] },
          { name: "JSON", extensions: ["json"] },
          { name: "HTML", extensions: ["html", "htm"] },
          { name: t("main.dialogs.textFiles"), extensions: ["txt"] },
          { name: t("main.dialogs.allFiles"), extensions: ["*"] },
        ];

        const defaultFormat = options.format || "ndjson";
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

  // Helper to yield to the event loop, preventing UI blocking
  const yieldToEventLoop = (): Promise<void> =>
    new Promise((resolve) => setImmediate(resolve));

  // Number of log lines parsed per chunk when ingesting a large HTTP-tail
  // initial payload ("load existing content first"). parseTextLines is
  // per-line, so chunking is lossless; yielding between chunks keeps the main
  // process responsive instead of freezing on one giant synchronous parse.
  const HTTP_TAIL_PARSE_CHUNK_LINES = 5000;

  ipcMain.handle(
    "logs:parsePaths",
    async (_event, filePaths: string[]): Promise<ParseResult> => {
      try {
        const { parsePaths, parsePathsAsync } = getParsers();

        // Yield before heavy parsing to keep UI responsive
        await yieldToEventLoop();

        // Bevorzuge die async-parallele Variante (non-blocking I/O,
        // mehrere Dateien werden parallel gelesen). Fallback auf
        // synchrone Variante, falls Parser-Modul älter ist.
        const entries: LogEntry[] = parsePathsAsync
          ? await parsePathsAsync(filePaths)
          : parsePaths(filePaths);

        // Yield after parsing before processing results
        await yieldToEventLoop();

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
          // Yield between files to keep UI responsive
          await yieldToEventLoop();

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
                  eext === ".ndjson" ||
                  eext === ".txt")
              ) {
                // Yield between zip entries for large archives
                await yieldToEventLoop();

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
        const allowed = win
          ? !!sharedApi.getWindowCanTcpControl?.(win.id)
          : true;
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
            sharedApi.setTcpOwnerWindowId?.(win.id);
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
        const allowed = win
          ? !!sharedApi.getWindowCanTcpControl?.(win.id)
          : true;
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
            sharedApi.setTcpOwnerWindowId?.(null);
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

  // HTTP insecure SSL handler
  ipcMain.handle(
    "http:setAllowInsecureSSL",
    (_event, allow: boolean): { ok: boolean } => {
      networkService.setAllowInsecureSSL(allow);
      return { ok: true };
    },
  );

  ipcMain.handle("http:getAllowInsecureSSL", (): boolean => {
    return networkService.getAllowInsecureSSL();
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
          keepAlive: opts.keepAlive || "5m",
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

  // App relaunch handler
  ipcMain.handle("app:relaunch", () => {
    log.info("[app] Relaunch requested by renderer");
    app.relaunch();
    app.exit(0);
    return { ok: true };
  });

  // ============================================================================
  // Filter UtilityProcess Handler (Electron 40+)
  // ============================================================================

  // Lazy import to avoid loading FilterService at startup
  let _filterService: import("../services/FilterService").FilterService | null =
    null;

  function getFilterServiceLazy(): import("../services/FilterService").FilterService {
    if (!_filterService) {
      // Dynamic import to defer loading
      const { getFilterService } =
        require("../services/FilterService") as typeof import("../services/FilterService");
      _filterService = getFilterService();
    }
    return _filterService;
  }

  /**
   * Filter entries using UtilityProcess for better performance
   * Falls back to returning empty result on error
   */
  ipcMain.handle(
    "filter:entries",
    async (
      _event,
      {
        entries,
        options,
      }: {
        entries: unknown[];
        options: {
          stdFiltersEnabled: boolean;
          filter: {
            level: string;
            logger: string;
            thread: string;
            message: string;
          };
          onlyMarked: boolean;
          dcFilterEnabled: boolean;
          dcFilterEntries: Array<{
            key: string;
            value: string;
            active: boolean;
          }>;
          timeFilterEnabled: boolean;
          timeFilterFrom?: string;
          timeFilterTo?: string;
        };
      },
    ) => {
      try {
        const filterService = getFilterServiceLazy();
        const result = await filterService.filter(entries, options);
        return {
          ok: true,
          filteredIndices: result.filteredIndices,
          stats: result.stats,
        };
      } catch (error) {
        log.warn(
          "[filter] UtilityProcess filter failed, returning empty result:",
          error instanceof Error ? error.message : String(error),
        );
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          filteredIndices: [],
          stats: {
            total: entries.length,
            passed: 0,
            rejectedByOnlyMarked: 0,
            rejectedByLevel: 0,
            rejectedByLogger: 0,
            rejectedByThread: 0,
            rejectedByMessage: 0,
            rejectedByTime: 0,
            rejectedByDC: 0,
          },
        };
      }
    },
  );

  /**
   * Check if UtilityProcess filter is available
   */
  ipcMain.handle("filter:isAvailable", () => {
    try {
      const filterService = getFilterServiceLazy();
      return { ok: true, available: filterService.isAvailable() };
    } catch {
      return { ok: true, available: false };
    }
  });

  // ============================================================================
  // Filter Profiles – file-based persistence (shared across all processes)
  // ============================================================================

  const resolveProfilesPath = (): string => {
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
    if (portableDir && portableDir.length) {
      return path.join(portableDir, "data", "filter-profiles.json");
    }
    return path.join(app.getPath("userData"), "filter-profiles.json");
  };

  ipcMain.handle("filterProfiles:getAll", () => {
    try {
      const filePath = resolveProfilesPath();
      if (!fs.existsSync(filePath)) {
        return { ok: true, profiles: [] };
      }
      const raw = fs.readFileSync(filePath, "utf8");
      const profiles = JSON.parse(raw);
      return { ok: true, profiles: Array.isArray(profiles) ? profiles : [] };
    } catch (e) {
      log.warn(
        "[filterProfiles] Failed to load profiles:",
        e instanceof Error ? e.message : String(e),
      );
      return { ok: false, profiles: [], error: String(e) };
    }
  });

  ipcMain.handle("filterProfiles:save", (_event, profiles: unknown[]) => {
    try {
      const filePath = resolveProfilesPath();
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify(profiles, null, 2), "utf8");

      // Notify all OTHER windows that profiles changed
      const senderWc = _event.sender;
      for (const win of BrowserWindow.getAllWindows()) {
        try {
          if (
            !win.isDestroyed() &&
            win.webContents &&
            !win.webContents.isDestroyed() &&
            win.webContents.id !== senderWc.id
          ) {
            win.webContents.send("filterProfiles:changed");
          }
        } catch {
          // ignore
        }
      }

      return { ok: true };
    } catch (e) {
      log.error(
        "[filterProfiles] Failed to save profiles:",
        e instanceof Error ? e.message : String(e),
      );
      return { ok: false, error: String(e) };
    }
  });

  // ============================================================================
  // Alert Rules – file-based persistence (analogous to filterProfiles)
  // ============================================================================
  const resolveAlertRulesPath = (): string => {
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
    if (portableDir && portableDir.length) {
      return path.join(portableDir, "data", "alert-rules.json");
    }
    return path.join(app.getPath("userData"), "alert-rules.json");
  };

  ipcMain.handle("alertRules:getAll", () => {
    try {
      const filePath = resolveAlertRulesPath();
      if (!fs.existsSync(filePath)) {
        return { ok: true, rules: [] };
      }
      const raw = fs.readFileSync(filePath, "utf8");
      const rules: unknown = JSON.parse(raw);
      return { ok: true, rules: Array.isArray(rules) ? rules : [] };
    } catch (e) {
      log.warn(
        "[alertRules] Failed to load rules:",
        e instanceof Error ? e.message : String(e),
      );
      return { ok: false, rules: [], error: String(e) };
    }
  });

  ipcMain.handle("alertRules:save", (_event, rules: unknown[]) => {
    try {
      const filePath = resolveAlertRulesPath();
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify(rules, null, 2), "utf8");

      // Notify all OTHER windows (multi-window sync, like filterProfiles)
      const senderWc = _event.sender;
      for (const win of BrowserWindow.getAllWindows()) {
        try {
          if (
            !win.isDestroyed() &&
            win.webContents &&
            !win.webContents.isDestroyed() &&
            win.webContents.id !== senderWc.id
          ) {
            win.webContents.send("alertRules:changed");
          }
        } catch {
          // ignore
        }
      }
      return { ok: true };
    } catch (e) {
      log.error(
        "[alertRules] Failed to save rules:",
        e instanceof Error ? e.message : String(e),
      );
      return { ok: false, error: String(e) };
    }
  });

  /**
   * Show a native OS notification.
   * Falls back to a no-op (returns ok:false) if notifications are not supported.
   */
  ipcMain.handle(
    "notification:show",
    (
      _event,
      args: {
        title: string;
        body: string;
        severity?: "info" | "warning" | "critical";
      },
    ) => {
      try {
        if (!ElectronNotification.isSupported()) {
          return { ok: false, error: "notifications not supported" };
        }
        const n = new ElectronNotification({
          title: String(args?.title ?? "Lumberjack"),
          body: String(args?.body ?? ""),
          urgency:
            args?.severity === "critical"
              ? "critical"
              : args?.severity === "warning"
                ? "normal"
                : "low",
          silent: args?.severity === "info",
        });
        // Focus the originating window when the notification is clicked.
        n.on("click", () => {
          try {
            const win = BrowserWindow.fromWebContents(_event.sender);
            if (win && !win.isDestroyed()) {
              if (win.isMinimized()) win.restore();
              win.focus();
            }
          } catch {
            // ignore
          }
        });
        n.show();
        return { ok: true };
      } catch (e) {
        log.warn(
          "[notification] failed:",
          e instanceof Error ? e.message : String(e),
        );
        return { ok: false, error: String(e) };
      }
    },
  );

  // ============================================================================
  // Sprint 5 – C3: Tail/Watch mode for log files
  // ============================================================================
  const watchManager = new WatchManager();

  /**
   * Send watcher status updates (started/stopped/rotated/error) to the owning
   * window so the renderer can show toasts and keep its watcher list in sync.
   */
  function emitWatchStatus(
    senderId: number,
    payload: {
      type: "started" | "stopped" | "rotated" | "error" | "lines";
      id: number;
      filePath: string;
      lineCount?: number;
      message?: string;
    },
  ): void {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        if (
          !win.isDestroyed() &&
          win.webContents &&
          !win.webContents.isDestroyed() &&
          win.webContents.id === senderId
        ) {
          win.webContents.send("watch:status", payload);
          break;
        }
      } catch {
        // ignore
      }
    }
  }

  ipcMain.handle(
    "watch:start",
    (
      event,
      args: {
        filePath: string;
        emitInitial?: boolean;
        pollIntervalMs?: number;
      },
    ) => {
      try {
        if (!args?.filePath || typeof args.filePath !== "string") {
          return { ok: false, error: "filePath required" };
        }
        const senderId = event.sender.id;
        const { parseTextLines } = getParsers();
        const fileName = path.basename(args.filePath);

        const watcher = watchManager.start(
          args.filePath,
          {
            onLines: (lines: string[]) => {
              if (lines.length === 0) return;
              try {
                const data = lines.join("\n");
                const entries = parseTextLines(fileName, data);
                if (entries.length > 0 && enqueueWatchEntries) {
                  enqueueWatchEntries(entries, senderId);
                }
                emitWatchStatus(senderId, {
                  type: "lines",
                  id: watcher.id,
                  filePath: args.filePath,
                  lineCount: lines.length,
                });
              } catch (e) {
                log.warn(
                  "[watch] parse failed:",
                  e instanceof Error ? e.message : String(e),
                );
              }
            },
            onError: (err: Error) => {
              emitWatchStatus(senderId, {
                type: "error",
                id: watcher.id,
                filePath: args.filePath,
                message: err.message,
              });
            },
            onRotated: () => {
              emitWatchStatus(senderId, {
                type: "rotated",
                id: watcher.id,
                filePath: args.filePath,
              });
            },
          },
          {
            emitInitial: !!args.emitInitial,
            pollIntervalMs: args.pollIntervalMs,
          },
        );

        emitWatchStatus(senderId, {
          type: "started",
          id: watcher.id,
          filePath: args.filePath,
        });
        return { ok: true, id: watcher.id, filePath: args.filePath };
      } catch (e) {
        log.warn(
          "[watch] start failed:",
          e instanceof Error ? e.message : String(e),
        );
        return { ok: false, error: String(e) };
      }
    },
  );

  ipcMain.handle("watch:stop", (event, args: { id: number }) => {
    try {
      const ok = watchManager.stop(args?.id);
      if (ok) {
        emitWatchStatus(event.sender.id, {
          type: "stopped",
          id: args.id,
          filePath: "",
        });
      }
      return { ok };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle("watch:list", () => {
    return { ok: true, watchers: watchManager.list() };
  });

  // Stop all watchers when the app quits.
  app.on("before-quit", () => {
    try {
      watchManager.stopAll();
    } catch {
      // ignore
    }
  });

  // ============================================================================
  // HTTP Tail – incremental Range-based polling for endpoints like
  // Spring Boot Actuator's `/actuator/logfile`.
  // ============================================================================
  const httpTailManager = new HttpTailManager();

  function emitHttpTailStatus(
    senderId: number,
    payload: {
      type: "started" | "stopped" | "rotated" | "error" | "lines" | "progress";
      id: number;
      url: string;
      lineCount?: number;
      offset?: number;
      total?: number;
      message?: string;
    },
  ): void {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        if (
          !win.isDestroyed() &&
          win.webContents &&
          !win.webContents.isDestroyed() &&
          win.webContents.id === senderId
        ) {
          win.webContents.send("httpTail:status", payload);
          break;
        }
      } catch {
        // ignore
      }
    }
  }

  ipcMain.handle(
    "httpTail:start",
    (
      event,
      args: {
        url: string;
        intervalMs?: number;
        emitInitial?: boolean;
        headers?: Record<string, string>;
        allowInsecureSSL?: boolean;
      },
    ) => {
      try {
        if (!args?.url || typeof args.url !== "string") {
          return { ok: false, error: "url required" };
        }
        const senderId = event.sender.id;
        const { parseTextLines, parseJsonFile } = getParsers();
        // Best-effort source label (host + last path segment).
        let source = args.url;
        try {
          const u = new URL(args.url);
          const last = u.pathname.split("/").filter(Boolean).pop() ?? "log";
          source = `${u.host}/${last}`;
        } catch {
          // fall through
        }

        const tail = httpTailManager.start(
          args.url,
          {
            onLines: async (lines: string[]) => {
              if (lines.length === 0) return;
              try {
                const data = lines.join("\n");
                // Decide JSON vs text once on the whole chunk.
                const trimmed = data.trim();
                // Only a single JSON *array* must be parsed as one unit – it
                // cannot be split by lines. NDJSON (one JSON object per line,
                // starts with "{") is handled by parseTextLines, which tries
                // JSON per line, so it can be chunked exactly like plain text
                // and must NOT take the single-parse path (that would block the
                // main process and freeze the app on large initial loads).
                const isJsonArray = trimmed.startsWith("[");

                if (
                  isJsonArray ||
                  lines.length <= HTTP_TAIL_PARSE_CHUNK_LINES
                ) {
                  // Small chunk (normal tailing tick) or a JSON array document
                  // that must be parsed as a single unit.
                  const entries = isJsonArray
                    ? parseJsonFile(source, data)
                    : parseTextLines(source, data);
                  if (entries.length > 0 && enqueueWatchEntries) {
                    enqueueWatchEntries(entries, senderId);
                  }
                } else {
                  // Large initial payload ("load existing content first") of
                  // plain text OR NDJSON. parseTextLines treats every line
                  // independently (and parses per-line JSON), so we can safely
                  // split the work into line-chunks and yield to the event loop
                  // between them. This keeps the main process responsive (so the
                  // user can still open files/zips while a tail is active)
                  // instead of freezing on one giant parse.
                  //
                  // Each parsed chunk is enqueued (and flushed by main.ts)
                  // immediately, so the content streams into the renderer
                  // progressively instead of appearing all at once after a
                  // multi-second parse. Because main.ts drains the buffer right
                  // after every enqueue, the per-call backpressure invariant
                  // still holds and no chunk is ever dropped.
                  for (
                    let i = 0;
                    i < lines.length;
                    i += HTTP_TAIL_PARSE_CHUNK_LINES
                  ) {
                    const slice = lines.slice(
                      i,
                      i + HTTP_TAIL_PARSE_CHUNK_LINES,
                    );
                    const part = parseTextLines(source, slice.join("\n"));
                    if (part.length > 0 && enqueueWatchEntries) {
                      enqueueWatchEntries(part, senderId);
                    }
                    // Report incremental progress so the UI status reflects the
                    // streaming load rather than a single end-of-parse jump.
                    emitHttpTailStatus(senderId, {
                      type: "lines",
                      id: tail.id,
                      url: args.url,
                      lineCount: slice.length,
                    });
                    // Yield between chunks (but not after the last one).
                    if (i + HTTP_TAIL_PARSE_CHUNK_LINES < lines.length) {
                      await yieldToEventLoop();
                    }
                  }
                  return;
                }
                emitHttpTailStatus(senderId, {
                  type: "lines",
                  id: tail.id,
                  url: args.url,
                  lineCount: lines.length,
                });
              } catch (e) {
                log.warn(
                  "[httpTail] parse failed:",
                  e instanceof Error ? e.message : String(e),
                );
              }
            },
            onError: (err: Error) => {
              emitHttpTailStatus(senderId, {
                type: "error",
                id: tail.id,
                url: args.url,
                message: err.message,
              });
            },
            onRotated: () => {
              emitHttpTailStatus(senderId, {
                type: "rotated",
                id: tail.id,
                url: args.url,
              });
            },
            onProgress: (p) => {
              emitHttpTailStatus(senderId, {
                type: "progress",
                id: tail.id,
                url: args.url,
                offset: p.offset,
                total: p.total,
              });
            },
          },
          {
            intervalMs: args.intervalMs,
            emitInitial: !!args.emitInitial,
            headers: args.headers,
            allowInsecureSSL: !!args.allowInsecureSSL,
          },
        );

        emitHttpTailStatus(senderId, {
          type: "started",
          id: tail.id,
          url: args.url,
        });
        return { ok: true, id: tail.id, url: args.url };
      } catch (e) {
        log.warn(
          "[httpTail] start failed:",
          e instanceof Error ? e.message : String(e),
        );
        return { ok: false, error: String(e) };
      }
    },
  );

  ipcMain.handle("httpTail:stop", (event, args: { id: number }) => {
    try {
      const ok = httpTailManager.stop(args?.id);
      if (ok) {
        emitHttpTailStatus(event.sender.id, {
          type: "stopped",
          id: args.id,
          url: "",
        });
      }
      return { ok };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle("httpTail:list", () => {
    return { ok: true, tails: httpTailManager.list() };
  });

  ipcMain.handle("httpTail:getAuthHeader", () => {
    try {
      const settings = settingsService.get();
      return {
        ok: true,
        authHeader: settingsService.decryptSecret(
          settings.httpAuthHeaderEnc || "",
        ),
      };
    } catch (e) {
      return { ok: false, authHeader: "", error: String(e) };
    }
  });

  app.on("before-quit", () => {
    try {
      httpTailManager.stopAll();
    } catch {
      // ignore
    }
  });
}
