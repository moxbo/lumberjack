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
 */

import {
  autoUpdater,
  type UpdateInfo,
  type ProgressInfo,
} from "electron-updater";
import { app, BrowserWindow, ipcMain } from "electron";
import log from "electron-log/main";

// Configure electron-updater to use electron-log
autoUpdater.logger = log;

export interface UpdateStatus {
  status:
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "error";
  info?: UpdateInfo;
  progress?: ProgressInfo;
  error?: string;
}

export class AutoUpdaterService {
  private mainWindow: BrowserWindow | null = null;
  private isCheckingForUpdates = false;
  private updateDownloaded = false;

  constructor() {
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

    // Configure GitHub token for private repositories
    // Token can be set via GH_TOKEN or GITHUB_TOKEN environment variable
    // or via app settings (stored securely)
    this.configurePrivateRepoAccess();

    this.setupEventHandlers();
    this.setupIpcHandlers();

    log.info("[auto-updater] Service initialized", {
      currentVersion: autoUpdater.currentVersion?.version || "unknown",
      allowPrerelease: autoUpdater.allowPrerelease,
      hasToken: !!process.env.GH_TOKEN || !!process.env.GITHUB_TOKEN,
    });
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
      log.info(
        "[auto-updater] GitHub token configured for private repo access",
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
    autoUpdater.allowPrerelease = allow;
    log.info("[auto-updater] allowPrerelease set to:", allow);
  }

  /**
   * Get current pre-release setting
   */
  getAllowPrerelease(): boolean {
    return autoUpdater.allowPrerelease;
  }

  /**
   * Set the main window for sending update notifications
   */
  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  /**
   * Setup electron-updater event handlers
   */
  private setupEventHandlers(): void {
    autoUpdater.on("checking-for-update", () => {
      log.info("[auto-updater] Checking for updates...");
      this.sendStatusToRenderer({ status: "checking" });
    });

    autoUpdater.on("update-available", (info: UpdateInfo) => {
      log.info("[auto-updater] Update available:", info.version);
      this.sendStatusToRenderer({ status: "available", info });
    });

    autoUpdater.on("update-not-available", (info: UpdateInfo) => {
      log.info(
        "[auto-updater] No update available. Current version:",
        info.version,
      );
      this.sendStatusToRenderer({ status: "not-available", info });
    });

    autoUpdater.on("download-progress", (progress: ProgressInfo) => {
      log.debug(
        `[auto-updater] Download progress: ${progress.percent.toFixed(1)}% ` +
          `(${(progress.bytesPerSecond / 1024 / 1024).toFixed(2)} MB/s)`,
      );
      this.sendStatusToRenderer({ status: "downloading", progress });
    });

    autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
      log.info("[auto-updater] Update downloaded:", info.version);
      this.updateDownloaded = true;
      this.sendStatusToRenderer({ status: "downloaded", info });
    });

    autoUpdater.on("error", (error: Error) => {
      log.error("[auto-updater] Error:", error.message);
      this.sendStatusToRenderer({ status: "error", error: error.message });
    });
  }

  /**
   * Setup IPC handlers for renderer communication
   */
  private setupIpcHandlers(): void {
    // Check for updates manually
    ipcMain.handle("auto-updater:check", async () => {
      return this.checkForUpdates();
    });

    // Download available update
    ipcMain.handle("auto-updater:download", async () => {
      return this.downloadUpdate();
    });

    // Install downloaded update (restart app)
    ipcMain.handle("auto-updater:install", () => {
      return this.installUpdate();
    });

    // Get current update status
    ipcMain.handle("auto-updater:status", () => {
      return {
        updateDownloaded: this.updateDownloaded,
        isChecking: this.isCheckingForUpdates,
        allowPrerelease: autoUpdater.allowPrerelease,
      };
    });

    // Get/Set pre-release setting
    ipcMain.handle("auto-updater:getAllowPrerelease", () => {
      return this.getAllowPrerelease();
    });

    ipcMain.handle(
      "auto-updater:setAllowPrerelease",
      (_event, allow: boolean) => {
        this.setAllowPrerelease(allow);
        return { ok: true };
      },
    );
  }

  /**
   * Check for available updates
   */
  async checkForUpdates(): Promise<UpdateInfo | null> {
    if (this.isCheckingForUpdates) {
      log.warn("[auto-updater] Already checking for updates");
      return null;
    }

    try {
      this.isCheckingForUpdates = true;
      const result = await autoUpdater.checkForUpdates();
      return result?.updateInfo ?? null;
    } catch (error) {
      log.error("[auto-updater] Check failed:", error);
      return null;
    } finally {
      this.isCheckingForUpdates = false;
    }
  }

  /**
   * Download available update
   */
  async downloadUpdate(): Promise<void> {
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      log.error("[auto-updater] Download failed:", error);
      throw error;
    }
  }

  /**
   * Install downloaded update and restart app
   */
  installUpdate(): void {
    if (!this.updateDownloaded) {
      log.warn("[auto-updater] No update downloaded to install");
      return;
    }

    log.info("[auto-updater] Installing update and restarting...");
    autoUpdater.quitAndInstall(false, true);
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
      `[auto-updater] Will check for updates in ${delayMs / 1000}s (hasToken: ${hasToken})`,
    );

    setTimeout(() => {
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
}

// Singleton instance
let autoUpdaterService: AutoUpdaterService | null = null;

export function getAutoUpdaterService(): AutoUpdaterService {
  if (!autoUpdaterService) {
    autoUpdaterService = new AutoUpdaterService();
  }
  return autoUpdaterService;
}
