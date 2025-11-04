// TimeFilter: verwaltet Zeitbereichs-Filter (relativ oder absolut) und bietet ein matches()-Prädikat

class SimpleEmitterTF {
  private _ls = new Set<() => void>();
  on(fn: () => void): () => void {
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
      } catch {
        // Ignore errors in listeners
      }
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
  const unit = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  } as const;
  type UnitKey = keyof typeof unit;
  const mul = unit[u as UnitKey];
  if (!mul) return null;
  return n * mul;
}

function toIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === "number") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

export type TimeFilterMode = "relative" | "absolute";

export interface TimeFilterState {
  enabled: boolean;
  mode: TimeFilterMode;
  duration: string; // z. B. "15m" (nur wenn mode=relative)
  from: string | null; // ISO (nur wenn mode=absolute)
  to: string | null; // ISO (nur wenn mode=absolute)
  // Ankerzeitpunkt für relative Fenster; verhindert Driften bei Re-Renders
  anchorMs?: number | null;
}

class TimeFilterImpl {
  private _em = new SimpleEmitterTF();
  private _state: TimeFilterState = {
    enabled: false,
    mode: "relative",
    duration: "",
    from: null,
    to: null,
    anchorMs: null,
  };

  onChange(fn: () => void): () => void {
    return this._em.on(fn);
  }
  getState(): TimeFilterState {
    return { ...this._state };
  }
  isEnabled(): boolean {
    return this._state.enabled;
  }
  setEnabled(v: boolean): void {
    const nv = v;
    if (nv !== this._state.enabled) {
      this._state.enabled = nv;
      this._em.emit();
    }
  }
  reset(): void {
    this._state = {
      enabled: false,
      mode: "relative",
      duration: "",
      from: null,
      to: null,
      anchorMs: null,
    };
    this._em.emit();
  }
  setRelative(duration: string): void {
    const d = String(duration || "").trim();
    this._state.mode = "relative";
    this._state.duration = d;
    this._state.from = null;
    this._state.to = null;
    // Anker jetzt setzen, damit das Fenster stabil bleibt
    this._state.anchorMs = Date.now();
    this._em.emit();
  }
  setAbsolute(from?: string | Date | null, to?: string | Date | null): void {
    this._state.mode = "absolute";
    this._state.duration = "";
    this._state.from = toIso(from);
    this._state.to = toIso(to);
    this._state.anchorMs = null;
    this._em.emit();
  }

  /** Optional: Anker aktualisieren (z. B. auf Nutzerwunsch) */
  refreshAnchor(): void {
    if (this._state.mode === "relative") {
      this._state.anchorMs = Date.now();
      this._em.emit();
    }
  }

  private _rangeNow(): { from: number | null; to: number | null } {
    if (!this._state.enabled) return { from: null, to: null };
    if (this._state.mode === "relative") {
      const ms = parseDurationMs(this._state.duration);
      if (!ms) return { from: null, to: null };
      // Stabilisiere: benutze Anker, nicht stets Date.now()
      const base = this._state.anchorMs ?? Date.now();
      return { from: base - ms, to: base };
    }
    // absolute
    const fromMs = this._state.from ? Date.parse(this._state.from) : NaN;
    const toMs = this._state.to ? Date.parse(this._state.to) : NaN;
    const f = isNaN(fromMs) ? null : fromMs;
    const t = isNaN(toMs) ? null : toMs;
    if (f == null && t == null) return { from: null, to: null };
    return { from: f, to: t };
  }

  matchesTs(ts: string | number): boolean {
    if (!this._state.enabled) return true;
    const { from, to } = this._rangeNow();
    if (from == null && to == null) return true; // kein wirksamer Bereich gesetzt
    if (ts == null) return false;
    const ms = typeof ts === "number" ? ts : Date.parse(String(ts));
    if (isNaN(ms)) return false;
    if (from != null && ms < from) return false;
    return !(to != null && ms > to);
  }
}

// Lazy singleton
import { lazyInstance } from "./_lazy";
export const TimeFilter = lazyInstance(() => new TimeFilterImpl());
