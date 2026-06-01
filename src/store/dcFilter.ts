// DiagnosticContextFilter: verwaltet (key,val,active)-Einträge und kann MDC-Prädikate bilden

import {
  canonicalDcKey,
  matchesDcFilter,
  normalizeTraceKeyName,
} from "../utils/dcMatch";

// Re-export für bestehende Konsumenten (z. B. mdcListener)
export { canonicalDcKey };

interface Listener {
  (): void;
}
class SimpleEmitter {
  private _ls = new Set<Listener>();
  on(fn: Listener): () => void {
    if (typeof fn === "function") {
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
        console.warn("Listener error in DiagnosticContextFilter emitter:", e);
      }
    }
  }
}

type DcEntry = { key: string; val: string; active: boolean };
export type { DcEntry };

function entryKey(key: string, val: string): string {
  return `${key}\u241F${val}`;
} // UNIT SEPARATOR-like delimiter

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
    if (v !== this._enabled) {
      this._enabled = v;
      this._em.emit();
    }
  }
  private _normalizeKey(k: string): string {
    const raw = String(k || "").trim();
    if (!raw) return "";
    const canonical = normalizeTraceKeyName(raw);
    return canonical || raw;
  }
  private _normalizeVal(v: string): string {
    return v == null ? "" : String(v);
  }
  // Re-mappe vorhandene Einträge auf kanonische Keys (z. B. traceId -> TraceID) und merge Duplicates
  addMdcEntry(key: string, val: string): void {
    const k = this._normalizeKey(key);
    if (!k) return;
    const v = this._normalizeVal(val);
    const id = entryKey(k, v);
    const existing = this._map.get(id);
    if (existing) {
      // Entry exists - reactivate if it was deactivated
      if (!existing.active) {
        existing.active = true;
        this._em.emit();
      }
      return;
    }
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
  /**
   * Setzt den Aktiv-Status für alle internen Einträge, die dem (kanonischen) Key+Value entsprechen.
   * Das ist robuster, falls historisch Duplikate existieren sollten.
   */
  private _setMdcEntryActive(key: string, val: string, active: boolean): void {
    const k = this._normalizeKey(key);
    if (!k) return;
    const v = this._normalizeVal(val);
    let changed = false;
    for (const e of this._map.values()) {
      const ek = this._normalizeKey(e.key);
      const ev = this._normalizeVal(e.val);
      if (ek === k && ev === v) {
        if (e.active !== active) {
          e.active = active;
          changed = true;
        }
      }
    }
    if (changed) this._em.emit();
  }
  activateMdcEntry(key: string, val: string): void {
    this._setMdcEntryActive(key, val, true);
  }
  deactivateMdcEntry(key: string, val: string): void {
    this._setMdcEntryActive(key, val, false);
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
      (a, b) => a.key.localeCompare(b.key) || a.val.localeCompare(b.val),
    );
  }
  /**
   * Returns the complete state of the DC filter for use by the filter worker.
   * This method provides both the enabled status and all entries in one call.
   * Note: Returns 'value' instead of 'val' for compatibility with the filter worker API.
   */
  getState(): {
    entries: Array<{ key: string; value: string; active: boolean }>;
    enabled: boolean;
  } {
    return {
      entries: this.getDcEntries().map((e) => ({
        key: e.key,
        value: e.val,
        active: e.active,
      })),
      enabled: this._enabled,
    };
  }
  private _hasActive(): boolean {
    for (const e of this._map.values()) if (e.active) return true;
    return false;
  }
  // matches: AND über Keys, OR innerhalb eines Keys. val=='' => Wildcard
  matches(mdc: unknown): boolean {
    if (!this.isEnabled()) return true;
    if (!this._hasActive()) return true;

    const obj =
      mdc && typeof mdc === "object" ? (mdc as Record<string, unknown>) : {};

    const entries = Array.from(this._map.values()).map((e) => ({
      key: e.key,
      value: e.val,
      active: e.active,
    }));

    return matchesDcFilter(obj, entries);
  }
}

import { lazyInstance } from "./_lazy";

/** Public interface for typed access (avoids `as any` casts in consumers) */
export interface IDiagnosticContextFilter {
  onChange(fn: () => void): () => void;
  isEnabled(): boolean;
  setEnabled(v: boolean): void;
  addMdcEntry(key: string, val: string): void;
  removeMdcEntry(key: string, val: string): void;
  activateMdcEntry(key: string, val: string): void;
  deactivateMdcEntry(key: string, val: string): void;
  reset(): void;
  getDcEntries(): DcEntry[];
  getState(): {
    entries: Array<{ key: string; value: string; active: boolean }>;
    enabled: boolean;
  };
  matches(mdc: unknown): boolean;
}

// Export the singleton lazily to avoid temporal-dead-zone issues when modules
// import each other during initialization (bundlers can reorder/rename symbols).
export const DiagnosticContextFilter: IDiagnosticContextFilter = lazyInstance(
  () => new DiagnosticContextFilterImpl(),
);
export function dcEntryId(e: DcEntry): string {
  return entryKey(e.key, e.val);
}
