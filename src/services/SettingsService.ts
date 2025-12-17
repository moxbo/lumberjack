/**
 * SettingsService
 * Manages application settings with validation, persistence, and encryption
 */

import type { Settings } from "../types/ipc";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { app, safeStorage } from "electron";
import log from "electron-log/main";

/**
 * Default settings values
 */
const DEFAULT_SETTINGS: Settings = {
  windowBounds: {
    width: 1200,
    height: 800,
  },
  isMaximized: false,
  tcpPort: 4445,
  logToFile: false,
  logFilePath: "",
  logMaxBytes: 10 * 1024 * 1024, // 10 MB
  logMaxBackups: 3,
  elasticUrl: "",
  elasticUser: "",
  elasticPassEnc: "",
  elasticSize: 10000,
  themeMode: "system",
  // NEW: default UI language
  locale: "de",
  histLogger: [],
  // NEW histories for ElasticSearch dialog
  histAppName: [],
  histEnvironment: [],
  // NEW: Index history
  histIndex: [],
  // NEW: last environment-case used in Elastic dialog
  lastEnvironmentCase: "original",
  httpUrl: "",
  httpPollInterval: 5, // Interval in seconds
  elasticMaxParallel: 1,
  // Auto-Update
  allowPrerelease: false,
};

/**
 * Settings validation result
 */
interface ValidationResult {
  success: boolean;
  error?: string;
}

/**
 * SettingsService manages application settings
 */
export class SettingsService {
  private settings: Settings;
  private _settingsPath: string | null = null;
  private loaded = false;

  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
  }

  /**
   * Get settings file path (lazy-resolved to ensure app is ready)
   */
  private get settingsPath(): string {
    if (this._settingsPath) {
      return this._settingsPath;
    }
    this._settingsPath = this.resolveSettingsPath();
    log.info("[settings] Resolved settings path:", this._settingsPath);
    return this._settingsPath;
  }

  /**
   * Resolve settings file path (portable vs. standard)
   */
  private resolveSettingsPath(): string {
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
    if (portableDir && portableDir.length) {
      return path.join(portableDir, "data", "settings.json");
    }
    try {
      if (app && typeof app.getPath === "function") {
        const userDataPath = app.getPath("userData");
        if (userDataPath) {
          return path.join(userDataPath, "settings.json");
        }
      }
    } catch (err) {
      log.warn(
        "[settings] app.getPath('userData') failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
    // Fallback für Nicht-Electron-Testkontexte
    log.warn("[settings] Using fallback path (process.cwd)");
    return path.join(process.cwd(), ".test-settings", "settings.json");
  }

  /**
   * Load settings from disk asynchronously
   */
  async load(): Promise<void> {
    try {
      if (!fs.existsSync(this.settingsPath)) {
        log.info("Settings file not found, using defaults");
        this.loaded = true;
        return;
      }

      const raw = await fs.promises.readFile(this.settingsPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<Settings> &
        Record<string, unknown>;
      // Entferne veraltete Schlüssel, die nicht mehr unterstützt werden
      if ("windowTitle" in parsed) {
        delete parsed.windowTitle;
      }

      // Merge with defaults to ensure all required fields exist
      this.settings = { ...DEFAULT_SETTINGS, ...parsed } as Settings;
      this.loaded = true;
      log.info("Settings loaded successfully from", this.settingsPath);
    } catch (err) {
      log.error(
        "Error loading settings:",
        err instanceof Error ? err.message : String(err),
      );
      log.info("Using default settings");
      this.loaded = true;
    }
  }

  /**
   * Load settings synchronously (for emergency/startup use only)
   */
  loadSync(): void {
    try {
      log.info("[settings] loadSync() called, path:", this.settingsPath);
      if (!fs.existsSync(this.settingsPath)) {
        log.info("[settings] loadSync(): File not found, using defaults");
        this.loaded = true;
        return;
      }

      const raw = fs.readFileSync(this.settingsPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<Settings> &
        Record<string, unknown>;
      log.info(
        "[settings] loadSync(): parsed httpUrl:",
        (parsed as any).httpUrl || "(empty)",
      );
      // Entferne veraltete Schlüssel
      if ("windowTitle" in parsed) {
        delete (parsed as Record<string, unknown>)["windowTitle"];
      }
      this.settings = { ...DEFAULT_SETTINGS, ...parsed } as Settings;
      log.info(
        "[settings] loadSync(): merged httpUrl:",
        this.settings.httpUrl || "(empty)",
      );
      this.loaded = true;
    } catch (err) {
      log.error(
        "Error loading settings sync:",
        err instanceof Error ? err.message : String(err),
      );
      this.loaded = true;
    }
  }

  /**
   * Save settings to disk
   */
  async save(): Promise<boolean> {
    try {
      // Vorherigen persistierten Zustand laden (falls vorhanden)
      let prev: Settings | null = null;
      try {
        if (fs.existsSync(this.settingsPath)) {
          const rawPrev = await fs.promises.readFile(this.settingsPath, "utf8");
          prev = {
            ...DEFAULT_SETTINGS,
            ...(JSON.parse(rawPrev) as Partial<Settings>),
          } as Settings;
        }
      } catch (e) {
        log.warn(
          "[settings] Could not read previous settings for delta (async):",
          e instanceof Error ? e.message : String(e),
        );
      }

      const json = JSON.stringify(this.settings, null, 2);
      const dir = path.dirname(this.settingsPath);
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(this.settingsPath, json, "utf8");

      this.logDelta(prev, this.settings, "async");
      return true;
    } catch (err) {
      log.error(
        "Error saving settings:",
        err instanceof Error ? err.message : String(err),
      );
      return false;
    }
  }

  /**
   * Save settings synchronously
   */
  saveSync(): boolean {
    try {
      let prev: Settings | null = null;
      try {
        if (fs.existsSync(this.settingsPath)) {
          const rawPrev = fs.readFileSync(this.settingsPath, "utf8");
          prev = {
            ...DEFAULT_SETTINGS,
            ...(JSON.parse(rawPrev) as Partial<Settings>),
          } as Settings;
        }
      } catch (e) {
        log.warn(
          "[settings] Could not read previous settings for delta (sync):",
          e instanceof Error ? e.message : String(e),
        );
      }
      const json = JSON.stringify(this.settings, null, 2);
      const dir = path.dirname(this.settingsPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.settingsPath, json, "utf8");

      this.logDelta(prev, this.settings, "sync");
      return true;
    } catch (err) {
      log.error(
        "Error saving settings sync:",
        err instanceof Error ? err.message : String(err),
      );
      return false;
    }
  }

  /**
   * Vergleicht vorherigen (persistierten) Zustand mit aktuellem und loggt Delta
   */
  private logDelta(
    prev: Settings | null,
    next: Settings,
    mode: "async" | "sync",
  ): void {
    try {
      if (!prev) {
        log.info(`[settings] Initial settings ${mode} persisted`);
        return;
      }
      const changes: Record<string, { alpha: unknown; delta: unknown }> = {};
      const allKeys = new Set<string>([
        ...Object.keys(prev),
        ...Object.keys(next),
      ]);
      for (const key of allKeys) {
        const alphaVal = (prev as unknown as Record<string, unknown>)[key];
        const deltaVal = (next as unknown as Record<string, unknown>)[key];
        if (JSON.stringify(alphaVal) !== JSON.stringify(deltaVal)) {
          changes[key] = { alpha: alphaVal, delta: deltaVal };
        }
      }
      if (Object.keys(changes).length) {
        log.info(`[settings] Configuration changed (${mode} save)`, {
          changes,
        });
      } else {
        log.info(`[settings] No changes (${mode} save)`);
      }
    } catch (e) {
      log.warn(
        "[settings] Delta logging failed:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  /**
   * Get current settings (deep copy to prevent mutations)
   */
  get(): Settings {
    if (!this.loaded) {
      log.info(
        "[settings] get() called but not loaded yet, calling loadSync()",
      );
      this.loadSync();
    }
    const result = JSON.parse(JSON.stringify(this.settings)) as Settings;
    log.debug(
      "[settings] get() returning settings with httpUrl:",
      result.httpUrl || "(empty)",
    );
    return result;
  }

  /**
   * Update settings with a partial patch
   */
  update(patch: Partial<Settings>): Settings {
    if (!this.loaded) {
      this.loadSync();
    }

    // Entferne veraltete Schlüssel aus Patches
    try {
      if (patch && typeof patch === "object" && "windowTitle" in patch) {
        delete (patch as Record<string, unknown>)["windowTitle"];
      }
    } catch (e) {
      log.warn(
        "Failed to strip legacy windowTitle from settings patch:",
        e instanceof Error ? e.message : String(e),
      );
    }

    // Merge patch into current settings
    this.settings = { ...this.settings, ...patch } as Settings;

    return this.get();
  }

  /**
   * Validate settings
   */
  validate(settings: Partial<Settings>): ValidationResult {
    // Add validation logic here
    if (settings.logMaxBytes !== undefined && settings.logMaxBytes < 0) {
      return { success: false, error: "logMaxBytes must be >= 0" };
    }

    if (settings.logMaxBackups !== undefined && settings.logMaxBackups < 0) {
      return { success: false, error: "logMaxBackups must be >= 0" };
    }

    if (
      settings.tcpPort !== undefined &&
      (settings.tcpPort < 1 || settings.tcpPort > 65535)
    ) {
      return { success: false, error: "tcpPort must be between 1 and 65535" };
    }

    if (settings.elasticMaxParallel !== undefined) {
      const v = Number(settings.elasticMaxParallel);
      if (!Number.isFinite(v) || v < 1) {
        return { success: false, error: "elasticMaxParallel must be >= 1" };
      }
    }

    return { success: true };
  }

  /**
   * Encrypt a secret using Electron's safeStorage or fallback to AES
   */
  encryptSecret(plaintext: string): string {
    try {
      // Try Electron safeStorage first
      if (
        safeStorage &&
        typeof safeStorage.isEncryptionAvailable === "function" &&
        safeStorage.isEncryptionAvailable()
      ) {
        const buf = safeStorage.encryptString(plaintext);
        return "ss1:" + Buffer.from(buf).toString("base64");
      }
    } catch (err) {
      log.warn("safeStorage encryption failed, falling back to AES:", err);
    }

    // Fallback to AES-256-GCM
    try {
      const key = crypto
        .createHash("sha256")
        .update(app.getPath("userData") + "|lumberjack")
        .digest();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const enc = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      return "gcm1:" + Buffer.concat([iv, tag, enc]).toString("base64");
    } catch (err) {
      log.error("AES encryption failed:", err);
      return "";
    }
  }

  /**
   * Decrypt a secret
   */
  decryptSecret(encrypted: string): string {
    if (!encrypted) return "";

    try {
      if (encrypted.startsWith("ss1:")) {
        const b = Buffer.from(encrypted.slice(4), "base64");
        if (safeStorage && typeof safeStorage.decryptString === "function") {
          return safeStorage.decryptString(b);
        }
        return "";
      }

      if (encrypted.startsWith("gcm1:")) {
        const buf = Buffer.from(encrypted.slice(5), "base64");
        const iv = buf.subarray(0, 12);
        const tag = buf.subarray(12, 28);
        const data = buf.subarray(28);
        const key = crypto
          .createHash("sha256")
          .update(app.getPath("userData") + "|lumberjack")
          .digest();
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([
          decipher.update(data),
          decipher.final(),
        ]).toString("utf8");
      }
    } catch (err) {
      log.error("Decryption failed:", err);
      return "";
    }

    return "";
  }

  /**
   * Get default settings
   */
  static getDefaults(): Settings {
    return { ...DEFAULT_SETTINGS };
  }
}
