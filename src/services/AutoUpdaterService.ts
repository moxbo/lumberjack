/**
 * AutoUpdater Service
 *
 * Handles automatic updates using electron-updater.
 * Supports GitHub Releases as the update source.
 *
 * Features:
 * - Automatic update checks on app start (configurable)
 * - Manual update check via IPC
 * - Download progress notifications
 * - User-controlled install (restart prompt)
 * - Logging of all update events
 *
 * Memory Optimizations:
 * - Lazy initialization of electron-updater module
 * - Proper event listener cleanup via dispose()
 * - WeakRef for mainWindow to prevent memory leaks
 * - Throttled progress events to reduce IPC overhead
 * - Cached update info to avoid redundant checks
 */

import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import log from "electron-log/main";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";

// Lazy-loaded types - actual import deferred until needed
type AutoUpdater = typeof import("electron-updater").autoUpdater;
type UpdateInfo = import("electron-updater").UpdateInfo;
type ProgressInfo = import("electron-updater").ProgressInfo;

export interface UpdateStatus {
  status:
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "error"
    | "available-portable";
  info?: UpdateInfo & { releaseUrl?: string };
  progress?: ProgressInfo;
  error?: string;
  isPortable?: boolean;
}

// IPC handler signatures for type safety
type IpcHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

// Constants for progress throttling
const PROGRESS_THROTTLE_MS = 100;

// GitHub repository info for portable update checks
const GITHUB_OWNER = "moxbo";
const GITHUB_REPO = "lumberjack";
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

export class AutoUpdaterService {
  // Use WeakRef to prevent memory leaks if window is destroyed elsewhere
  private mainWindowRef: WeakRef<BrowserWindow> | null = null;
  private isCheckingForUpdates = false;
  private updateDownloaded = false;
  private autoUpdatesAvailable: boolean | null = null;
  private readonly isPortable: boolean;

  // Lazy-loaded autoUpdater instance
  private _autoUpdater: AutoUpdater | null = null;
  private _isInitialized = false;

  // Bound event handlers for proper cleanup
  // Using 'any' for handler type to allow different event signatures

  private readonly boundHandlers = new Map<string, (...args: any[]) => void>();

  // Registered IPC handlers for cleanup
  private readonly registeredIpcChannels: string[] = [];

  // Progress throttling
  private lastProgressUpdate = 0;
  private pendingProgressUpdate: ProgressInfo | null = null;
  private progressThrottleTimer: ReturnType<typeof setTimeout> | null = null;

  // Cached update check result to avoid redundant network calls
  private cachedUpdateInfo: UpdateInfo | null = null;
  private lastUpdateCheck = 0;
  private readonly updateCheckCacheMs = 60000; // Cache for 1 minute

  // Startup check timer reference for cleanup
  private startupCheckTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Detect portable mode (set by electron-builder for portable targets)
    // Also treat "dir" / zip installations (packaged but no app-update.yml) as portable
    const isPortableExe = !!(
      process.env.PORTABLE_EXECUTABLE_DIR &&
      process.env.PORTABLE_EXECUTABLE_DIR.length > 0
    );

    // Check if auto-updates are available for this installation
    this.autoUpdatesAvailable = this.checkAutoUpdatesAvailable();

    // Treat as portable if: running from portable exe OR packaged without auto-update support
    // This covers "dir" builds and zip-distributed releases that don't have app-update.yml
    this.isPortable =
      isPortableExe || (app.isPackaged && !this.autoUpdatesAvailable);

    // Always setup IPC handlers so renderer can query status
    this.setupIpcHandlers();

    if (this.isPortable) {
      log.info(
        "[auto-updater] Portable/dir mode detected – auto-update disabled, " +
          "will check for new versions via GitHub API instead" +
          (isPortableExe ? " (portable exe)" : " (dir/zip installation)"),
      );
      return;
    }

    if (!this.autoUpdatesAvailable) {
      log.info(
        "[auto-updater] Auto-updates not available for this installation",
      );
      return;
    }

    // Defer full initialization until actually needed (lazy loading)
    log.info("[auto-updater] Service created (lazy initialization enabled)");
  }

  /**
   * Get the autoUpdater instance, initializing lazily if needed
   * This defers the heavy electron-updater import until first use
   */
  private get autoUpdater(): AutoUpdater {
    if (!this._autoUpdater) {
      this.initializeAutoUpdater();
    }
    return this._autoUpdater!;
  }

  /**
   * Initialize electron-updater lazily
   * This defers the module import and setup until first actual use
   */
  private initializeAutoUpdater(): void {
    if (this._isInitialized) return;

    // Dynamic import to defer loading
    const { autoUpdater } =
      require("electron-updater") as typeof import("electron-updater");
    this._autoUpdater = autoUpdater;

    // Configure electron-updater to use electron-log
    autoUpdater.logger = log;

    // Disable auto-download by default - let user decide
    autoUpdater.autoDownload = false;
    // Disable auto-install on quit - let user control when to restart
    autoUpdater.autoInstallOnAppQuit = false;

    // Pre-release handling:
    // Only check for stable releases by default.
    // Users can manually opt-in to pre-releases via setAllowPrerelease(true).
    autoUpdater.allowPrerelease = false;

    // Allow downgrade (useful for testing)
    autoUpdater.allowDowngrade = false;

    // Disable code signing verification for unsigned builds
    // Required for macOS when building without Apple Developer ID
    // @ts-expect-error - forceCodeSigning is not in the type definitions but is supported
    autoUpdater.forceCodeSigning = false;

    // Configure GitHub token for private repositories
    this.configurePrivateRepoAccess();

    // Setup event handlers with bound references for cleanup
    this.setupEventHandlers();

    this._isInitialized = true;

    log.info("[auto-updater] Fully initialized", {
      currentVersion: autoUpdater.currentVersion?.version || "unknown",
      allowPrerelease: autoUpdater.allowPrerelease,
      hasToken: !!process.env.GH_TOKEN || !!process.env.GITHUB_TOKEN,
      autoUpdatesAvailable: this.autoUpdatesAvailable,
    });
  }

  /**
   * Check if auto-updates are available for this installation.
   * Auto-updates require app-update.yml which is generated by electron-builder.
   * Returns false if:
   * - Running in development mode
   * - App is not packaged
   * - app-update.yml is missing
   */
  private checkAutoUpdatesAvailable(): boolean {
    // Not available in development
    if (process.env.NODE_ENV === "development") {
      log.debug("[auto-updater] Development mode - auto-updates disabled");
      return false;
    }

    // Not available if not packaged
    if (!app.isPackaged) {
      log.debug("[auto-updater] Not packaged - auto-updates disabled");
      return false;
    }

    // Check for app-update.yml in Resources directory
    const resourcesPath = process.resourcesPath;
    const appUpdateYmlPath = path.join(resourcesPath, "app-update.yml");

    if (!fs.existsSync(appUpdateYmlPath)) {
      log.warn(
        "[auto-updater] app-update.yml not found at:",
        appUpdateYmlPath,
        "Auto-updates will not be available.",
      );
      return false;
    }

    log.debug("[auto-updater] app-update.yml found, auto-updates available");
    return true;
  }

  /**
   * Configure access to private GitHub repositories
   * Uses GH_TOKEN or GITHUB_TOKEN environment variable
   */
  private configurePrivateRepoAccess(): void {
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (token) {
      // Set the token for electron-updater to use with private repos
      process.env.GH_TOKEN = token;

      // Force electron-updater to use GitHub API instead of Atom feed
      // This is required for private repositories
      this.autoUpdater.setFeedURL({
        provider: "github",
        owner: "moxbo",
        repo: "lumberjack",
        private: true,
        token: token,
      });

      log.info(
        "[auto-updater] GitHub token configured for private repo access (using API)",
      );
    } else {
      log.debug(
        "[auto-updater] No GitHub token found. " +
          "Set GH_TOKEN or GITHUB_TOKEN env var for private repo access.",
      );
    }
  }

  /**
   * Enable or disable pre-release updates
   * Call this to opt-in to beta channel
   */
  setAllowPrerelease(allow: boolean): void {
    if (!this.autoUpdatesAvailable) {
      log.debug(
        "[auto-updater] Auto-updates not available, ignoring setAllowPrerelease",
      );
      return;
    }
    this.autoUpdater.allowPrerelease = allow;

    // Invalidate cache when settings change - different releases may be available
    this.cachedUpdateInfo = null;
    this.lastUpdateCheck = 0;

    log.info("[auto-updater] allowPrerelease set to:", allow);
  }

  /**
   * Get current pre-release setting
   */
  getAllowPrerelease(): boolean {
    if (!this.autoUpdatesAvailable) {
      return false;
    }
    return this.autoUpdater.allowPrerelease;
  }

  /**
   * Set the main window for sending update notifications
   * Uses WeakRef to prevent memory leaks
   */
  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindowRef = window ? new WeakRef(window) : null;
  }

  /**
   * Get main window safely via WeakRef
   */
  private get mainWindow(): BrowserWindow | null {
    const window = this.mainWindowRef?.deref() ?? null;
    // Clear stale reference if window was garbage collected
    if (this.mainWindowRef && !window) {
      this.mainWindowRef = null;
    }
    return window;
  }

  /**
   * Setup electron-updater event handlers
   * Uses bound handlers stored in Map for proper cleanup
   */
  private setupEventHandlers(): void {
    const autoUpdater = this.autoUpdater;

    // Create and store bound handlers for cleanup
    const checkingHandler = () => {
      log.info("[auto-updater] Checking for updates...");
      this.sendStatusToRenderer({ status: "checking" });
    };
    this.boundHandlers.set("checking-for-update", checkingHandler);
    autoUpdater.on("checking-for-update", checkingHandler);

    const availableHandler = (info: UpdateInfo) => {
      log.info("[auto-updater] Update available:", info.version);
      this.cachedUpdateInfo = info;
      this.lastUpdateCheck = Date.now();
      this.sendStatusToRenderer({ status: "available", info });
    };
    this.boundHandlers.set("update-available", availableHandler);
    autoUpdater.on("update-available", availableHandler);

    const notAvailableHandler = (info: UpdateInfo) => {
      log.info(
        "[auto-updater] No update available. Current version:",
        info.version,
      );
      this.cachedUpdateInfo = info;
      this.lastUpdateCheck = Date.now();
      this.sendStatusToRenderer({ status: "not-available", info });
    };
    this.boundHandlers.set("update-not-available", notAvailableHandler);
    autoUpdater.on("update-not-available", notAvailableHandler);

    // Throttled progress handler to reduce IPC overhead
    const progressHandler = (progress: ProgressInfo) => {
      this.handleProgressUpdate(progress);
    };
    this.boundHandlers.set("download-progress", progressHandler);
    autoUpdater.on("download-progress", progressHandler);

    const downloadedHandler = (info: UpdateInfo) => {
      log.info("[auto-updater] Update downloaded:", info.version);
      this.updateDownloaded = true;
      // Clear any pending progress updates
      this.clearPendingProgress();
      this.sendStatusToRenderer({ status: "downloaded", info });
    };
    this.boundHandlers.set("update-downloaded", downloadedHandler);
    autoUpdater.on("update-downloaded", downloadedHandler);

    const errorHandler = (error: Error) => {
      log.error("[auto-updater] Error:", error.message);
      // Clear any pending progress updates on error
      this.clearPendingProgress();
      this.sendStatusToRenderer({ status: "error", error: error.message });
    };
    this.boundHandlers.set("error", errorHandler);
    autoUpdater.on("error", errorHandler);
  }

  /**
   * Clear pending progress state
   * Called when download completes or fails to prevent memory leaks
   */
  private clearPendingProgress(): void {
    if (this.progressThrottleTimer) {
      clearTimeout(this.progressThrottleTimer);
      this.progressThrottleTimer = null;
    }
    this.pendingProgressUpdate = null;
    this.lastProgressUpdate = 0;
  }

  /**
   * Handle progress updates with throttling
   * Prevents excessive IPC calls during fast downloads
   */
  private handleProgressUpdate(progress: ProgressInfo): void {
    const now = Date.now();

    // Store latest progress
    this.pendingProgressUpdate = progress;

    // If we've sent an update recently, schedule a deferred update
    if (now - this.lastProgressUpdate < PROGRESS_THROTTLE_MS) {
      if (!this.progressThrottleTimer) {
        this.progressThrottleTimer = setTimeout(() => {
          this.progressThrottleTimer = null;
          if (this.pendingProgressUpdate) {
            this.sendProgressUpdate(this.pendingProgressUpdate);
            this.pendingProgressUpdate = null;
          }
        }, PROGRESS_THROTTLE_MS);
      }
      return;
    }

    // Send immediately if enough time has passed
    this.sendProgressUpdate(progress);
    this.pendingProgressUpdate = null;
  }

  /**
   * Send progress update to renderer
   */
  private sendProgressUpdate(progress: ProgressInfo): void {
    this.lastProgressUpdate = Date.now();
    log.debug(
      `[auto-updater] Download progress: ${progress.percent.toFixed(1)}% ` +
        `(${(progress.bytesPerSecond / 1024 / 1024).toFixed(2)} MB/s)`,
    );
    this.sendStatusToRenderer({ status: "downloading", progress });
  }

  /**
   * Setup IPC handlers for renderer communication
   * Tracks registered channels for cleanup
   */
  private setupIpcHandlers(): void {
    // Helper to register and track handlers
    const registerHandler = (channel: string, handler: IpcHandler): void => {
      ipcMain.handle(channel, handler);
      this.registeredIpcChannels.push(channel);
    };

    // Check for updates manually
    registerHandler("auto-updater:check", async () => {
      return this.checkForUpdates();
    });

    // Download available update
    registerHandler("auto-updater:download", async () => {
      return this.downloadUpdate();
    });

    // Install downloaded update (restart app)
    registerHandler("auto-updater:install", () => {
      return this.installUpdate();
    });

    // Get current update status
    registerHandler("auto-updater:status", () => {
      return {
        updateDownloaded: this.updateDownloaded,
        isChecking: this.isCheckingForUpdates,
        allowPrerelease:
          this.autoUpdatesAvailable && this._isInitialized
            ? (this._autoUpdater?.allowPrerelease ?? false)
            : false,
        autoUpdatesAvailable: this.autoUpdatesAvailable,
        isPortable: this.isPortable,
      };
    });

    // Open GitHub releases page (for portable mode)
    registerHandler("auto-updater:open-release-page", () => {
      this.openReleasePage();
    });

    // Get/Set pre-release setting
    registerHandler("auto-updater:getAllowPrerelease", () => {
      return this.getAllowPrerelease();
    });

    registerHandler(
      "auto-updater:setAllowPrerelease",
      (_event: IpcMainInvokeEvent, ...args: unknown[]) => {
        const allow = args[0] as boolean;
        this.setAllowPrerelease(allow);
        return { ok: true };
      },
    );
  }

  /**
   * Check for available updates
   * Uses caching to avoid redundant network calls
   * In portable mode, uses GitHub API instead of electron-updater
   */
  async checkForUpdates(): Promise<UpdateInfo | null> {
    // Portable mode: check via GitHub API
    if (this.isPortable) {
      return this.checkForUpdatesPortable();
    }

    // Early return if auto-updates are not available
    // This should not normally be reached since isPortable covers dir/zip builds,
    // but handle it gracefully just in case
    if (!this.autoUpdatesAvailable) {
      log.debug(
        "[auto-updater] Auto-updates not available, skipping check silently",
      );
      return null;
    }

    if (this.isCheckingForUpdates) {
      log.warn("[auto-updater] Already checking for updates");
      return null;
    }

    // Return cached result if still valid
    if (
      this.cachedUpdateInfo &&
      Date.now() - this.lastUpdateCheck < this.updateCheckCacheMs
    ) {
      log.debug("[auto-updater] Returning cached update info");
      return this.cachedUpdateInfo;
    }

    try {
      this.isCheckingForUpdates = true;
      const result = await this.autoUpdater.checkForUpdates();
      return result?.updateInfo ?? null;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Handle missing app-update.yml gracefully
      // This happens when app is not built with electron-builder or the file is missing
      if (errorMsg.includes("ENOENT") && errorMsg.includes("app-update.yml")) {
        log.warn(
          "[auto-updater] app-update.yml not found. " +
            "Auto-updates are not available for this build. " +
            "This is expected for development or manually installed builds.",
        );
        this.sendStatusToRenderer({
          status: "error",
          error: "Auto-updates are not available for this installation.",
        });
        return null;
      }

      log.error("[auto-updater] Check failed:", error);
      return null;
    } finally {
      this.isCheckingForUpdates = false;
    }
  }

  /**
   * Check for updates in portable mode using the GitHub Releases API.
   * Compares the latest release tag with the current app version.
   * Sends "available-portable" status if a newer version is found.
   */
  private async checkForUpdatesPortable(): Promise<UpdateInfo | null> {
    if (this.isCheckingForUpdates) {
      log.warn("[auto-updater] Already checking for updates (portable)");
      return null;
    }

    // Return cached result if still valid
    if (
      this.cachedUpdateInfo &&
      Date.now() - this.lastUpdateCheck < this.updateCheckCacheMs
    ) {
      log.debug("[auto-updater] Returning cached portable update info");
      return this.cachedUpdateInfo;
    }

    try {
      this.isCheckingForUpdates = true;
      this.sendStatusToRenderer({ status: "checking", isPortable: true });

      const releaseInfo = await this.fetchLatestGitHubRelease();
      if (!releaseInfo) {
        this.sendStatusToRenderer({
          status: "not-available",
          isPortable: true,
        });
        return null;
      }

      const currentVersion = app.getVersion();
      const latestVersion = releaseInfo.version;

      log.info(
        `[auto-updater] Portable version check: current=${currentVersion}, latest=${latestVersion}`,
      );

      if (this.isNewerVersion(latestVersion, currentVersion)) {
        log.info(
          `[auto-updater] Newer version available for portable: ${latestVersion}`,
        );
        const info: UpdateInfo = {
          version: latestVersion,
          releaseDate: releaseInfo.publishedAt,
          releaseNotes: releaseInfo.body,
        } as UpdateInfo;

        this.cachedUpdateInfo = info;
        this.lastUpdateCheck = Date.now();

        this.sendStatusToRenderer({
          status: "available-portable",
          info: {
            ...info,
            releaseUrl: releaseInfo.htmlUrl,
          },
          isPortable: true,
        });
        return info;
      } else {
        log.info("[auto-updater] Portable is up to date");
        this.lastUpdateCheck = Date.now();
        this.sendStatusToRenderer({
          status: "not-available",
          isPortable: true,
        });
        return null;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error("[auto-updater] Portable update check failed:", errorMsg);
      this.sendStatusToRenderer({
        status: "error",
        error: errorMsg,
        isPortable: true,
      });
      return null;
    } finally {
      this.isCheckingForUpdates = false;
    }
  }

  /**
   * Fetch latest release information from GitHub Releases API
   */
  private fetchLatestGitHubRelease(): Promise<{
    version: string;
    htmlUrl: string;
    publishedAt: string;
    body: string;
  } | null> {
    return new Promise((resolve) => {
      const options = {
        hostname: "api.github.com",
        path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
        method: "GET",
        headers: {
          "User-Agent": `Lumberjack/${app.getVersion()}`,
          Accept: "application/vnd.github.v3+json",
        },
        timeout: 10000,
      };

      // Add GitHub token if available (for private repos)
      const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
      if (token) {
        options.headers = {
          ...options.headers,
          Authorization: `token ${token}`,
        } as typeof options.headers;
      }

      const req = https.get(options, (res) => {
        let data = "";

        // Handle redirects
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          log.debug("[auto-updater] GitHub API redirect, following...");
          resolve(null);
          return;
        }

        if (res.statusCode !== 200) {
          log.warn(
            `[auto-updater] GitHub API returned status ${res.statusCode}`,
          );
          resolve(null);
          return;
        }

        res.on("data", (chunk: string) => {
          data += chunk;
        });

        res.on("end", () => {
          try {
            const release = JSON.parse(data) as {
              tag_name: string;
              html_url: string;
              published_at: string;
              body: string;
            };
            const version = release.tag_name.replace(/^v/, "");
            resolve({
              version,
              htmlUrl: release.html_url,
              publishedAt: release.published_at,
              body: release.body || "",
            });
          } catch (e) {
            log.error("[auto-updater] Failed to parse GitHub release:", e);
            resolve(null);
          }
        });
      });

      req.on("error", (err) => {
        log.error("[auto-updater] GitHub API request failed:", err.message);
        resolve(null);
      });

      req.on("timeout", () => {
        log.warn("[auto-updater] GitHub API request timed out");
        req.destroy();
        resolve(null);
      });
    });
  }

  /**
   * Compare semantic versions: returns true if latest > current
   */
  private isNewerVersion(latest: string, current: string): boolean {
    try {
      const latestParts = latest.split(".").map(Number);
      const currentParts = current.split(".").map(Number);

      for (
        let i = 0;
        i < Math.max(latestParts.length, currentParts.length);
        i++
      ) {
        const l = latestParts[i] || 0;
        const c = currentParts[i] || 0;
        if (l > c) return true;
        if (l < c) return false;
      }
      return false;
    } catch {
      log.warn("[auto-updater] Version comparison failed:", latest, current);
      return false;
    }
  }

  /**
   * Open the GitHub releases page in the default browser
   */
  openReleasePage(): void {
    log.info("[auto-updater] Opening release page:", GITHUB_RELEASES_URL);
    void shell.openExternal(GITHUB_RELEASES_URL);
  }

  /**
   * Download available update
   */
  async downloadUpdate(): Promise<void> {
    if (!this.autoUpdatesAvailable) {
      log.debug("[auto-updater] Auto-updates not available, skipping download");
      throw new Error("Auto-updates are not available for this installation.");
    }

    try {
      // Send downloading status immediately so UI updates right away
      this.sendStatusToRenderer({ status: "downloading" });
      await this.autoUpdater.downloadUpdate();
    } catch (error) {
      log.error("[auto-updater] Download failed:", error);
      throw error;
    }
  }

  /**
   * Install downloaded update and restart app
   */
  installUpdate(): void {
    if (!this.autoUpdatesAvailable) {
      log.warn("[auto-updater] Auto-updates not available, cannot install");
      return;
    }

    if (!this.updateDownloaded) {
      log.warn("[auto-updater] No update downloaded to install");
      return;
    }

    log.info("[auto-updater] Installing update and restarting...");
    this.autoUpdater.quitAndInstall(false, true);
  }

  /**
   * Send update status to renderer process
   */
  private sendStatusToRenderer(status: UpdateStatus): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("auto-updater:status", status);
    }
  }

  /**
   * Check for updates silently on app start (after delay)
   * Skips check in development mode or when running from source
   * For private repositories, set GH_TOKEN or GITHUB_TOKEN environment variable
   */
  checkForUpdatesOnStart(delayMs: number = 10000): void {
    // Skip auto-update check in development mode
    if (process.env.NODE_ENV === "development" || !app.isPackaged) {
      log.info(
        "[auto-updater] Skipping update check (development mode or not packaged)",
      );
      return;
    }

    // Log token status for debugging
    const hasToken = !!process.env.GH_TOKEN || !!process.env.GITHUB_TOKEN;
    log.info(
      `[auto-updater] Will check for updates in ${delayMs / 1000}s (hasToken: ${hasToken}, isPortable: ${this.isPortable})`,
    );

    // Store timer reference for cleanup
    this.startupCheckTimer = setTimeout(() => {
      this.startupCheckTimer = null;
      log.info("[auto-updater] Checking for updates on start...");
      this.checkForUpdates().catch((err) => {
        log.warn("[auto-updater] Startup check failed:", err);
      });
    }, delayMs);
  }

  /**
   * Initialize allowPrerelease from settings
   * Call this after SettingsService is ready
   */
  initFromSettings(allowPrerelease: boolean | undefined): void {
    const value = allowPrerelease ?? false;
    this.setAllowPrerelease(value);
    log.info(
      "[auto-updater] Initialized allowPrerelease from settings:",
      value,
    );
  }

  /**
   * Dispose of all resources
   * Call this during app shutdown to prevent memory leaks
   */
  dispose(): void {
    log.info("[auto-updater] Disposing service...");

    // Clear startup check timer
    if (this.startupCheckTimer) {
      clearTimeout(this.startupCheckTimer);
      this.startupCheckTimer = null;
    }

    // Clear progress throttle state
    this.clearPendingProgress();

    // Remove all IPC handlers
    for (const channel of this.registeredIpcChannels) {
      ipcMain.removeHandler(channel);
    }
    this.registeredIpcChannels.length = 0;

    // Remove all event listeners from autoUpdater
    if (this._autoUpdater && this._isInitialized) {
      // Cast autoUpdater to access generic removeListener
      const updater = this._autoUpdater as unknown as {
        removeListener: (
          event: string,
          handler: (...args: unknown[]) => void,
        ) => void;
      };
      for (const [event, handler] of this.boundHandlers) {
        updater.removeListener(event, handler);
      }
    }
    this.boundHandlers.clear();

    // Clear references
    this.mainWindowRef = null;
    this.cachedUpdateInfo = null;

    // Reset state flags
    this.isCheckingForUpdates = false;
    this.updateDownloaded = false;
    this.lastUpdateCheck = 0;

    // Clear singleton reference
    this._autoUpdater = null;
    this._isInitialized = false;

    log.info("[auto-updater] Service disposed");
  }

  /**
   * Reset singleton instance for testing purposes
   * @internal
   */
  static resetForTesting(): void {
    if (autoUpdaterService) {
      autoUpdaterService.dispose();
      autoUpdaterService = null;
    }
  }
}

// Singleton instance
let autoUpdaterService: AutoUpdaterService | null = null;

export function getAutoUpdaterService(): AutoUpdaterService {
  if (!autoUpdaterService) {
    autoUpdaterService = new AutoUpdaterService();
  }
  return autoUpdaterService;
}

/**
 * Get the singleton instance if it exists (for cleanup purposes)
 */
export function getAutoUpdaterServiceIfExists(): AutoUpdaterService | null {
  return autoUpdaterService;
}
