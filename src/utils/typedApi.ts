/**
 * Typed IPC API wrapper
 *
 * Provides type-safe access to `window.api` methods, eliminating `as any` casts
 * at call sites. Each helper validates the response and returns properly typed data.
 */

import type {
  AutoUpdaterStatus,
  DroppedFile,
  ElasticSearchOptions,
  ExportPathResult,
  ExportResult,
  FeatureFlagsResult,
  FilterOptions,
  FilterResult,
  HttpPollResult,
  LogEntry,
  MenuCommand,
  ParseResult,
  Result,
  Settings,
  SettingsResult,
  TcpStatus,
  WindowPermsResult,
  WindowTitleResult,
} from "../types/ipc";

// ─────────────────────────── Settings ───────────────────────────

/**
 * Get current settings from main process (type-safe).
 * Returns `null` if the call fails or returns no settings.
 */
export async function getSettings(): Promise<Settings | null> {
  if (!window.api?.settingsGet) return null;
  try {
    const result: SettingsResult = await window.api.settingsGet();
    if (!result?.ok || !result.settings) return null;
    return result.settings;
  } catch {
    return null;
  }
}

/**
 * Patch (merge) settings in main process.
 * Returns the full SettingsResult for callers that need error info.
 */
export async function patchSettings(
  patch: Partial<Settings>,
): Promise<SettingsResult> {
  if (!window.api?.settingsSet)
    return { ok: false, error: "settingsSet unavailable" };
  try {
    return await window.api.settingsSet(patch);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Fire-and-forget variant of patchSettings (void-returning, swallows errors).
 * Use when you don't need to check the result.
 */
export function patchSettingsQuiet(patch: Partial<Settings>): void {
  void patchSettings(patch);
}

/**
 * Get the default log file path from the main process.
 */
export async function getDefaultLogPath(): Promise<string> {
  if (!window.api?.getDefaultLogPath) return "";
  try {
    return await window.api.getDefaultLogPath();
  } catch {
    return "";
  }
}

// ─────────────────────────── Window Title ───────────────────────────

/**
 * Get the current window title.
 */
export async function windowTitleGet(): Promise<WindowTitleResult> {
  if (!window.api?.windowTitleGet)
    return { ok: false, error: "windowTitleGet unavailable" };
  try {
    return await window.api.windowTitleGet();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Set the window title.
 */
export async function windowTitleSet(title: string): Promise<Result<void>> {
  if (!window.api?.windowTitleSet)
    return { ok: false, error: "windowTitleSet unavailable" };
  try {
    return await window.api.windowTitleSet(title);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─────────────────────────── Window Permissions ───────────────────────────

/**
 * Get per-window permissions (e.g. canTcpControl).
 */
export async function windowPermsGet(): Promise<WindowPermsResult> {
  if (!window.api?.windowPermsGet)
    return { ok: false, error: "windowPermsGet unavailable" };
  try {
    return await window.api.windowPermsGet();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Set per-window permissions.
 */
export async function windowPermsSet(patch: {
  canTcpControl?: boolean;
}): Promise<Result<void>> {
  if (!window.api?.windowPermsSet)
    return { ok: false, error: "windowPermsSet unavailable" };
  try {
    return await window.api.windowPermsSet(patch);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─────────────────────────── Dialog / File Operations ───────────────────────────

/**
 * Open a native file picker dialog.
 * Returns selected file paths (empty array if cancelled or unavailable).
 */
export async function openFiles(): Promise<string[]> {
  if (!window.api?.openFiles) return [];
  try {
    return (await window.api.openFiles()) || [];
  } catch {
    return [];
  }
}

/**
 * Open a native file picker for choosing a single log file path.
 */
export async function chooseLogFile(): Promise<string> {
  if (!window.api?.chooseLogFile) return "";
  try {
    return (await window.api.chooseLogFile()) || "";
  } catch {
    return "";
  }
}

/**
 * Open a native save dialog for choosing an export path.
 */
export async function chooseExportPath(): Promise<ExportPathResult> {
  if (!window.api?.chooseExportPath)
    return { ok: false, error: "chooseExportPath unavailable" };
  try {
    return await window.api.chooseExportPath();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Save content to a file path.
 */
export async function saveExportFile(
  filePath: string,
  content: string,
): Promise<ExportResult> {
  if (!window.api?.saveExportFile)
    return { ok: false, error: "saveExportFile unavailable" };
  try {
    return await window.api.saveExportFile(filePath, content);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─────────────────────────── Log Parsing ───────────────────────────

/**
 * Parse log files by path.
 */
export async function parsePaths(paths: string[]): Promise<ParseResult> {
  if (!window.api?.parsePaths)
    return { ok: false, error: "parsePaths unavailable" };
  try {
    return await window.api.parsePaths(paths);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Parse raw dropped files.
 */
export async function parseRawDrops(
  files: DroppedFile[],
): Promise<ParseResult> {
  if (!window.api?.parseRawDrops)
    return { ok: false, error: "parseRawDrops unavailable" };
  try {
    return await window.api.parseRawDrops(files);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─────────────────────────── TCP ───────────────────────────

/**
 * Start TCP log server on given port.
 */
export function tcpStart(port: number): void {
  if (window.api?.tcpStart) {
    window.api.tcpStart(port);
  }
}

/**
 * Stop TCP log server.
 */
export function tcpStop(): void {
  if (window.api?.tcpStop) {
    window.api.tcpStop();
  }
}

// ─────────────────────────── HTTP ───────────────────────────

/**
 * Load logs from HTTP URL once.
 */
export async function httpLoadOnce(url: string): Promise<ParseResult> {
  if (!window.api?.httpLoadOnce)
    return { ok: false, error: "httpLoadOnce unavailable" };
  try {
    return await window.api.httpLoadOnce(url);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Start HTTP polling.
 */
export async function httpStartPoll(options: {
  url: string;
  intervalSec: number;
}): Promise<HttpPollResult> {
  if (!window.api?.httpStartPoll)
    return { ok: false, error: "httpStartPoll unavailable" };
  try {
    return await window.api.httpStartPoll(options);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Stop HTTP polling.
 */
export async function httpStopPoll(id: number): Promise<Result<void>> {
  if (!window.api?.httpStopPoll)
    return { ok: false, error: "httpStopPoll unavailable" };
  try {
    return await window.api.httpStopPoll(id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Get allowInsecureSSL setting.
 */
export async function httpGetAllowInsecureSSL(): Promise<boolean> {
  if (!window.api?.httpGetAllowInsecureSSL) return false;
  try {
    return await window.api.httpGetAllowInsecureSSL();
  } catch {
    return false;
  }
}

/**
 * Set allowInsecureSSL setting.
 */
export async function httpSetAllowInsecureSSL(
  allow: boolean,
): Promise<boolean> {
  if (!window.api?.httpSetAllowInsecureSSL) return false;
  try {
    const r = await window.api.httpSetAllowInsecureSSL(allow);
    return r?.ok;
  } catch {
    return false;
  }
}

// ─────────────────────────── Elasticsearch ───────────────────────────

/**
 * Perform an Elasticsearch search.
 */
export async function elasticSearch(
  options: ElasticSearchOptions,
): Promise<ParseResult> {
  if (!window.api?.elasticSearch)
    return { ok: false, error: "elasticSearch unavailable" };
  try {
    return await window.api.elasticSearch(options);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Close an Elasticsearch PIT session.
 */
export async function elasticClosePit(
  sessionId: string,
): Promise<Result<void>> {
  if (!window.api?.elasticClosePit)
    return { ok: false, error: "elasticClosePit unavailable" };
  try {
    return await window.api.elasticClosePit(sessionId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─────────────────────────── Feature Flags ───────────────────────────

/**
 * Get all feature flags.
 */
export async function featureFlagsGetAll(): Promise<FeatureFlagsResult | null> {
  if (!window.api?.featureFlagsGetAll) return null;
  try {
    return await window.api.featureFlagsGetAll();
  } catch {
    return null;
  }
}

/**
 * Disable a feature flag.
 */
export async function featureFlagsDisable(
  feature: string,
  reason?: string,
): Promise<Result<void>> {
  if (!window.api?.featureFlagsDisable)
    return { ok: false, error: "featureFlagsDisable unavailable" };
  try {
    return await window.api.featureFlagsDisable(feature, reason);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Enable a feature flag.
 */
export async function featureFlagsEnable(
  feature: string,
): Promise<Result<void>> {
  if (!window.api?.featureFlagsEnable)
    return { ok: false, error: "featureFlagsEnable unavailable" };
  try {
    return await window.api.featureFlagsEnable(feature);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Reset all feature flags to defaults.
 */
export async function featureFlagsResetAll(): Promise<Result<void>> {
  if (!window.api?.featureFlagsResetAll)
    return { ok: false, error: "featureFlagsResetAll unavailable" };
  try {
    return await window.api.featureFlagsResetAll();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─────────────────────────── App Operations ───────────────────────────

/**
 * Relaunch the application.
 */
export async function appRelaunch(): Promise<Result<void>> {
  if (!window.api?.appRelaunch)
    return { ok: false, error: "appRelaunch unavailable" };
  try {
    return await window.api.appRelaunch();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─────────────────────────── Auto-Updater ───────────────────────────

/**
 * Check for updates.
 */
export async function autoUpdaterCheck(): Promise<unknown> {
  if (!window.api?.autoUpdaterCheck) return null;
  try {
    return await window.api.autoUpdaterCheck();
  } catch {
    return null;
  }
}

/**
 * Download available update.
 */
export async function autoUpdaterDownload(): Promise<void> {
  if (!window.api?.autoUpdaterDownload) return;
  try {
    await window.api.autoUpdaterDownload();
  } catch {
    // swallow
  }
}

/**
 * Install downloaded update (triggers restart).
 */
export async function autoUpdaterInstall(): Promise<void> {
  if (!window.api?.autoUpdaterInstall) return;
  try {
    await window.api.autoUpdaterInstall();
  } catch {
    // swallow
  }
}

/**
 * Set allowPrerelease flag.
 */
export async function autoUpdaterSetAllowPrerelease(
  allow: boolean,
): Promise<boolean> {
  if (!window.api?.autoUpdaterSetAllowPrerelease) return false;
  try {
    const r = await window.api.autoUpdaterSetAllowPrerelease(allow);
    return r?.ok;
  } catch {
    return false;
  }
}

// ─────────────────────────── Event Listeners ───────────────────────────

/** No-op cleanup function returned when the API is unavailable. */
const noop = (): void => {};

/**
 * Subscribe to log append events.
 * Returns a cleanup function.
 */
export function onAppend(callback: (entries: LogEntry[]) => void): () => void {
  if (!window.api?.onAppend) return noop;
  try {
    return window.api.onAppend(callback);
  } catch {
    return noop;
  }
}

/**
 * Subscribe to TCP status events.
 */
export function onTcpStatus(callback: (status: TcpStatus) => void): () => void {
  if (!window.api?.onTcpStatus) return noop;
  try {
    return window.api.onTcpStatus(callback);
  } catch {
    return noop;
  }
}

/**
 * Subscribe to menu command events.
 */
export function onMenu(callback: (command: MenuCommand) => void): () => void {
  if (!window.api?.onMenu) return noop;
  try {
    return window.api.onMenu(callback);
  } catch {
    return noop;
  }
}

/**
 * Subscribe to auto-updater status events.
 */
export function onAutoUpdaterStatus(
  callback: (status: AutoUpdaterStatus) => void,
): () => void {
  if (!window.api?.onAutoUpdaterStatus) return noop;
  try {
    return window.api.onAutoUpdaterStatus(callback);
  } catch {
    return noop;
  }
}

/**
 * Subscribe to window focus events.
 */
export function onWindowFocus(callback: () => void): () => void {
  if (!window.api?.onWindowFocus) return noop;
  try {
    return window.api.onWindowFocus(callback);
  } catch {
    return noop;
  }
}

// ─────────────────────────── Filter (UtilityProcess) ───────────────────────────

/**
 * Filter entries using UtilityProcess.
 */
export async function filterEntries(
  entries: unknown[],
  options: FilterOptions,
): Promise<FilterResult> {
  if (!window.api?.filterEntries)
    return {
      ok: false,
      error: "filterEntries unavailable",
      filteredIndices: [],
      stats: {
        total: 0,
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
  try {
    return await window.api.filterEntries(entries, options);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      filteredIndices: [],
      stats: {
        total: 0,
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
}

/**
 * Check if UtilityProcess filter is available.
 */
export async function filterIsAvailable(): Promise<boolean> {
  if (!window.api?.filterIsAvailable) return false;
  try {
    const r = await window.api.filterIsAvailable();
    return r?.available;
  } catch {
    return false;
  }
}
