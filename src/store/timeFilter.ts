// TimeFilter: verwaltet Zeitbereichs-Filter (relativ oder absolut) und bietet ein matches()-Prädikat

class SimpleEmitterTF {
  private _ls = new Set<() => void>();
  on(fn: () => void) {
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

function parseDurationMs(str: string): number | null {
  if (!str) return null;
  const s = String(str).trim().toLowerCase();
  const m = s.match(/^([0-9]+)\s*([smhdw])$/);
  if (!m) return null;
  const n = Number(m[1] || 0);
  const u = m[2];
  if (!(n > 0)) return null;
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 } as const;
  // @ts-ignore
  const mul = unit[u];
  if (!mul) return null;
  return n * mul;
}

function toIso(v: any): string | null {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === 'number') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

export type TimeFilterMode = 'relative' | 'absolute';

export interface TimeFilterState {
  enabled: boolean;
  mode: TimeFilterMode;
  duration: string; // z. B. "15m" (nur wenn mode=relative)
  from: string | null; // ISO (nur wenn mode=absolute)
  to: string | null; // ISO (nur wenn mode=absolute)
}

class TimeFilterImpl {
  private _em = new SimpleEmitterTF();
  private _state: TimeFilterState = {
    enabled: false,
    mode: 'relative',
    duration: '',
    from: null,
    to: null,
  };

  onChange(fn: () => void) {
    return this._em.on(fn);
  }
  getState(): TimeFilterState {
    return { ...this._state };
  }
  isEnabled(): boolean {
    return !!this._state.enabled;
  }
  setEnabled(v: boolean) {
    const nv = !!v;
    if (nv !== this._state.enabled) {
      this._state.enabled = nv;
      this._em.emit();
    }
  }
  reset() {
    this._state = { enabled: false, mode: 'relative', duration: '', from: null, to: null };
    this._em.emit();
  }
  setRelative(duration: string) {
    const d = String(duration || '').trim();
    this._state.mode = 'relative';
    this._state.duration = d;
    this._state.from = null;
    this._state.to = null;
    this._em.emit();
  }
  setAbsolute(from?: string | Date | null, to?: string | Date | null) {
    this._state.mode = 'absolute';
    this._state.duration = '';
    this._state.from = toIso(from);
    this._state.to = toIso(to);
    this._em.emit();
  }

  private _rangeNow(): { from: number | null; to: number | null } {
    if (!this._state.enabled) return { from: null, to: null };
    if (this._state.mode === 'relative') {
      const ms = parseDurationMs(this._state.duration);
      if (!ms) return { from: null, to: null };
      const now = Date.now();
      return { from: now - ms, to: now };
    }
    // absolute
    const fromMs = this._state.from ? Date.parse(this._state.from) : NaN;
    const toMs = this._state.to ? Date.parse(this._state.to) : NaN;
    const f = isNaN(fromMs) ? null : fromMs;
    const t = isNaN(toMs) ? null : toMs;
    if (f == null && t == null) return { from: null, to: null };
    return { from: f, to: t };
  }

  matchesTs(ts: any): boolean {
    if (!this._state.enabled) return true;
    const { from, to } = this._rangeNow();
    if (from == null && to == null) return true; // kein wirksamer Bereich gesetzt
    if (ts == null) return false;
    const ms = typeof ts === 'number' ? ts : Date.parse(String(ts));
    if (isNaN(ms)) return false;
    if (from != null && ms < from) return false;
    if (to != null && ms > to) return false;
    return true;
  }
}

// Lazy singleton
import { lazyInstance } from './_lazy.js';
export const TimeFilter = lazyInstance(() => new TimeFilterImpl());
