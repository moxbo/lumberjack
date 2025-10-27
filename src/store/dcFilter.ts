// DiagnosticContextFilter: verwaltet (key,val,active)-Einträge und kann MDC-Prädikate bilden

interface Listener {
  (): void;
}
class SimpleEmitter {
  private _ls = new Set<Listener>();
  on(fn: Listener): () => void {
    if (typeof fn === 'function') {
      this._ls.add(fn);
      return () => this._ls.delete(fn);
    }
    return () => {};
  }
  emit(): void {
    for (const fn of this._ls) {
      try {
        fn();
      } catch (e) {
        // best-effort: do not throw from listeners
        console.warn('Listener error in DiagnosticContextFilter emitter:', e);
      }
    }
  }
}

type DcEntry = { key: string; val: string; active: boolean };

function entryKey(key: string, val: string): string {
  return `${key}\u241F${val}`;
} // UNIT SEPARATOR-like delimiter

// Mappe diverse Trace-Key-Varianten auf den kanonischen Anzeigenamen
function normalizeTraceKeyName(k: string): string | null {
  const lk = String(k || '')
    .trim()
    .toLowerCase();
  const variants = new Set([
    'traceid',
    'trace_id',
    'trace.id',
    'trace-id',
    'x-trace-id',
    'x_trace_id',
    'x.trace.id',
    'trace',
  ]);
  return variants.has(lk) ? 'TraceID' : null;
}

// Liefert alle Event-Key-Varianten zu einem kanonischen Key
function eventKeyVariantsForCanonical(k: string): string[] {
  const canon = normalizeTraceKeyName(k) || String(k || '').trim();
  if (canon === 'TraceID') {
    return [
      'TraceID',
      'traceId',
      'trace_id',
      'trace.id',
      'trace-id',
      'x-trace-id',
      'x_trace_id',
      'x.trace.id',
      'trace',
    ];
  }
  return [canon];
}

class DiagnosticContextFilterImpl {
  private _map = new Map<string, DcEntry>();
  private _em = new SimpleEmitter();
  private _enabled = true;
  onChange(fn: () => void): () => void {
    return this._em.on(fn);
  }
  isEnabled(): boolean {
    return this._enabled;
  }
  setEnabled(v: boolean): void {
    const nv = v;
    if (nv !== this._enabled) {
      this._enabled = nv;
      this._em.emit();
    }
  }
  private _normalizeKey(k: string): string {
    const raw = String(k || '').trim();
    if (!raw) return '';
    const canonical = normalizeTraceKeyName(raw);
    return canonical || raw;
  }
  private _normalizeVal(v: string): string {
    return v == null ? '' : String(v);
  }
  // Re-mappe vorhandene Einträge auf kanonische Keys (z. B. traceId -> TraceID) und merge Duplicates
  addMdcEntry(key: string, val: string): void {
    const k = this._normalizeKey(key);
    if (!k) return;
    const v = this._normalizeVal(val);
    const id = entryKey(k, v);
    if (this._map.has(id)) return;
    this._map.set(id, { key: k, val: v, active: true });
    this._em.emit();
  }
  removeMdcEntry(key: string, val: string): void {
    const k = this._normalizeKey(key);
    if (!k) return;
    const v = this._normalizeVal(val);
    const id = entryKey(k, v);
    if (this._map.delete(id)) this._em.emit();
  }
  activateMdcEntry(key: string, val: string): void {
    const k = this._normalizeKey(key);
    if (!k) return;
    const v = this._normalizeVal(val);
    const id = entryKey(k, v);
    const e = this._map.get(id);
    if (e && !e.active) {
      e.active = true;
      this._em.emit();
    }
  }
  deactivateMdcEntry(key: string, val: string): void {
    const k = this._normalizeKey(key);
    if (!k) return;
    const v = this._normalizeVal(val);
    const id = entryKey(k, v);
    const e = this._map.get(id);
    if (e && e.active) {
      e.active = false;
      this._em.emit();
    }
  }
  reset(): void {
    if (this._map.size) {
      this._map.clear();
    }
    this._em.emit();
  }
  getDcEntries(): DcEntry[] {
    // Rein funktionale Sicht: canonicalisieren und Duplikate mergen, ohne internen Zustand zu ändern
    const tmp = new Map<string, DcEntry>();
    for (const e of this._map.values()) {
      const k = this._normalizeKey(e.key);
      const v = this._normalizeVal(e.val);
      const id = entryKey(k, v);
      const prev = tmp.get(id);
      if (prev) {
        prev.active = prev.active || e.active;
      } else {
        tmp.set(id, { key: k, val: v, active: e.active });
      }
    }
    return Array.from(tmp.values()).sort(
      (a, b) => a.key.localeCompare(b.key) || a.val.localeCompare(b.val)
    );
  }
  private _hasActive(): boolean {
    for (const e of this._map.values()) if (e.active) return true;
    return false;
  }
  // matches: AND über Keys, OR innerhalb eines Keys. val=='' => Wildcard
  matches(mdc: unknown): boolean {
    if (!this.isEnabled()) return true;
    if (!this._hasActive()) return true;

    // gruppiere aktive Einträge je Key
    const groups = new Map<string, DcEntry[]>();
    for (const e of this._map.values()) {
      if (!e.active) continue;
      const k = this._normalizeKey(e.key);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(e);
    }

    const hasOwn = (obj: Record<string, unknown>, k: string): boolean =>
      Object.prototype.hasOwnProperty.call(obj, k);

    const obj = mdc && typeof mdc === 'object' ? (mdc as Record<string, unknown>) : {};

    for (const [canonKey, arr] of groups) {
      const candidates = eventKeyVariantsForCanonical(canonKey);
      // Sammle vorhandene Event-Werte für alle Kandidaten
      const present: string[] = [];
      for (const k of candidates) {
        if (hasOwn(obj, k)) {
          const val = obj[k];
          present.push(val != null && val !== '' ? String(val ?? '') : '');
        }
      }

      let ok = false;
      for (const it of arr) {
        if (it.val === '') {
          // Wildcard: Key muss vorhanden sein (mind. ein Kandidat)
          if (present.length > 0) {
            ok = true;
            break;
          }
        } else {
          // Match, wenn einer der vorhandenen Werte exakt gleich ist
          if (present.includes(String(it.val))) {
            ok = true;
            break;
          }
        }
      }
      if (!ok) return false;
    }
    return true;
  }
}

import { lazyInstance } from './_lazy.js';

// Export the singleton lazily to avoid temporal-dead-zone issues when modules
// import each other during initialization (bundlers can reorder/rename symbols).
export const DiagnosticContextFilter = lazyInstance(() => new DiagnosticContextFilterImpl());
export function dcEntryId(e: DcEntry): string {
  return entryKey(e.key, e.val);
}
