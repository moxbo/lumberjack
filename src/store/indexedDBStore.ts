/**
 * IndexedDB-basierter Store für große Log-Mengen.
 * Ermöglicht das Speichern und Abrufen von Logs ohne den gesamten Speicher zu belegen.
 */

const DB_NAME = "LumberjackLogs";
const DB_VERSION = 1;
const STORE_NAME = "logs";
const INDEX_TIMESTAMP = "timestamp";
const INDEX_LEVEL = "level";
const INDEX_SOURCE = "source";

// Maximum entries to keep in memory cache
const MEMORY_CACHE_SIZE = 5000;

interface LogEntry {
  _id: number;
  timestamp?: string | number;
  level?: string;
  logger?: string;
  message?: string;
  thread?: string;
  mdc?: Record<string, unknown>;
  source?: string;
  _mark?: string;
  [key: string]: unknown;
}

interface QueryOptions {
  level?: string;
  source?: string;
  startTime?: string | number;
  endTime?: string | number;
  limit?: number;
  offset?: number;
}

class IndexedDBLogStore {
  private db: IDBDatabase | null = null;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;
  private memoryCache: Map<number, LogEntry> = new Map();
  private nextId = 1;

  /**
   * Initialize the IndexedDB database
   */
  async init(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
          console.error(
            "[IndexedDBStore] Failed to open database:",
            request.error,
          );
          reject(request.error);
        };

        request.onsuccess = () => {
          this.db = request.result;
          this.isInitialized = true;
          console.log("[IndexedDBStore] Database opened successfully");
          resolve();
        };

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;

          // Create object store if it doesn't exist
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: "_id" });

            // Create indexes for efficient querying
            store.createIndex(INDEX_TIMESTAMP, "timestamp", { unique: false });
            store.createIndex(INDEX_LEVEL, "level", { unique: false });
            store.createIndex(INDEX_SOURCE, "source", { unique: false });

            console.log("[IndexedDBStore] Object store created");
          }
        };
      } catch (error) {
        console.error("[IndexedDBStore] Error initializing:", error);
        reject(error);
      }
    });

    return this.initPromise;
  }

  /**
   * Add entries to the store
   */
  async addEntries(entries: LogEntry[]): Promise<number[]> {
    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const addedIds: number[] = [];

      transaction.onerror = () => {
        console.error("[IndexedDBStore] Transaction error:", transaction.error);
        reject(transaction.error);
      };

      transaction.oncomplete = () => {
        resolve(addedIds);
      };

      for (const entry of entries) {
        // Assign ID if not present
        if (entry._id == null) {
          entry._id = this.nextId++;
        } else {
          this.nextId = Math.max(this.nextId, entry._id + 1);
        }

        const request = store.add(entry);
        request.onsuccess = () => {
          addedIds.push(entry._id);

          // Update memory cache (keep most recent entries)
          this.memoryCache.set(entry._id, entry);
          if (this.memoryCache.size > MEMORY_CACHE_SIZE) {
            const firstKey = this.memoryCache.keys().next().value;
            if (firstKey !== undefined) {
              this.memoryCache.delete(firstKey);
            }
          }
        };
      }
    });
  }

  /**
   * Get entry by ID
   */
  async getEntry(id: number): Promise<LogEntry | undefined> {
    // Check memory cache first
    const cached = this.memoryCache.get(id);
    if (cached) return cached;

    await this.init();
    if (!this.db) return undefined;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const entry = request.result as LogEntry | undefined;
        if (entry) {
          // Add to memory cache
          this.memoryCache.set(id, entry);
        }
        resolve(entry);
      };
    });
  }

  /**
   * Get multiple entries by IDs
   */
  async getEntries(ids: number[]): Promise<LogEntry[]> {
    await this.init();
    if (!this.db) return [];

    const entries: LogEntry[] = [];
    const idsToFetch: number[] = [];

    // Check memory cache first
    for (const id of ids) {
      const cached = this.memoryCache.get(id);
      if (cached) {
        entries.push(cached);
      } else {
        idsToFetch.push(id);
      }
    }

    if (idsToFetch.length === 0) return entries;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);

      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve(entries);

      for (const id of idsToFetch) {
        const request = store.get(id);
        request.onsuccess = () => {
          const entry = request.result as LogEntry | undefined;
          if (entry) {
            entries.push(entry);
            this.memoryCache.set(id, entry);
          }
        };
      }
    });
  }

  /**
   * Query entries with filters
   */
  async query(options: QueryOptions = {}): Promise<LogEntry[]> {
    await this.init();
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const entries: LogEntry[] = [];

      let request: IDBRequest;

      // Use appropriate index based on query
      if (options.level) {
        const index = store.index(INDEX_LEVEL);
        request = index.openCursor(
          IDBKeyRange.only(options.level.toUpperCase()),
        );
      } else if (options.source) {
        const index = store.index(INDEX_SOURCE);
        request = index.openCursor(IDBKeyRange.only(options.source));
      } else if (options.startTime || options.endTime) {
        const index = store.index(INDEX_TIMESTAMP);
        let range: IDBKeyRange | null = null;

        if (options.startTime && options.endTime) {
          range = IDBKeyRange.bound(options.startTime, options.endTime);
        } else if (options.startTime) {
          range = IDBKeyRange.lowerBound(options.startTime);
        } else if (options.endTime) {
          range = IDBKeyRange.upperBound(options.endTime);
        }

        request = index.openCursor(range);
      } else {
        request = store.openCursor();
      }

      const limit = options.limit || Infinity;
      const offset = options.offset || 0;
      let skipped = 0;

      request.onerror = () => reject(request.error);
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest)
          .result as IDBCursorWithValue | null;

        if (cursor && entries.length < limit) {
          if (skipped < offset) {
            skipped++;
            cursor.continue();
            return;
          }

          entries.push(cursor.value as LogEntry);
          cursor.continue();
        } else {
          resolve(entries);
        }
      };
    });
  }

  /**
   * Get total count of entries
   */
  async count(): Promise<number> {
    await this.init();
    if (!this.db) return 0;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.count();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * Clear all entries
   */
  async clear(): Promise<void> {
    await this.init();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.memoryCache.clear();
        this.nextId = 1;
        console.log("[IndexedDBStore] Store cleared");
        resolve();
      };
    });
  }

  /**
   * Update an entry (e.g., to add/remove marks)
   */
  async updateEntry(id: number, updates: Partial<LogEntry>): Promise<void> {
    await this.init();
    if (!this.db) return;

    const entry = await this.getEntry(id);
    if (!entry) return;

    const updatedEntry = { ...entry, ...updates };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(updatedEntry);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.memoryCache.set(id, updatedEntry);
        resolve();
      };
    });
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isInitialized = false;
      this.initPromise = null;
      console.log("[IndexedDBStore] Database closed");
    }
  }
}

// Singleton instance
export const indexedDBStore = new IndexedDBLogStore();

// Export types
export type { LogEntry, QueryOptions };
