/**
 * Hook for managing filter profiles
 */
import { useCallback, useEffect, useState } from "preact/hooks";
import {
  type FilterProfile,
  filterProfilesStore,
} from "../store/filterProfiles";
import type { FilterState } from "./useFilterState";
import type { SearchMode } from "../utils/msgFilter";

export interface UseFilterProfilesReturn {
  profiles: FilterProfile[];
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
}

export function useFilterProfiles(): UseFilterProfilesReturn {
  const [profiles, setProfiles] = useState<FilterProfile[]>([]);
  const [canUndoDelete, setCanUndoDelete] = useState(false);

  useEffect(() => {
    // Wait for initial load, then subscribe to changes
    let unsubscribe: (() => void) | null = null;

    const syncState = () => {
      setProfiles(filterProfilesStore.getAll());
      setCanUndoDelete(filterProfilesStore.canUndoDelete);
    };

    filterProfilesStore
      .waitForInit()
      .then(() => {
        // Set initial profiles after init
        syncState();

        // Subscribe to future changes
        unsubscribe = filterProfilesStore.onChange(syncState);
      })
      .catch((error) => {
        console.error("[useFilterProfiles] Init failed:", error);
        // Still subscribe to changes even if init failed
        unsubscribe = filterProfilesStore.onChange(syncState);
      });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

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
        return filterProfilesStore.saveProfile(
          name,
          filter,
          search,
          stdFiltersEnabled,
          mdcFilters,
          searchMode,
          onlyMarked,
        );
      } catch (e) {
        console.error("[useFilterProfiles] Save failed:", e);
        return null;
      }
    },
    [],
  );

  const loadProfile = useCallback((id: string): FilterProfile | null => {
    return filterProfilesStore.getById(id) ?? null;
  }, []);

  const deleteProfile = useCallback((id: string): boolean => {
    const result = filterProfilesStore.deleteProfile(id);
    setCanUndoDelete(filterProfilesStore.canUndoDelete);
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
    return restored;
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
  };
}
