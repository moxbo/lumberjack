// @ts-nocheck
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

  // Filter-Historien
  const [histLogger, setHistLogger] = useState([]);

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

  // Drag & Drop Overlay state
  const [dragActive, setDragActive] = useState(false);

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
  const dividerRef = useRef({ _resizing: false, _startY: 0, _startH: 0 } as any);
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
      } catch {}
      try {
        if (!DiagnosticContextFilter.matches(e.mdc || {})) continue;
      } catch {}
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
    } catch {}
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
    } catch {}
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
    };
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
      alert('Speichern fehlgeschlagen: ' + (e?.message || String(e)));
    }
  }

  // Historie-Utils (max 6, in-use Tokens nie entfernen)
  function setAndPersistHistory(kind, arr) {
    if (kind === 'logger') {
      setHistLogger(arr);
      window.api.settingsSet({ histLogger: arr });
    }
  }
  function addToHistory(kind, value) {
    const v = String(value || '').trim();
    if (!v) return;
    if (kind === 'logger') {
      const cur = histLogger.slice();
      const idx = cur.indexOf(v);
      if (idx >= 0) cur.splice(idx, 1);
      cur.unshift(v);
      setAndPersistHistory('logger', cur.slice(0, 6));
    }
  }

  // HTTP Dropdown-Menü (toolbar)
  function openHttpMenu(ev) {
    ev.preventDefault();
    const btn = httpBtnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setHttpMenu({ open: true, x: Math.round(r.left), y: Math.round(r.bottom + 4) });
  }

  // Dialoge öffnen: HTTP einmal laden & Poll starten
  function openHttpLoadDialog() {
    // URL aus Settings übernehmen
    setHttpLoadUrl(String(httpUrl || ''));
    setShowHttpLoadDlg(true);
  }
  function openHttpPollDialog() {
    const url = String(httpUrl || '');
    const ms = Math.max(0, Number(httpInterval || 0)) || 5000;
    setHttpPollForm({ url, interval: ms });
    setShowHttpPollDlg(true);
  }
  // Zeit-Filter Modal öffnen
  function openTimeFilterDialog() {
    try {
      const s = TimeFilter.getState();
      const toLocal = (iso) => {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        const pad = (n) => String(n).padStart(2, '0');
        const y = d.getFullYear();
        const m = pad(d.getMonth() + 1);
        const da = pad(d.getDate());
        const hh = pad(d.getHours());
        const mm = pad(d.getMinutes());
        return `${y}-${m}-${da}T${hh}:${mm}`;
      };
      setTimeForm({
        enabled: true,
        mode: s.mode || 'relative',
        duration: s.duration || '15m',
        from: toLocal(s.from),
        to: toLocal(s.to),
        application_name: '',
        logger: '',
        level: '',
        environment: '',
        loadMode: 'append',
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
        loadMode: 'append',
      });
    }
    setShowTimeDialog(true);
  }
  function applyTimeFilter() {
    const f = timeForm;
    // 1) Lokalen Zeitfilter weiter pflegen, damit UI-Filter wie gehabt funktionieren
    if (f.mode === 'relative') {
      TimeFilter.setRelative(String(f.duration || '').trim());
    } else {
      // convert datetime-local values to Date for ISO in store
      const toDate = (s) => {
        const t = String(s || '').trim();
        if (!t) return null;
        // treat as local time
        const d = new Date(t);
        return isNaN(d.getTime()) ? null : d;
      };
      TimeFilter.setAbsolute(toDate(f.from), toDate(f.to));
    }
    TimeFilter.setEnabled(!!f.enabled);

    // 2) Elasticsearch-Suche auslösen und Ergebnisse anhängen
    withBusy(async () => {
      try {
        const opts = {};
        // Zeit einschränken nur wenn aktiviert
        if (f.enabled) {
          if (f.mode === 'relative') {
            const dur = String(f.duration || '').trim();
            if (dur) opts['duration'] = dur;
          } else {
            const fromD = toDate(f.from);
            const toD = toDate(f.to);
            if (fromD) opts['from'] = fromD;
            if (toD) opts['to'] = toD;
          }
        }
        // Zusatzfelder einbeziehen
        const app = String(f.application_name || '').trim();
        const lg = String(f.logger || '').trim();
        const lvl = String(f.level || '').trim();
        const env = String(f.environment || '').trim();
        if (app) opts['application_name'] = app;
        if (lg) opts['logger'] = lg;
        if (lvl) opts['level'] = lvl;
        if (env) opts['environment'] = env;

        const res = await window.api.elasticSearch?.(opts);
        if (!res || !res.ok) throw new Error(res?.error || 'Elasticsearch-Fehler');
        if (Array.isArray(res.entries) && res.entries.length) appendEntries(res.entries);
      } catch (e) {
        alert('Elastic-Suche fehlgeschlagen: ' + (e?.message || String(e)));
      }
    });

    setShowTimeDialog(false);
  }
  function clearTimeFilter() {
    TimeFilter.reset();
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
      loadMode: 'append',
    });
    setShowTimeDialog(false);
  }

  // Drag & Drop
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
            alert('Fehler beim Einlesen der Dateien: ' + (e?.message || String(e)));
          }
        });
      },
    });
    // war: mgr.attach(window)
    mgr.attach(document);
    return () => mgr.detach();
  }, []);

  // Kontextmenü (Zeilenmenü) – State und Helfer
  const [ctxMenu, setCtxMenu] = useState({ open: false, x: 0, y: 0, idx: null as any });
  const ctxRef = useRef(null);
  const colorChoices = [
    '#ffb3ba',
    '#ffdfba',
    '#ffffba',
    '#baffc9',
    '#bae1ff',
    '#ffd1dc',
    '#caffbf',
    '#a0c4ff',
    '#bdb2ff',
    '#ffc6ff',
  ];
  function openContextMenu(ev, idx: number) {
    ev.preventDefault();
    // Wenn Eintrag noch nicht selektiert ist, selektiere ihn
    setSelected((prev) => (prev.has(idx) ? prev : new Set([idx])));
    setCtxMenu({ open: true, x: Math.round(ev.clientX), y: Math.round(ev.clientY), idx });
  }
  function applyMarkColor(color?: string) {
    setEntries((prev) => {
      if (!prev || selected.size === 0) return prev;
      const out = prev.slice();
      for (const i of selected) {
        const e = out[i];
        if (!e) continue;
        if (color) out[i] = { ...e, _mark: color };
        else {
          const { _mark, ...rest } = (e as any) || {};
          out[i] = { ...rest } as any;
        }
      }
      return out;
    });
    setCtxMenu({ open: false, x: 0, y: 0, idx: null });
  }
  function adoptTraceIds() {
    try {
      const vals = new Set<string>();
      for (const i of selected) {
        const e: any = entries[i] || {};
        const v = e?.traceId || e?.TraceID || e?.mdc?.traceId || e?.mdc?.TraceID;
        if (v) vals.add(String(v));
      }
      if (vals.size > 0) {
        for (const v of Array.from(vals)) DiagnosticContextFilter.addMdcEntry('traceId', v);
        DiagnosticContextFilter.setEnabled(true);
      }
    } catch {}
    setCtxMenu({ open: false, x: 0, y: 0, idx: null });
  }
  function copyTsMsg() {
    try {
      const idx =
        selectedOneIdx != null ? selectedOneIdx : selected.size ? Array.from(selected)[0] : null;
      const e: any = idx != null ? entries[idx] : null;
      const text = e ? `${fmtTimestamp(e.timestamp)} ${e.message ?? ''}` : '';
      navigator?.clipboard?.writeText?.(text);
    } catch {}
    setCtxMenu({ open: false, x: 0, y: 0, idx: null });
  }

  // Kontextmenü außerhalb schließen (Zeilenmenü)
  useEffect(() => {
    function onDocClick(e) {
      if (!ctxMenu.open) return;
      const el = ctxRef.current;
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      if (el && (el === e.target || el.contains(e.target) || (path && path.includes(el)))) return;
      setCtxMenu({ open: false, x: 0, y: 0, idx: null });
    }
    window.addEventListener('mousedown', onDocClick, { capture: true, passive: true });
    return () => window.removeEventListener('mousedown', onDocClick, { capture: true });
  }, [ctxMenu.open]);

  useEffect(() => {
    // Guard against missing window.api (preload script not loaded)
    if (!window.api) {
      logger.error('window.api is not available. Preload script may have failed to load.');
      return;
    }

    const off = window.api.onAppend((arr) => appendEntries(arr));
    const offTcp = window.api.onTcpStatus((s) => setTcpStatus(s.message || ''));
    const offMenu = window.api.onMenu(async (cmd) => {
      switch (cmd?.type) {
        case 'open-files': {
          const files = await window.api.openFiles();
          if (!files?.length) return;
          await withBusy(async () => {
            const res = await window.api.parsePaths(files);
            if (res?.ok) appendEntries(res.entries);
            else alert('Fehler beim Laden: ' + (res?.error || ''));
          });
          break;
        }
        case 'open-settings': {
          openSettingsModal(cmd?.tab || 'tcp');
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
          if (httpPollId == null) {
            setHttpStatus('Kein aktives Polling');
            return;
          }
          const r = await window.api.httpStopPoll(httpPollId);
          if (r.ok) {
            setHttpStatus('Poll gestoppt');
            setHttpPollId(null);
            setNextPollIn('');
            setNextPollDueAt(null);
          }
          break;
        }
        case 'tcp-configure': {
          openSettingsModal('tcp');
          break;
        }
        case 'tcp-start': {
          const port = Number(tcpPort || 5000);
          if (!port) return;
          window.api.tcpStart(port);
          break;
        }
        case 'tcp-stop': {
          window.api.tcpStop();
          break;
        }
        case 'window-title': {
          openSetWindowTitleDialog();
          break;
        }
      }
    });
    return () => {
      off?.();
      offTcp?.();
      offMenu?.();
    };
  }, [httpPollId, tcpPort, httpUrl, httpInterval]);

  // Toolbar-Aktion: Logs leeren
  function clearLogs() {
    setEntries([]);
    setSelected(new Set());
    setNextId(1);
    try {
      LoggingStore.reset();
    } catch {}
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
      if (!dividerRef.current?._resizing) return;
      const startY = dividerRef.current._startY;
      const startH = dividerRef.current._startH;
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
      if (dividerRef.current) dividerRef.current._resizing = false;
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
      dividerRef.current._resizing = true;
      dividerRef.current._startY = e.clientY;
      const cs = getComputedStyle(document.documentElement);
      const h = cs.getPropertyValue('--detail-height').trim();
      dividerRef.current._startH = Number(h.replace('px', '')) || 300;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'row-resize';
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }
    const el = dividerRef.current;
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
                      // Persistiere URL bequemlichkeitshalber
                      setHttpUrl(url);
                      await window.api.settingsSet({ httpUrl: url });
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
                  if (httpPollId != null) return; // doppelt absichern
                  setShowHttpPollDlg(false);
                  try {
                    // Persistiere URL & Intervall
                    setHttpUrl(url);
                    setHttpInterval(ms);
                    await window.api.settingsSet({ httpUrl: url, httpInterval: ms });
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
            // Revert live preview when closing without saving
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
                  await window.api.settingsSet({ follow: v });
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
                  await window.api.settingsSet({ followSmooth: v });
                } catch {}
              }}
              disabled={!follow}
            />
            <span>Smooth</span>
          </label>
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

      {/* Hauptlayout: Liste + Details als Overlay */}
      <main className="layout" style="min-height:0;" ref={layoutRef}>
        <aside className="list" id="listPane" ref={parentRef}>
          <div className="list-header" role="row">
            <div className="cell" role="columnheader">
              Zeit
              <span className="resizer" onMouseDown={(e) => onColMouseDown('ts', e)} />
            </div>
            <div className="cell" role="columnheader">
              Level
              <span className="resizer" onMouseDown={(e) => onColMouseDown('lvl', e)} />
            </div>
            <div className="cell" role="columnheader">
              Logger
              <span className="resizer" onMouseDown={(e) => onColMouseDown('logger', e)} />
            </div>
            <div className="cell" role="columnheader">
              Message
            </div>
          </div>
          <ul
            id="logList"
            className="log-list"
            style={{ position: 'relative', height: totalHeight + 'px' }}
          >
            {virtualItems.map((vi) => {
              const idx = filteredIdx[vi.index];
              const e = entries[idx];
              const sel = selected.has(idx);
              const s = search.trim();
              const msgHtml = highlightAll(String(e?.message || ''), s);
              const rowStyle = {
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 36 + 'px',
                transform: `translateY(${vi.start}px)`,
              };
              // Markierte Einträge: gut sichtbar, aber Text lesbar halten -> Farbstreifen statt Vollhintergrund
              if (e?._mark) Object.assign(rowStyle, { boxShadow: `inset 4px 0 0 ${e._mark}` });
              return (
                <li
                  key={vi.key}
                  className={`row${sel ? ' sel' : ''}`}
                  data-idx={idx}
                  style={rowStyle}
                  onClick={(ev) => {
                    const shift = ev.shiftKey;
                    const meta = ev.metaKey || ev.ctrlKey;
                    toggleSelectIndex(idx, shift, meta);
                  }}
                  onContextMenu={(ev) => openContextMenu(ev, idx)}
                >
                  <span className="col ts">{fmtTimestamp(e?.timestamp)}</span>
                  <span className={`col lvl ${levelClass(e?.level)}`}>{fmt(e?.level || '')}</span>
                  <span className="col logger">{fmt(e?.logger)}</span>
                  <span className="col msg" dangerouslySetInnerHTML={{ __html: msgHtml }} />
                </li>
              );
            })}
          </ul>
        </aside>
        <div className="overlay">
          <div className="divider" ref={dividerRef} title="Höhe der Details ziehen" />
          <section
            className="details"
            id="detailsPane"
            data-tinted={selectedEntry && selectedEntry._mark ? '1' : undefined}
            style={
              selectedEntry && selectedEntry._mark
                ? { ['--details-tint']: computeTint(selectedEntry._mark) }
                : undefined
            }
          >
            {/* Tönung via CSS-Variable/Background-Image, kein Overlay-Element mehr nötig */}
            {selectedOneIdx == null && <div id="detailsEmpty">Kein Eintrag ausgewählt.</div>}
            {selectedEntry && (
              <div id="detailsView">
                {/* Meta-Infos kompakt in zwei Spalten */}
                <div className="meta-grid">
                  {/* Reihe 1: Zeit + Logger */}
                  <div className="kv">
                    <span>Zeit</span>
                    <code id="dTime">{fmtTimestamp(selectedEntry.timestamp)}</code>
                  </div>
                  <div className="kv">
                    <span>Logger</span>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr auto',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <code id="dLogger">{fmt(selectedEntry.logger)}</code>
                      <button
                        title="Logger in Filter übernehmen"
                        onClick={() => {
                          const v = String(selectedEntry.logger || '');
                          setStdFiltersEnabled(true);
                          setFilter((f) => ({ ...f, logger: v }));
                          addToHistory('logger', v);
                        }}
                      >
                        + Filter
                      </button>
                    </div>
                  </div>
                  {/* Reihe 2: Level + Thread */}
                  <div className="kv">
                    <span>Level</span>
                    <code id="dLevel">{fmt(selectedEntry.level)}</code>
                  </div>
                  <div className="kv">
                    <span>Thread</span>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr auto',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <code id="dThread">{fmt(selectedEntry.thread)}</code>
                      <button
                        title="Thread in Filter übernehmen"
                        onClick={() => {
                          const v = String(selectedEntry.thread || '');
                          setStdFiltersEnabled(true);
                          setFilter((f) => ({ ...f, thread: v }));
                        }}
                      >
                        + Filter
                      </button>
                    </div>
                  </div>
                  {/* Rest wie zuvor */}
                  <div className="kv" style={{ gridColumn: '1 / span 2' }}>
                    <span>Source</span>
                    <code id="dSource">{fmt(selectedEntry.source)}</code>
                  </div>
                </div>

                <div className="kv full">
                  <span>Message</span>
                  <pre
                    id="dMessage"
                    dangerouslySetInnerHTML={{
                      __html: highlightAll(selectedEntry.message, search),
                    }}
                  />
                </div>
                {selectedEntry?.stackTrace ? (
                  <div className="kv full">
                    <span>Stack Trace</span>
                    <pre
                      className="stack-trace"
                      dangerouslySetInnerHTML={{
                        __html: highlightAll(selectedEntry.stackTrace, search),
                      }}
                    />
                  </div>
                ) : null}
                {mdcPairs.length > 0 && (
                  <Fragment>
                    <div className="section-sep" />
                    <div className="kv full">
                      <span>MDC</span>
                      <div>
                        <div className="mdc-grid">
                          {mdcPairs.map(([k, v]) => (
                            <Fragment key={`${k}|${v}`}>
                              <div className="mdc-key">{k}</div>
                              <div className="mdc-val">
                                <code>{v}</code>
                              </div>
                              <div className="mdc-act">
                                <button
                                  title="Zum DC-Filter hinzufügen"
                                  onClick={() => addMdcToFilter(k, v)}
                                >
                                  + Filter
                                </button>
                              </div>
                            </Fragment>
                          ))}
                        </div>
                      </div>
                    </div>
                  </Fragment>
                )}
              </div>
            )}
          </section>
        </div>
      </main>

      {/* MDC-Filter Modal: aus Listenauswahl */}
      {showMdcModal && (
        <div className="modal-backdrop" onClick={() => setShowMdcModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>MDC-Filter aus Auswahl</h3>
            {mdcAgg.length === 0 ? (
              <div style={{ padding: '8px', color: '#777' }}>Keine MDC-Daten in der Auswahl</div>
            ) : (
              <div className="kv full">
                <span>Schlüssel</span>
                <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '10px' }}>
                  <div style={{ borderRight: '1px solid var(--color-divider)' }}>
                    {mdcAgg.map((it) => (
                      <div
                        key={it.key}
                        className={`item${mdcSelKey === it.key ? ' sel' : ''}`}
                        style={{ padding: '6px 8px', cursor: 'pointer' }}
                        onClick={() => {
                          setMdcSelKey(it.key);
                          setMdcSelVals(new Set());
                        }}
                      >
                        {it.key}{' '}
                        <small style={{ color: 'var(--color-text-secondary)' }}>
                          ({it.values.length})
                        </small>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '8px',
                      }}
                    >
                      <button onClick={() => addSelectedMdcToFilter({ presentOnly: true })}>
                        + Key vorhanden
                      </button>
                      <button
                        onClick={() => addSelectedMdcToFilter({ allValues: true })}
                        disabled={!mdcAgg.find((x) => x.key === mdcSelKey)}
                      >
                        + Alle Werte
                      </button>
                      <button
                        onClick={() => addSelectedMdcToFilter()}
                        disabled={mdcSelVals.size === 0}
                      >
                        + Ausgewählte Werte
                      </button>
                      <button
                        onClick={removeSelectedMdcFromFilter}
                        disabled={mdcSelVals.size === 0}
                      >
                        Ausgewählte entfernen
                      </button>
                    </div>
                    <div
                      style={{
                        maxHeight: '280px',
                        overflow: 'auto',
                        border: '1px solid var(--color-divider)',
                        borderRadius: '8px',
                      }}
                    >
                      {(mdcAgg.find((x) => x.key === mdcSelKey)?.values || []).map(
                        ({ val, count }) => {
                          const id = `${mdcSelKey}|${val}`;
                          const checked = mdcSelVals.has(val);
                          return (
                            <label
                              key={id}
                              className="item"
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '6px 8px',
                                borderBottom: '1px solid var(--color-divider)',
                                cursor: 'pointer',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  setMdcSelVals((prev) => {
                                    const next = new Set(prev);
                                    if (e.currentTarget.checked) next.add(val);
                                    else next.delete(val);
                                    return next;
                                  });
                                }}
                              />
                              <code style={{ flex: 1 }}>{val}</code>
                              <small style={{ color: 'var(--color-text-secondary)' }}>
                                {count}
                              </small>
                            </label>
                          );
                        }
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="modal-actions">
              <button
                onClick={() => {
                  DiagnosticContextFilter.reset();
                  setShowMdcModal(false);
                }}
                title="Alle MDC-Filter entfernen"
              >
                Leeren
              </button>
              <button
                onClick={() => {
                  DiagnosticContextFilter.setEnabled(!DiagnosticContextFilter.isEnabled());
                  setShowMdcModal(false);
                }}
              >
                {DiagnosticContextFilter.isEnabled() ? 'Deaktivieren' : 'Aktivieren'}
              </button>
              <button onClick={() => setShowMdcModal(false)}>Schließen</button>
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
            firstTs={(() => {
              let best = Number.POSITIVE_INFINITY;
              for (const idx of filteredIdx) {
                const e = entries[idx];
                const ms = e?.timestamp != null ? Number(new Date(e.timestamp)) : NaN;
                if (!isNaN(ms) && ms < best) best = ms;
              }
              return best !== Number.POSITIVE_INFINITY ? new Date(best) : null;
            })()}
            lastTs={(() => {
              let best = Number.NEGATIVE_INFINITY;
              for (const idx of filteredIdx) {
                const e = entries[idx];
                const ms = e?.timestamp != null ? Number(new Date(e.timestamp)) : NaN;
                if (!isNaN(ms) && ms > best) best = ms;
              }
              return best !== Number.NEGATIVE_INFINITY ? new Date(best) : null;
            })()}
            onApply={(f) => {
              setTimeForm(f);
              // Lokalen TimeFilter-Status aktualisieren
              try {
                const mode = f?.mode || 'relative';
                if (mode === 'relative') {
                  TimeFilter.setRelative(String(f?.duration || '').trim());
                } else {
                  const toDate = (s) => {
                    const t = String(s || '').trim();
                    if (!t) return null;
                    const d = new Date(t);
                    return isNaN(d.getTime()) ? null : d;
                  };
                  TimeFilter.setAbsolute(toDate(f?.from), toDate(f?.to));
                }
                TimeFilter.setEnabled(!!f?.enabled);
              } catch {}
              setShowTimeDialog(false);
            }}
            onClear={() => {
              clearTimeFilter();
            }}
            onClose={() => setShowTimeDialog(false)}
          />
        </Suspense>
      )}

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
          <div className="item" onClick={openMdcFromSelection}>
            MDC aus Auswahl…
          </div>
          {/* Entfernt: Fenster-Titel setzen aus Kontextmenü */}
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
