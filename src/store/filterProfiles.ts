/**
 * Filter Profiles Store - Persistente Speicherung von Filterkonfigurationen
 */

import type { FilterState } from "../hooks";

const STORAGE_KEY = "lumberjack-filter-profiles";

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

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored) as FilterProfile[];
        this.profiles.clear();
        for (const profile of data) {
          this.profiles.set(profile.id, profile);
        }
      }
    } catch (e) {
      console.warn("[FilterProfilesStore] Failed to load profiles:", e);
      this.profiles.clear();
    }
  }

  private save(): void {
    try {
      const data = Array.from(this.profiles.values());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error("[FilterProfilesStore] Failed to save profiles:", e);
      throw e;
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
    this.save();
    this.emit();

    return profile;
  }

  /**
   * Delete a profile by ID
   */
  deleteProfile(id: string): boolean {
    const deleted = this.profiles.delete(id);
    if (deleted) {
      this.save();
      this.emit();
    }
    return deleted;
  }

  /**
   * Delete a profile by name
   */
  deleteProfileByName(name: string): boolean {
    const profile = this.getByName(name);
    if (profile) {
      return this.deleteProfile(profile.id);
    }
    return false;
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

    // Check if new name already exists (excluding current profile)
    const existing = this.getByName(trimmedName);
    if (existing && existing.id !== id) {
      throw new Error("Profile name already exists");
    }

    profile.name = trimmedName;
    profile.updatedAt = Date.now();
    this.save();
    this.emit();

    return profile;
  }

  /**
   * Clear all profiles
   */
  clearAll(): void {
    this.profiles.clear();
    this.save();
    this.emit();
  }

  /**
   * Export all profiles as JSON
   */
  exportProfiles(): string {
    return JSON.stringify(Array.from(this.profiles.values()), null, 2);
  }

  /**
   * Import profiles from JSON
   */
  importProfiles(json: string, overwrite = false): number {
    const data = JSON.parse(json) as FilterProfile[];
    let imported = 0;

    for (const profile of data) {
      if (!profile.name || !profile.filters) continue;

      if (overwrite || !this.nameExists(profile.name)) {
        const newProfile: FilterProfile = {
          id: this.generateId(),
          name: profile.name,
          createdAt: profile.createdAt ?? Date.now(),
          updatedAt: Date.now(),
          filters: {
            level: profile.filters.level ?? "",
            logger: profile.filters.logger ?? "",
            thread: profile.filters.thread ?? "",
            message: profile.filters.message ?? "",
            search: profile.filters.search ?? "",
            stdFiltersEnabled: profile.filters.stdFiltersEnabled ?? true,
            mdcFilters: profile.filters.mdcFilters ?? [],
          },
        };
        this.profiles.set(newProfile.id, newProfile);
        imported++;
      }
    }

    if (imported > 0) {
      this.save();
      this.emit();
    }

    return imported;
  }
}

// Singleton instance
export const filterProfilesStore = new FilterProfilesStore();
