// Hook for managing log data with SoA store
import { useState, useCallback, useMemo } from "preact/hooks";
import {
  createLogDataStore,
  addLogEntry,
  addLogEntries,
  filterLogEntries,
  sortLogEntries,
  clearLogDataStore,
  getLogEntry,
  type LogDataStore,
  type LogEntry,
  type FilterOptions,
} from "../store/logDataStore";

export function useLogDataStore(): {
  store: LogDataStore;
  entries: LogEntry[];
  size: number;
  version: number;
  addEntry: (entry: LogEntry) => void;
  addEntries: (entries: LogEntry[]) => void;
  clear: () => void;
  getEntry: (index: number) => LogEntry | null;
  filter: (options: FilterOptions) => number[];
  sort: (key: "timestamp" | "level", direction?: "asc" | "desc") => number[];
} {
  const [store] = useState<LogDataStore>(() => createLogDataStore());
  const [version, setVersion] = useState(0);

  const addEntry = useCallback(
    (entry: LogEntry) => {
      addLogEntry(store, entry);
      setVersion((v) => v + 1);
    },
    [store],
  );

  const addEntries = useCallback(
    (entries: LogEntry[]) => {
      addLogEntries(store, entries);
      setVersion((v) => v + 1);
    },
    [store],
  );

  const clear = useCallback(() => {
    clearLogDataStore(store);
    setVersion((v) => v + 1);
  }, [store]);

  const getEntry = useCallback(
    (index: number) => {
      return getLogEntry(store, index);
    },
    [store],
  );

  const filter = useCallback(
    (options: FilterOptions): number[] => {
      return filterLogEntries(store, options);
    },
    [store],
  );

  const sort = useCallback(
    (
      key: "timestamp" | "level",
      direction: "asc" | "desc" = "desc",
    ): number[] => {
      return sortLogEntries(store, key, direction);
    },
    [store],
  );

  // Get all entries as array (for compatibility with existing code)
  const entries = useMemo(() => {
    return store.entries;
  }, [store, version]);

  const size = store.size;

  return {
    store,
    entries,
    size,
    version,
    addEntry,
    addEntries,
    clear,
    getEntry,
    filter,
    sort,
  };
}
