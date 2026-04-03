/**
 * Hook for managing filter profiles
 *
 * Features:
 * - CRUD operations (save, load, delete, rename, duplicate)
 * - Active profile tracking with dirty detection
 * - Undo last delete
 * - Import / Export (JSON)
 * - Profile search (client-side filtering)
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import {
  type FilterProfile,
  filterProfilesStore,
} from "../store/filterProfiles";
import type { FilterState } from "./useFilterState";
import type { SearchMode } from "../utils/msgFilter";

export interface UseFilterProfilesReturn {
  /** All profiles (optionally filtered by `profileSearch`). */
  profiles: FilterProfile[];
  /** Total profile count (ignoring search filter). */
  totalCount: number;
  saveProfile: (
    name: string,
    filter: FilterState,
    search: string,
    stdFiltersEnabled: boolean,
    mdcFilters?: Array<{ key: string; value: string; active: boolean }>,
    searchMode?: SearchMode,
    onlyMarked?: boolean,
  ) => FilterProfile | null;
  loadProfile: (id: string) => FilterProfile | null;
  deleteProfile: (id: string) => boolean;
  renameProfile: (id: string, newName: string) => FilterProfile | null;
  duplicateProfile: (id: string) => FilterProfile | null;
  undoDelete: () => FilterProfile | null;
  canUndoDelete: boolean;
  exportProfiles: () => string;
  importProfiles: (json: string, overwrite?: boolean) => number;
  nameExists: (name: string) => boolean;
  getByName: (name: string) => FilterProfile | undefined;

  /** ID of the currently active (loaded) profile, or null. */
  activeProfileId: string | null;
  /** Whether the current filter state has diverged from the active profile. */
  isDirty: boolean;
  /** Clear the active-profile tracking (e.g. after "clear all filters"). */
  clearActiveProfile: () => void;

  /** Client-side search term for filtering the profile list. */
  profileSearch: string;
  setProfileSearch: (term: string) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Shallow-compare a FilterProfile's filters against the current app state. */
function filtersMatchProfile(
  profile: FilterProfile,
  filter: FilterState,
  search: string,
  stdFiltersEnabled: boolean,
  searchMode: SearchMode,
  onlyMarked: boolean,
  mdcFilters: Array<{ key: string; value: string; active: boolean }>,
): boolean {
  const f = profile.filters;
  return (
    f.level === filter.level &&
    f.logger === filter.logger &&
    f.thread === filter.thread &&
    (f.service ?? "") === (filter.service ?? "") &&
    f.message === filter.message &&
    f.search === search &&
    f.searchMode === searchMode &&
    f.stdFiltersEnabled === stdFiltersEnabled &&
    (f.onlyMarked ?? false) === onlyMarked &&
    JSON.stringify(f.mdcFilters ?? []) === JSON.stringify(mdcFilters)
  );
}

export function useFilterProfiles(currentState?: {
  filter: FilterState;
  search: string;
  stdFiltersEnabled: boolean;
  searchMode: SearchMode;
  onlyMarked: boolean;
  mdcFilters: Array<{ key: string; value: string; active: boolean }>;
}): UseFilterProfilesReturn {
  const [allProfiles, setAllProfiles] = useState<FilterProfile[]>([]);
  const [canUndoDelete, setCanUndoDelete] = useState(false);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [profileSearch, setProfileSearch] = useState("");

  // Keep a ref so callbacks always see the latest activeProfileId
  const activeIdRef = useRef(activeProfileId);
  activeIdRef.current = activeProfileId;

  useEffect(() => {
    // Wait for initial load, then subscribe to changes
    let unsubscribe: (() => void) | null = null;

    const syncState = () => {
      setAllProfiles(filterProfilesStore.getAll());
      setCanUndoDelete(filterProfilesStore.canUndoDelete);

      // If the active profile was deleted externally, clear tracking
      if (
        activeIdRef.current &&
        !filterProfilesStore.getById(activeIdRef.current)
      ) {
        setActiveProfileId(null);
      }
    };

    filterProfilesStore
      .waitForInit()
      .then(() => {
        syncState();
        unsubscribe = filterProfilesStore.onChange(syncState);
      })
      .catch((error) => {
        console.error("[useFilterProfiles] Init failed:", error);
        unsubscribe = filterProfilesStore.onChange(syncState);
      });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  // ── Dirty detection ──────────────────────────────────────────────

  const isDirty = useMemo(() => {
    if (!activeProfileId || !currentState) return false;
    const profile = filterProfilesStore.getById(activeProfileId);
    if (!profile) return false;
    return !filtersMatchProfile(
      profile,
      currentState.filter,
      currentState.search,
      currentState.stdFiltersEnabled,
      currentState.searchMode,
      currentState.onlyMarked,
      currentState.mdcFilters,
    );
  }, [activeProfileId, currentState]);

  // ── Profile search (client-side) ────────────────────────────────

  const profiles = useMemo(() => {
    if (!profileSearch.trim()) return allProfiles;
    const term = profileSearch.trim().toLowerCase();
    return allProfiles.filter((p) => p.name.toLowerCase().includes(term));
  }, [allProfiles, profileSearch]);

  // ── Actions ─────────────────────────────────────────────────────

  const saveProfile = useCallback(
    (
      name: string,
      filter: FilterState,
      search: string,
      stdFiltersEnabled: boolean,
      mdcFilters?: Array<{ key: string; value: string; active: boolean }>,
      searchMode?: SearchMode,
      onlyMarked?: boolean,
    ): FilterProfile | null => {
      try {
        const saved = filterProfilesStore.saveProfile(
          name,
          filter,
          search,
          stdFiltersEnabled,
          mdcFilters,
          searchMode,
          onlyMarked,
        );
        // Automatically track the just-saved profile as active
        if (saved) {
          setActiveProfileId(saved.id);
        }
        return saved;
      } catch (e) {
        console.error("[useFilterProfiles] Save failed:", e);
        return null;
      }
    },
    [],
  );

  const loadProfile = useCallback((id: string): FilterProfile | null => {
    const profile = filterProfilesStore.getById(id) ?? null;
    if (profile) {
      setActiveProfileId(profile.id);
    }
    return profile;
  }, []);

  const deleteProfile = useCallback((id: string): boolean => {
    const result = filterProfilesStore.deleteProfile(id);
    setCanUndoDelete(filterProfilesStore.canUndoDelete);
    // If the deleted profile was the active one, clear tracking
    if (result && activeIdRef.current === id) {
      setActiveProfileId(null);
    }
    return result;
  }, []);

  const nameExists = useCallback((name: string): boolean => {
    return filterProfilesStore.nameExists(name);
  }, []);

  const getByName = useCallback(
    (name: string): FilterProfile | undefined =>
      filterProfilesStore.getByName(name),
    [],
  );

  const renameProfile = useCallback(
    (id: string, newName: string): FilterProfile | null => {
      try {
        return filterProfilesStore.renameProfile(id, newName);
      } catch (e) {
        console.error("[useFilterProfiles] Rename failed:", e);
        return null;
      }
    },
    [],
  );

  const duplicateProfile = useCallback((id: string): FilterProfile | null => {
    try {
      return filterProfilesStore.duplicateProfile(id);
    } catch (e) {
      console.error("[useFilterProfiles] Duplicate failed:", e);
      return null;
    }
  }, []);

  const undoDelete = useCallback((): FilterProfile | null => {
    const restored = filterProfilesStore.undoDelete();
    setCanUndoDelete(filterProfilesStore.canUndoDelete);
    if (restored) {
      setActiveProfileId(restored.id);
    }
    return restored;
  }, []);

  const clearActiveProfile = useCallback(() => {
    setActiveProfileId(null);
  }, []);

  const exportProfiles = useCallback((): string => {
    return filterProfilesStore.exportProfiles();
  }, []);

  const importProfiles = useCallback(
    (json: string, overwrite = false): number => {
      return filterProfilesStore.importProfiles(json, overwrite);
    },
    [],
  );

  return {
    profiles,
    totalCount: allProfiles.length,
    saveProfile,
    loadProfile,
    deleteProfile,
    renameProfile,
    duplicateProfile,
    undoDelete,
    canUndoDelete,
    exportProfiles,
    importProfiles,
    nameExists,
    getByName,
    activeProfileId,
    isDirty,
    clearActiveProfile,
    profileSearch,
    setProfileSearch,
  };
}
