/**
 * Hook for managing filter state and history
 */
import { useState, useCallback } from "preact/hooks";
import { MAX_FILTER_HISTORY } from "../constants";
import type { SearchMode } from "../utils/msgFilter";

export interface FilterState {
  level: string;
  logger: string;
  thread: string;
  service: string;
  message: string;
}

export const INITIAL_FILTER_STATE: FilterState = {
  level: "",
  logger: "",
  thread: "",
  service: "",
  message: "",
};

export function useFilterState() {
  const [search, setSearch] = useState<string>("");
  const [searchMode, setSearchMode] = useState<SearchMode>("insensitive");
  const [showSearchOptions, setShowSearchOptions] = useState<boolean>(false);
  const [filter, setFilter] = useState<FilterState>(INITIAL_FILTER_STATE);
  const [stdFiltersEnabled, setStdFiltersEnabled] = useState<boolean>(true);
  const [onlyMarked, setOnlyMarked] = useState<boolean>(false);

  // Filter history (session-only, no persistence)
  const [fltHistSearch, setFltHistSearch] = useState<string[]>([]);
  const [fltHistLogger, setFltHistLogger] = useState<string[]>([]);
  const [fltHistThread, setFltHistThread] = useState<string[]>([]);
  const [fltHistMessage, setFltHistMessage] = useState<string[]>([]);

  // Filter section expanded state
  const [filtersExpanded, setFiltersExpanded] = useState<boolean>(false);

  const addFilterHistory = useCallback(
    (kind: "search" | "logger" | "thread" | "message", val: string) => {
      const v = String(val || "").trim();
      if (!v) return;
      const upd = (prev: string[]) =>
        [v, ...prev.filter((x) => x !== v)].slice(0, MAX_FILTER_HISTORY);

      switch (kind) {
        case "search":
          setFltHistSearch(upd);
          break;
        case "logger":
          setFltHistLogger(upd);
          break;
        case "thread":
          setFltHistThread(upd);
          break;
        case "message":
          setFltHistMessage(upd);
          break;
      }
    },
    [],
  );

  const clearAllFilters = useCallback(() => {
    setSearch("");
    setFilter(INITIAL_FILTER_STATE);
    setOnlyMarked(false);
  }, []);

  const updateFilter = useCallback((partial: Partial<FilterState>) => {
    setFilter((prev) => ({ ...prev, ...partial }));
  }, []);

  return {
    // Search
    search,
    setSearch,
    searchMode,
    setSearchMode,
    showSearchOptions,
    setShowSearchOptions,

    // Standard filters
    filter,
    setFilter,
    updateFilter,
    stdFiltersEnabled,
    setStdFiltersEnabled,

    // Marks filter
    onlyMarked,
    setOnlyMarked,

    // History
    fltHistSearch,
    fltHistLogger,
    fltHistThread,
    fltHistMessage,
    addFilterHistory,

    // UI state
    filtersExpanded,
    setFiltersExpanded,

    // Actions
    clearAllFilters,
  };
}

export type FilterStateReturn = ReturnType<typeof useFilterState>;
