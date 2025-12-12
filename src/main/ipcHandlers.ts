/**
 * IPC Handlers
 * Handles IPC communication between main and renderer processes
 */

import { ipcMain, dialog, BrowserWindow } from "electron";
import log from "electron-log/main";
import * as path from "path";
import { getSharedMainApi } from "./sharedMainApi";
import {
  Settings,
  ElasticSearchOptions,
  ParseResult,
  SettingsResult,
  DroppedFile,
  WindowPermsResult,
  Result,
} from "../types/ipc";
import type { SettingsService } from "../services/SettingsService";
import type { NetworkService } from "../services/NetworkService";

export function registerIpcHandlers(
  settingsService: SettingsService,
  networkService: NetworkService,
  getParsers: () => typeof import("./parsers.cjs"),
  getAdmZip: () => typeof import("adm-zip"),
): void {
  const sharedApi = getSharedMainApi();

  function updateWindowTitles(): void {
    try {
      sharedApi.applyWindowTitles?.();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fn = (global as any)?.__applyWindowTitles;
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const upd = (global as any)?.__updateAppMenu;
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
          return { ok: false, error: "Invalid patch: not an object" };
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
          return { ok: false, error: "Failed to save settings to disk" };
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
        { name: "Logs", extensions: ["log", "json", "jsonl", "txt", "zip"] },
        { name: "All Files", extensions: ["*"] },
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
      title: "Logdatei wählen",
      defaultPath: defaultPath || undefined,
      filters: [
        { name: "Logdateien", extensions: ["log", "jsonl", "txt"] },
        { name: "Alle Dateien", extensions: ["*"] },
      ],
    });

    if (res.canceled) return "";
    return res.filePath || "";
  });

  // Log parsing handlers

  ipcMain.handle(
    "logs:parsePaths",
    async (_event, filePaths: string[]): Promise<ParseResult> => {
      try {
        const { parsePaths } = getParsers();
        const entries = parsePaths(filePaths);
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
        const all = [] as any[];
        for (const f of files) {
          const name = String(f?.name || "");
          const enc = String(f?.encoding || "utf8");
          const data = String(f?.data || "");
          const ext = path.extname(name).toLowerCase();
          if (!name || !data) continue;
          if (ext === ".zip") {
            const buf = Buffer.from(data, enc === "base64" ? "base64" : "utf8");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const zip = new (ZipClass as any)(buf);
            zip.getEntries().forEach((zEntry: Record<string, unknown>) => {
              const ename = String(zEntry.entryName || "");
              const eext = path.extname(ename).toLowerCase();
              if (
                !zEntry.isDirectory &&
                (eext === ".log" ||
                  eext === ".json" ||
                  eext === ".jsonl" ||
                  eext === ".txt")
              ) {
                const getData = zEntry.getData as (
                  ...args: unknown[]
                ) => Buffer;
                const text = getData().toString("utf8");
                const parsed =
                  eext === ".json"
                    ? parseJsonFile(ename, text)
                    : parseTextLines(ename, text);
                parsed.forEach((e: Record<string, unknown>) => {
                  e.source = `${name}::${ename}`;
                });
                all.push(...parsed);
              }
            });
          } else if (ext === ".json") {
            const entries = parseJsonFile(name, data);
            all.push(...entries);
          } else {
            const entries = parseTextLines(name, data);
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
        const win = BrowserWindow.fromWebContents(event.sender);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const canFn = (global as any)?.__getWindowCanTcpControl;
        const allowed =
          win && typeof canFn === "function" ? !!canFn(win.id) : true;
        if (!allowed) {
          if (win) sharedApi.setTcpOwnerWindowId?.(win.id);
          event.reply("tcp:status", {
            ok: false,
            message: "In diesem Fenster nicht erlaubt",
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (global as any).__setTcpOwnerWindowId?.(win.id);
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const canFn = (global as any)?.__getWindowCanTcpControl;
        const allowed =
          win && typeof canFn === "function" ? !!canFn(win.id) : true;
        if (!allowed) {
          event.reply("tcp:status", {
            ok: false,
            message: "In diesem Fenster nicht erlaubt",
          });
          return;
        }
        const status = await networkService.stopTcpServer();
        event.reply("tcp:status", status);
        if (status.ok) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (global as any).__setTcpOwnerWindowId?.(null);
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
      return await networkService.httpLoadOnce(url);
    },
  );

  ipcMain.handle(
    "http:startPoll",
    async (
      _event,
      { url, intervalMs }: { url: string; intervalMs: number },
    ) => {
      return await networkService.httpStartPoll(url, intervalMs);
    },
  );

  ipcMain.handle("http:stopPoll", async (_event, id: number) => {
    return networkService.httpStopPoll(id);
  });

  // Elasticsearch handler
  ipcMain.handle(
    "elastic:search",
    async (_event, opts: ElasticSearchOptions): Promise<ParseResult> => {
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
          throw new Error("Elasticsearch URL ist nicht konfiguriert");
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

        type PitPage = {
          entries: Array<unknown>;
          total: number | null;
          hasMore: boolean;
          nextSearchAfter: Array<string | number> | null;
          pitSessionId: string;
        };
        const page = await (
          fetchElasticPitPage as unknown as (
            o: ElasticSearchOptions,
          ) => Promise<PitPage>
        )(mergedOpts);

        return {
          ok: true,
          entries: page.entries as any,
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
}
