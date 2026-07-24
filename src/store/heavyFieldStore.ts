/**
 * Heavy-Field Offload Store (Phase 2)
 *
 * Lagert die großen, ausschließlich in der Detailansicht/Export benötigten
 * Felder eines Log-Eintrags (`stackTrace`, `_fullMessage`) nach IndexedDB aus,
 * damit sie NICHT dauerhaft im Renderer-Heap liegen. Die Log-Tabelle, die
 * Filterung und die Suche lesen diese Felder nie – daher können sie aus dem
 * In-Memory-Eintrag entfernt und erst bei Bedarf (Öffnen der Detailansicht,
 * Export) per stabiler `_id` nachgeladen werden.
 *
 * Eigenschaften:
 * - Fokussiert & schlank: nur ein Object-Store mit `_id` als Key, keine
 *   überflüssigen Indizes.
 * - Graceful Degradation: Ist IndexedDB nicht verfügbar oder schlägt eine
 *   Operation fehl, verhalten sich alle Methoden als No-Op (Detailansicht
 *   fällt dann auf die im Speicher verbliebenen Felder zurück).
 * - Kleiner LRU-Cache, damit wiederholtes Öffnen desselben Eintrags nicht jedes
 *   Mal die DB anfragt.
 */

const DB_NAME = "LumberjackHeavyFields";
const DB_VERSION = 1;
const STORE = "heavy";

/** Größte Anzahl zwischengespeicherter Records (klein halten – nur Detail-Peek). */
const LRU_MAX = 200;

/**
 * Nur Felder ab dieser Länge (in Zeichen) werden ausgelagert. Kleine
 * Stacktraces / Nachrichten bleiben im Speicher: der Async-Roundtrip würde sich
 * für ein paar hundert Bytes nicht lohnen und die Detailansicht bliebe
 * unnötig asynchron.
 */
export const OFFLOAD_MIN_CHARS = 2000;

export interface HeavyRecord {
  _id: number;
  stackTrace?: string | null;
  _fullMessage?: string;
  _messageSize?: number;
}

class HeavyFieldStore {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<IDBDatabase | null> | null = null;
  private available = true;
  private readonly lru = new Map<number, HeavyRecord>();
  private readonly pending = new Map<number, HeavyRecord>();

  private getDb(): Promise<IDBDatabase | null> {
    if (this.db) return Promise.resolve(this.db);
    if (!this.available) return Promise.resolve(null);
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise<IDBDatabase | null>((resolve) => {
      try {
        if (typeof indexedDB === "undefined") {
          this.available = false;
          resolve(null);
          return;
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: "_id" });
          }
        };
        req.onsuccess = () => {
          this.db = req.result;
          resolve(this.db);
        };
        req.onerror = () => {
          this.available = false;
          resolve(null);
        };
      } catch {
        this.available = false;
        resolve(null);
      }
    });
    return this.initPromise;
  }

  private touchLru(id: number, rec: HeavyRecord): void {
    if (this.lru.has(id)) this.lru.delete(id);
    this.lru.set(id, rec);
    if (this.lru.size > LRU_MAX) {
      const first = this.lru.keys().next().value;
      if (first !== undefined) this.lru.delete(first);
    }
  }

  /**
   * Persistiert (upsert) eine Menge Heavy-Records. Best-effort: Fehler werden
   * verschluckt, damit ein DB-Problem niemals die Log-Anzeige stört.
   */
  async putMany(records: HeavyRecord[]): Promise<void> {
    if (!records.length) return;
    for (const record of records) this.pending.set(record._id, record);

    const db = await this.getDb();
    if (!db) return;
    const persisted = await new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction([STORE], "readwrite");
        const store = tx.objectStore(STORE);
        // `put` = upsert. Nach einem Clear/Reset werden `_id`s wiederverwendet;
        // put ersetzt evtl. vorhandene Alt-Records vollständig (kein
        // Duplicate-Key-Fehler wie bei `add`).
        for (const r of records) store.put(r);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
    if (persisted) {
      for (const record of records) {
        if (this.pending.get(record._id) === record) {
          this.pending.delete(record._id);
        }
      }
    }
  }

  /** Lädt einen einzelnen Heavy-Record (Detailansicht). */
  async get(id: number): Promise<HeavyRecord | undefined> {
    const pending = this.pending.get(id);
    if (pending) return pending;
    const cached = this.lru.get(id);
    if (cached) return cached;
    const db = await this.getDb();
    if (!db) return undefined;
    return new Promise<HeavyRecord | undefined>((resolve) => {
      try {
        const tx = db.transaction([STORE], "readonly");
        const req = tx.objectStore(STORE).get(id);
        req.onsuccess = () => {
          const rec = req.result as HeavyRecord | undefined;
          if (rec) this.touchLru(id, rec);
          resolve(rec);
        };
        req.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  }

  /** Lädt mehrere Records in einer Transaktion (Export). */
  async getMany(ids: number[]): Promise<Map<number, HeavyRecord>> {
    const out = new Map<number, HeavyRecord>();
    if (!ids.length) return out;
    const missing: number[] = [];
    for (const id of ids) {
      const c = this.pending.get(id) ?? this.lru.get(id);
      if (c) out.set(id, c);
      else missing.push(id);
    }
    if (!missing.length) return out;
    const db = await this.getDb();
    if (!db) return out;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction([STORE], "readonly");
        const store = tx.objectStore(STORE);
        let pending = missing.length;
        for (const id of missing) {
          const req = store.get(id);
          req.onsuccess = () => {
            const rec = req.result as HeavyRecord | undefined;
            if (rec) {
              out.set(id, rec);
              this.touchLru(id, rec);
            }
            if (--pending === 0) resolve();
          };
          req.onerror = () => {
            if (--pending === 0) resolve();
          };
        }
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
    return out;
  }

  /**
   * Leert Store + Cache. MUSS beim Löschen aller Einträge / Reset aufgerufen
   * werden, weil `_id`s dann wieder bei 1 beginnen und sonst Alt-Records
   * fälschlich für neue Einträge geladen würden.
   */
  async clear(): Promise<void> {
    this.lru.clear();
    this.pending.clear();
    const db = await this.getDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction([STORE], "readwrite");
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}

export const heavyFieldStore = new HeavyFieldStore();
