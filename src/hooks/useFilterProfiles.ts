/**
 * Hook for managing filter profiles
 */
import { useCallback, useEffect, useState } from "preact/hooks";
import {
  type FilterProfile,
  filterProfilesStore,
} from "../store/filterProfiles";
import type { FilterState } from "./useFilterState";

export interface UseFilterProfilesReturn {
  profiles: FilterProfile[];
  saveProfile: (
    name: string,
    filter: FilterState,
    search: string,
    stdFiltersEnabled: boolean,
    mdcFilters?: Array<{ key: string; value: string; active: boolean }>,
  ) => FilterProfile | null;
  loadProfile: (id: string) => FilterProfile | null;
  deleteProfile: (id: string) => boolean;
  nameExists: (name: string) => boolean;
  getByName: (name: string) => FilterProfile | undefined;
}

export function useFilterProfiles(): UseFilterProfilesReturn {
  const [profiles, setProfiles] = useState<FilterProfile[]>(
    filterProfilesStore.getAll(),
  );

  useEffect(() => {
    return filterProfilesStore.onChange(() => {
      setProfiles(filterProfilesStore.getAll());
    });
  }, []);

  const saveProfile = useCallback(
    (
      name: string,
      filter: FilterState,
      search: string,
      stdFiltersEnabled: boolean,
      mdcFilters?: Array<{ key: string; value: string; active: boolean }>,
    ): FilterProfile | null => {
      try {
        return filterProfilesStore.saveProfile(
          name,
          filter,
          search,
          stdFiltersEnabled,
          mdcFilters,
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
    return filterProfilesStore.deleteProfile(id);
  }, []);

  const nameExists = useCallback((name: string): boolean => {
    return filterProfilesStore.nameExists(name);
  }, []);

  const getByName = useCallback(
    (name: string): FilterProfile | undefined =>
      filterProfilesStore.getByName(name),
    [],
  );

  return {
    profiles,
    saveProfile,
    loadProfile,
    deleteProfile,
    nameExists,
    getByName,
  };
}
