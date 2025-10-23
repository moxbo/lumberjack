// DiagnosticContextFilter: verwaltet (key,val,active)-Einträge und kann MDC-Prädikate bilden

class SimpleEmitter {
  constructor() {
    this._ls = new Set();
  }
  on(fn) {
    if (typeof fn === 'function') {
      this._ls.add(fn);
      return () => this._ls.delete(fn);
    }
    return () => {};
  }
  emit() {
    for (const fn of this._ls) {
      try {
        fn();
      } catch {}
    }
  }
}

function entryKey(key, val) {
  return `${key}\u241F${val}`;
} // UNIT SEPARATOR-like delimiter

// Mappe diverse Trace-Key-Varianten auf den kanonischen Anzeigenamen
function normalizeTraceKeyName(k) {
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
function eventKeyVariantsForCanonical(k) {
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
  constructor() {
    this._map = new Map();
    this._em = new SimpleEmitter();
    this._enabled = true;
  }
  onChange(fn) {
    return this._em.on(fn);
  }
  isEnabled() {
    return !!this._enabled;
  }
  setEnabled(v) {
    const nv = !!v;
    if (nv !== this._enabled) {
      this._enabled = nv;
      this._em.emit();
    }
  }
  _normalizeKey(k) {
    const raw = String(k || '').trim();
    if (!raw) return '';
    const canonical = normalizeTraceKeyName(raw);
    return canonical || raw;
  }
  _normalizeVal(v) {
    return v == null ? '' : String(v);
  }
  // Re-mappe vorhandene Einträge auf kanonische Keys (z. B. traceId -> TraceID) und merge Duplicates
  _recanonicalize() {
    const next = new Map();
    for (const e of this._map.values()) {
      const k = this._normalizeKey(e.key);
      const v = this._normalizeVal(e.val);
      const id = entryKey(k, v);
      const prev = next.get(id);
      if (prev) {
        // merge: aktiv wenn einer aktiv ist
        prev.active = !!(prev.active || e.active);
      } else {
        next.set(id, { key: k, val: v, active: !!e.active });
      }
    }
    if (next.size !== this._map.size) {
      this._map = next;
      this._em.emit();
    } else {
      // auch wenn gleich groß, können Keys/IDs geändert worden sein
      this._map = next;
    }
  }
  addMdcEntry(key, val) {
    const k = this._normalizeKey(key);
    if (!k) return;
    const v = this._normalizeVal(val);
    const id = entryKey(k, v);
    const prev = this._map.get(id);
    if (prev) {
      return;
    }
    this._map.set(id, { key: k, val: v, active: true });
    this._em.emit();
  }
  removeMdcEntry(key, val) {
    const k = this._normalizeKey(key);
    if (!k) return;
    const v = this._normalizeVal(val);
    const id = entryKey(k, v);
    if (this._map.delete(id)) this._em.emit();
  }
  activateMdcEntry(key, val) {
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
  deactivateMdcEntry(key, val) {
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
  reset() {
    if (this._map.size) {
      this._map.clear();
    }
    this._em.emit();
  }
  getDcEntries() {
    // Vor Rückgabe sicherstellen, dass alles kanonisch ist
    this._recanonicalize();
    return Array.from(this._map.values()).sort(
      (a, b) => a.key.localeCompare(b.key) || a.val.localeCompare(b.val)
    );
  }
  hasActive() {
    for (const e of this._map.values()) if (e.active) return true;
    return false;
  }
  // matches: AND über Keys, OR innerhalb eines Keys. val=='' => Wildcard
  matches(mdc) {
    if (!this.isEnabled()) return true;
    if (!this.hasActive()) return true;

    // gruppiere aktive Einträge je Key
    const groups = new Map();
    for (const e of this._map.values()) {
      if (!e.active) continue;
      const k = this._normalizeKey(e.key);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }

    const hasOwn = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);

    for (const [canonKey, arr] of groups) {
      const candidates = eventKeyVariantsForCanonical(canonKey);
      // Sammle vorhandene Event-Werte für alle Kandidaten
      const present = [];
      if (mdc && typeof mdc === 'object') {
        for (const k of candidates) if (hasOwn(mdc, k)) present.push(String(mdc[k] ?? ''));
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

export const DiagnosticContextFilter = new DiagnosticContextFilterImpl();
export function dcEntryId(e) {
  return entryKey(e.key, e.val);
}
