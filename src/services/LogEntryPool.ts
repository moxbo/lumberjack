/**
 * LogEntryPool - Object Pool für Log-Einträge
 *
 * Reduziert GC-Druck bei 100k+ Log-Einträgen durch Wiederverwendung von Objekten.
 * Besonders effektiv bei:
 * - TCP-Streaming (kontinuierlicher Datenstrom)
 * - Elasticsearch-Batches (viele Einträge auf einmal)
 * - Log-Rotation (alte Logs werden entfernt, neue hinzugefügt)
 *
 * Der Pool ist flexibel - Logs können beliebig lange im Speicher bleiben.
 * Erst wenn Logs explizit entfernt werden (trim, clear), werden sie recycelt.
 */

import log from "electron-log/main";

/**
 * Poolable Log Entry Interface
 * Erweiterung des Standard LogEntry mit Pool-Metadaten
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
  // Pool tracking (internal)
  __pooled?: boolean;
}

/**
 * Pool Statistics für Monitoring
 */
export interface PoolStats {
  /** Aktuelle Anzahl verfügbarer Objekte im Pool */
  available: number;
  /** Gesamtzahl der erstellten Objekte */
  totalCreated: number;
  /** Anzahl der wiederverwendeten Objekte */
  reused: number;
  /** Anzahl der zurückgegebenen Objekte */
  returned: number;
  /** Hit-Rate: reused / (reused + created since start) */
  hitRate: number;
  /** Maximale Pool-Größe */
  maxSize: number;
}

/**
 * Configuration für den Pool
 */
export interface PoolConfig {
  /** Maximale Anzahl an Objekten im Pool (default: 50000) */
  maxSize?: number;
  /** Initiale Pool-Größe bei Erstellung (default: 1000) */
  initialSize?: number;
  /** Logging aktivieren (default: false in prod) */
  enableLogging?: boolean;
  /** Interval für Stats-Logging in ms (default: 60000) */
  statsLogInterval?: number;
}

const DEFAULT_CONFIG: Required<PoolConfig> = {
  maxSize: 50_000, // Groß genug für Bursts, aber nicht unbegrenzt
  initialSize: 1_000, // Schneller Start mit vorallokierten Objekten
  enableLogging: process.env.NODE_ENV === "development",
  statsLogInterval: 60_000, // Alle 60 Sekunden Stats loggen
};

/**
 * LogEntryPool - Singleton Object Pool für Log-Einträge
 */
export class LogEntryPool {
  private static instance: LogEntryPool | null = null;

  private pool: PoolableLogEntry[] = [];
  private config: Required<PoolConfig>;

  // Statistics
  private totalCreated = 0;
  private reusedCount = 0;
  private returnedCount = 0;
  private statsTimer: ReturnType<typeof setInterval> | null = null;

  private constructor(config: PoolConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.preallocate(this.config.initialSize);

    if (this.config.enableLogging && this.config.statsLogInterval > 0) {
      this.startStatsLogging();
    }
  }

  /**
   * Singleton-Instanz holen oder erstellen
   */
  static getInstance(config?: PoolConfig): LogEntryPool {
    if (!LogEntryPool.instance) {
      LogEntryPool.instance = new LogEntryPool(config);
    }
    return LogEntryPool.instance;
  }

  /**
   * Pool zurücksetzen (für Tests)
   */
  static resetInstance(): void {
    if (LogEntryPool.instance) {
      LogEntryPool.instance.dispose();
      LogEntryPool.instance = null;
    }
  }

  /**
   * Vorallokierung von Objekten für schnelleren Start
   */
  private preallocate(count: number): void {
    const toCreate = Math.min(count, this.config.maxSize);
    for (let i = 0; i < toCreate; i++) {
      this.pool.push(this.createEmpty());
    }
    this.totalCreated = toCreate;

    if (this.config.enableLogging) {
      log.debug(`[LogEntryPool] Preallocated ${toCreate} entries`);
    }
  }

  /**
   * Erstellt ein leeres Log-Entry-Objekt
   */
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
      __pooled: true,
    };
  }

  /**
   * Setzt ein Objekt auf den Ausgangszustand zurück
   */
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

    // Pool ist leer - neues Objekt erstellen
    this.totalCreated++;
    const entry = this.createEmpty();
    entry.__pooled = false;
    return entry;
  }

  /**
   * Holt mehrere Objekte aus dem Pool (effizienter bei Batches)
   */
  acquireBatch(count: number): PoolableLogEntry[] {
    const result: PoolableLogEntry[] = new Array(count);

    // Erst aus dem Pool nehmen
    const fromPool = Math.min(count, this.pool.length);
    for (let i = 0; i < fromPool; i++) {
      const entry = this.pool.pop()!;
      entry.__pooled = false;
      result[i] = entry;
      this.reusedCount++;
    }

    // Rest neu erstellen
    for (let i = fromPool; i < count; i++) {
      this.totalCreated++;
      const entry = this.createEmpty();
      entry.__pooled = false;
      result[i] = entry;
    }

    return result;
  }

  /**
   * Gibt ein Objekt zurück in den Pool
   */
  release(entry: PoolableLogEntry): void {
    // Validierung: Nicht doppelt zurückgeben
    if (entry.__pooled) {
      if (this.config.enableLogging) {
        log.warn("[LogEntryPool] Attempted to release already pooled entry");
      }
      return;
    }

    // Pool voll? Dann GC überlassen
    if (this.pool.length >= this.config.maxSize) {
      return;
    }

    this.reset(entry);
    this.pool.push(entry);
    this.returnedCount++;
  }

  /**
   * Gibt mehrere Objekte zurück (effizienter bei Batch-Operationen)
   */
  releaseBatch(entries: PoolableLogEntry[]): void {
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
   * Kopiert Daten auf einen Pool-Eintrag
   */
  private applyData(
    entry: PoolableLogEntry,
    data: Partial<PoolableLogEntry>,
  ): void {
    if (data.timestamp !== undefined) entry.timestamp = data.timestamp;
    if (data.level !== undefined) entry.level = data.level;
    if (data.logger !== undefined) entry.logger = data.logger;
    if (data.thread !== undefined) entry.thread = data.thread;
    if (data.message !== undefined) entry.message = data.message;
    if (data.traceId !== undefined) entry.traceId = data.traceId;
    if (data.stackTrace !== undefined) entry.stackTrace = data.stackTrace;
    if (data.raw !== undefined) entry.raw = data.raw;
    if (data.source !== undefined) entry.source = data.source;
    if (data._mark !== undefined) entry._mark = data._mark;
    if (data.mdc !== undefined) entry.mdc = data.mdc;
    if (data.service !== undefined) entry.service = data.service;
    if (data._fullMessage !== undefined) entry._fullMessage = data._fullMessage;
    if (data._truncated !== undefined) entry._truncated = data._truncated;
    if (data._messageSize !== undefined) entry._messageSize = data._messageSize;
    if (data._id !== undefined) entry._id = data._id;
  }

  /**
   * Erstellt einen neuen Eintrag mit Daten (Convenience-Methode)
   */
  create(data: Partial<PoolableLogEntry>): PoolableLogEntry {
    const entry = this.acquire();
    this.applyData(entry, data);
    return entry;
  }

  /**
   * Erstellt mehrere Einträge aus Daten-Array
   */
  createBatch(dataArray: Partial<PoolableLogEntry>[]): PoolableLogEntry[] {
    const entries = this.acquireBatch(dataArray.length);

    for (let i = 0; i < dataArray.length; i++) {
      const data = dataArray[i];
      const entry = entries[i];
      if (!data || !entry) continue;
      this.applyData(entry, data);
    }

    return entries;
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
   * Stats-Logging starten
   */
  private startStatsLogging(): void {
    this.statsTimer = setInterval(() => {
      const stats = this.getStats();
      log.info(
        `[LogEntryPool] Stats: available=${stats.available}, ` +
          `created=${stats.totalCreated}, reused=${stats.reused}, ` +
          `returned=${stats.returned}, hitRate=${(stats.hitRate * 100).toFixed(1)}%`,
      );
    }, this.config.statsLogInterval);
  }

  /**
   * Pool leeren (für Shutdown)
   */
  clear(): void {
    this.pool.length = 0;
    if (this.config.enableLogging) {
      log.debug("[LogEntryPool] Pool cleared");
    }
  }

  /**
   * Ressourcen freigeben
   */
  dispose(): void {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    this.clear();
    if (this.config.enableLogging) {
      log.debug("[LogEntryPool] Disposed");
    }
  }

  /**
   * Pool-Größe dynamisch anpassen
   */
  resize(newMaxSize: number): void {
    this.config.maxSize = newMaxSize;

    // Überschüssige Einträge entfernen
    if (this.pool.length > newMaxSize) {
      this.pool.length = newMaxSize;
    }

    if (this.config.enableLogging) {
      log.debug(`[LogEntryPool] Resized to maxSize=${newMaxSize}`);
    }
  }
}

// Export singleton getter für einfachen Zugriff
export function getLogEntryPool(config?: PoolConfig): LogEntryPool {
  return LogEntryPool.getInstance(config);
}

// Export für Tests
export function resetLogEntryPool(): void {
  LogEntryPool.resetInstance();
}
