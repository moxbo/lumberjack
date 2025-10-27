/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-base-to-string, @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-misused-promises, @typescript-eslint/require-await, @typescript-eslint/no-floating-promises */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Fragment } from 'preact';
import { useVirtualizer } from '@tanstack/react-virtual';
import { highlightAll } from '../utils/highlight';
import { msgMatches } from '../utils/msgFilter';
import logger from '../utils/logger';
// Dynamic import for DCFilterDialog (code splitting)
// Preact supports dynamic imports directly
import { LoggingStore } from '../store/loggingStore';
import { DiagnosticContextFilter } from '../store/dcFilter';
import { DragAndDropManager } from '../utils/dnd';
import { compareByTimestampId } from '../utils/sort';
import { TimeFilter } from '../store/timeFilter';
import { lazy, Suspense } from 'preact/compat';
import type { ElasticSearchOptions } from '../types/ipc';

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
  const hex = c.startsWith('#') ? c.slice(1) : null;
  if (hex) {
    let r, g, b;
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    if (hex.length === 6) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }
  // Fallback: unveränderte Farbe (ohne Alpha)
  return c;
}

// Message-Filter-Logik ausgelagert nach utils/msgFilter.js

export default function App() {
  const [entries, setEntries] = useState([]);
  const [nextId, setNextId] = useState(1);
  const [selected, setSelected] = useState(new Set());
  const lastClicked = useRef(null);

  // Follow-Modus: wenn aktiv, wird immer der letzte Eintrag ausgewählt & angezeigt
  const [follow, setFollow] = useState(false);
  const [followSmooth, setFollowSmooth] = useState(false);

  // Theme Mode: 'system' | 'light' | 'dark'
  const [themeMode, setThemeMode] = useState('system');
  function applyThemeMode(mode: string | null | undefined): void {
    const root = document.documentElement;
    if (!mode || mode === 'system') {
      root.removeAttribute('data-theme');
      // allow prefers-color-scheme to apply
      return;
    }
    root.setAttribute('data-theme', mode);
  }

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState({
    level: '',
    logger: '',
    thread: '',
    service: '',
    message: '',
  });
  const [stdFiltersEnabled, setStdFiltersEnabled] = useState(true);

  // re-render trigger for MDC filter changes
  const [dcVersion, setDcVersion] = useState(0);
  useEffect(() => {
    const off = DiagnosticContextFilter.onChange(() => setDcVersion((v) => v + 1));
    return () => off?.();
  }, []);
  // re-render trigger for Time filter changes
  const [timeVersion, setTimeVersion] = useState(0);
  useEffect(() => {
    const off = TimeFilter.onChange(() => setTimeVersion((v) => v + 1));
    return () => off?.();
  }, []);

  // Neuer Dialog-State für DC-Filter
  const [showDcDialog, setShowDcDialog] = useState(false);
  // Zeit-Filter Dialog-State
  const [showTimeDialog, setShowTimeDialog] = useState(false);
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
  function openTimeFilterDialog() {
    try {
      const s = TimeFilter.getState?.();
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
      setTimeForm({
        enabled: true,
        mode: (s && s.mode) || 'relative',
        duration: (s && s.duration) || '15m',
        from: toLocal(s?.from),
        to: toLocal(s?.to),
        application_name: '',
        logger: '',
        level: '',
        environment: '',
      });
    } catch {
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
  const [histLogger, setHistLogger] = useState([]);
  const [histAppName, setHistAppName] = useState([]);
  const [histEnvironment, setHistEnvironment] = useState([]);

  // History-Pflege für Elastic-Dialog
  function addToHistory(kind: 'app' | 'env', val: string) {
    const v = String(val || '').trim();
    if (!v) return;
    if (kind === 'app') {
      setHistAppName((prev) => {
        const list = [v, ...prev.filter((x) => x !== v)].slice(0, 10);
        try {
          void window.api.settingsSet({ histAppName: list } as any);
        } catch (e){
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
        } catch (e){
            logger.error('Failed to save histEnvironment settings:', e);
            alert('Failed to save histEnvironment settings. See logs for details.');
        }
        return list;
      });
    }
  }

  const [tcpStatus, setTcpStatus] = useState('');
  const [httpStatus, setHttpStatus] = useState('');
  const [httpPollId, setHttpPollId] = useState(null);
  const [tcpPort, setTcpPort] = useState(5000);

  const [httpUrl, setHttpUrl] = useState('');
  const [httpInterval, setHttpInterval] = useState(5000);
  const [showSettings, setShowSettings] = useState(false);
  // neuer Tab-State für das Einstellungsfenster: 'tcp' | 'http' | 'logging' | 'appearance'
  const [settingsTab, setSettingsTab] = useState('tcp');
  const [form, setForm] = useState({
    tcpPort: 5000,
    httpUrl: '',
    httpInterval: 5000,
    logToFile: false,
    logFilePath: '',
    logMaxMB: 5,
    logMaxBackups: 3,
    themeMode: 'system',
    // Elasticsearch form fields (nur im Dialog benutzt)
    elasticUrl: '',
    elasticSize: 1000,
    elasticUser: '',
    elasticPassNew: '',
    elasticPassClear: false,
  });
  // Neue Dialog-States: HTTP einmal laden & Poll starten
  const [showHttpLoadDlg, setShowHttpLoadDlg] = useState(false);
  const [httpLoadUrl, setHttpLoadUrl] = useState('');
  const [showHttpPollDlg, setShowHttpPollDlg] = useState(false);
  const [httpPollForm, setHttpPollForm] = useState({ url: '', interval: 5000 });
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

  // Logging-Settings (persisted state for convenience)
  const [logToFile, setLogToFile] = useState(false);
  const [logFilePath, setLogFilePath] = useState('');
  const [logMaxBytes, setLogMaxBytes] = useState(5 * 1024 * 1024);
  const [logMaxBackups, setLogMaxBackups] = useState(3);

  // Elasticsearch-Settings (persisted state)
  const [elasticUrl, setElasticUrl] = useState('');
  const [elasticSize, setElasticSize] = useState(1000);
  const [elasticUser, setElasticUser] = useState('');
  const [elasticHasPass, setElasticHasPass] = useState(false); // nur Anzeige

  // HTTP Dropdown-Menü (toolbar)
  const [httpMenu, setHttpMenu] = useState({ open: false, x: 0, y: 0 });
  const httpBtnRef = useRef(null);
  const httpMenuRef = useRef(null);

  // Kontextmenü für Log-Einträge
  const [ctxMenu, setCtxMenu] = useState({ open: false, x: 0, y: 0 });
  const ctxRef = useRef(null);
  const colorChoices = [
    '#F59E0B', // amber
    '#EF4444', // red
    '#10B981', // emerald
    '#3B82F6', // blue
    '#8B5CF6', // violet
    '#EC4899', // pink
    '#14B8A6', // teal
    '#6B7280', // gray
  ];
  function closeContextMenu() {
    setCtxMenu({ open: false, x: 0, y: 0 });
  }
  useEffect(() => {
    if (!ctxMenu.open) return;
    const onMouseDown = (e) => {
      try {
        if (!ctxRef.current) return closeContextMenu();
        if (!ctxRef.current.contains(e.target)) closeContextMenu();
      } catch {
        closeContextMenu();
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') closeContextMenu();
    };
    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu.open]);
  function openContextMenu(ev, idx) {
    ev.preventDefault();
    // Falls der angeklickte Eintrag nicht selektiert ist: Einzel-Selektion setzen
    setSelected((prev) => {
      if (prev && prev.has(idx)) return prev;
      return new Set([idx]);
    });
    setCtxMenu({ open: true, x: ev.clientX, y: ev.clientY });
  }
  function applyMarkColor(color) {
    setEntries((prev) => {
      if (!prev || !prev.length) return prev;
      const next = prev.slice();
      for (const i of selected) {
        if (i >= 0 && i < next.length) {
          const e = next[i] || {};
          const n = { ...e };
          if (color) n._mark = color;
          else delete n._mark;
          next[i] = n;
        }
      }
      return next;
    });
    closeContextMenu();
  }
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
      const added = new Set();
      for (const i of selected) {
        const e = entries[i];
        const m = e && e.mdc;
        if (!m || typeof m !== 'object') continue;
        for (const k of variants) {
          if (Object.prototype.hasOwnProperty.call(m, k)) {
            const v = String(m[k] ?? '');
            if (v && !added.has(v)) {
              DiagnosticContextFilter.addMdcEntry('TraceID', v);
              added.add(v);
            }
          }
        }
      }
      if (added.size) DiagnosticContextFilter.setEnabled(true);
    } catch {}
    closeContextMenu();
  }
  async function copyTsMsg() {
    const list = Array.from(selected).sort((a, b) => a - b);
    const lines = list.map((i) => {
      const e = entries[i] || {};
      return `${fmtTimestamp(e.timestamp)} ${String(e.message ?? '')}`;
    });
    const text = lines.join('\n');
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
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

  // Busy indicator and helper
  const [busy, setBusy] = useState(false);
  const withBusy = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  // HTTP polling helper state (for status/next tick display)
  const [pollMs, setPollMs] = useState(0);
  const [nextPollDueAt, setNextPollDueAt] = useState(null);
  const [nextPollIn, setNextPollIn] = useState('');
  useEffect(() => {
    if (!nextPollDueAt) {
      setNextPollIn('');
      return;
    }
    let t = 0;
    const tick = () => {
      const ms = Math.max(0, Number(nextPollDueAt) - Date.now());
      setNextPollIn(ms > 0 ? `${Math.ceil(ms / 1000)}s` : '');
    };
    tick();
    t = window.setInterval(tick, 250);
    return () => clearInterval(t);
  }, [nextPollDueAt]);

  // Refs for layout and virtualization
  const parentRef = useRef(null); // scroll container for list
  const layoutRef = useRef(null);
  // Separate divider element ref and divider state ref
  const dividerElRef = useRef<HTMLElement | null>(null);
  const dividerStateRef = useRef({ _resizing: false, _startY: 0, _startH: 0 });
  const colResize = useRef({ active: null as null | string, startX: 0, startW: 0 });

  // Compute filtered indices based on filters, time and MDC
  const filteredIdx = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e) continue;
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
      // Time filter and MDC filter
      try {
        if (!TimeFilter.matchesTs(e.timestamp)) continue;
      } catch (e) {
        logger.error('TimeFilter.matchesTs error:', e);
        continue;
      }
      try {
        if (!DiagnosticContextFilter.matches(e.mdc || {})) continue;
      } catch (e) {
        logger.error('DiagnosticContextFilter.matches error:', e);
      }
      out.push(i);
    }
    return out;
  }, [entries, stdFiltersEnabled, filter, dcVersion, timeVersion]);

  // Counts for toolbar
  const countTotal = entries.length;
  const countFiltered = filteredIdx.length;
  const countSelected = selected.size;

  // Virtualized list setup
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

  // Selection handling
  function toggleSelectIndex(idx: number, shift: boolean, meta: boolean) {
    setSelected((prev) => {
      let next = new Set(prev);
      if (shift && lastClicked.current != null) {
        const a = filteredIdx.indexOf(lastClicked.current);
        const b = filteredIdx.indexOf(idx);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          next = new Set(filteredIdx.slice(lo, hi + 1).map((i) => i));
        } else {
          next = new Set([idx]);
        }
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
    if (selected.size === 1) return Array.from(selected)[0];
    if (selected.size > 1) return lastClicked.current ?? Array.from(selected).slice(-1)[0];
    return null;
  }, [selected]);
  const selectedEntry = useMemo(() => {
    return selectedOneIdx != null ? entries[selectedOneIdx] || null : null;
  }, [selectedOneIdx, entries]);

  const mdcPairs = useMemo(() => {
    const e = selectedEntry as any;
    if (!e || !e.mdc || typeof e.mdc !== 'object') return [] as [string, string][];
    return Object.entries(e.mdc)
      .map(([k, v]) => [String(k), String(v ?? '')] as [string, string])
      .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  }, [selectedEntry]);

  // Marked rows and navigation
  const markedIdx = useMemo(() => {
    const out: number[] = [];
    for (let vi = 0; vi < filteredIdx.length; vi++) {
      const idx = filteredIdx[vi];
      if (entries[idx]?._mark) out.push(vi);
    }
    return out;
  }, [filteredIdx, entries]);

  const searchMatchIdx = useMemo(() => {
    const s = String(search || '').trim();
    if (!s) return [] as number[];
    const out: number[] = [];
    for (let vi = 0; vi < filteredIdx.length; vi++) {
      const idx = filteredIdx[vi];
      const e = entries[idx];
      if (msgMatches(e?.message, s)) out.push(vi);
    }
    return out;
  }, [search, filteredIdx, entries]);

  function gotoMarked(dir: number) {
    if (!markedIdx.length) return;
    const curVi = selectedOneIdx != null ? filteredIdx.indexOf(selectedOneIdx) : -1;
    let targetVi: number;
    if (dir > 0) {
      targetVi = markedIdx.find((vi) => vi > curVi) ?? markedIdx[0];
    } else {
      let prev = -1;
      for (const vi of markedIdx) if (vi < curVi) prev = vi;
      targetVi = prev >= 0 ? prev : markedIdx[markedIdx.length - 1];
    }
    const globalIdx = filteredIdx[targetVi];
    setSelected(new Set([globalIdx]));
    lastClicked.current = globalIdx as any;
    virtualizer.scrollToIndex(targetVi, {
      align: 'center',
      behavior: followSmooth ? 'smooth' : 'auto',
    });
  }

  function gotoSearchMatch(dir: number) {
    if (!searchMatchIdx.length) return;
    const curVi = selectedOneIdx != null ? filteredIdx.indexOf(selectedOneIdx) : -1;
    let targetVi: number;
    if (dir > 0) {
      targetVi = searchMatchIdx.find((vi) => vi > curVi) ?? searchMatchIdx[0];
    } else {
      let prev = -1;
      for (const vi of searchMatchIdx) if (vi < curVi) prev = vi;
      targetVi = prev >= 0 ? prev : searchMatchIdx[searchMatchIdx.length - 1];
    }
    const globalIdx = filteredIdx[targetVi];
    setSelected(new Set([globalIdx]));
    lastClicked.current = globalIdx as any;
    virtualizer.scrollToIndex(targetVi, {
      align: 'center',
      behavior: followSmooth ? 'smooth' : 'auto',
    });
  }

  // Append entries helper (assigns _id and merges + sorts)
  function appendEntries(newEntries: any[]) {
    if (!Array.isArray(newEntries) || newEntries.length === 0) return;
    const toAdd = newEntries.map((e, i) => ({ ...e, _id: nextId + i }));
    try {
      // Attach MDC fields
      LoggingStore.addEvents(toAdd);
    } catch (e) {
        logger.error('LoggingStore.addEvents error:', e);
        alert( 'Failed to process new log entries. See logs for details. ' + (e?.message || String(e)) );
    }
    const merged = [...entries, ...toAdd].sort(compareByTimestampId);
    setEntries(merged);
    setNextId(nextId + toAdd.length);
  }

  // Follow mode: auto-select and scroll to last entry when new entries arrive
  useEffect(() => {
    if (!follow) return;
    if (!filteredIdx.length) return;
    const lastGlobalIdx = filteredIdx[filteredIdx.length - 1];
    setSelected(new Set([lastGlobalIdx]));
    // Defer to ensure virtualizer has updated measurements
    setTimeout(() => gotoListEnd(), 0);
  }, [entries, follow, stdFiltersEnabled, filter, dcVersion, timeVersion]);

  // MDC helpers
  function addMdcToFilter(k: string, v: string) {
    try {
      DiagnosticContextFilter.addMdcEntry(k, v ?? '');
      DiagnosticContextFilter.setEnabled(true);
    } catch (e) {
        logger.error('Failed to add MDC entry to filter:', e);
        alert('Failed to add MDC entry to filter. See logs for details.');
    }
  }

  const [showMdcModal, setShowMdcModal] = useState(false);
  const [mdcAgg, setMdcAgg] = useState(
    [] as { key: string; values: { val: string; count: number }[] }[]
  );
  const [mdcSelKey, setMdcSelKey] = useState('');
  const [mdcSelVals, setMdcSelVals] = useState(new Set<string>());

  function openMdcFromSelection() {
    const byKey: Map<string, Map<string, number>> = new Map();
    for (const idx of selected) {
      const e = entries[idx] as any;
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

  function addSelectedMdcToFilter(opts?: { presentOnly?: boolean; allValues?: boolean }) {
    const key = mdcSelKey;
    if (!key) return;
    const entry = mdcAgg.find((x) => x.key === key);
    if (!entry) return;
    if (opts?.presentOnly) {
      DiagnosticContextFilter.addMdcEntry(key, '');
    } else if (opts?.allValues) {
      for (const { val } of entry.values) DiagnosticContextFilter.addMdcEntry(key, val);
    } else {
      for (const val of Array.from(mdcSelVals)) DiagnosticContextFilter.addMdcEntry(key, val);
    }
    DiagnosticContextFilter.setEnabled(true);
  }

  function removeSelectedMdcFromFilter() {
    const key = mdcSelKey;
    if (!key) return;
    for (const val of Array.from(mdcSelVals)) DiagnosticContextFilter.removeMdcEntry(key, val);
  }

  // Popup: Fenster-Titel setzen
  const [showTitleDlg, setShowTitleDlg] = useState(false);
  const [titleInput, setTitleInput] = useState('Lumberjack');
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
      alert('Speichern fehlgeschlagen: ' + (e?.message || String(e)));
    }
  }

  // Initial Settings laden (inkl. CSS-Variablen und Historien)
  // Deferred to avoid blocking initial render
  useEffect(() => {
    // Use setTimeout to defer loading until after first paint
    const timeoutId = setTimeout(async () => {
      try {
        // Guard against missing window.api
        if (!window.api?.settingsGet) {
          logger.error(
            'window.api.settingsGet is not available. Preload script may have failed to load.'
          );
          return;
        }
        const result = await window.api.settingsGet();
        if (!result || !result.ok) {
          logger.warn('Failed to load settings:', result?.error);
          return;
        }
        const r = result.settings;
        if (!r) return;

        // Apply settings
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
        // Fenster-Titel ist nur zur Laufzeit; keine Persistenz mehr

        // CSS Vars
        const root = document.documentElement;
        const detail = Number(r.detailHeight || 0);
        if (detail) root.style.setProperty('--detail-height', `${Math.round(detail)}px`);
        const map = [
          ['--col-ts', r.colTs],
          ['--col-lvl', r.colLvl],
          ['--col-logger', r.colLogger],
        ];
        for (const [k, v] of map)
          if (v != null) root.style.setProperty(k, `${Math.round(Number(v) || 0)}px`);

        // Logging
        setLogToFile(!!r.logToFile);
        setLogFilePath(String(r.logFilePath || ''));
        setLogMaxBytes(Number(r.logMaxBytes || 5 * 1024 * 1024));
        setLogMaxBackups(Number(r.logMaxBackups || 3));

        // Elasticsearch
        setElasticUrl(String(r.elasticUrl || ''));
        setElasticSize(Number(r.elasticSize || 1000));
        setElasticUser(String(r.elasticUser || ''));
        setElasticHasPass(!!String(r.elasticPassEnc || '').trim());
      } catch (e) {
        logger.error('Error loading settings:', e);
      }
    }, 0);
    return () => clearTimeout(timeoutId);
  }, []);

  async function openSettingsModal(initialTab) {
    // Hole den aktuell persistierten Zustand (Race-Condition direkt nach App-Start vermeiden)
    let curMode = themeMode;
    try {
      if (!window.api?.settingsGet) {
        logger.warn('window.api.settingsGet is not available');
      } else {
        const result = await window.api.settingsGet();
        const r = result?.ok ? result.settings : null;
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
      // Elasticsearch (aus persistierten States)
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
    const toFile = !!form.logToFile;
    const path = String(form.logFilePath || '').trim();
    const maxMB = Math.max(1, Number(form.logMaxMB || 5));
    const maxBytes = Math.round(maxMB * 1024 * 1024);
    const backups = Math.max(0, Number(form.logMaxBackups || 0));
    const mode = ['light', 'dark', 'system'].includes(form.themeMode) ? form.themeMode : 'system';

    const patch = {
      tcpPort: port,
      httpUrl: String(form.httpUrl || '').trim(),
      httpInterval: interval,
      logToFile: toFile,
      logFilePath: path,
      logMaxBytes: maxBytes,
      logMaxBackups: backups,
      themeMode: mode,
      // Elasticsearch
      elasticUrl: String(form.elasticUrl || '').trim(),
      elasticSize: Math.max(1, Number(form.elasticSize || 1000)),
      elasticUser: String(form.elasticUser || '').trim(),
    } as any;
    const newPass = String(form.elasticPassNew || '').trim();
    if (form.elasticPassClear) {
      patch['elasticPassClear'] = true;
    } else if (newPass) {
      patch['elasticPassPlain'] = newPass;
    }

    try {
      const res = await window.api.settingsSet(patch);
      if (!res || !res.ok) throw new Error(res?.error || 'Unbekannter Fehler');

      // Apply to local states
      setTcpPort(port);
      setHttpUrl(String(form.httpUrl || '').trim());
      setHttpInterval(interval);
      setLogToFile(toFile);
      setLogFilePath(path);
      setLogMaxBytes(maxBytes);
      setLogMaxBackups(backups);
      setThemeMode(mode);
      applyThemeMode(mode);

      // Elasticsearch
      setElasticUrl(String(form.elasticUrl || '').trim());
      setElasticSize(Math.max(1, Number(form.elasticSize || 1000)));
      setElasticUser(String(form.elasticUser || '').trim());
      if (form.elasticPassClear) setElasticHasPass(false);
      else if (newPass) setElasticHasPass(true);

      setShowSettings(false);
    } catch (e) {
        logger.error('Failed to save settings:', e);
      alert('Speichern fehlgeschlagen: ' + (e?.message || String(e)));
    }
  }

  // HTTP Dropdown-Menü Outside-Click schließen
  useEffect(() => {
    if (!httpMenu.open) return;
    const onDocDown = (e: any) => {
      try {
        const menuEl = httpMenuRef.current as any;
        const btnEl = httpBtnRef.current as any;
        if (!menuEl) {
          setHttpMenu({ open: false, x: 0, y: 0 });
          return;
        }
        const t = e.target as Node;
        if (menuEl.contains(t) || (btnEl && btnEl.contains && btnEl.contains(t))) return;
        setHttpMenu({ open: false, x: 0, y: 0 });
      } catch {
        setHttpMenu({ open: false, x: 0, y: 0 });
      }
    };
    window.addEventListener('mousedown', onDocDown, true);
    return () => window.removeEventListener('mousedown', onDocDown, true);
  }, [httpMenu.open]);

  // IPC: Logs, Menü, TCP-Status
  useEffect(() => {
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
            const { type, tab } = cmd || ({} as any);
            switch (type) {
              case 'open-files': {
                const paths = await window.api.openFiles();
                if (paths && paths.length) {
                  const res = await window.api.parsePaths(paths);
                  if (res?.ok) appendEntries(res.entries);
                }
                break;
              }
              case 'open-settings': {
                await openSettingsModal((tab as any) || 'tcp');
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
            st?.ok
              ? st.running
                ? `TCP: Port ${st.port} aktiv`
                : 'TCP gestoppt'
              : st.message || 'TCP-Fehler'
          );
        });
        offs.push(off);
      }
    } catch (e) {
        logger.error('onTcpStatus setup failed:', e);
    }
    return () => {
      for (const f of offs)
        try {
          f();
        } catch (e) {
            logger.error('Failed to remove IPC listener:', e);
        }
    };
  }, [httpPollId, tcpPort]);

  // Refs für Drag & Drop
  // const dropRef = useRef(null);

  // Drag & Drop Overlay state
  const [dragActive, setDragActive] = useState(false);

  // Drag & Drop Handler
  useEffect(() => {
    const mgr = new DragAndDropManager({
      onFiles: async (paths) => {
        await withBusy(async () => {
          if (!window.api?.parsePaths) {
            alert('API nicht verfügbar. Preload-Skript wurde möglicherweise nicht geladen.');
            return;
          }
          const res = await window.api.parsePaths(paths);
          if (res?.ok) appendEntries(res.entries);
          else alert('Fehler beim Laden (Drop): ' + (res?.error || 'unbekannt'));
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
            if (res?.ok) appendEntries(res.entries);
            else alert('Fehler beim Laden (Drop-Rohdaten): ' + (res?.error || 'unbekannt'));
          } catch (e) {
            logger.error('Fehler beim Einlesen der Dateien (Drop-Rohdaten):', e);
            alert('Fehler beim Einlesen der Dateien: ' + (e?.message || String(e)));
          }
        });
      },
    });
    // Global auf window hören statt auf ein null-Ref
    mgr.attach();
    return () => mgr.detach();
  }, []);

  // Toolbar-Aktion: Logs leeren
  function clearLogs() {
    setEntries([]);
    setSelected(new Set());
    setNextId(1);
    try {
      LoggingStore.reset();
    } catch (e) {
        logger.error('LoggingStore.reset error:', e);
        alert('Failed to reset logging store. See logs for details.');
    }
    setHttpStatus('');
    setTcpStatus('');
  }

  // Toolbar-HTTP-Menü Aktionen -> Dialoge statt direkte Aktionen
  async function httpMenuLoadOnce() {
    setHttpMenu({ open: false, x: 0, y: 0 });
    openHttpLoadDialog();
  }
  async function httpMenuStartPoll() {
    setHttpMenu({ open: false, x: 0, y: 0 });
    openHttpPollDialog();
  }
  async function httpMenuStopPoll() {
    setHttpMenu({ open: false, x: 0, y: 0 });
    if (httpPollId == null) return;
    const r = await window.api.httpStopPoll(httpPollId);
    if (r.ok) {
      setHttpStatus('Poll gestoppt');
      setHttpPollId(null);
      setNextPollIn('');
      setNextPollDueAt(null);
    }
  }

  // Divider Drag (Höhe der Detailansicht anpassen)
  useEffect(() => {
    function onMouseMove(e) {
      if (!dividerStateRef.current._resizing) return;
      const startY = dividerStateRef.current._startY;
      const startH = dividerStateRef.current._startH;
      const dy = e.clientY - startY;
      let newH = startH - dy;
      const layout = layoutRef.current;
      const total = layout ? layout.clientHeight : document.body.clientHeight || window.innerHeight;
      const minDetail = 150;
      const minList = 140;
      // Divider-Höhe dynamisch aus CSS-Variable lesen
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
      } catch {}
    }
    function onMouseDown(e) {
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
    if (el) el.addEventListener('mousedown', onMouseDown);
    return () => {
      if (el) el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // Spalten-Resize (Zeit/Level/Logger)
  function onColMouseDown(key, e) {
    const varMap = { ts: '--col-ts', lvl: '--col-lvl', logger: '--col-logger' };
    const active = varMap[key];
    if (!active) return;
    const cs = getComputedStyle(document.documentElement);
    const cur = cs.getPropertyValue(active).trim();
    const curW = Number(cur.replace('px', '')) || 0;
    const onMove = (ev) => onColMouseMove(ev);
    const onUp = async () => {
      await onColMouseUp();
    };
    colResize.current = { active, startX: e.clientX, startW: curW };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
  function onColMouseMove(e) {
    const st = colResize.current;
    if (!st.active) return;
    let newW = st.startW + (e.clientX - st.startX);
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
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
    window.removeEventListener('mousemove', onColMouseMove);
    window.removeEventListener('mouseup', onColMouseUp);
    try {
      if (!st.active) return;
      const cs = getComputedStyle(document.documentElement);
      const val = cs.getPropertyValue(st.active).trim();
      const num = Number(val.replace('px', '')) || 0;
      const keyMap = { '--col-ts': 'colTs', '--col-lvl': 'colLvl', '--col-logger': 'colLogger' };
      const k = keyMap[st.active];
      if (k) await window.api.settingsSet({ [k]: Math.round(num) });
    } catch {}
  }

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
            onApply={async (
              formVals: ElasticSearchOptions & { loadMode?: 'append' | 'replace' }
            ) => {
              try {
                setShowTimeDialog(false);
                // Persist history tokens (limited)
                addToHistory('app', formVals?.application_name || '');
                addToHistory('env', formVals?.environment || '');

                // Apply to TimeFilter
                if (formVals.mode === 'relative' && formVals.duration) {
                  TimeFilter.setRelative(formVals.duration);
                } else if (formVals.mode === 'absolute') {
                  const from = formVals.from || undefined;
                  const to = formVals.to || undefined;
                  TimeFilter.setAbsolute(from as any, to as any);
                }
                TimeFilter.setEnabled(true);

                // Fire search
                const opts: ElasticSearchOptions = {
                  url: elasticUrl || undefined,
                  size: elasticSize || undefined,
                  index: formVals.index,
                  sort: formVals.sort,
                  duration: formVals.mode === 'relative' ? (formVals.duration as any) : undefined,
                  from: formVals.mode === 'absolute' ? (formVals.from as any) : undefined,
                  to: formVals.mode === 'absolute' ? (formVals.to as any) : undefined,
                  application_name: formVals.application_name,
                  logger: formVals.logger,
                  level: formVals.level,
                  environment: formVals.environment,
                } as any;

                const res = await window.api.elasticSearch(opts);
                if (res?.ok) {
                  if ((formVals.loadMode || 'replace') === 'replace') {
                    setEntries([]);
                    setSelected(new Set());
                    setNextId(1);
                  }
                  appendEntries(res.entries);
                } else {
                  alert('Elastic-Fehler: ' + (res?.error || 'Unbekannt'));
                }
              } catch (e) {
                alert('Elastic-Fehler: ' + (e?.message || String(e)));
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
                      if (res.ok) appendEntries(res.entries);
                      else setHttpStatus('Fehler: ' + res.error);
                    } catch (e) {
                      setHttpStatus('Fehler: ' + (e?.message || String(e)));
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
                      setHttpPollId(r.id);
                      setHttpStatus(`Polling #${r.id}`);
                      setPollMs(ms);
                      setNextPollDueAt(Date.now() + ms);
                    } else setHttpStatus('Fehler: ' + r.error);
                  } catch (e) {
                    setHttpStatus('Fehler: ' + (e?.message || String(e)));
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
                          checked={!!form.logToFile}
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
                            } catch {}
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
                          // Live-Vorschau, ohne zu speichern
                          applyThemeMode(['light', 'dark'].includes(v) ? v : 'system');
                        }}
                      >
                        <option value="system">System</option>
                        <option value="light">Hell</option>
                        <option value="dark">Dunkel</option>
                      </select>
                    </div>
                    {/* Fenster-Titel wird nicht mehr über Einstellungen geändert, nur via Kontextmenü */}
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
                } catch {}
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
                } catch {}
              }}
              disabled={!follow}
            />
            <span>Smooth</span>
          </label>
        </div>
        <div className="section">
          {/* NEU: HTTP Menü */}
          <button
            ref={httpBtnRef}
            onClick={(e) => {
              const el = e.currentTarget as any;
              const r = el.getBoundingClientRect();
              setHttpMenu({ open: true, x: Math.round(r.left), y: Math.round(r.bottom + 4) });
            }}
            title="HTTP-Aktionen"
          >
            HTTP ▾
          </button>
        </div>
        <div className="section">
          {/* NEU: Anfang/Ende */}
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
            }}
          >
            Filter leeren
          </button>
        </div>
        {/* DC-Filter Steuerung + Hinweis */}
        <div className="section">
          <button onClick={() => setShowDcDialog(true)} title="Diagnostic Context Filter öffnen">
            DC-Filter…
          </button>
          {(() => {
            const dcCount = DiagnosticContextFilter.getDcEntries().length;
            const dcEnabled = DiagnosticContextFilter.isEnabled();
            if (dcCount === 0) return null;
            return (
              <span
                className="status"
                title={dcEnabled ? 'DC-Filter aktiv' : 'DC-Filter gesetzt, aber deaktiviert'}
                style={{ marginLeft: '6px' }}
              >
                {dcEnabled ? `DC ${dcCount} aktiv` : `DC ${dcCount} aus`}
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
              const label =
                s.mode === 'relative' && s.duration
                  ? `Elastic: ${s.duration}`
                  : s.from || s.to
                    ? `Elastic: ${s.from ? 'von' : ''} ${s.from || ''} ${s.to ? 'bis ' + s.to : ''}`
                    : 'Elastic aktiv';
              return (
                <span className="status" style={{ marginLeft: '6px' }} title="Elastic-Search aktiv">
                  {label}
                </span>
              );
            } catch {
              return null;
            }
          })()}
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
        <div className="section">
          <button onClick={() => openSettingsModal('tcp')}>Einstellungen…</button>
        </div>
      </header>

      {/* Aktive Filter-Chips: ohne TraceId-Chips */}
      {(() => {
        const stdFilterChips = [];
        if (filter.level)
          stdFilterChips.push({
            key: 'level',
            label: `Level: ${filter.level}`,
            onRemove: () => setFilter((f) => ({ ...f, level: '' })),
          });
        if (filter.logger)
          stdFilterChips.push({
            key: 'logger',
            label: `Logger: ${filter.logger}`,
            onRemove: () => setFilter((f) => ({ ...f, logger: '' })),
          });
        if (filter.thread)
          stdFilterChips.push({
            key: 'thread',
            label: `Thread: ${filter.thread}`,
            onRemove: () => setFilter((f) => ({ ...f, thread: '' })),
          });
        if (filter.message)
          stdFilterChips.push({
            key: 'message',
            label: `Message: ${filter.message}`,
            onRemove: () => setFilter((f) => ({ ...f, message: '' })),
          });
        const allChips = [...stdFilterChips.map((c) => ({ ...c, type: 'std' }))];
        return allChips.length > 0 ? (
          <div style={{ padding: '6px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '12px', color: '#666' }}>Aktive Filter:</div>
              <div className="chips" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {allChips.map((c) => (
                  <span className="chip" key={c.key}>
                    {c.label}
                    <button title="Entfernen" onClick={c.onRemove}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <button
                onClick={() =>
                  setFilter((f) => ({ ...f, level: '', logger: '', thread: '', message: '' }))
                }
                title="Alle Filter-Chips löschen"
              >
                Alle löschen
              </button>
            </div>
          </div>
        ) : null;
      })()}

      {/* HTTP Dropdown Menü */}
      {httpMenu.open && (
        <div
          id="httpMenu"
          ref={httpMenuRef}
          className="context-menu"
          style={{ left: httpMenu.x + 'px', top: httpMenu.y + 'px' }}
        >
          <div className="item" onClick={httpMenuLoadOnce}>
            Einmal laden
          </div>
          <div className="item" onClick={httpMenuStartPoll}>
            Polling starten
          </div>
          <div
            className="item"
            onClick={() => {
              setHttpMenu({ open: false, x: 0, y: 0 });
              if (httpPollId != null) httpMenuStopPoll();
            }}
          >
            Polling stoppen
          </div>
          <div className="sep" />
          <div className="item" onClick={() => openSettingsModal('http')}>
            Einstellungen…
          </div>
        </div>
      )}

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
              const globalIdx = filteredIdx[vi.index];
              const e = entries[globalIdx] || {};
              const isSel = selected.has(globalIdx);
              const rowCls = 'row' + (isSel ? ' sel' : '');
              const mark = (e as any)._mark as string | undefined;
              const style = {
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${vi.start}px)`,
                height: rowHeight + 'px',
              } as any;
              return (
                <div
                  key={vi.key}
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
              // sanfte Tönung aus _mark oder color ableiten
              ['--details-tint' as any]: computeTint(
                (selectedEntry && (selectedEntry as any)._mark) || (selectedEntry as any)?.color,
                0.22
              ),
            }}
          >
            {!selectedEntry && (
              <div style={{ color: 'var(--color-text-secondary)' }}>Keine Auswahl</div>
            )}
            {selectedEntry && (
              <Fragment>
                {/* Meta */}
                <div className="meta-grid">
                  <div>
                    <div className="kv">
                      <span>Zeit</span>
                      <div>{fmtTimestamp((selectedEntry as any).timestamp)}</div>
                    </div>
                    <div className="kv">
                      <span>Logger</span>
                      <div>{fmt((selectedEntry as any).logger)}</div>
                    </div>
                  </div>
                  <div>
                    <div className="kv">
                      <span>Level</span>
                      <div>
                        <span className={levelClass((selectedEntry as any).level)}>
                          {fmt((selectedEntry as any).level)}
                        </span>
                      </div>
                    </div>
                    <div className="kv">
                      <span>Thread</span>
                      <div>{fmt((selectedEntry as any).thread)}</div>
                    </div>
                  </div>
                </div>

                <div className="section-sep" />

                {/* Message */}
                <div className="kv full">
                  <span>Message</span>
                  <pre
                    id="dMessage"
                    dangerouslySetInnerHTML={{
                      __html: highlightAll((selectedEntry as any).message || '', search),
                    }}
                  />
                </div>

                {/* Stacktrace falls vorhanden */}
                {((selectedEntry as any).stack_trace || (selectedEntry as any).stackTrace) && (
                  <div className="kv full">
                    <span>Stacktrace</span>
                    <pre className="stack-trace">
                      {String(
                        (selectedEntry as any).stack_trace ||
                          (selectedEntry as any).stackTrace ||
                          ''
                      )}
                    </pre>
                  </div>
                )}

                {/* MDC */}
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
            {colorChoices.map((c, i) => (
              <div
                key={i}
                className="swatch"
                style={{ background: c }}
                onClick={() => applyMarkColor(c)}
                title={c}
              />
            ))}
          </div>
          <div className="sep" />
          <div className="item" onClick={adoptTraceIds}>
            TraceId(s) in MDC-Filter übernehmen
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
