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

export interface FilterProfile {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  filters: {
    level: string;
    logger: string;
    thread: string;
    message: string;
    search: string;
    stdFiltersEnabled: boolean;
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

  constructor() {
    // Start async initialization immediately and store the promise
    this.initPromise = this.initFromIpc();
    this.listenForCrossProcessChanges();
  }

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
              this.profiles.set(profile.id, profile);
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
              this.profiles.set(profile.id, profile);
            }
          }
          // Persist migrated profiles to file
          void this.saveViaIpc();
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
          this.profiles.set(profile.id, profile);
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
            this.profiles.set(profile.id, profile);
          }
        }
        this.emit();
      }
    } catch (e) {
      console.warn("[FilterProfilesStore] Reload from IPC failed:", e);
    }
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
  ): FilterProfile {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error("Profile name is required");
    }

    // Check for existing profile with same name
    const existing = this.getByName(trimmedName);
    const now = Date.now();

    const profile: FilterProfile = {
      id: existing?.id ?? this.generateId(),
      name: trimmedName,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      filters: {
        level: filter.level,
        logger: filter.logger,
        thread: filter.thread,
        message: filter.message,
        search,
        stdFiltersEnabled,
        mdcFilters: mdcFilters ?? [],
      },
    };

    this.profiles.set(profile.id, profile);
    void this.saveViaIpc();
    this.emit();

    return profile;
  }

  /**
   * Delete a profile by ID
   */
  deleteProfile(id: string): boolean {
    const deleted = this.profiles.delete(id);
    if (deleted) {
      void this.saveViaIpc();
      this.emit();
    }
    return deleted;
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

    profile.name = trimmedName;
    profile.updatedAt = Date.now();
    void this.saveViaIpc();
    this.emit();

    return profile;
  }

  /**
   * Export all profiles as a JSON string (for sharing / backup).
   */
  exportProfiles(): string {
    return JSON.stringify(Array.from(this.profiles.values()), null, 2);
  }

  /**
   * Import profiles from a JSON string.
   * @param json - JSON array of FilterProfile objects
   * @param overwrite - if true, overwrite existing profiles with the same name
   * @returns number of imported profiles
   */
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
        message: typeof f.message === "string" ? f.message : "",
        search: typeof f.search === "string" ? f.search : "",
        stdFiltersEnabled:
          typeof f.stdFiltersEnabled === "boolean" ? f.stdFiltersEnabled : true,
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
        message: typeof profile.message === "string" ? profile.message : "",
        search: typeof profile.search === "string" ? profile.search : "",
        stdFiltersEnabled:
          typeof profile.stdFiltersEnabled === "boolean"
            ? profile.stdFiltersEnabled
            : true,
        mdcFilters: Array.isArray(profile.mdcFilters) ? profile.mdcFilters : [],
      };
    }
    return null;
  }

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
        filters,
      };
      this.profiles.set(newProfile.id, newProfile);
      imported++;
    }

    if (imported > 0) {
      void this.saveViaIpc();
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
