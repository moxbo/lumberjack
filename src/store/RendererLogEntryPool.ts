/**
 * LogEntryPool für Renderer-Prozess
 *
 * Reduziert GC-Druck bei 100k+ Log-Einträgen durch Wiederverwendung von Objekten.
 * Diese Version ist für den Renderer-Prozess optimiert (ohne electron-log).
 *
 * Verwendung:
 * - Beim Hinzufügen neuer Logs: pool.create(data) oder pool.acquireBatch()
 * - Beim Entfernen von Logs (trim, clear): pool.releaseBatch(removedEntries)
 */

import logger from "../utils/logger";

/**
 * Poolable Log Entry Interface
 */
export interface PoolableLogEntry {
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
  _fullMessage?: string;
  _truncated?: boolean;
  _messageSize?: number;
  _id?: number;
  color?: string; // Legacy support
  _processed?: boolean;
  /** Phase 2: true if this entry has a stack trace that was offloaded to IndexedDB. */
  _hasStack?: boolean;
  /** Phase 2: true if heavy fields (stackTrace/_fullMessage) were moved to the heavyFieldStore. */
  _offloaded?: boolean;
  // Pool tracking (internal)
  __pooled?: boolean;
}

/**
 * Pool Statistics für Monitoring/Debugging
 */
export interface PoolStats {
  available: number;
  totalCreated: number;
  reused: number;
  returned: number;
  hitRate: number;
  maxSize: number;
}

/**
 * Configuration für den Pool
 */
export interface PoolConfig {
  maxSize?: number;
  initialSize?: number;
  enableLogging?: boolean;
}

const DEFAULT_CONFIG: Required<PoolConfig> = {
  maxSize: 50_000,
  initialSize: 1_000,
  enableLogging: false,
};

/**
 * RendererLogEntryPool - Singleton Object Pool für Renderer-Prozess
 */
class RendererLogEntryPool {
  private static instance: RendererLogEntryPool | null = null;

  private pool: PoolableLogEntry[] = [];
  private config: Required<PoolConfig>;

  // Statistics
  private totalCreated = 0;
  private reusedCount = 0;
  private returnedCount = 0;

  private constructor(config: PoolConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.preallocate(this.config.initialSize);
  }

  static getInstance(config?: PoolConfig): RendererLogEntryPool {
    if (!RendererLogEntryPool.instance) {
      RendererLogEntryPool.instance = new RendererLogEntryPool(config);
    }
    return RendererLogEntryPool.instance;
  }

  static resetInstance(): void {
    if (RendererLogEntryPool.instance) {
      RendererLogEntryPool.instance.clear();
      RendererLogEntryPool.instance = null;
    }
  }

  private preallocate(count: number): void {
    const toCreate = Math.min(count, this.config.maxSize);
    for (let i = 0; i < toCreate; i++) {
      this.pool.push(this.createEmpty());
    }
    this.totalCreated = toCreate;

    if (this.config.enableLogging) {
      logger.debug(`[RendererPool] Preallocated ${toCreate} entries`);
    }
  }

  private createEmpty(): PoolableLogEntry {
    return {
      timestamp: null,
      level: null,
      logger: null,
      thread: null,
      message: "",
      traceId: null,
      stackTrace: null,
      raw: null,
      source: "",
      _mark: undefined,
      mdc: undefined,
      service: undefined,
      _fullMessage: undefined,
      _truncated: undefined,
      _messageSize: undefined,
      _id: undefined,
      color: undefined,
      _processed: undefined,
      _hasStack: undefined,
      _offloaded: undefined,
      __pooled: true,
    };
  }

  private reset(entry: PoolableLogEntry): void {
    entry.timestamp = null;
    entry.level = null;
    entry.logger = null;
    entry.thread = null;
    entry.message = "";
    entry.traceId = null;
    entry.stackTrace = null;
    entry.raw = null;
    entry.source = "";
    entry._mark = undefined;
    entry.mdc = undefined;
    entry.service = undefined;
    entry._fullMessage = undefined;
    entry._truncated = undefined;
    entry._messageSize = undefined;
    entry._id = undefined;
    entry.color = undefined;
    entry._processed = undefined;
    entry._hasStack = undefined;
    entry._offloaded = undefined;
    entry.__pooled = true;
  }

  /**
   * Holt ein Objekt aus dem Pool oder erstellt ein neues
   */
  acquire(): PoolableLogEntry {
    if (this.pool.length > 0) {
      const entry = this.pool.pop()!;
      entry.__pooled = false;
      this.reusedCount++;
      return entry;
    }

    this.totalCreated++;
    const entry = this.createEmpty();
    entry.__pooled = false;
    return entry;
  }

  /**
   * Holt mehrere Objekte aus dem Pool (effizienter bei Batches)
   */
  acquireBatch(count: number): PoolableLogEntry[] {
    const result: PoolableLogEntry[] = [];

    const fromPool = Math.min(count, this.pool.length);
    for (let i = 0; i < fromPool; i++) {
      const entry = this.pool.pop()!;
      entry.__pooled = false;
      result.push(entry);
      this.reusedCount++;
    }

    for (let i = fromPool; i < count; i++) {
      this.totalCreated++;
      const entry = this.createEmpty();
      entry.__pooled = false;
      result.push(entry);
    }

    return result;
  }

  /**
   * Gibt ein Objekt zurück in den Pool
   */
  release(entry: PoolableLogEntry): void {
    if (!entry || entry.__pooled) return;
    if (this.pool.length >= this.config.maxSize) return;

    this.reset(entry);
    this.pool.push(entry);
    this.returnedCount++;
  }

  /**
   * Gibt mehrere Objekte zurück (effizienter bei Batch-Operationen)
   */
  releaseBatch(entries: PoolableLogEntry[]): void {
    if (!entries || entries.length === 0) return;

    const spaceAvailable = this.config.maxSize - this.pool.length;
    const toReturn = Math.min(entries.length, spaceAvailable);

    for (let i = 0; i < toReturn; i++) {
      const entry = entries[i];
      if (entry && !entry.__pooled) {
        this.reset(entry);
        this.pool.push(entry);
        this.returnedCount++;
      }
    }
  }

  /**
   * Erstellt einen neuen Eintrag mit Daten
   */
  create(data: Partial<PoolableLogEntry>): PoolableLogEntry {
    const entry = this.acquire();
    return Object.assign(entry, data);
  }

  /**
   * Erstellt mehrere Einträge aus Daten-Array
   */
  createBatch(dataArray: Partial<PoolableLogEntry>[]): PoolableLogEntry[] {
    const entries = this.acquireBatch(dataArray.length);
    for (let i = 0; i < dataArray.length; i++) {
      const entry = entries[i];
      const data = dataArray[i];
      if (entry && data) {
        Object.assign(entry, data);
      }
    }
    return entries;
  }

  /**
   * Kopiert Daten von einem Objekt in ein Pool-Objekt
   * Nützlich für das Konvertieren von externen Objekten
   */
  fromObject(obj: Record<string, unknown>): PoolableLogEntry {
    const entry = this.acquire();

    entry.timestamp = (obj.timestamp as string | null) ?? null;
    entry.level = (obj.level as string | null) ?? null;
    entry.logger = (obj.logger as string | null) ?? null;
    entry.thread = (obj.thread as string | null) ?? null;
    entry.message = (obj.message as string) ?? "";
    entry.traceId = (obj.traceId as string | null) ?? null;
    entry.stackTrace = (obj.stackTrace as string | null) ?? null;
    entry.raw = obj.raw ?? null;
    entry.source = (obj.source as string) ?? "";
    entry._mark = obj._mark as string | undefined;
    entry.mdc = obj.mdc as Record<string, string> | undefined;
    entry.service = obj.service as string | undefined;
    entry._fullMessage = obj._fullMessage as string | undefined;
    entry._truncated = obj._truncated as boolean | undefined;
    entry._messageSize = obj._messageSize as number | undefined;
    entry._id = obj._id as number | undefined;
    entry.color = obj.color as string | undefined;
    entry._processed = obj._processed as boolean | undefined;

    return entry;
  }

  /**
   * Konvertiert ein Array von Objekten in Pool-Objekte
   */
  fromObjectBatch(objects: Record<string, unknown>[]): PoolableLogEntry[] {
    return objects.map((obj) => this.fromObject(obj));
  }

  /**
   * Statistiken abrufen
   */
  getStats(): PoolStats {
    const totalAcquired =
      this.reusedCount + (this.totalCreated - this.config.initialSize);
    return {
      available: this.pool.length,
      totalCreated: this.totalCreated,
      reused: this.reusedCount,
      returned: this.returnedCount,
      hitRate: totalAcquired > 0 ? this.reusedCount / totalAcquired : 0,
      maxSize: this.config.maxSize,
    };
  }

  /**
   * Pool leeren
   */
  clear(): void {
    this.pool.length = 0;
  }

  /**
   * Pool-Größe dynamisch anpassen
   */
  resize(newMaxSize: number): void {
    this.config.maxSize = newMaxSize;
    if (this.pool.length > newMaxSize) {
      this.pool.length = newMaxSize;
    }
  }

  /**
   * Logging aktivieren/deaktivieren
   */
  setLogging(enabled: boolean): void {
    this.config.enableLogging = enabled;
  }
}

// Singleton getter
export function getRendererLogEntryPool(
  config?: PoolConfig,
): RendererLogEntryPool {
  return RendererLogEntryPool.getInstance(config);
}

// Reset für Tests
export function resetRendererLogEntryPool(): void {
  RendererLogEntryPool.resetInstance();
}

// Default export für einfachen Import
export default RendererLogEntryPool;
