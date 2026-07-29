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
  locale: "en",
  histLogger: [],
  // NEW histories for ElasticSearch dialog
  histAppName: [],
  histEnvironment: [],
  // NEW: Index history
  histIndex: [],
  // NEW: last environment-case used in Elastic dialog
  lastEnvironmentCase: "original",
  // NEW: last used timestamp field for the ES time-range filter (empty => @timestamp)
  lastTimestampField: "",
  httpUrl: "",
  httpPollInterval: 5, // Interval in seconds
  httpTailEmitInitial: false,
  httpTailAllowInsecureSSL: false,
  httpAuthHeaderEnc: "",
  elasticMaxParallel: 1,
  // Auto-Update
  allowPrerelease: false,
  // Performance / Memory - heap size in MB (requires restart)
  heapSizeMB: 4096,
};

/**
 * Settings validation result
 */
interface ValidationResult {
  success: boolean;
  error?: string;
}

/**
 * A lock file older than this is considered stale (left behind by a crashed
 * instance) and may be stolen.
 */
const LOCK_STALE_MS = 5000;

/**
 * SettingsService manages application settings
 */
export class SettingsService {
  private settings: Settings;
  // Last state this instance knows to be persisted on disk. Used to compute a
  // minimal delta on save so concurrent instances don't clobber each other.
  private baseline: Settings;
  private _settingsPath: string | null = null;
  private loaded = false;

  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.baseline = { ...DEFAULT_SETTINGS };
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
      // marksMap is session-only (ephemeral) - don't load from persisted settings
      if ("marksMap" in parsed) {
        delete parsed.marksMap;
      }

      // Merge with defaults to ensure all required fields exist
      this.settings = { ...DEFAULT_SETTINGS, ...parsed } as Settings;
      this.baseline = structuredClone(this.settings);
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
      // marksMap is session-only (ephemeral) - don't load from persisted settings
      if ("marksMap" in parsed) {
        delete (parsed as Record<string, unknown>)["marksMap"];
      }
      this.settings = { ...DEFAULT_SETTINGS, ...parsed } as Settings;
      this.baseline = structuredClone(this.settings);
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
   * Compute the keys this instance actually changed since it last read/wrote
   * the settings file. Only these keys are written on save, so a concurrent
   * instance that changed *other* keys is never clobbered. marksMap is
   * session-only and always excluded.
   */
  private computeLocalDelta(): Record<string, unknown> {
    const cur = this.settings as unknown as Record<string, unknown>;
    const base = this.baseline as unknown as Record<string, unknown>;
    const delta: Record<string, unknown> = {};
    const keys = new Set<string>([...Object.keys(cur), ...Object.keys(base)]);
    for (const key of keys) {
      if (key === "marksMap") continue;
      if (JSON.stringify(cur[key]) !== JSON.stringify(base[key])) {
        delta[key] = cur[key];
      }
    }
    return delta;
  }

  /**
   * Read the currently persisted settings from disk (best effort).
   */
  private readPersistedSync(): Settings {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const raw = fs.readFileSync(this.settingsPath, "utf8");
        return {
          ...DEFAULT_SETTINGS,
          ...(JSON.parse(raw) as Partial<Settings>),
        } as Settings;
      }
    } catch (e) {
      log.warn(
        "[settings] Could not read persisted settings for merge (sync):",
        e instanceof Error ? e.message : String(e),
      );
    }
    return { ...DEFAULT_SETTINGS };
  }

  private async readPersistedAsync(): Promise<Settings> {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const raw = await fs.promises.readFile(this.settingsPath, "utf8");
        return {
          ...DEFAULT_SETTINGS,
          ...(JSON.parse(raw) as Partial<Settings>),
        } as Settings;
      }
    } catch (e) {
      log.warn(
        "[settings] Could not read persisted settings for merge (async):",
        e instanceof Error ? e.message : String(e),
      );
    }
    return { ...DEFAULT_SETTINGS };
  }

  /**
   * Merge this instance's local delta on top of the current on-disk state.
   * Returns the merged settings (without marksMap) ready to persist.
   */
  private buildMerged(prev: Settings): Settings {
    const delta = this.computeLocalDelta();
    const mergedNoMarks = { ...prev, ...delta } as Record<string, unknown>;
    delete mergedNoMarks.marksMap;
    return { ...DEFAULT_SETTINGS, ...mergedNoMarks } as Settings;
  }

  /**
   * Adopt the freshly persisted merged state as the new in-memory truth.
   * This also picks up changes other instances made to keys we didn't touch,
   * and resets the baseline so the next save produces a correct delta. The
   * ephemeral marksMap is preserved.
   */
  private adoptMerged(merged: Settings): void {
    const marks = (this.settings as Settings & { marksMap?: unknown }).marksMap;
    this.settings =
      marks !== undefined
        ? ({ ...merged, marksMap: marks } as Settings)
        : merged;
    this.baseline = structuredClone(merged);
  }

  private get lockPath(): string {
    return this.settingsPath + ".lock";
  }

  private static sleepSync(ms: number): void {
    try {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    } catch {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        /* busy wait fallback */
      }
    }
  }

  /**
   * Acquire an exclusive cross-process lock for the settings file. Stale locks
   * (left behind by a crashed instance) are stolen. Returns the open fd, or
   * null if the lock could not be acquired (in which case the caller proceeds
   * best-effort — the merge + atomic write still prevents corruption).
   */
  private acquireLockSync(maxWaitMs = 1500): number | null {
    const start = Date.now();
    for (;;) {
      try {
        const fd = fs.openSync(this.lockPath, "wx");
        try {
          fs.writeSync(fd, String(process.pid));
        } catch {
          /* ignore */
        }
        return fd;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") return null;
        try {
          const st = fs.statSync(this.lockPath);
          if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
            fs.unlinkSync(this.lockPath);
            continue;
          }
        } catch {
          /* lock vanished – retry */
        }
        if (Date.now() - start > maxWaitMs) return null;
        SettingsService.sleepSync(15);
      }
    }
  }

  private releaseLockSync(fd: number | null): void {
    if (fd === null) return;
    try {
      fs.closeSync(fd);
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(this.lockPath);
    } catch {
      /* ignore */
    }
  }

  private async acquireLockAsync(
    maxWaitMs = 1500,
  ): Promise<fs.promises.FileHandle | null> {
    const start = Date.now();
    for (;;) {
      try {
        const fh = await fs.promises.open(this.lockPath, "wx");
        try {
          await fh.writeFile(String(process.pid));
        } catch {
          /* ignore */
        }
        return fh;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") return null;
        try {
          const st = await fs.promises.stat(this.lockPath);
          if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
            await fs.promises.unlink(this.lockPath).catch(() => {});
            continue;
          }
        } catch {
          /* lock vanished – retry */
        }
        if (Date.now() - start > maxWaitMs) return null;
        await new Promise((r) => setTimeout(r, 15));
      }
    }
  }

  private async releaseLockAsync(
    fh: fs.promises.FileHandle | null,
  ): Promise<void> {
    if (!fh) return;
    try {
      await fh.close();
    } catch {
      /* ignore */
    }
    try {
      await fs.promises.unlink(this.lockPath);
    } catch {
      /* ignore */
    }
  }

  /**
   * Save settings to disk (async).
   *
   * Multi-instance safe: the file is read again under a cross-process lock,
   * this instance's delta is merged on top and the result is written
   * atomically (temp file + rename). This prevents one instance from
   * overwriting settings.json changes made by another instance.
   */
  async save(): Promise<boolean> {
    const fh = await this.acquireLockAsync();
    if (!fh) {
      log.warn(
        "[settings] Saving without lock (could not acquire) – async merge best-effort",
      );
    }
    try {
      const prev = await this.readPersistedAsync();
      const merged = this.buildMerged(prev);
      const json = JSON.stringify(merged, null, 2);
      const dir = path.dirname(this.settingsPath);
      await fs.promises.mkdir(dir, { recursive: true });
      const tmp = `${this.settingsPath}.tmp-${process.pid}`;
      await fs.promises.writeFile(tmp, json, "utf8");
      await fs.promises.rename(tmp, this.settingsPath);

      this.adoptMerged(merged);
      this.logDelta(prev, merged, "async");
      return true;
    } catch (err) {
      log.error(
        "Error saving settings:",
        err instanceof Error ? err.message : String(err),
      );
      return false;
    } finally {
      await this.releaseLockAsync(fh);
    }
  }

  /**
   * Save settings synchronously (multi-instance safe, see save()).
   */
  saveSync(): boolean {
    const fd = this.acquireLockSync();
    if (fd === null) {
      log.warn(
        "[settings] Saving without lock (could not acquire) – sync merge best-effort",
      );
    }
    try {
      const prev = this.readPersistedSync();
      const merged = this.buildMerged(prev);
      const json = JSON.stringify(merged, null, 2);
      const dir = path.dirname(this.settingsPath);
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${this.settingsPath}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, json, "utf8");
      fs.renameSync(tmp, this.settingsPath);

      this.adoptMerged(merged);
      this.logDelta(prev, merged, "sync");
      return true;
    } catch (err) {
      log.error(
        "Error saving settings sync:",
        err instanceof Error ? err.message : String(err),
      );
      return false;
    } finally {
      this.releaseLockSync(fd);
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
    // Node 22+/Chrome 134+: structuredClone ist schneller als JSON.parse/stringify
    const result = structuredClone(this.settings);
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

    if (settings.heapSizeMB !== undefined) {
      const v = Number(settings.heapSizeMB);
      if (!Number.isFinite(v) || v < 512 || v > 8192) {
        return {
          success: false,
          error: "heapSizeMB must be between 512 and 8192",
        };
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
