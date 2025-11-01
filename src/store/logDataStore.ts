// Struct-of-Arrays (SoA) log data store for efficient memory layout and fast filtering/sorting
// Stores frequently accessed fields in columnar format for better cache locality

export interface LogEntry {
  timestamp: string | null;
  level: string | null;
  logger: string | null;
  thread: string | null;
  message: string;
  traceId: string | null;
  stackTrace: string | null;
  raw: unknown;
  source: string;
  _mark?: string;
  mdc?: Record<string, string>;
  service?: string;
}

export interface LogDataStore {
  // Columnar storage for hot fields
  timestamps: (string | null)[];
  levels: (string | null)[];
  loggers: (string | null)[];
  messages: string[];
  traceIds: (string | null)[];

  // Less frequently accessed fields stored as objects
  entries: LogEntry[];

  // Indices for fast filtering
  levelIndex: Map<string, Set<number>>;
  loggerIndex: Map<string, Set<number>>;
  traceIdIndex: Map<string, Set<number>>;

  // Sort state
  sortedIndices: number[] | null;
  sortKey: 'timestamp' | 'level' | null;
  sortDirection: 'asc' | 'desc';

  // Size tracking
  size: number;
}

export function createLogDataStore(): LogDataStore {
  return {
    timestamps: [],
    levels: [],
    loggers: [],
    messages: [],
    traceIds: [],
    entries: [],
    levelIndex: new Map(),
    loggerIndex: new Map(),
    traceIdIndex: new Map(),
    sortedIndices: null,
    sortKey: null,
    sortDirection: 'desc',
    size: 0,
  };
}

export function addLogEntry(store: LogDataStore, entry: LogEntry): void {
  const index = store.size;

  // Add to columnar storage
  store.timestamps.push(entry.timestamp);
  store.levels.push(entry.level);
  store.loggers.push(entry.logger);
  store.messages.push(entry.message);
  store.traceIds.push(entry.traceId);
  store.entries.push(entry);

  // Update indices
  if (entry.level) {
    const levelUpper = entry.level.toUpperCase();
    if (!store.levelIndex.has(levelUpper)) {
      store.levelIndex.set(levelUpper, new Set());
    }
    store.levelIndex.get(levelUpper)!.add(index);
  }

  if (entry.logger) {
    if (!store.loggerIndex.has(entry.logger)) {
      store.loggerIndex.set(entry.logger, new Set());
    }
    store.loggerIndex.get(entry.logger)!.add(index);
  }

  if (entry.traceId) {
    if (!store.traceIdIndex.has(entry.traceId)) {
      store.traceIdIndex.set(entry.traceId, new Set());
    }
    store.traceIdIndex.get(entry.traceId)!.add(index);
  }

  store.size++;
  // Invalidate sort cache when new entries are added
  store.sortedIndices = null;
}

export function addLogEntries(store: LogDataStore, entries: LogEntry[]): void {
  for (const entry of entries) {
    addLogEntry(store, entry);
  }
}

export function getLogEntry(store: LogDataStore, index: number): LogEntry | null {
  if (index < 0 || index >= store.size) return null;
  return store.entries[index];
}

export function getLogEntrySlice(store: LogDataStore, start: number, end: number): LogEntry[] {
  if (start < 0 || start >= store.size) return [];
  const actualEnd = Math.min(end, store.size);
  return store.entries.slice(start, actualEnd);
}

// Fast filtering by level
export function filterByLevel(store: LogDataStore, levels: string[]): number[] {
  if (levels.length === 0) return Array.from({ length: store.size }, (_, i) => i);

  const result = new Set<number>();
  for (const level of levels) {
    const levelUpper = level.toUpperCase();
    const indices = store.levelIndex.get(levelUpper);
    if (indices) {
      indices.forEach((idx) => result.add(idx));
    }
  }

  return Array.from(result).sort((a, b) => a - b);
}

// Fast filtering by logger
export function filterByLogger(store: LogDataStore, loggers: string[]): number[] {
  if (loggers.length === 0) return Array.from({ length: store.size }, (_, i) => i);

  const result = new Set<number>();
  for (const logger of loggers) {
    const indices = store.loggerIndex.get(logger);
    if (indices) {
      indices.forEach((idx) => result.add(idx));
    }
  }

  return Array.from(result).sort((a, b) => a - b);
}

// Fast filtering by traceId
export function filterByTraceId(store: LogDataStore, traceId: string): number[] {
  const indices = store.traceIdIndex.get(traceId);
  if (!indices) return [];
  return Array.from(indices).sort((a, b) => a - b);
}

// Combined filtering
export interface FilterOptions {
  levels?: string[];
  loggers?: string[];
  traceId?: string;
  messageContains?: string;
}

export function filterLogEntries(store: LogDataStore, options: FilterOptions): number[] {
  let indices = Array.from({ length: store.size }, (_, i) => i);

  // Apply level filter
  if (options.levels && options.levels.length > 0) {
    const levelSet = new Set(filterByLevel(store, options.levels));
    indices = indices.filter((i) => levelSet.has(i));
  }

  // Apply logger filter
  if (options.loggers && options.loggers.length > 0) {
    const loggerSet = new Set(filterByLogger(store, options.loggers));
    indices = indices.filter((i) => loggerSet.has(i));
  }

  // Apply traceId filter
  if (options.traceId) {
    const traceIdSet = new Set(filterByTraceId(store, options.traceId));
    indices = indices.filter((i) => traceIdSet.has(i));
  }

  // Apply message filter (less efficient, but necessary)
  if (options.messageContains) {
    const searchLower = options.messageContains.toLowerCase();
    indices = indices.filter((i) => store.messages[i]?.toLowerCase().includes(searchLower));
  }

  return indices;
}

// Efficient sorting with caching
export function sortLogEntries(
  store: LogDataStore,
  key: 'timestamp' | 'level',
  direction: 'asc' | 'desc' = 'desc'
): number[] {
  // Return cached sort if parameters match
  if (store.sortedIndices && store.sortKey === key && store.sortDirection === direction) {
    return store.sortedIndices;
  }

  const indices = Array.from({ length: store.size }, (_, i) => i);

  if (key === 'timestamp') {
    indices.sort((a, b) => {
      const tsA = store.timestamps[a];
      const tsB = store.timestamps[b];
      if (!tsA && !tsB) return 0;
      if (!tsA) return 1;
      if (!tsB) return -1;
      const cmp = tsA.localeCompare(tsB);
      return direction === 'asc' ? cmp : -cmp;
    });
  } else if (key === 'level') {
    const levelOrder: Record<string, number> = {
      FATAL: 0,
      ERROR: 1,
      WARN: 2,
      INFO: 3,
      DEBUG: 4,
      TRACE: 5,
    };
    indices.sort((a, b) => {
      const levelA = (store.levels[a] || '').toUpperCase();
      const levelB = (store.levels[b] || '').toUpperCase();
      const orderA = levelOrder[levelA] ?? 999;
      const orderB = levelOrder[levelB] ?? 999;
      const cmp = orderA - orderB;
      return direction === 'asc' ? cmp : -cmp;
    });
  }

  // Cache the result
  store.sortedIndices = indices;
  store.sortKey = key;
  store.sortDirection = direction;

  return indices;
}

export function clearLogDataStore(store: LogDataStore): void {
  store.timestamps.length = 0;
  store.levels.length = 0;
  store.loggers.length = 0;
  store.messages.length = 0;
  store.traceIds.length = 0;
  store.entries.length = 0;
  store.levelIndex.clear();
  store.loggerIndex.clear();
  store.traceIdIndex.clear();
  store.sortedIndices = null;
  store.sortKey = null;
  store.size = 0;
}
