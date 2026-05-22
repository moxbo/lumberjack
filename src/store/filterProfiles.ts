/**
 * Filter Profiles Store - Persistente Speicherung von Filterkonfigurationen
 *
 * Uses IPC to persist profiles in a shared file on disk (via main process).
 * This ensures profiles are available across ALL windows, including those
 * running in separate Electron processes (multi-instance mode).
 *
 * Previous versions used localStorage + BroadcastChannel which only worked
 * within the same Electron process.
 */

import type { FilterState } from "../hooks";
import type { SearchMode } from "../utils/msgFilter";

/** Current schema version – bump when FilterProfile shape changes. */
export const CURRENT_SCHEMA_VERSION = 2;

/** Maximum number of profiles allowed. */
export const MAX_PROFILES = 100;

export interface FilterProfile {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Schema version for forward-compatible migrations. */
  schemaVersion: number;
  filters: {
    level: string;
    logger: string;
    thread: string;
    service: string;
    message: string;
    search: string;
    searchMode: SearchMode;
    stdFiltersEnabled: boolean;
    onlyMarked: boolean;
    mdcFilters?: Array<{ key: string; value: string; active: boolean }>;
  };
}

interface Listener {
  (): void;
}

class FilterProfilesStore {
  private profiles: Map<string, FilterProfile> = new Map();
  private listeners = new Set<Listener>();
  private initPromise: Promise<void>;
  /** Serialised save queue to prevent race conditions. */
  private saveQueue: Promise<void> = Promise.resolve();
  /** Last deleted profile for undo support. */
  private lastDeleted: FilterProfile | null = null;

  constructor() {
    // Start async initialization immediately and store the promise
    this.initPromise = this.initFromIpc();
    this.listenForCrossProcessChanges();
  }

  // ─── Initialisation ────────────────────────────────────────────────

  /**
   * Wait for initial load to complete
   */
  async waitForInit(): Promise<void> {
    await this.initPromise;
  }

  /**
   * Load profiles from the main process (file-based, shared across processes).
   * Falls back to localStorage for migration from older versions.
   */
  private async initFromIpc(): Promise<void> {
    try {
      if (window.api?.filterProfilesGetAll) {
        const result = await window.api.filterProfilesGetAll();
        if (result.ok && Array.isArray(result.profiles)) {
          this.profiles.clear();
          for (const profile of result.profiles as FilterProfile[]) {
            if (profile.id && profile.name) {
              this.profiles.set(
                profile.id,
                FilterProfilesStore.migrateProfile(profile),
              );
            }
          }

          // If file was empty, try migrating from localStorage
          if (this.profiles.size === 0) {
            this.migrateFromLocalStorage();
          }

          // Emit after loading - listeners may now be registered
          this.emit();
          return;
        }
      }
    } catch (e) {
      console.warn(
        "[FilterProfilesStore] IPC load failed, falling back to localStorage:",
        e,
      );
    }

    // Fallback: load from localStorage (old behavior / IPC unavailable)
    this.loadFromLocalStorage();
    // Emit after loading - listeners may now be registered
    this.emit();
  }

  /**
   * Migrate profiles from localStorage to file-based storage.
   * This runs once when the file doesn't exist yet but localStorage has profiles.
   */
  private migrateFromLocalStorage(): void {
    try {
      const stored = localStorage.getItem("lumberjack-filter-profiles");
      if (stored) {
        const data = JSON.parse(stored) as FilterProfile[];
        if (Array.isArray(data) && data.length > 0) {
          for (const profile of data) {
            if (profile.id && profile.name) {
              this.profiles.set(
                profile.id,
                FilterProfilesStore.migrateProfile(profile),
              );
            }
          }
          // Persist migrated profiles to file
          void this.enqueueSave();
          // Clean up localStorage after successful migration
          localStorage.removeItem("lumberjack-filter-profiles");
          console.warn(
            `[FilterProfilesStore] Migrated ${data.length} profiles from localStorage to file`,
          );
        }
      }
    } catch (e) {
      console.warn("[FilterProfilesStore] localStorage migration failed:", e);
    }
  }

  private loadFromLocalStorage(): void {
    try {
      const stored = localStorage.getItem("lumberjack-filter-profiles");
      if (stored) {
        const data = JSON.parse(stored) as FilterProfile[];
        this.profiles.clear();
        for (const profile of data) {
          this.profiles.set(
            profile.id,
            FilterProfilesStore.migrateProfile(profile),
          );
        }
      }
    } catch (e) {
      console.warn(
        "[FilterProfilesStore] Failed to load profiles from localStorage:",
        e,
      );
      this.profiles.clear();
    }
  }

  // ─── Cross-process sync ────────────────────────────────────────────

  /**
   * Listen for cross-process profile changes via IPC event.
   * When another window saves profiles, the main process notifies us.
   */
  private listenForCrossProcessChanges(): void {
    try {
      if (window.api?.onFilterProfilesChanged) {
        window.api.onFilterProfilesChanged(() => {
          void this.reloadFromIpc();
        });
      }
    } catch (e) {
      console.warn(
        "[FilterProfilesStore] Failed to listen for cross-process changes:",
        e,
      );
    }
  }

  /**
   * Reload profiles from file (triggered by cross-process notification).
   */
  private async reloadFromIpc(): Promise<void> {
    try {
      if (!window.api?.filterProfilesGetAll) return;
      const result = await window.api.filterProfilesGetAll();
      if (result.ok && Array.isArray(result.profiles)) {
        this.profiles.clear();
        for (const profile of result.profiles as FilterProfile[]) {
          if (profile.id && profile.name) {
            this.profiles.set(
              profile.id,
              FilterProfilesStore.migrateProfile(profile),
            );
          }
        }
        this.emit();
      }
    } catch (e) {
      console.warn("[FilterProfilesStore] Reload from IPC failed:", e);
    }
  }

  // ─── Persistence (save queue) ──────────────────────────────────────

  /**
   * Enqueue a save operation. Saves are serialised so that concurrent
   * mutations never interleave their IPC calls.
   */
  private enqueueSave(): Promise<void> {
    this.saveQueue = this.saveQueue
      .then(() => this.saveViaIpc())
      .catch((e) => {
        console.error("[FilterProfilesStore] Queued save failed:", e);
      });
    return this.saveQueue;
  }

  /**
   * Save profiles to file via IPC.
   */
  private async saveViaIpc(): Promise<void> {
    try {
      if (window.api?.filterProfilesSave) {
        const data = Array.from(this.profiles.values());
        const result = await window.api.filterProfilesSave(data);
        if (!result.ok) {
          console.error("[FilterProfilesStore] IPC save failed:", result.error);
          // Fallback: save to localStorage
          this.saveToLocalStorage();
        }
      } else {
        // Fallback: save to localStorage
        this.saveToLocalStorage();
      }
    } catch (e) {
      console.error("[FilterProfilesStore] Save failed:", e);
      this.saveToLocalStorage();
    }
  }

  private saveToLocalStorage(): void {
    try {
      const data = Array.from(this.profiles.values());
      localStorage.setItem("lumberjack-filter-profiles", JSON.stringify(data));
    } catch (e) {
      console.error("[FilterProfilesStore] localStorage save failed:", e);
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private emit(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch (e) {
        console.warn("[FilterProfilesStore] Listener error:", e);
      }
    }
  }

  private generateId(): string {
    return `fp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Create a snapshot of the current in-memory profiles (for rollback).
   */
  private snapshot(): Map<string, FilterProfile> {
    return new Map(this.profiles);
  }

  /**
   * Persist + emit with automatic rollback on IPC failure.
   */
  private persistAndEmit(snapshotBefore: Map<string, FilterProfile>): void {
    this.emit();
    void this.enqueueSave().catch(() => {
      // Rollback in-memory state on IPC failure
      this.profiles = snapshotBefore;
      this.emit();
    });
  }

  // ─── Schema migration ─────────────────────────────────────────────

  /**
   * Migrate a profile loaded from disk/IPC to the current schema.
   * Fills in missing fields with sensible defaults.
   */
  static migrateProfile(profile: FilterProfile): FilterProfile {
    const f = profile.filters ?? ({} as FilterProfile["filters"]);
    return {
      ...profile,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      filters: {
        level: f.level ?? "",
        logger: f.logger ?? "",
        thread: f.thread ?? "",
        service: f.service ?? "",
        message: f.message ?? "",
        search: f.search ?? "",
        searchMode: f.searchMode ?? "insensitive",
        stdFiltersEnabled: f.stdFiltersEnabled ?? true,
        onlyMarked: f.onlyMarked ?? false,
        mdcFilters: Array.isArray(f.mdcFilters) ? f.mdcFilters : [],
      },
    };
  }

  // ─── Public API ────────────────────────────────────────────────────

  /**
   * Subscribe to profile changes
   */
  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Get all profiles sorted by name
   */
  getAll(): FilterProfile[] {
    return Array.from(this.profiles.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  /**
   * Get a profile by ID
   */
  getById(id: string): FilterProfile | undefined {
    return this.profiles.get(id);
  }

  /**
   * Get a profile by name
   */
  getByName(name: string): FilterProfile | undefined {
    const normalized = name.trim().toLowerCase();
    for (const profile of this.profiles.values()) {
      if (profile.name.toLowerCase() === normalized) {
        return profile;
      }
    }
    return undefined;
  }

  /**
   * Check if a profile name exists
   */
  nameExists(name: string): boolean {
    return this.getByName(name) !== undefined;
  }

  /**
   * Save a new profile or update an existing one
   */
  saveProfile(
    name: string,
    filter: FilterState,
    search: string,
    stdFiltersEnabled: boolean,
    mdcFilters?: Array<{ key: string; value: string; active: boolean }>,
    searchMode?: SearchMode,
    onlyMarked?: boolean,
  ): FilterProfile {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error("Profile name is required");
    }

    // Check for existing profile with same name
    const existing = this.getByName(trimmedName);

    // Enforce max-profile limit for NEW profiles only
    if (!existing && this.profiles.size >= MAX_PROFILES) {
      throw new Error(
        `Maximum number of profiles (${MAX_PROFILES}) reached. Delete unused profiles first.`,
      );
    }

    const snap = this.snapshot();
    const now = Date.now();

    const profile: FilterProfile = {
      id: existing?.id ?? this.generateId(),
      name: trimmedName,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      filters: {
        level: filter.level,
        logger: filter.logger,
        thread: filter.thread,
        service: filter.service ?? "",
        message: filter.message,
        search,
        searchMode: searchMode ?? "insensitive",
        stdFiltersEnabled,
        onlyMarked: onlyMarked ?? false,
        // Nur aktive MDC-Einträge persistieren – inaktive (deselektierte) Einträge
        // verbleiben zwar im DiagnosticContextFilter-Speicher, gehören aber nicht
        // zum gewählten Filterzustand des Profils.
        mdcFilters: (mdcFilters ?? []).filter((m) => m && m.active),
      },
    };

    this.profiles.set(profile.id, profile);
    this.persistAndEmit(snap);

    return profile;
  }

  /**
   * Delete a profile by ID
   */
  deleteProfile(id: string): boolean {
    const profile = this.profiles.get(id);
    if (!profile) return false;

    // Store for undo before deleting
    this.lastDeleted = { ...profile, filters: { ...profile.filters } };

    const snap = this.snapshot();
    this.profiles.delete(id);
    this.persistAndEmit(snap);

    return true;
  }

  /**
   * Undo the last delete operation.
   * Returns the restored profile or null if there is nothing to undo.
   */
  undoDelete(): FilterProfile | null {
    if (!this.lastDeleted) return null;

    const profile = this.lastDeleted;
    this.lastDeleted = null;

    // Don't exceed max profiles
    if (this.profiles.size >= MAX_PROFILES) {
      return null;
    }

    const snap = this.snapshot();
    this.profiles.set(profile.id, profile);
    this.persistAndEmit(snap);

    return profile;
  }

  /**
   * Whether an undo-delete is available.
   */
  get canUndoDelete(): boolean {
    return this.lastDeleted !== null;
  }

  /**
   * Rename a profile
   */
  renameProfile(id: string, newName: string): FilterProfile | null {
    const profile = this.profiles.get(id);
    if (!profile) return null;

    const trimmedName = newName.trim();
    if (!trimmedName) {
      throw new Error("Profile name is required");
    }

    const existing = this.getByName(trimmedName);
    if (existing && existing.id !== id) {
      throw new Error("Profile name already exists");
    }

    const snap = this.snapshot();
    profile.name = trimmedName;
    profile.updatedAt = Date.now();
    this.persistAndEmit(snap);

    return profile;
  }

  /**
   * Duplicate a profile.
   * @returns the duplicated profile or null if the source was not found.
   */
  duplicateProfile(id: string): FilterProfile | null {
    const source = this.profiles.get(id);
    if (!source) return null;

    if (this.profiles.size >= MAX_PROFILES) {
      throw new Error(
        `Maximum number of profiles (${MAX_PROFILES}) reached. Delete unused profiles first.`,
      );
    }

    // Determine a unique copy name
    let copyName = `${source.name} (Copy)`;
    let counter = 2;
    while (this.getByName(copyName)) {
      copyName = `${source.name} (Copy ${counter})`;
      counter++;
    }

    const now = Date.now();
    const duplicate: FilterProfile = {
      id: this.generateId(),
      name: copyName,
      createdAt: now,
      updatedAt: now,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      filters: {
        ...source.filters,
        mdcFilters: [...(source.filters.mdcFilters ?? [])],
      },
    };

    const snap = this.snapshot();
    this.profiles.set(duplicate.id, duplicate);
    this.persistAndEmit(snap);

    return duplicate;
  }

  // ─── Export / Import ───────────────────────────────────────────────

  /**
   * Export all profiles as a JSON string (for sharing / backup).
   */
  exportProfiles(): string {
    return JSON.stringify(Array.from(this.profiles.values()), null, 2);
  }

  /**
   * Normalize parsed JSON into an array of profile-like objects.
   * Accepts: plain array, single object, or wrapper like {profiles: [...]}.
   */
  private static normalizeImportData(raw: unknown): unknown[] {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === "object") {
      // Support wrapper objects like { profiles: [...] } or { ok: true, profiles: [...] }
      const wrapped = (raw as Record<string, unknown>).profiles;
      if (Array.isArray(wrapped)) return wrapped;
      // Single profile object
      return [raw];
    }
    throw new Error("Invalid JSON: expected array or object");
  }

  /**
   * Extract a filters object from a profile, tolerating flat structures
   * where filter fields (level, logger, …) sit directly on the profile object
   * instead of being nested under a `filters` key.
   */
  private static extractFilters(
    profile: Record<string, unknown>,
  ): FilterProfile["filters"] | null {
    const f = profile.filters as Record<string, unknown> | undefined;
    if (f && typeof f === "object") {
      return {
        level: typeof f.level === "string" ? f.level : "",
        logger: typeof f.logger === "string" ? f.logger : "",
        thread: typeof f.thread === "string" ? f.thread : "",
        service: typeof f.service === "string" ? f.service : "",
        message: typeof f.message === "string" ? f.message : "",
        search: typeof f.search === "string" ? f.search : "",
        searchMode:
          typeof f.searchMode === "string" &&
          ["insensitive", "sensitive", "regex"].includes(f.searchMode)
            ? (f.searchMode as SearchMode)
            : "insensitive",
        stdFiltersEnabled:
          typeof f.stdFiltersEnabled === "boolean" ? f.stdFiltersEnabled : true,
        onlyMarked: typeof f.onlyMarked === "boolean" ? f.onlyMarked : false,
        mdcFilters: Array.isArray(f.mdcFilters) ? f.mdcFilters : [],
      };
    }
    // Fallback: try flat structure (filter fields directly on the profile)
    const hasAnyFilterField = [
      "level",
      "logger",
      "thread",
      "message",
      "search",
    ].some((k) => typeof profile[k] === "string" && profile[k] !== "");
    if (hasAnyFilterField) {
      return {
        level: typeof profile.level === "string" ? profile.level : "",
        logger: typeof profile.logger === "string" ? profile.logger : "",
        thread: typeof profile.thread === "string" ? profile.thread : "",
        service: typeof profile.service === "string" ? profile.service : "",
        message: typeof profile.message === "string" ? profile.message : "",
        search: typeof profile.search === "string" ? profile.search : "",
        searchMode:
          typeof profile.searchMode === "string" &&
          ["insensitive", "sensitive", "regex"].includes(
            profile.searchMode as string,
          )
            ? (profile.searchMode as SearchMode)
            : "insensitive",
        stdFiltersEnabled:
          typeof profile.stdFiltersEnabled === "boolean"
            ? profile.stdFiltersEnabled
            : true,
        onlyMarked:
          typeof profile.onlyMarked === "boolean" ? profile.onlyMarked : false,
        mdcFilters: Array.isArray(profile.mdcFilters) ? profile.mdcFilters : [],
      };
    }
    return null;
  }

  /**
   * Import profiles from a JSON string.
   * @param json - JSON array of FilterProfile objects
   * @param overwrite - if true, overwrite existing profiles with the same name
   * @returns number of imported profiles
   */
  importProfiles(json: string, overwrite = false): number {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error("Invalid JSON");
    }

    const data = FilterProfilesStore.normalizeImportData(parsed);
    if (data.length === 0) throw new Error("Empty data");

    let imported = 0;
    let skippedExisting = 0;
    let skippedInvalid = 0;

    for (const item of data) {
      const profile = item as Record<string, unknown>;
      if (!profile || typeof profile !== "object") {
        skippedInvalid++;
        continue;
      }

      const name = typeof profile.name === "string" ? profile.name.trim() : "";
      if (!name) {
        skippedInvalid++;
        continue;
      }

      const filters = FilterProfilesStore.extractFilters(profile);
      if (!filters) {
        skippedInvalid++;
        continue;
      }

      const existing = this.getByName(name);
      if (existing && !overwrite) {
        skippedExisting++;
        continue;
      }

      // Enforce max-profile limit (only for genuinely new profiles)
      if (!existing && this.profiles.size >= MAX_PROFILES) {
        break; // stop importing – limit reached
      }

      const newProfile: FilterProfile = {
        id:
          existing?.id ??
          (typeof profile.id === "string" ? profile.id : this.generateId()),
        name,
        createdAt:
          existing?.createdAt ??
          (typeof profile.createdAt === "number"
            ? profile.createdAt
            : Date.now()),
        updatedAt: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
        filters,
      };
      this.profiles.set(newProfile.id, newProfile);
      imported++;
    }

    if (imported > 0) {
      void this.enqueueSave();
      this.emit();
    }

    // Provide a helpful diagnostic when nothing was imported
    if (imported === 0) {
      if (skippedExisting > 0 && skippedInvalid === 0) {
        throw new Error(
          `All ${skippedExisting} profile(s) already exist. Enable "overwrite" to update them.`,
        );
      }
      if (skippedInvalid > 0) {
        throw new Error(
          `${skippedInvalid} profile(s) skipped: missing name or filter data.`,
        );
      }
    }

    return imported;
  }
}

// Singleton instance
export const filterProfilesStore = new FilterProfilesStore();
