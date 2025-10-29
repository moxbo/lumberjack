/* eslint-disable */
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-base-to-string, @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-misused-promises, no-empty, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import {useEffect, useMemo, useRef, useState} from 'preact/hooks';
import {Fragment} from 'preact';
import {useVirtualizer} from '@tanstack/react-virtual';
import {highlightAll} from '../utils/highlight';
import {msgMatches} from '../utils/msgFilter';
import logger from '../utils/logger';
import {rendererPerf} from '../utils/rendererPerf';
// Dynamic import for DCFilterDialog (code splitting)
// Preact supports dynamic imports directly
import {LoggingStore} from '../store/loggingStore';
import {canonicalDcKey, DiagnosticContextFilter} from '../store/dcFilter';
import {DragAndDropManager} from '../utils/dnd';
import {compareByTimestampId} from '../utils/sort';
import {TimeFilter} from '../store/timeFilter';
import {lazy, Suspense} from 'preact/compat';
import type {ElasticSearchOptions} from '../types/ipc';
import {MDCListener} from '../store/mdcListener';

// Feste Basisfarben für Markierungen
const BASE_MARK_COLORS = [
  '#F59E0B', // amber
  '#EF4444', // red
  '#10B981', // emerald
  '#3B82F6', // blue
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#14B8A6', // teal
  '#6B7280', // gray
];

// Lazy-load DCFilterDialog as a component
const DCFilterDialog = lazy(() => import('./DCFilterDialog'));
const ElasticSearchDialog = lazy(() => import('./ElasticSearchDialog'));

function levelClass(level: string | null | undefined): string {
  const l = (level || '').toUpperCase();
  return (
    {
      TRACE: 'lev-trace',
      DEBUG: 'lev-debug',
      INFO: 'lev-info',
      WARN: 'lev-warn',
      ERROR: 'lev-error',
      FATAL: 'lev-fatal',
    }[l] || 'lev-unk'
  );
}
function fmt(v: unknown): string {
  return v == null ? '' : String(v);
}
// Lightweight timestamp formatter (replaces moment.js for faster startup)
function fmtTimestamp(ts: string | number | Date | null | undefined): string {
  if (!ts) return '-';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
  } catch (e) {
    return String(ts);
  }
}

// Hilfsfunktion: erzeugt halbtransparente Tönung als rgba()-String
function computeTint(color: string | null | undefined, alpha = 0.4): string {
  if (!color) return '';
  const c = String(color).trim();
  const hexRaw = c.startsWith('#') ? c.slice(1) : '';
  const hex = String(hexRaw);
  if (hex.length === 3) {
    const [h0, h1, h2] = hex as unknown as [string, string, string];
    const r = parseInt(h0 + h0, 16);
    const g = parseInt(h1 + h1, 16);
    const b = parseInt(h2 + h2, 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (hex.length === 6) {
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  // Fallback: unveränderte Farbe (ohne Alpha)
  return c;
}

export default function App() {
  // Track component initialization
  rendererPerf.mark('app-component-init');

  const [entries, setEntries] = useState<any[]>([]);
  const [nextId, setNextId] = useState<number>(1);
  // Keep a ref in sync with nextId for atomic id assignment in appendEntries
  const nextIdRef = useRef<number>(1);
  useEffect(() => {
    nextIdRef.current = nextId;
  }, [nextId]);
  // Persistenz: Markierungen (signature -> color)
  const [marksMap, setMarksMap] = useState<Record<string, string>>({});
  const [onlyMarked, setOnlyMarked] = useState<boolean>(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const lastClicked = useRef<number | null>(null);

  // Follow-Modus
  const [follow, setFollow] = useState<boolean>(false);
  const [followSmooth, setFollowSmooth] = useState<boolean>(false);

  // Theme Mode
  const [themeMode, setThemeMode] = useState<'system' | 'light' | 'dark'>('system');
  function applyThemeMode(mode: string | null | undefined): void {
    const root = document.documentElement;
    if (!mode || mode === 'system') {
      root.removeAttribute('data-theme');
      return;
    }
    root.setAttribute('data-theme', mode);
  }

  const [search, setSearch] = useState<string>('');
  const [filter, setFilter] = useState({
    level: '',
    logger: '',
    thread: '',
    service: '',
    message: '',
  });
  const [stdFiltersEnabled, setStdFiltersEnabled] = useState<boolean>(true);

  // re-render trigger for MDC filter changes
  const [dcVersion, setDcVersion] = useState<number>(0);
  useEffect(() => {
    const off = (DiagnosticContextFilter as any).onChange?.(() => setDcVersion((v) => v + 1));
    return () => {
      try {
        if (typeof off === 'function') off();
      } catch {}
    };
  }, []);
  // re-render trigger for Time filter changes
  const [timeVersion, setTimeVersion] = useState<number>(0);
  useEffect(() => {
    const off = (TimeFilter as any).onChange?.(() => setTimeVersion((v) => v + 1));
    return () => {
      try {
        if (typeof off === 'function') off();
      } catch {}
    };
  }, []);

  // Neuer Dialog-State für DC-Filter
  const [showDcDialog, setShowDcDialog] = useState<boolean>(false);
  // Zeit-Filter Dialog-State
  const [showTimeDialog, setShowTimeDialog] = useState<boolean>(false);
  const [timeForm, setTimeForm] = useState({
    enabled: true,
    mode: 'relative', // 'relative' | 'absolute'
    duration: '15m',
    from: '',
    to: '',
    // Elastic-Suchfelder
    application_name: '',
    logger: '',
    level: '',
    environment: '',
  });

  // Öffnet den Elastic-Search-Dialog und befüllt Formular aus TimeFilter-State
  async function openTimeFilterDialog() {
    // Helper: get last used values from in-memory history or settings as fallback
    const getLasts = async () => {
      let lastApp = (histAppName && histAppName.length > 0 ? String(histAppName[0]) : '') || '';
      let lastEnv =
        (histEnvironment && histEnvironment.length > 0 ? String(histEnvironment[0]) : '') || '';
      if ((!lastApp || !lastEnv) && window.api?.settingsGet) {
        try {
          const res = await window.api.settingsGet();
          const r = res?.ok ? (res.settings as any) : null;
          if (!lastApp && Array.isArray(r?.histAppName) && r.histAppName.length)
            lastApp = String(r.histAppName[0] || '');
          if (!lastEnv && Array.isArray(r?.histEnvironment) && r.histEnvironment.length)
            lastEnv = String(r.histEnvironment[0] || '');
        } catch {
          // ignore
        }
      }
      return { lastApp, lastEnv };
    };

    try {
      const s = (TimeFilter as any).getState?.();
      const toLocal = (iso: unknown) => {
        const t = String(iso || '').trim();
        if (!t) return '';
        const d = new Date(t);
        if (isNaN(d.getTime())) return '';
        const pad = (n: number) => String(n).padStart(2, '0');
        const y = d.getFullYear();
        const m = pad(d.getMonth() + 1);
        const da = pad(d.getDate());
        const hh = pad(d.getHours());
        const mm = pad(d.getMinutes());
        return `${y}-${m}-${da}T${hh}:${mm}`;
      };
      const { lastApp, lastEnv } = await getLasts();
      setTimeForm({
        enabled: true,
        mode: (s && s.mode) || 'relative',
        duration: (s && s.duration) || '15m',
        from: toLocal(s?.from),
        to: toLocal(s?.to),
        application_name: lastApp,
        logger: '',
        level: '',
        environment: lastEnv,
      });
    } catch (e) {
      const { lastApp, lastEnv } = await getLasts();
      setTimeForm({
        enabled: true,
        mode: 'relative',
        duration: '15m',
        from: '',
        to: '',
        application_name: lastApp,
        logger: '',
        level: '',
        environment: lastEnv,
      });
    }
    setShowTimeDialog(true);
  }

  // Setzt das lokale Formular zurück und schließt den Dialog
  function clearTimeFilter() {
    setTimeForm({
      enabled: true,
      mode: 'relative',
      duration: '15m',
      from: '',
      to: '',
      application_name: '',
      logger: '',
      level: '',
      environment: '',
    });
    setShowTimeDialog(false);
  }

  // Filter-Historien
  const [histLogger, setHistLogger] = useState<string[]>([]);
  const [histAppName, setHistAppName] = useState<string[]>([]);
  const [histEnvironment, setHistEnvironment] = useState<string[]>([]);

  // History-Pflege für Elastic-Dialog
  function addToHistory(kind: 'app' | 'env', val: string) {
    const v = String(val || '').trim();
    if (!v) return;
    if (kind === 'app') {
      setHistAppName((prev) => {
        const list = [v, ...prev.filter((x) => x !== v)].slice(0, 10);
        try {
          void window.api.settingsSet({ histAppName: list } as any);
        } catch (e) {
          logger.error('Failed to save histAppName settings:', e);
          alert('Failed to save histAppName settings. See logs for details.');
        }
        return list;
      });
    } else if (kind === 'env') {
      setHistEnvironment((prev) => {
        const list = [v, ...prev.filter((x) => x !== v)].slice(0, 10);
        try {
          void window.api.settingsSet({ histEnvironment: list } as any);
        } catch (e) {
          logger.error('Failed to save histEnvironment settings:', e);
          alert('Failed to save histEnvironment settings. See logs for details.');
        }
        return list;
      });
    }
  }

  const [tcpStatus, setTcpStatus] = useState<string>('');
  const [httpStatus, setHttpStatus] = useState<string>('');
  const [httpPollId, setHttpPollId] = useState<number | null>(null);
  const [tcpPort, setTcpPort] = useState<number>(5000);

  const [httpUrl, setHttpUrl] = useState<string>('');
  const [httpInterval, setHttpInterval] = useState<number>(5000);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [settingsTab, setSettingsTab] = useState<
    'tcp' | 'http' | 'elastic' | 'logging' | 'appearance'
  >('tcp');
  const [form, setForm] = useState({
    tcpPort: 5000,
    httpUrl: '',
    httpInterval: 5000,
    logToFile: false,
    logFilePath: '',
    logMaxMB: 5,
    logMaxBackups: 3,
    themeMode: 'system',
    elasticUrl: '',
    elasticSize: 1000,
    elasticUser: '',
    elasticPassNew: '',
    elasticPassClear: false,
  });

  const [showHttpLoadDlg, setShowHttpLoadDlg] = useState<boolean>(false);
  const [httpLoadUrl, setHttpLoadUrl] = useState<string>('');
  const [showHttpPollDlg, setShowHttpPollDlg] = useState<boolean>(false);
  const [httpPollForm, setHttpPollForm] = useState<{ url: string; interval: number }>({
    url: '',
    interval: 5000,
  });

  function openHttpLoadDialog() {
    try {
      setHttpLoadUrl(String(httpUrl || ''));
    } catch {
      setHttpLoadUrl('');
    }
    setShowHttpLoadDlg(true);
  }
  function openHttpPollDialog() {
    try {
      setHttpPollForm({ url: String(httpUrl || ''), interval: Number(httpInterval || 5000) });
    } catch {
      setHttpPollForm({ url: '', interval: 5000 });
    }
    setShowHttpPollDlg(true);
  }

  // Logging-Settings
  const [logToFile, setLogToFile] = useState<boolean>(false);
  const [logFilePath, setLogFilePath] = useState<string>('');
  const [logMaxBytes, setLogMaxBytes] = useState<number>(5 * 1024 * 1024);
  const [logMaxBackups, setLogMaxBackups] = useState<number>(3);

  // Elasticsearch
  const [elasticUrl, setElasticUrl] = useState<string>('');
  const [elasticSize, setElasticSize] = useState<number>(1000);
  const [elasticUser, setElasticUser] = useState<string>('');
  const [elasticHasPass, setElasticHasPass] = useState<boolean>(false);

  // Kontextmenü + Farbpalette
  const [ctxMenu, setCtxMenu] = useState<{ open: boolean; x: number; y: number }>({
    open: false,
    x: 0,
    y: 0,
  });
  const ctxRef = useRef<HTMLDivElement | null>(null);
  const [customColors, setCustomColors] = useState<string[]>([]);
  const [pickerColor, setPickerColor] = useState<string>('#ffcc00');
  const palette = useMemo(() => [...BASE_MARK_COLORS, ...customColors], [customColors]);
  function addCustomColor(c: string) {
    const color = String(c || '').trim();
    if (!color) return;
    setCustomColors((prev) => {
      const list = prev.includes(color) ? prev : [...prev, color];
      try {
        void window.api.settingsSet({ customMarkColors: list });
      } catch (e) {
        logger.error('Failed to save customMarkColors settings:', e);
      }
      return list;
    });
  }
  function closeContextMenu() {
    setCtxMenu({ open: false, x: 0, y: 0 });
  }
  useEffect(() => {
    if (!ctxMenu.open) return;
    const onMouseDown = (e: MouseEvent) => {
      try {
        if (!ctxRef.current) return closeContextMenu();
        if (!ctxRef.current.contains(e.target as Node)) closeContextMenu();
      } catch {
        closeContextMenu();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu();
    };
    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu.open]);
  function openContextMenu(ev: MouseEvent, idx: number) {
    ev.preventDefault();
    setSelected((prev) => {
      if (prev && prev.has(idx)) return prev;
      return new Set([idx]);
    });
    setCtxMenu({ open: true, x: ev.clientX, y: ev.clientY });
  }

  // Markierung anwenden/entfernen + Persistenz
  function entrySignature(e: any): string {
    const ts = e?.timestamp != null ? String(e.timestamp) : '';
    const lg = e?.logger != null ? String(e.logger) : '';
    const msg = e?.message != null ? String(e.message) : '';
    return `${ts}|${lg}|${msg}`;
  }
  function applyMarkColor(color?: string) {
    setEntries((prev) => {
      if (!prev || !prev.length) return prev;
      const next = prev.slice();
      const newMap: Record<string, string> = { ...marksMap };
      for (const i of selected) {
        if (i >= 0 && i < next.length) {
          const e = next[i] || {};
          const n = { ...e };
          if (color) {
            n._mark = color;
            newMap[entrySignature(n)] = color;
          } else {
            if (n._mark) delete newMap[entrySignature(n)];
            delete n._mark;
          }
          (next as any)[i] = n;
        }
      }
      setMarksMap(newMap);
      try {
        void window.api.settingsSet({ marksMap: newMap });
      } catch {}
      return next;
    });
    closeContextMenu();
  }
  // Synchronisiere bestehende Einträge, wenn marksMap geladen/aktualisiert wird
  useEffect(() => {
    if (!entries.length) return;
    setEntries((prev) =>
      prev.map((e) => {
        const sig = entrySignature(e);
        const c = marksMap[sig];
        if (c && e._mark !== c) return { ...e, _mark: c };
        if (!c && e._mark) {
          const n = { ...e };
          delete n._mark;
          return n;
        }
        return e;
      })
    );
  }, [marksMap]);

  function adoptTraceIds() {
    try {
      const variants = [
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
      const added = new Set<string>();
      for (const i of selected) {
        const e = entries[i];
        const m = e && e.mdc;
        if (!m || typeof m !== 'object') continue;
        for (const k of variants) {
          if (Object.prototype.hasOwnProperty.call(m, k)) {
            const v = String(m[k] ?? '');
            if (v && !added.has(v)) {
              (DiagnosticContextFilter as any).addMdcEntry('TraceID', v);
              added.add(v);
            }
          }
        }
      }
      if (added.size) (DiagnosticContextFilter as any).setEnabled(true);
    } catch (e) {
      logger.warn('adoptTraceIds failed:', e as any);
    }
    closeContextMenu();
  }
  async function copyTsMsg() {
    const list = Array.from(selected).sort((a, b) => a - b);
    const lines = list.map((i) => {
      const e = entries[i] || {};
      return `${fmtTimestamp(e.timestamp)}\n${String(e.message ?? '')}`;
    });
    const text = lines.join('\n');
    try {
      if ((navigator as any)?.clipboard?.writeText)
        await (navigator as any).clipboard.writeText(text);
      else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch (e) {
      logger.error('Failed to copy to clipboard:', e);
      alert('Failed to copy to clipboard. See logs for details.');
    }
    closeContextMenu();
  }

  // Busy helper
  const [busy, setBusy] = useState<boolean>(false);
  const [esBusy, setEsBusy] = useState<boolean>(false);
  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  // HTTP polling helper state
  const [nextPollDueAt, setNextPollDueAt] = useState<number | null>(null);
  const [nextPollIn, setNextPollIn] = useState<string>('');
  useEffect(() => {
    if (!nextPollDueAt) {
      setNextPollIn('');
      return;
    }
    let t = 0 as unknown as number;
    const tick = () => {
      const ms = Math.max(0, Number(nextPollDueAt) - Date.now());
      setNextPollIn(ms > 0 ? `${Math.ceil(ms / 1000)}s` : '');
    };
    tick();
    t = window.setInterval(tick, 250) as unknown as number;
    return () => clearInterval(t as unknown as number);
  }, [nextPollDueAt]);

  // Refs/Layout/Virtualizer
  const parentRef = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const dividerElRef = useRef<HTMLElement | null>(null);
  const dividerStateRef = useRef<{ _resizing: boolean; _startY: number; _startH: number }>({
    _resizing: false,
    _startY: 0,
    _startH: 0,
  });
  const colResize = useRef<{ active: null | string; startX: number; startW: number }>({
    active: null,
    startX: 0,
    startW: 0,
  });

  // Filtered indices
  const filteredIdx = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e) continue;
      if (onlyMarked && !e._mark) continue;
      if (stdFiltersEnabled) {
        if (filter.level) {
          const lev = String(e.level || '').toUpperCase();
          if (lev !== String(filter.level).toUpperCase()) continue;
        }
        if (filter.logger) {
          const q = String(filter.logger || '').toLowerCase();
          if (
            !String(e.logger || '')
              .toLowerCase()
              .includes(q)
          )
            continue;
        }
        if (filter.thread) {
          const q = String(filter.thread || '').toLowerCase();
          if (
            !String(e.thread || '')
              .toLowerCase()
              .includes(q)
          )
            continue;
        }
        if (filter.message) {
          if (!msgMatches(e.message, filter.message)) continue;
        }
      }
      try {
        if (!(TimeFilter as any).matchesTs(e.timestamp)) continue;
      } catch (e) {
        logger.error('TimeFilter.matchesTs error:', e);
        continue;
      }
      try {
        if (!(DiagnosticContextFilter as any).matches(e.mdc || {})) continue;
      } catch (e) {
        logger.error('DiagnosticContextFilter.matches error:', e);
      }
      out.push(i);
    }
    return out;
  }, [entries, stdFiltersEnabled, filter, dcVersion, timeVersion, onlyMarked]);

  const countTotal = entries.length;
  const countFiltered = filteredIdx.length;
  const countSelected = selected.size;

  const rowHeight = 36;
  const virtualizer = useVirtualizer({
    count: filteredIdx.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
  } as any);
  const virtualItems = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();

  function gotoListStart() {
    if (!filteredIdx.length) return;
    virtualizer.scrollToIndex(0, { align: 'start', behavior: followSmooth ? 'smooth' : 'auto' });
  }
  function gotoListEnd() {
    if (!filteredIdx.length) return;
    virtualizer.scrollToIndex(filteredIdx.length - 1, {
      align: 'end',
      behavior: followSmooth ? 'smooth' : 'auto',
    });
  }

  // Selection
  function toggleSelectIndex(idx: number, shift: boolean, meta: boolean) {
    setSelected((prev) => {
      let next = new Set(prev);
      if (shift && lastClicked.current != null) {
        const a = filteredIdx.indexOf(lastClicked.current);
        const b = filteredIdx.indexOf(idx);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          next = new Set(filteredIdx.slice(lo, hi + 1).map((i) => i));
        } else next = new Set([idx]);
      } else if (meta) {
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
      } else {
        next = new Set([idx]);
      }
      lastClicked.current = idx;
      return next;
    });
  }

  const selectedOneIdx = useMemo(() => {
    if (selected.size === 1) return Array.from(selected)[0] as number;
    if (selected.size > 1)
      return lastClicked.current ?? (Array.from(selected).slice(-1)[0] as number);
    return null;
  }, [selected]);
  const selectedEntry = useMemo(
    () => (selectedOneIdx != null ? entries[selectedOneIdx] || null : null),
    [selectedOneIdx, entries]
  );

  const mdcPairs = useMemo(() => {
    const e = selectedEntry;
    const mdc = e && e.mdc && typeof e.mdc === 'object' ? (e.mdc as Record<string, unknown>) : null;
    if (!mdc) return [] as [string, string][];
    // Gruppiere nach kanonischem Key (z. B. traceId/TraceID -> TraceID) und dedupliziere Werte
    const byKey = new Map<string, Set<string>>();
    for (const [k, v] of Object.entries(mdc)) {
      const ck = canonicalDcKey(k);
      if (!ck) continue;
      const val = v == null ? '' : String(v);
      if (!byKey.has(ck)) byKey.set(ck, new Set());
      byKey.get(ck)!.add(val);
    }
    const pairs: Array<[string, string]> = [];
    for (const [k, set] of byKey.entries()) {
      // prettier-ignore
      const vals = Array.from(set).filter((s) => s !== '').sort((a, b) => a.localeCompare(b));
      const hasEmpty = set.has('');
      const joined = vals.join(' | ');
      pairs.push([k, hasEmpty && !joined ? '' : joined]);
    }
    pairs.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    return pairs;
  }, [selectedEntry]);

  const markedIdx = useMemo(() => {
    const out: number[] = [];
    for (let vi = 0; vi < filteredIdx.length; vi++) {
      const idx = filteredIdx[vi]!;
      const e = entries[idx];
      if (e?._mark) out.push(vi);
    }
    return out;
  }, [filteredIdx, entries]);
  const searchMatchIdx = useMemo(() => {
    const s = String(search || '').trim();
    if (!s) return [] as number[];
    const out: number[] = [];
    for (let vi = 0; vi < filteredIdx.length; vi++) {
      const idx = filteredIdx[vi]!;
      const e = entries[idx];
      if (msgMatches(e?.message, s)) out.push(vi);
    }
    return out;
  }, [search, filteredIdx, entries]);

  function gotoMarked(dir: number) {
    if (!markedIdx.length) return;
    const curVi = selectedOneIdx != null ? filteredIdx.indexOf(selectedOneIdx) : -1;
    let targetVi: number;
    if (dir > 0) targetVi = markedIdx.find((vi) => vi > curVi) ?? markedIdx[0]!;
    else {
      let prev = -1;
      for (const vi of markedIdx) if (vi < curVi) prev = vi;
      targetVi = prev >= 0 ? prev : markedIdx[markedIdx.length - 1]!;
    }
    const globalIdx: number = filteredIdx[targetVi]!;
    setSelected(new Set([globalIdx]));
    lastClicked.current = globalIdx;
    virtualizer.scrollToIndex(targetVi, {
      align: 'center',
      behavior: followSmooth ? 'smooth' : 'auto',
    });
  }
  function gotoSearchMatch(dir: number) {
    if (!searchMatchIdx.length) return;
    const curVi = selectedOneIdx != null ? filteredIdx.indexOf(selectedOneIdx) : -1;
    let targetVi: number;
    if (dir > 0) targetVi = searchMatchIdx.find((vi) => vi > curVi) ?? searchMatchIdx[0]!;
    else {
      let prev = -1;
      for (const vi of searchMatchIdx) if (vi < curVi) prev = vi;
      targetVi = prev >= 0 ? prev : searchMatchIdx[searchMatchIdx.length - 1]!;
    }
    const globalIdx: number = filteredIdx[targetVi]!;
    setSelected(new Set([globalIdx]));
    lastClicked.current = globalIdx;
    virtualizer.scrollToIndex(targetVi, {
      align: 'center',
      behavior: followSmooth ? 'smooth' : 'auto',
    });
  }

  // Append entries helper
  function appendEntries(newEntries: any[]) {
    if (!Array.isArray(newEntries) || newEntries.length === 0) return;
    const toAdd = newEntries.map((e, i) => {
      const n = { ...e, _id: nextId + i };
      const sig = entrySignature(n);
      if (marksMap[sig]) n._mark = marksMap[sig];
      return n;
    });
    try {
      (LoggingStore as any).addEvents(toAdd);
    } catch (e) {
      logger.error('LoggingStore.addEvents error:', e);
      alert(
        'Failed to process new log entries. See logs for details. ' +
          ((e as any)?.message || String(e))
      );
    }
    setEntries((prev) => [...prev, ...toAdd].sort(compareByTimestampId as any));
    setNextId((prev) => prev + toAdd.length);
  }

  // Follow mode auto-select
  useEffect(() => {
    if (!follow) return;
    if (!filteredIdx.length) return;
    const lastGlobalIdx = filteredIdx[filteredIdx.length - 1] as number;
    setSelected(new Set([lastGlobalIdx]));
    setTimeout(() => gotoListEnd(), 0);
  }, [entries, follow, stdFiltersEnabled, filter, dcVersion, timeVersion]);

  function addMdcToFilter(k: string, v: string) {
    try {
      (DiagnosticContextFilter as any).addMdcEntry(k, v ?? '');
      (DiagnosticContextFilter as any).setEnabled(true);
    } catch (e) {
      logger.error('Failed to add MDC entry to filter:', e);
      alert('Failed to add MDC entry to filter. See logs for details.');
    }
  }

  const [, setMdcAgg] = useState([] as { key: string; values: { val: string; count: number }[] }[]);
  const [, setMdcSelKey] = useState<string>('');
  const [, setMdcSelVals] = useState<Set<string>>(new Set());
  const [, setShowMdcModal] = useState<boolean>(false);

  function openMdcFromSelection() {
    const byKey: Map<string, Map<string, number>> = new Map();
    for (const idx of selected) {
      const e = entries[idx];
      const m = e && e.mdc;
      if (!m || typeof m !== 'object') continue;
      for (const [k, v] of Object.entries(m)) {
        const key = String(k);
        const val = String(v ?? '');
        if (!byKey.has(key)) byKey.set(key, new Map());
        const mm = byKey.get(key)!;
        mm.set(val, (mm.get(val) || 0) + 1);
      }
    }
    const agg = Array.from(byKey.entries()).map(([key, mm]) => ({
      key,
      values: Array.from(mm.entries())
        .map(([val, count]) => ({ val, count }))
        .sort((a, b) => b.count - a.count || a.val.localeCompare(b.val)),
    }));
    agg.sort((a, b) => a.key.localeCompare(b.key));
    setMdcAgg(agg);
    setMdcSelKey(agg[0]?.key || '');
    setMdcSelVals(new Set());
    setShowMdcModal(true);
  }

  const [showTitleDlg, setShowTitleDlg] = useState<boolean>(false);
  const [titleInput, setTitleInput] = useState<string>('Lumberjack');
  async function openSetWindowTitleDialog() {
    try {
      const res = await window.api?.windowTitleGet?.();
      const t =
        res?.ok && typeof res.title === 'string' && res.title.trim()
          ? String(res.title)
          : 'Lumberjack';
      setTitleInput(t);
    } catch {
      setTitleInput('Lumberjack');
    }
    setShowTitleDlg(true);
  }
  async function applySetWindowTitle() {
    const t = String(titleInput || '').trim();
    if (!t) {
      alert('Bitte einen Fenstertitel eingeben');
      return;
    }
    try {
      await window.api?.windowTitleSet?.(t);
      setShowTitleDlg(false);
    } catch (e) {
      alert('Speichern fehlgeschlagen: ' + ((e as any)?.message || String(e)));
    }
  }

  // Settings laden (deferred to not block initial render)
  useEffect(() => {
    // Use requestIdleCallback to defer settings load until after initial render
    const loadSettings = async () => {
      rendererPerf.mark('settings-load-start');
      try {
        if (!window.api?.settingsGet) {
          logger.error('window.api.settingsGet is not available.');
          return;
        }
        const result = await window.api.settingsGet();
        if (!result || !result.ok) {
          logger.warn('Failed to load settings:', (result as any)?.error);
          return;
        }
        const r = result.settings as any;
        if (!r) return;
        if (r.tcpPort != null) setTcpPort(Number(r.tcpPort) || 5000);
        if (typeof r.httpUrl === 'string') setHttpUrl(r.httpUrl);
        if (r.httpInterval != null) setHttpInterval(Number(r.httpInterval) || 5000);
        if (Array.isArray(r.histLogger)) setHistLogger(r.histLogger);
        if (Array.isArray(r.histAppName)) setHistAppName(r.histAppName);
        if (Array.isArray(r.histEnvironment)) setHistEnvironment(r.histEnvironment);
        if (typeof r.themeMode === 'string') {
          const mode = ['light', 'dark', 'system'].includes(r.themeMode) ? r.themeMode : 'system';
          setThemeMode(mode);
          applyThemeMode(mode);
        }
        if (typeof r.follow === 'boolean') setFollow(!!r.follow);
        if (typeof r.followSmooth === 'boolean') setFollowSmooth(!!r.followSmooth);
        const root = document.documentElement;
        const detail = Number(r.detailHeight || 0);
        if (detail) root.style.setProperty('--detail-height', `${Math.round(detail)}px`);
        const map: Array<[string, unknown]> = [
          ['--col-ts', r.colTs],
          ['--col-lvl', r.colLvl],
          ['--col-logger', r.colLogger],
        ];
        for (const [k, v] of map)
          if (v != null) root.style.setProperty(k, `${Math.round(Number(v) || 0)}px`);
        setLogToFile(!!r.logToFile);
        setLogFilePath(String(r.logFilePath || ''));
        setLogMaxBytes(Number(r.logMaxBytes || 5 * 1024 * 1024));
        setLogMaxBackups(Number(r.logMaxBackups || 3));
        setElasticUrl(String(r.elasticUrl || ''));
        setElasticSize(Number(r.elasticSize || 1000));
        setElasticUser(String(r.elasticUser || ''));
        setElasticHasPass(!!String(r.elasticPassEnc || '').trim());
        if (r.marksMap && typeof r.marksMap === 'object')
          setMarksMap(r.marksMap as Record<string, string>);
        if (Array.isArray(r.customMarkColors)) setCustomColors(r.customMarkColors as string[]);
        if (typeof r.onlyMarked === 'boolean') setOnlyMarked(!!r.onlyMarked);
        rendererPerf.mark('settings-loaded');
      } catch (e) {
        logger.error('Error loading settings:', e);
      }
    };

    // Use requestIdleCallback with a timeout to ensure settings load eventually
    const idleId = requestIdleCallback(
      () => {
        loadSettings();
      },
      { timeout: 100 }
    );
    return () => cancelIdleCallback(idleId);
  }, []);

  async function openSettingsModal(
    initialTab?: 'tcp' | 'http' | 'elastic' | 'logging' | 'appearance'
  ) {
    let curMode = themeMode;
    try {
      if (window.api?.settingsGet) {
        const result = await window.api.settingsGet();
        const r = result?.ok ? (result.settings as any) : null;
        if (r && typeof r.themeMode === 'string') {
          const mode = ['light', 'dark', 'system'].includes(r.themeMode) ? r.themeMode : 'system';
          curMode = mode;
          setThemeMode(mode);
          applyThemeMode(mode);
        }
        if (r && typeof r.follow === 'boolean') setFollow(!!r.follow);
        if (r && typeof r.followSmooth === 'boolean') setFollowSmooth(!!r.followSmooth);
      }
    } catch {}
    setForm({
      tcpPort,
      httpUrl,
      httpInterval,
      logToFile,
      logFilePath,
      logMaxMB: Math.max(1, Math.round((logMaxBytes || 5 * 1024 * 1024) / (1024 * 1024))),
      logMaxBackups,
      themeMode: curMode,
      elasticUrl,
      elasticSize,
      elasticUser,
      elasticPassNew: '',
      elasticPassClear: false,
    });
    setSettingsTab(initialTab || 'tcp');
    setShowSettings(true);
  }
  async function saveSettingsModal() {
    const port = Number(form.tcpPort || 0);
    if (!(port >= 1 && port <= 65535)) {
      alert('Ungültiger TCP-Port');
      return;
    }
    const interval = Math.max(500, Number(form.httpInterval || 5000));
    const toFile = form.logToFile;
    const path = String(form.logFilePath || '').trim();
    const maxMB = Math.max(1, Number(form.logMaxMB || 5));
    const maxBytes = Math.round(maxMB * 1024 * 1024);
    const backups = Math.max(0, Number(form.logMaxBackups || 0));
    const mode = ['light', 'dark', 'system'].includes(form.themeMode)
      ? (form.themeMode as any)
      : 'system';
    const patch: any = {
      tcpPort: port,
      httpUrl: String(form.httpUrl || '').trim(),
      httpInterval: interval,
      logToFile: toFile,
      logFilePath: path,
      logMaxBytes: maxBytes,
      logMaxBackups: backups,
      themeMode: mode,
      elasticUrl: String(form.elasticUrl || '').trim(),
      elasticSize: Math.max(1, Number(form.elasticSize || 1000)),
      elasticUser: String(form.elasticUser || '').trim(),
    };
    const newPass = String(form.elasticPassNew || '').trim();
    if (form.elasticPassClear) patch['elasticPassClear'] = true;
    else if (newPass) patch['elasticPassPlain'] = newPass;
    try {
      const res = await window.api.settingsSet(patch);
      if (!res || !res.ok) {
        alert('Speichern fehlgeschlagen: ' + ((res as any)?.error || 'Unbekannter Fehler'));
        return;
      }
      setTcpPort(port);
      setHttpUrl(String(form.httpUrl || '').trim());
      setHttpInterval(interval);
      setLogToFile(toFile);
      setLogFilePath(path);
      setLogMaxBytes(maxBytes);
      setLogMaxBackups(backups);
      setThemeMode(mode);
      applyThemeMode(mode);
      setElasticUrl(String(form.elasticUrl || '').trim());
      setElasticSize(Math.max(1, Number(form.elasticSize || 1000)));
      setElasticUser(String(form.elasticUser || '').trim());
      if (form.elasticPassClear) setElasticHasPass(false);
      else if (newPass) setElasticHasPass(true);
      setShowSettings(false);
    } catch (e) {
      logger.error('Failed to save settings:', e);
      alert('Speichern fehlgeschlagen: ' + ((e as any)?.message || String(e)));
    }
  }

  // IPC listeners setup (deferred to not block rendering)
  useEffect(() => {
    rendererPerf.mark('ipc-setup-start');
    const offs: Array<() => void> = [];
    try {
      if (window.api?.onAppend) {
        const off = window.api.onAppend((newEntries) => {
          appendEntries(newEntries as any[]);
        });
        offs.push(off);
      }
    } catch {}
    try {
      if (window.api?.onMenu) {
        const off = window.api.onMenu(async (cmd) => {
          try {
            const { type, tab } = (cmd as any) || ({} as any);
            switch (type) {
              case 'open-files': {
                const paths = await window.api.openFiles();
                if (paths && paths.length) {
                  const res = await window.api.parsePaths(paths);
                  if (res?.ok) appendEntries(res.entries as any);
                }
                break;
              }
              case 'open-settings': {
                await openSettingsModal(tab || 'tcp');
                break;
              }
              case 'tcp-start': {
                try {
                  window.api.tcpStart(tcpPort);
                } catch (e) {
                  logger.error('Fehler beim Starten des TCP-Servers:', e);
                }
                break;
              }
              case 'tcp-stop': {
                try {
                  window.api.tcpStop();
                } catch (e) {
                  logger.error('Fehler beim Stoppen des TCP-Servers:', e);
                }
                break;
              }
              case 'http-load': {
                openHttpLoadDialog();
                break;
              }
              case 'http-start-poll': {
                openHttpPollDialog();
                break;
              }
              case 'http-stop-poll': {
                if (httpPollId != null) void httpMenuStopPoll();
                break;
              }
              case 'tcp-configure': {
                await openSettingsModal('tcp');
                break;
              }
              case 'window-title': {
                await openSetWindowTitleDialog();
                break;
              }
              default:
                break;
            }
          } catch (e) {
            logger.warn('Menu command failed:', e);
          }
        });
        offs.push(off);
      }
    } catch (e) {
      logger.error('onMenu setup failed:', e);
    }
    try {
      if (window.api?.onTcpStatus) {
        const off = window.api.onTcpStatus((st) => {
          setTcpStatus(
            (st as any)?.ok
              ? (st as any).running
                ? `TCP: Port ${(st as any).port} aktiv`
                : 'TCP gestoppt'
              : (st as any).message || 'TCP-Fehler'
          );
        });
        offs.push(off);
      }
    } catch (e) {
      logger.error('onTcpStatus setup failed:', e);
    }
    rendererPerf.mark('ipc-setup-complete');
    return () => {
      for (const f of offs)
        try {
          f();
        } catch (e) {
          logger.error('Failed to remove IPC listener:', e);
        }
    };
  }, [httpPollId, tcpPort]);

  // Drag & Drop
  const [dragActive, setDragActive] = useState<boolean>(false);
  useEffect(() => {
    const mgr = new DragAndDropManager({
      onFiles: async (paths) => {
        await withBusy(async () => {
          if (!window.api?.parsePaths) {
            alert('API nicht verfügbar. Preload-Skript wurde möglicherweise nicht geladen.');
            return;
          }
          const res = await window.api.parsePaths(paths);
          if (res?.ok) appendEntries(res.entries as any);
          else alert('Fehler beim Laden (Drop): ' + (res as any)?.error || 'unbekannt');
        });
      },
      onActiveChange: (active) => setDragActive(active),
      onRawFiles: async (files) => {
        await withBusy(async () => {
          try {
            if (!window.api?.parseRawDrops) {
              alert('API nicht verfügbar. Preload-Skript wurde möglicherweise nicht geladen.');
              return;
            }
            const res = await window.api.parseRawDrops(files);
            if (res?.ok) appendEntries(res.entries as any);
            else alert('Fehler beim Laden (Drop-Rohdaten): ' + (res as any)?.error || 'unbekannt');
          } catch (e) {
            logger.error('Fehler beim Einlesen der Dateien (Drop-Rohdaten):', e);
            alert('Fehler beim Einlesen der Dateien: ' + ((e as any)?.message || String(e)));
          }
        });
      },
    });
    mgr.attach();
    return () => mgr.detach();
  }, []);

  const [esHasMore, setEsHasMore] = useState<boolean>(false);
  const [esNextSearchAfter, setEsNextSearchAfter] = useState<Array<string | number> | null>(null);
  const [lastEsForm, setLastEsForm] = useState<any>(null);
  const [esTotal, setEsTotal] = useState<number | null>(null);
  const [esBaseline, setEsBaseline] = useState<number>(0);
  const esElasticCountAll = useMemo(() => {
    let cnt = 0;
    for (const e of entries) {
      const src = e?.source;
      if (typeof src === 'string' && src.startsWith('elastic://')) cnt++;
    }
    return cnt;
  }, [entries]);
  const esLoaded = Math.max(0, esElasticCountAll - esBaseline);

  function clearLogs() {
    setEntries([]);
    setSelected(new Set());
    setNextId(1);
    setEsHasMore(false);
    setEsNextSearchAfter(null);
    setLastEsForm(null);
    setEsTotal(null);
    setEsBaseline(0);
    try {
      (LoggingStore as any).reset();
    } catch (e) {
      logger.error('LoggingStore.reset error:', e);
      alert('Failed to reset logging store. See logs for details.');
    }
    setHttpStatus('');
    setTcpStatus('');
  }

  async function httpMenuStopPoll() {
    if (httpPollId == null) return;
    const r = await window.api.httpStopPoll(httpPollId);
    if (r.ok) {
      setHttpStatus('Poll gestoppt');
      setHttpPollId(null);
      setNextPollIn('');
      setNextPollDueAt(null);
    }
  }

  // Divider Drag
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dividerStateRef.current._resizing) return;
      const startY = dividerStateRef.current._startY;
      const startH = dividerStateRef.current._startH;
      const dy = e.clientY - startY;
      let newH = startH - dy;
      const layout = layoutRef.current;
      const total = layout
        ? (layout as any).clientHeight
        : document.body.clientHeight || window.innerHeight;
      const minDetail = 150;
      const minList = 140;
      const csRoot = getComputedStyle(document.documentElement);
      const divVar = csRoot.getPropertyValue('--divider-h').trim();
      const dividerSize = Math.max(0, parseInt(divVar.replace('px', ''), 10) || 8);
      const maxDetail = Math.max(minDetail, total - minList - dividerSize);
      if (newH < minDetail) newH = minDetail;
      if (newH > maxDetail) newH = maxDetail;
      document.documentElement.style.setProperty('--detail-height', `${Math.round(newH)}px`);
    }
    async function onMouseUp() {
      dividerStateRef.current._resizing = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      try {
        const cs = getComputedStyle(document.documentElement);
        const h = cs.getPropertyValue('--detail-height').trim();
        const num = Number(h.replace('px', '')) || 300;
        await window.api.settingsSet({ detailHeight: Math.round(num) });
      } catch (e) {
        logger.warn('Setting detailHeight via API failed:', e);
      }
    }
    function onMouseDown(e: MouseEvent) {
      dividerStateRef.current._resizing = true;
      dividerStateRef.current._startY = e.clientY;
      const cs = getComputedStyle(document.documentElement);
      const h = cs.getPropertyValue('--detail-height').trim();
      dividerStateRef.current._startH = Number(h.replace('px', '')) || 300;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'row-resize';
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }
    const el = dividerElRef.current;
    if (el) el.addEventListener('mousedown', onMouseDown as any);
    return () => {
      if (el) el.removeEventListener('mousedown', onMouseDown as any);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // Spalten-Resize (Zeit/Level/Logger)
  function onColMouseDown(key: 'ts' | 'lvl' | 'logger', e: MouseEvent) {
    const varMap: Record<string, string> = {
      ts: '--col-ts',
      lvl: '--col-lvl',
      logger: '--col-logger',
    };
    const active = varMap[key];
    if (!active) return;
    const cs = getComputedStyle(document.documentElement);
    const cur = cs.getPropertyValue(active).trim();
    const curW = Number(cur.replace('px', '')) || 0;
    const onMove = (ev: MouseEvent) => onColMouseMove(ev);
    const onUp = async () => {
      await onColMouseUp();
    };
    colResize.current = { active, startX: e.clientX, startW: curW };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
  function onColMouseMove(e: MouseEvent) {
    const st = colResize.current;
    if (!st.active) return;
    let newW = st.startW + (e.clientX - st.startX);
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
    if (st.active === '--col-ts') newW = clamp(newW, 140, 600);
    if (st.active === '--col-lvl') newW = clamp(newW, 70, 200);
    if (st.active === '--col-logger') newW = clamp(newW, 160, 800);
    document.documentElement.style.setProperty(st.active, `${Math.round(newW)}px`);
  }
  async function onColMouseUp() {
    const st = colResize.current;
    colResize.current = { active: null, startX: 0, startW: 0 };
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    window.removeEventListener('mousemove', onColMouseMove as any);
    window.removeEventListener('mouseup', onColMouseUp as any);
    try {
      if (!st.active) return;
      const cs = getComputedStyle(document.documentElement);
      const val = cs.getPropertyValue(st.active).trim();
      const num = Number(val.replace('px', '')) || 0;
      const keyMap: Record<string, string> = {
        '--col-ts': 'colTs',
        '--col-lvl': 'colLvl',
        '--col-logger': 'colLogger',
      };
      const k = keyMap[st.active];
      if (k) await window.api.settingsSet({ [k]: Math.round(num) } as any);
    } catch (e) {
      logger.warn('Column resize setting failed:', e);
    }
  }

  // Starte MDCListener früh, damit Keys/Werte gesammelt werden, sobald Events eintreffen
  useEffect(() => {
    try {
      MDCListener.startListening();
    } catch (e) {
      logger.warn('MDCListener.startListening failed:', e as any);
    }
  }, []);

  // Track when the component has fully mounted and is interactive
  useEffect(() => {
    rendererPerf.mark('app-mounted');
    // Log performance summary after a short delay to capture all initialization
    setTimeout(() => {
      const elapsed = rendererPerf.getElapsedTime();
      logger.log(`[App] Fully initialized in ${Math.round(elapsed)}ms`);
    }, 100);
  }, []);

  return (
    <div style="height:100%; display:flex; flex-direction:column;">
      {dragActive && <div className="drop-overlay">Dateien hierher ziehen (.log, .json, .zip)</div>}
      {/* DC-Filter Dialog */}
      {showDcDialog && (
        <div className="modal-backdrop" onClick={() => setShowDcDialog(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>Diagnostic Context Filter</h3>
            <Suspense fallback={<div style={{ padding: '20px' }}>Lädt...</div>}>
              <DCFilterDialog />
            </Suspense>
            <div className="modal-actions">
              <button onClick={() => setShowDcDialog(false)}>Schließen</button>
            </div>
          </div>
        </div>
      )}

      {/* Elastic-Search Dialog */}
      {showTimeDialog && (
        <Suspense
          fallback={
            <div className="modal-backdrop">
              <div className="modal">Lädt…</div>
            </div>
          }
        >
          <ElasticSearchDialog
            open={showTimeDialog}
            initial={timeForm}
            histAppName={histAppName}
            histEnvironment={histEnvironment}
            firstTs={(() => {
              const firstIdx = filteredIdx[0];
              return firstIdx != null ? entries[firstIdx]?.timestamp : null;
            })()}
            lastTs={(() => {
              const lastIdx = filteredIdx[filteredIdx.length - 1];
              return lastIdx != null ? entries[lastIdx]?.timestamp : null;
            })()}
            onApply={async (formVals: any) => {
              try {
                setShowTimeDialog(false);
                addToHistory('app', formVals?.application_name || '');
                addToHistory('env', formVals?.environment || '');
                setLastEsForm(formVals);
                if (formVals.mode === 'relative' && formVals.duration)
                  TimeFilter.setRelative(formVals.duration);
                else if (formVals.mode === 'absolute') {
                  const from = formVals.from || undefined;
                  const to = formVals.to || undefined;
                  TimeFilter.setAbsolute(from, to);
                }
                TimeFilter.setEnabled(true);
                await withBusy(async () => {
                  setEsBusy(true);
                  setEsTotal(null);
                  try {
                    const opts: ElasticSearchOptions = {
                      url: elasticUrl || undefined,
                      size: elasticSize || undefined,
                      index: formVals.index,
                      sort: formVals.sort,
                      duration: formVals.mode === 'relative' ? formVals.duration : undefined,
                      from: formVals.mode === 'absolute' ? formVals.from : undefined,
                      to: formVals.mode === 'absolute' ? formVals.to : undefined,
                      application_name: formVals.application_name,
                      logger: formVals.logger,
                      level: formVals.level,
                      environment: formVals.environment,
                      allowInsecureTLS: !!formVals.allowInsecureTLS,
                    } as any;
                    logger.info('[Elastic] Search started', { hasResponse: false });
                    // Set Baseline (replace => 0, sonst aktueller Elastic-Count)
                    const loadMode = String(formVals.loadMode || 'append');
                    setEsBaseline(loadMode === 'replace' ? 0 : esElasticCountAll);
                    const res = await window.api.elasticSearch(opts);
                    const total = Array.isArray(res?.entries) ? res.entries.length : 0;
                    logger.info('[Elastic] Search finished', {
                      ok: !!res?.ok,
                      total,
                      hasResponse: true,
                    });
                    if (res?.ok) {
                      // Reset pagination when new search is started
                      setEsHasMore(!!res.hasMore);
                      setEsNextSearchAfter((res.nextSearchAfter as any) || null);
                      setEsTotal(
                        typeof (res as any)?.total === 'number' ? Number((res as any).total) : null
                      );
                      if ((formVals.loadMode || 'replace') === 'replace') {
                        setEntries([]);
                        setSelected(new Set());
                        setNextId(1);
                      }
                      if (Array.isArray(res.entries) && res.entries.length)
                        appendEntries(res.entries as any[]);
                    } else {
                      alert('Elastic-Fehler: ' + ((res as any)?.error || 'Unbekannt'));
                    }
                  } finally {
                    setEsBusy(false);
                  }
                });
              } catch (e) {
                logger.error('[Elastic] Search failed', e as any);
                alert('Elastic-Fehler: ' + ((e as any)?.message || String(e)));
              }
            }}
            onClear={() => {
              clearTimeFilter();
              TimeFilter.reset();
            }}
            onClose={() => setShowTimeDialog(false)}
          />
        </Suspense>
      )}

      {/* HTTP Load Dialog */}
      {showHttpLoadDlg && (
        <div className="modal-backdrop" onClick={() => setShowHttpLoadDlg(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>HTTP einmal laden</h3>
            <div className="kv">
              <span>HTTP URL</span>
              <input
                type="text"
                value={httpLoadUrl}
                onInput={(e) => setHttpLoadUrl(e.currentTarget.value)}
                placeholder="https://…/logs.json"
                autoFocus
              />
            </div>
            <div className="modal-actions">
              <button onClick={() => setShowHttpLoadDlg(false)}>Abbrechen</button>
              <button
                onClick={async () => {
                  const url = String(httpLoadUrl || '').trim();
                  if (!url) {
                    alert('Bitte eine gültige URL eingeben');
                    return;
                  }
                  setShowHttpLoadDlg(false);
                  await withBusy(async () => {
                    try {
                      setHttpUrl(url);
                      await window.api.settingsSet({ httpUrl: url } as any);
                      const res = await window.api.httpLoadOnce(url);
                      if (res.ok) appendEntries((res.entries || []) as any[]);
                      else setHttpStatus('Fehler: ' + (res.error || 'unbekannt'));
                    } catch (e) {
                      setHttpStatus('Fehler: ' + ((e as any)?.message || String(e)));
                    }
                  });
                }}
              >
                Laden
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HTTP Poll Dialog */}
      {showHttpPollDlg && (
        <div className="modal-backdrop" onClick={() => setShowHttpPollDlg(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>HTTP Poll starten</h3>
            <div className="kv">
              <span>HTTP URL</span>
              <input
                type="text"
                value={httpPollForm.url}
                onInput={(e) => setHttpPollForm({ ...httpPollForm, url: e.currentTarget.value })}
                placeholder="https://…/logs.json"
                autoFocus
              />
            </div>
            <div className="kv">
              <span>Intervall (ms)</span>
              <input
                type="number"
                min="500"
                step="500"
                value={httpPollForm.interval}
                onInput={(e) =>
                  setHttpPollForm({
                    ...httpPollForm,
                    interval: Math.max(0, Number(e.currentTarget.value || 0)),
                  })
                }
              />
            </div>
            <div className="modal-actions">
              <button onClick={() => setShowHttpPollDlg(false)}>Abbrechen</button>
              <button
                disabled={httpPollId != null}
                title={httpPollId != null ? 'Bitte laufendes Polling zuerst stoppen' : ''}
                onClick={async () => {
                  const url = String(httpPollForm.url || '').trim();
                  const ms = Math.max(500, Number(httpPollForm.interval || 5000));
                  if (!url) {
                    alert('Bitte eine gültige URL eingeben');
                    return;
                  }
                  if (httpPollId != null) return;
                  setShowHttpPollDlg(false);
                  try {
                    setHttpUrl(url);
                    setHttpInterval(ms);
                    await window.api.settingsSet({ httpUrl: url, httpInterval: ms } as any);
                    const r = await window.api.httpStartPoll({ url, intervalMs: ms });
                    if (r.ok) {
                      setHttpPollId(r.id!);
                      setHttpStatus(`Polling #${r.id}`);
                      setNextPollDueAt(Date.now() + ms);
                    } else setHttpStatus('Fehler: ' + (r.error || 'unbekannt'));
                  } catch (e) {
                    setHttpStatus('Fehler: ' + ((e as any)?.message || String(e)));
                  }
                }}
              >
                Starten
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Einstellungen (Tabs) */}
      {showSettings && (
        <div
          className="modal-backdrop"
          onClick={() => {
            try {
              applyThemeMode(themeMode);
            } catch {}
            setShowSettings(false);
          }}
        >
          <div className="modal modal-settings" onClick={(e) => e.stopPropagation()}>
            <h3>Einstellungen</h3>
            <div className="tabs">
              <div className="tablist" role="tablist" aria-label="Einstellungen Tabs">
                <button
                  className={`tab${settingsTab === 'tcp' ? ' active' : ''}`}
                  role="tab"
                  aria-selected={settingsTab === 'tcp'}
                  onClick={() => setSettingsTab('tcp')}
                >
                  TCP
                </button>
                <button
                  className={`tab${settingsTab === 'http' ? ' active' : ''}`}
                  role="tab"
                  aria-selected={settingsTab === 'http'}
                  onClick={() => setSettingsTab('http')}
                >
                  HTTP
                </button>
                <button
                  className={`tab${settingsTab === 'elastic' ? ' active' : ''}`}
                  role="tab"
                  aria-selected={settingsTab === 'elastic'}
                  onClick={() => setSettingsTab('elastic')}
                >
                  Elasticsearch
                </button>
                <button
                  className={`tab${settingsTab === 'logging' ? ' active' : ''}`}
                  role="tab"
                  aria-selected={settingsTab === 'logging'}
                  onClick={() => setSettingsTab('logging')}
                >
                  Logging
                </button>
                <button
                  className={`tab${settingsTab === 'appearance' ? ' active' : ''}`}
                  role="tab"
                  aria-selected={settingsTab === 'appearance'}
                  onClick={() => setSettingsTab('appearance')}
                >
                  Darstellung
                </button>
              </div>
              <div className="tabpanels">
                {settingsTab === 'tcp' && (
                  <div className="tabpanel" role="tabpanel">
                    <div className="kv">
                      <span>TCP Port</span>
                      <input
                        type="number"
                        min="1"
                        max="65535"
                        value={form.tcpPort}
                        onInput={(e) =>
                          setForm({ ...form, tcpPort: Number(e.currentTarget.value || 0) })
                        }
                      />
                    </div>
                  </div>
                )}
                {settingsTab === 'http' && (
                  <div className="tabpanel" role="tabpanel">
                    <div className="kv">
                      <span>HTTP URL</span>
                      <input
                        type="text"
                        value={form.httpUrl}
                        onInput={(e) => setForm({ ...form, httpUrl: e.currentTarget.value })}
                        placeholder="https://…/logs.json"
                        autoFocus
                      />
                    </div>
                    <div className="kv">
                      <span>Intervall (ms)</span>
                      <input
                        type="number"
                        min="500"
                        step="500"
                        value={form.httpInterval}
                        onInput={(e) =>
                          setForm({ ...form, httpInterval: Number(e.currentTarget.value || 5000) })
                        }
                      />
                    </div>
                  </div>
                )}
                {settingsTab === 'elastic' && (
                  <div className="tabpanel" role="tabpanel">
                    <div className="kv">
                      <span>Elasticsearch URL</span>
                      <input
                        type="text"
                        value={form.elasticUrl}
                        onInput={(e) => setForm({ ...form, elasticUrl: e.currentTarget.value })}
                        placeholder="https://es:9200"
                        autoFocus
                      />
                    </div>
                    <div className="kv">
                      <span>Ergebnismenge (size)</span>
                      <input
                        type="number"
                        min="1"
                        max="10000"
                        value={form.elasticSize}
                        onInput={(e) =>
                          setForm({
                            ...form,
                            elasticSize: Math.max(1, Number(e.currentTarget.value || 1000)),
                          })
                        }
                      />
                    </div>
                    <div className="kv">
                      <span>Benutzer</span>
                      <input
                        type="text"
                        value={form.elasticUser}
                        onInput={(e) => setForm({ ...form, elasticUser: e.currentTarget.value })}
                        placeholder="user"
                      />
                    </div>
                    <div className="kv">
                      <span>Passwort</span>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px' }}>
                        <input
                          type="password"
                          value={form.elasticPassNew}
                          onInput={(e) =>
                            setForm({
                              ...form,
                              elasticPassNew: e.currentTarget.value,
                              elasticPassClear: false,
                            })
                          }
                          placeholder={
                            elasticHasPass
                              ? '(gesetzt) neues Passwort eingeben'
                              : 'neues Passwort eingeben'
                          }
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setForm({ ...form, elasticPassNew: '', elasticPassClear: true })
                          }
                          title="Gespeichertes Passwort löschen"
                        >
                          Löschen
                        </button>
                      </div>
                      <small style={{ color: '#6b7280' }}>
                        {elasticHasPass && !form.elasticPassClear
                          ? 'Aktuell: gesetzt'
                          : 'Aktuell: nicht gesetzt'}
                      </small>
                    </div>
                  </div>
                )}
                {settingsTab === 'logging' && (
                  <div className="tabpanel" role="tabpanel">
                    <div className="kv">
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          type="checkbox"
                          className="native-checkbox"
                          checked={form.logToFile}
                          onChange={(e) => setForm({ ...form, logToFile: e.currentTarget.checked })}
                        />
                        <span>In Datei schreiben</span>
                      </label>
                    </div>
                    <div className="kv">
                      <span>Datei</span>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px' }}>
                        <input
                          type="text"
                          value={form.logFilePath}
                          onInput={(e) => setForm({ ...form, logFilePath: e.currentTarget.value })}
                          placeholder="(Standardpfad)"
                          disabled={!form.logToFile}
                        />
                        <button
                          onClick={async () => {
                            try {
                              const p = await window.api.chooseLogFile();
                              if (p) setForm({ ...form, logFilePath: p });
                            } catch (e) {
                              logger.warn('chooseLogFile failed:', e as any);
                            }
                          }}
                          disabled={!form.logToFile}
                        >
                          Wählen…
                        </button>
                      </div>
                    </div>
                    <div className="kv">
                      <span>Max. Größe (MB)</span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={form.logMaxMB}
                        onInput={(e) =>
                          setForm({ ...form, logMaxMB: Number(e.currentTarget.value || 5) })
                        }
                        disabled={!form.logToFile}
                      />
                    </div>
                    <div className="kv">
                      <span>Max. Backups</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={form.logMaxBackups}
                        onInput={(e) =>
                          setForm({ ...form, logMaxBackups: Number(e.currentTarget.value || 0) })
                        }
                        disabled={!form.logToFile}
                      />
                    </div>
                  </div>
                )}
                {settingsTab === 'appearance' && (
                  <div className="tabpanel" role="tabpanel">
                    <div className="kv">
                      <span>Theme</span>
                      <select
                        value={form.themeMode}
                        onChange={(e) => {
                          const v = e.currentTarget.value;
                          setForm({ ...form, themeMode: v });
                          applyThemeMode(['light', 'dark'].includes(v) ? v : 'system');
                        }}
                      >
                        <option value="system">System</option>
                        <option value="light">Hell</option>
                        <option value="dark">Dunkel</option>
                      </select>
                    </div>
                    <div className="kv">
                      <span>Akzent</span>
                      <div>
                        <small style={{ color: '#6b7280' }}>
                          Akzentfarbe kann in styles.css über --accent / --accent-2 angepasst
                          werden.
                        </small>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-actions">
              <button
                onClick={() => {
                  applyThemeMode(themeMode);
                  setShowSettings(false);
                }}
              >
                Abbrechen
              </button>
              <button onClick={saveSettingsModal}>Speichern</button>
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <header className="toolbar">
        <div className="section">
          <span className="counts">
            <span id="countTotal">{countTotal}</span> gesamt,{' '}
            <span id="countFiltered">{countFiltered}</span> gefiltert,{' '}
            <span id="countSelected">{countSelected}</span> selektiert
          </span>
          <button onClick={clearLogs} disabled={entries.length === 0}>
            Logs leeren
          </button>
          <label
            style={{ marginLeft: '10px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            title="Immer den letzten Eintrag auswählen & anzeigen"
          >
            <input
              type="checkbox"
              className="native-checkbox"
              checked={follow}
              onChange={async (e) => {
                const v = e.currentTarget.checked;
                setFollow(v);
                try {
                  await window.api.settingsSet({ follow: v } as any);
                } catch (err) {
                  logger.warn('Persisting follow flag failed:', err as any);
                }
              }}
            />
            <span>Follow</span>
          </label>
          <label
            style={{ marginLeft: '8px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            title="Sanftes Scrollen, wenn Follow aktiv ist"
          >
            <input
              type="checkbox"
              className="native-checkbox"
              checked={followSmooth}
              onChange={async (e) => {
                const v = e.currentTarget.checked;
                setFollowSmooth(v);
                try {
                  await window.api.settingsSet({ followSmooth: v } as any);
                } catch (err) {
                  logger.warn('Persisting followSmooth flag failed:', err as any);
                }
              }}
              disabled={!follow}
            />
            <span>Smooth</span>
          </label>
        </div>
        <div className="section">
          <button
            title="Zum Anfang springen"
            onClick={gotoListStart}
            disabled={countFiltered === 0}
          >
            ⬆ Anfang
          </button>
          <button title="Zum Ende springen" onClick={gotoListEnd} disabled={countFiltered === 0}>
            Ende ⬇
          </button>
        </div>
        <div className="section">
          <button
            title="Vorherige Markierung"
            onClick={() => gotoMarked(-1)}
            disabled={markedIdx.length === 0}
          >
            ◀ Markierung
          </button>
          <button
            title="Nächste Markierung"
            onClick={() => gotoMarked(1)}
            disabled={markedIdx.length === 0}
          >
            Markierung ▶
          </button>
          <button
            onClick={() =>
              setOnlyMarked((v) => {
                const nv = !v;
                try {
                  void window.api.settingsSet({ onlyMarked: nv });
                } catch (e) {
                  logger.error('Persisting onlyMarked setting failed:', e);
                }
                return nv;
              })
            }
            disabled={!onlyMarked && markedIdx.length === 0}
            title={
              !onlyMarked && markedIdx.length === 0
                ? 'Keine markierten Einträge vorhanden'
                : 'Nur markierte anzeigen umschalten'
            }
          >
            {onlyMarked ? 'Nur markierte aus' : 'Nur markierte an'}
          </button>
        </div>
        <div className="section">
          <label>Suche</label>
          <input
            id="searchText"
            type="text"
            value={search}
            onInput={(e) => setSearch(e.currentTarget.value)}
            placeholder="Volltext in message… (unterstützt &, |, !)"
          />
          <button
            id="btnPrevMatch"
            title="Vorheriger Treffer"
            disabled={!search.trim() || searchMatchIdx.length === 0}
            onClick={() => gotoSearchMatch(-1)}
          >
            ◀
          </button>
          <button
            id="btnNextMatch"
            title="Nächster Treffer"
            disabled={!search.trim() || searchMatchIdx.length === 0}
            onClick={() => gotoSearchMatch(1)}
          >
            ▶
          </button>
        </div>
        <div className="section">
          <label>
            <input
              type="checkbox"
              className="native-checkbox"
              checked={stdFiltersEnabled}
              onChange={(e) => setStdFiltersEnabled(e.currentTarget.checked)}
            />{' '}
            Standard-Filter aktiv
          </label>
          <label>Level</label>
          <select
            id="filterLevel"
            value={filter.level}
            onChange={(e) => setFilter({ ...filter, level: e.currentTarget.value })}
            disabled={!stdFiltersEnabled}
          >
            <option value="">Alle</option>
            {['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'].map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <label>Logger</label>
          <input
            id="filterLogger"
            list="loggerHistoryList"
            type="text"
            value={filter.logger}
            onInput={(e) => setFilter({ ...filter, logger: e.currentTarget.value })}
            placeholder="Logger enthält…"
            disabled={!stdFiltersEnabled}
          />
          <datalist id="loggerHistoryList">
            {histLogger.map((v, i) => (
              <option key={i} value={v} />
            ))}
          </datalist>
          <label>Thread</label>
          <input
            id="filterThread"
            type="text"
            value={filter.thread}
            onInput={(e) => setFilter({ ...filter, thread: e.currentTarget.value })}
            placeholder="Thread enthält…"
            disabled={!stdFiltersEnabled}
          />
          <label>Message</label>
          <input
            id="filterMessage"
            type="text"
            value={filter.message}
            onInput={(e) => setFilter({ ...filter, message: e.currentTarget.value })}
            placeholder="Message-Filter: & = UND, | = ODER, ! = NICHT"
            disabled={!stdFiltersEnabled}
          />
          <button
            id="btnClearFilters"
            onClick={() => {
              setSearch('');
              setFilter({ level: '', logger: '', thread: '', service: '', message: '' });
              setOnlyMarked(false);
              try {
                void window.api.settingsSet({ onlyMarked: false });
              } catch {}
              try {
                (DiagnosticContextFilter as any).reset?.();
              } catch (e) {
                logger.error('Resetting DiagnosticContextFilter failed:', e);
              }
              try {
                (TimeFilter as any).reset?.();
              } catch (e) {
                logger.error('Resetting TimeFilter failed:', e);
              }
            }}
          >
            Filter leeren
          </button>
        </div>
        <div className="section">
          <button onClick={() => setShowDcDialog(true)} title="Diagnostic Context Filter öffnen">
            DC-Filter…
          </button>
          {(() => {
            const entries = DiagnosticContextFilter.getDcEntries();
            const total = entries.length;
            const active = entries.filter((e) => e.active).length;
            const enabled = DiagnosticContextFilter.isEnabled() && active > 0;
            if (total === 0) return null;
            return (
              <span
                className="status"
                title={enabled ? 'DC-Filter aktiv' : 'DC-Filter gesetzt, aber deaktiviert'}
                style={{ marginLeft: '6px' }}
              >
                {enabled ? `DC ${active} aktiv` : `DC ${total} aus`}
              </span>
            );
          })()}
        </div>
        <div className="section">
          <button onClick={openTimeFilterDialog} title="Elastic-Search öffnen">
            Elastic-Search…
          </button>
          {(() => {
            try {
              const s = TimeFilter.getState();
              if (!s.enabled) return null;
              return (
                <span className="status" style={{ marginLeft: '6px' }} title="Elastic-Search aktiv">
                  Elastic aktiv
                </span>
              );
            } catch {
              return null;
            }
          })()}
          {esBusy && (
            <span>
              <span className="spinner"></span>Elastic lädt…
            </span>
          )}
          {!esBusy && esHasMore && (
            <button
              style={{ marginLeft: '8px' }}
              title="Weitere Ergebnisse laden (search_after)"
              onClick={async () => {
                if (esBusy) return;
                const token = esNextSearchAfter;
                if (!token || !Array.isArray(token) || token.length === 0) return;
                await withBusy(async () => {
                  setEsBusy(true);
                  try {
                    const s = TimeFilter.getState();
                    const f = lastEsForm || {};
                    const opts: ElasticSearchOptions = {
                      url: elasticUrl || undefined,
                      size: elasticSize || undefined,
                      index: f?.index || undefined,
                      sort: f?.sort || undefined,
                      duration: s.mode === 'relative' ? (s.duration as any) : undefined,
                      from: s.mode === 'absolute' ? (s.from as any) : undefined,
                      to: s.mode === 'absolute' ? (s.to as any) : undefined,
                      application_name: f?.application_name,
                      logger: f?.logger,
                      level: f?.level,
                      environment: f?.environment,
                      allowInsecureTLS: !!f?.allowInsecureTLS,
                      searchAfter: token as any,
                    } as any;
                    const res = await window.api.elasticSearch(opts);
                    if (res?.ok) {
                      if (Array.isArray(res.entries) && res.entries.length)
                        appendEntries(res.entries as any[]);
                      setEsHasMore(!!res.hasMore);
                      setEsNextSearchAfter((res.nextSearchAfter as any) || null);
                      if (typeof (res as any)?.total === 'number')
                        setEsTotal(Number((res as any).total));
                    } else {
                      alert('Elastic-Fehler: ' + ((res as any)?.error || 'Unbekannt'));
                    }
                  } finally {
                    setEsBusy(false);
                  }
                });
              }}
            >
              Mehr laden…
            </button>
          )}
          {esTotal != null && (
            <span className="status" style={{ marginLeft: '6px' }} title="Geladene ES-Ergebnisse">
              Geladen: {esLoaded} von {esTotal}
            </span>
          )}
        </div>
        <div className="section">
          {busy && (
            <span className="busy">
              <span className="spinner"></span>Lädt…
            </span>
          )}
          <span id="tcpStatus" className="status">
            {tcpStatus}
          </span>
          <span id="httpStatus" className="status">
            {httpStatus}
          </span>
          {nextPollIn && (
            <span className="status" title="Nächster Poll in">
              {nextPollIn}
            </span>
          )}
        </div>
      </header>

      {/* Hauptlayout: Liste + Overlay-Details */}
      <div className="layout" ref={layoutRef}>
        {/* Listen-Header */}
        <div className="list" ref={parentRef as any}>
          <div className="list-header">
            <div className="cell">
              Zeitstempel
              <div className="resizer" onMouseDown={(e) => onColMouseDown('ts', e)} />
            </div>
            <div className="cell" style={{ textAlign: 'center' }}>
              Level
              <div className="resizer" onMouseDown={(e) => onColMouseDown('lvl', e)} />
            </div>
            <div className="cell">
              Logger
              <div className="resizer" onMouseDown={(e) => onColMouseDown('logger', e)} />
            </div>
            <div className="cell">Message</div>
          </div>
          {/* Virtualized rows */}
          <div style={{ height: totalHeight + 'px', position: 'relative' }}>
            {virtualItems.map((vi: any) => {
              const viIndex = typeof vi?.index === 'number' ? (vi.index as number) : -1;
              if (viIndex < 0 || viIndex >= filteredIdx.length) return null;
              const globalIdx: number = filteredIdx[viIndex]!;
              const e = entries[globalIdx] || {};
              const isSel = selected.has(globalIdx);
              const rowCls = 'row' + (isSel ? ' sel' : '');
              const markColor = (e && (e._mark || e.color)) as string | undefined;
              const y: number = typeof vi?.start === 'number' ? (vi.start as number) : 0;
              const style = {
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${y}px)`,
                height: rowHeight + 'px',
                borderLeft: `4px solid ${markColor ? String(markColor) : 'transparent'}`,
                background: markColor ? computeTint(markColor, 0.12) : undefined,
              } as any;
              const key = (vi && vi.key) || `${viIndex}-${globalIdx}`;
              return (
                <div
                  key={key}
                  className={rowCls}
                  style={style}
                  onClick={(ev) =>
                    toggleSelectIndex(
                      globalIdx,
                      (ev as any).shiftKey,
                      (ev as any).ctrlKey || (ev as any).metaKey
                    )
                  }
                  onContextMenu={(ev) => openContextMenu(ev as any, globalIdx)}
                  title={String(e.message || '')}
                  data-marked={markColor ? '1' : '0'}
                >
                  <div className="col ts">{fmtTimestamp(e.timestamp)}</div>
                  <div className="col lvl">
                    <span className={levelClass(e.level)}>{fmt(e.level)}</span>
                  </div>
                  <div className="col logger">{fmt(e.logger)}</div>
                  <div
                    className="col msg"
                    dangerouslySetInnerHTML={{ __html: highlightAll(e.message, search) }}
                  />
                </div>
              );
            })}
            {countFiltered === 0 && (
              <div style={{ padding: '10px', color: '#777' }}>Keine Einträge</div>
            )}
          </div>
        </div>

        {/* Overlay: Divider + Detailbereich */}
        <div className="overlay">
          <div className="divider" ref={(el) => (dividerElRef.current = el as any)} />
          <div
            className="details"
            data-tinted={selectedEntry && (selectedEntry._mark || selectedEntry.color) ? '1' : '0'}
            style={{
              ['--details-tint' as any]: computeTint(
                (selectedEntry && selectedEntry._mark) || selectedEntry?.color,
                0.22
              ),
            }}
          >
            {!selectedEntry && (
              <div style={{ color: 'var(--color-text-secondary)' }}>Keine Auswahl</div>
            )}
            {selectedEntry && (
              <Fragment>
                <div className="meta-grid">
                  <div>
                    <div className="kv">
                      <span>Zeit</span>
                      <div>{fmtTimestamp(selectedEntry.timestamp)}</div>
                    </div>
                    <div className="kv">
                      <span>Logger</span>
                      <div>{fmt(selectedEntry.logger)}</div>
                    </div>
                  </div>
                  <div>
                    <div className="kv">
                      <span>Level</span>
                      <div>
                        <span className={levelClass(selectedEntry.level)}>
                          {fmt(selectedEntry.level)}
                        </span>
                      </div>
                    </div>
                    <div className="kv">
                      <span>Thread</span>
                      <div>{fmt(selectedEntry.thread)}</div>
                    </div>
                  </div>
                </div>
                <div className="section-sep" />
                <div className="kv full">
                  <span>Message</span>
                  <pre
                    id="dMessage"
                    dangerouslySetInnerHTML={{
                      __html: highlightAll(selectedEntry.message || '', search),
                    }}
                  />
                </div>
                {(selectedEntry.stack_trace || selectedEntry.stackTrace) && (
                  <div className="kv full">
                    <span>Stacktrace</span>
                    <pre className="stack-trace">
                      {String(selectedEntry.stack_trace || selectedEntry.stackTrace || '')}
                    </pre>
                  </div>
                )}
                {mdcPairs.length > 0 && (
                  <Fragment>
                    <div className="section-sep" />
                    <div style={{ fontSize: '12px', color: '#666', marginBottom: '6px' }}>
                      Diagnostic Context
                    </div>
                    <div className="mdc-grid">
                      {mdcPairs.map(([k, v]) => (
                        <Fragment key={k + '=' + v}>
                          <div className="mdc-key">{k}</div>
                          <div className="mdc-val">
                            <code>{v}</code>
                          </div>
                          <div
                            className="mdc-act"
                            style={{ display: 'flex', gap: '6px', justifyContent: 'end' }}
                          >
                            <button
                              onClick={() => addMdcToFilter(k, v)}
                              title="Zum MDC-Filter hinzufügen"
                            >
                              +
                            </button>
                          </div>
                        </Fragment>
                      ))}
                    </div>
                  </Fragment>
                )}
              </Fragment>
            )}
          </div>
        </div>
      </div>

      {/* Kontextmenü */}
      {ctxMenu.open && (
        <div
          ref={ctxRef}
          className="context-menu"
          style={{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }}
        >
          <div className="item" onClick={() => applyMarkColor(undefined)}>
            Markierung löschen
          </div>
          <div className="colors">
            {palette.map((c, i) => (
              <div
                key={i}
                className="swatch"
                style={{ background: c }}
                onClick={() => applyMarkColor(c)}
                title={c}
              />
            ))}
          </div>
          <div
            className="item"
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto auto',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span>Farbe</span>
            <input
              type="color"
              value={pickerColor}
              onInput={(e) => setPickerColor(e.currentTarget.value)}
              style={{
                width: '100%',
                height: '28px',
                padding: 0,
                border: 'none',
                background: 'transparent',
              }}
            />
            <button onClick={() => applyMarkColor(pickerColor)} title="Ausgewählte Farbe anwenden">
              Anwenden
            </button>
            <button
              onClick={() => addCustomColor(pickerColor)}
              title="Farbe zur Palette hinzufügen (nur temporär)"
            >
              Hinzufügen
            </button>
          </div>
          <div className="sep" />
          <div className="item" onClick={adoptTraceIds}>
            TraceID in MDC-Filter übernehmen
          </div>
          <div className="item" onClick={copyTsMsg}>
            Kopieren: Zeit und Message
          </div>
          <div className="sep" />
          <div className="item" onClick={() => DiagnosticContextFilter.setEnabled(true)}>
            MDC-Filter aktivieren
          </div>
          <div className="item" onClick={() => DiagnosticContextFilter.setEnabled(false)}>
            MDC-Filter deaktivieren
          </div>
          <div className="item" onClick={() => DiagnosticContextFilter.reset()}>
            MDC-Filter leeren
          </div>
          <div className="item" onClick={() => openMdcFromSelection()}>
            MDC aus Auswahl…
          </div>
        </div>
      )}

      {/* Titel-Dialog */}
      {showTitleDlg && (
        <div className="modal-backdrop" onClick={() => setShowTitleDlg(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Fenster-Titel setzen</h3>
            <div className="kv full">
              <span>Titel</span>
              <input
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.currentTarget.value)}
                placeholder="Lumberjack"
                autoFocus
              />
            </div>
            <div className="modal-actions">
              <button onClick={() => setShowTitleDlg(false)}>Abbrechen</button>
              <button onClick={applySetWindowTitle}>Übernehmen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
