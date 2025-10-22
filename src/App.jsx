import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Fragment } from 'preact';
import { useVirtualizer } from '@tanstack/react-virtual';
import moment from 'moment';
import { highlightAll } from './utils/highlight.js';
import { msgMatches } from './utils/msgFilter.js';
import { DragAndDropManager } from './utils/dnd.js';
import DCFilterPanel from './DCFilterPanel.jsx';
import { LoggingStore } from './store/loggingStore.js';
import { DiagnosticContextFilter } from './store/dcFilter.js';

function levelClass(level) {
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
function fmt(v) {
  return v == null ? '' : String(v);
}
function fmtTimestamp(ts) {
  return ts ? moment(ts).format('YYYY-MM-DD HH:mm:ss.SSS') : '-';
}

// Hilfsfunktion: erzeugt halbtransparente Tönung als rgba()-String
function computeTint(color, alpha = 0.4) {
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

  // Theme Mode: 'system' | 'light' | 'dark'
  const [themeMode, setThemeMode] = useState('system');
  function applyThemeMode(mode) {
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
    trace: '',
    message: '',
  });
  const [stdFiltersEnabled, setStdFiltersEnabled] = useState(true);

  // re-render trigger for MDC filter changes
  const [dcVersion, setDcVersion] = useState(0);
  useEffect(() => {
    const off = DiagnosticContextFilter.onChange(() => setDcVersion((v) => v + 1));
    return () => off?.();
  }, []);

  // Filter-Historien
  const [histLogger, setHistLogger] = useState([]);
  const [histTrace, setHistTrace] = useState([]); // einzelne Trace-IDs

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

  // HTTP Dropdown-Menü (toolbar)
  const [httpMenu, setHttpMenu] = useState({ open: false, x: 0, y: 0 });
  const httpBtnRef = useRef(null);
  const httpMenuRef = useRef(null);

  // Countdown bis zum nächsten Intervall
  const [nextPollDueAt, setNextPollDueAt] = useState(null);
  const [pollMs, setPollMs] = useState(0);
  const [nextPollIn, setNextPollIn] = useState('');

  const dividerRef = useRef(null);
  const layoutRef = useRef(null);
  const colResize = useRef({ active: null, startX: 0, startW: 0 });

  const [dragActive, setDragActive] = useState(false);

  // Fortschritt
  const [busyCount, setBusyCount] = useState(0);
  const busy = busyCount > 0;
  const withBusy = async (fn) => {
    setBusyCount((c) => c + 1);
    try {
      return await fn();
    } finally {
      setBusyCount((c) => Math.max(0, c - 1));
    }
  };

  // Kontextmenü
  const [ctxMenu, setCtxMenu] = useState({ open: false, x: 0, y: 0 });
  const ctxRef = useRef(null);

  const colorChoices = ['#fffbcc', '#d1fae5', '#bae6fd', '#fecaca', '#e9d5ff', '#f5f5f5'];

  // MDC-Filter Modal aus Auswahl
  const [showMdcModal, setShowMdcModal] = useState(false);
  const [mdcAgg, setMdcAgg] = useState([]); // [{ key, values: [{ val, count }] }]
  const [mdcSelKey, setMdcSelKey] = useState('');
  const [mdcSelVals, setMdcSelVals] = useState(new Set());

  function openMdcFromSelection() {
    // Aggregiere MDC-Key/Values aus aktueller Auswahl
    const map = new Map(); // key -> Map(val->count)
    for (const idx of selected) {
      const e = entries[idx];
      const m = e && e.mdc ? e.mdc : null;
      if (!m) continue;
      for (const [k0, v0] of Object.entries(m)) {
        const k = String(k0);
        const v = String(v0 ?? '');
        if (!map.has(k)) map.set(k, new Map());
        const mm = map.get(k);
        mm.set(v, (mm.get(v) || 0) + 1);
      }
    }
    const arr = Array.from(map.entries()).map(([key, mm]) => ({
      key,
      values: Array.from(mm.entries()).map(([val, count]) => ({ val, count })),
    }));
    arr.sort((a, b) => a.key.localeCompare(b.key));
    for (const it of arr) it.values.sort((a, b) => a.val.localeCompare(b.val));
    setMdcAgg(arr);
    setMdcSelKey(arr[0]?.key || '');
    setMdcSelVals(new Set());
    setShowMdcModal(true);
    setCtxMenu({ open: false, x: 0, y: 0 });
  }
  function addSelectedMdcToFilter({ presentOnly = false, allValues = false } = {}) {
    const key = String(mdcSelKey || '').trim();
    if (!key) return;
    if (presentOnly) {
      DiagnosticContextFilter.addMdcEntry(key, ''); // Wildcard: Key vorhanden
      DiagnosticContextFilter.setEnabled(true);
      return;
    }
    const item = mdcAgg.find((x) => x.key === key);
    if (!item) return;
    const values = allValues ? item.values.map((x) => x.val) : Array.from(mdcSelVals.values());
    for (const v of values) DiagnosticContextFilter.addMdcEntry(key, v);
    if (values.length) DiagnosticContextFilter.setEnabled(true);
  }
  function removeSelectedMdcFromFilter() {
    const key = String(mdcSelKey || '').trim();
    if (!key) return;
    const item = mdcAgg.find((x) => x.key === key);
    if (!item) return;
    const values =
      mdcSelVals.size > 0 ? Array.from(mdcSelVals.values()) : item.values.map((x) => x.val);
    for (const v of values) DiagnosticContextFilter.removeMdcEntry(key, v);
  }

  // Kontextmenü öffnen für Zeile idx
  function openContextMenu(ev, idx) {
    ev.preventDefault();
    // Auswahl auf die Zeile setzen, wenn noch nicht enthalten
    setSelected((prev) => {
      if (prev.has(idx)) return prev;
      lastClicked.current = idx;
      return new Set([idx]);
    });
    setCtxMenu({ open: true, x: ev.clientX, y: ev.clientY });
  }
  // Markierungsfarbe auf selektierte Einträge anwenden
  function applyMarkColor(color) {
    setEntries((prev) => {
      if (!prev || !prev.length) return prev;
      const next = prev.slice();
      for (const idx of selected) {
        if (next[idx]) {
          if (color) next[idx] = { ...next[idx], _mark: color };
          else {
            const { _mark, ...rest } = next[idx];
            next[idx] = rest;
          }
        }
      }
      return next;
    });
    setCtxMenu({ open: false, x: 0, y: 0 });
  }
  // TraceIds aus Auswahl in Filter übernehmen
  function adoptTraceIds() {
    const tokens = [];
    for (const idx of selected) {
      const e = entries[idx];
      if (!e) continue;
      const t1 = String(e.traceId || '').trim();
      const t2 = String(e?.mdc?.traceId || '').trim();
      if (t1) tokens.push(t1);
      if (t2 && t2 !== t1) tokens.push(t2);
    }
    const uniq = Array.from(new Set(tokens)).filter(Boolean);
    if (!uniq.length) return;
    setStdFiltersEnabled(true);
    setFilter((f) => {
      const cur = (f.trace || '')
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
      const all = Array.from(new Set([...cur, ...uniq]));
      return { ...f, trace: all.join('|') };
    });
    try {
      addTraceTokensToHistory(uniq);
    } catch {}
    setCtxMenu({ open: false, x: 0, y: 0 });
  }
  // Zeit+Message der Auswahl kopieren
  async function copyTsMsg() {
    try {
      const lines = [];
      const order = Array.from(selected).sort((a, b) => a - b);
      for (const idx of order) {
        const e = entries[idx];
        if (!e) continue;
        const ts = fmtTimestamp(e.timestamp);
        lines.push(`${ts} ${String(e.message || '')}`);
      }
      const text = lines.join('\n');
      if (!text) return;
      if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-1000px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCtxMenu({ open: false, x: 0, y: 0 });
    } catch (e) {
      alert('Kopieren fehlgeschlagen: ' + (e?.message || String(e)));
    }
  }

  function ensureIds(arr) {
    let id = nextId;
    for (const e of arr) {
      if (e._id == null) e._id = id++;
    }
    if (id !== nextId) setNextId(id);
  }
  function appendEntries(arr) {
    ensureIds(arr);
    try {
      LoggingStore.addEvents(arr);
    } catch {}
    setEntries((prev) => prev.concat(arr));
  }

  const filteredIdx = useMemo(() => {
    const level = filter.level.trim().toUpperCase();
    const logger = filter.logger.trim().toLowerCase();
    const thread = (filter.thread ?? '').trim().toLowerCase();
    const service = (filter.service ?? '').trim().toLowerCase();
    const traceList = (filter.trace.trim().toLowerCase() || '')
      .split('|')
      .map((t) => t.trim())
      .filter(Boolean);
    const msgExpr = filter.message || '';
    const out = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (stdFiltersEnabled) {
        if (level && String(e.level || '').toUpperCase() !== level) continue;
        if (
          logger &&
          !String(e.logger || '')
            .toLowerCase()
            .includes(logger)
        )
          continue;
        if (
          thread &&
          !String(e.thread || '')
            .toLowerCase()
            .includes(thread)
        )
          continue;
        if (
          service &&
          !String(e.service || '')
            .toLowerCase()
            .includes(service)
        )
          continue;
        if (traceList.length) {
          const et = String(e.traceId || '').toLowerCase();
          let ok = false;
          for (const t of traceList) {
            if (et.includes(t)) {
              ok = true;
              break;
            }
          }
          if (!ok) continue;
        }
        if (!msgMatches(e?.message, msgExpr)) continue;
      }
      // MDC filter muss matchen
      try {
        if (!DiagnosticContextFilter.matches(e?.mdc || {})) continue;
      } catch {}
      out.push(i);
    }
    return out;
  }, [entries, filter, dcVersion, stdFiltersEnabled]);

  const searchMatchIdx = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return [];
    const out = [];
    for (const idx of filteredIdx) {
      const e = entries[idx];
      if (
        String(e?.message || '')
          .toLowerCase()
          .includes(s)
      )
        out.push(idx);
    }
    return out;
  }, [search, filteredIdx, entries]);

  const markedIdx = useMemo(() => {
    const out = [];
    for (const idx of filteredIdx) if (entries[idx]?._mark) out.push(idx);
    return out;
  }, [entries, filteredIdx]);

  useEffect(() => {
    if (lastClicked.current == null && selected.size === 0 && filteredIdx.length > 0) {
      const idx = filteredIdx[0];
      setSelected(new Set([idx]));
      lastClicked.current = idx;
    }
  }, [filteredIdx, selected]);

  const countTotal = entries.length;
  const countFiltered = filteredIdx.length;
  const countSelected = selected.size;

  const parentRef = useRef(null);
  const rowH = 36;
  const virtualizer = useVirtualizer({
    count: filteredIdx.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowH,
    overscan: 10,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();

  function toggleSelectIndex(idx, extendRange, keepOthers) {
    setSelected((prev) => {
      const next = keepOthers || extendRange ? new Set(prev) : new Set();
      if (extendRange && lastClicked.current != null) {
        const a = Math.min(lastClicked.current, idx);
        const b = Math.max(lastClicked.current, idx);
        for (let i = a; i <= b; i++) next.add(i);
      } else {
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
      }
      lastClicked.current = idx;
      return next;
    });
  }

  function gotoSearchMatch(dir) {
    const order = searchMatchIdx;
    if (!order.length) return;
    const current = [...selected][0] ?? -1;
    const pos = order.indexOf(current);
    const target =
      current === -1
        ? order[0]
        : pos === -1
          ? order[0]
          : order[(pos + (dir > 0 ? 1 : order.length - 1)) % order.length];
    setSelected(new Set([target]));
    lastClicked.current = target;
    const visIndex = filteredIdx.indexOf(target);
    if (visIndex >= 0) parentRef.current?.scrollTo({ top: visIndex * rowH, behavior: 'smooth' });
  }
  function gotoMarked(dir) {
    const order = markedIdx;
    if (!order.length) return;
    const current = [...selected][0] ?? -1;
    const pos = order.indexOf(current);
    const target =
      current === -1
        ? order[0]
        : pos === -1
          ? order[0]
          : order[(pos + (dir > 0 ? 1 : order.length - 1)) % order.length];
    setSelected(new Set([target]));
    lastClicked.current = target;
    const visIndex = filteredIdx.indexOf(target);
    if (visIndex >= 0) parentRef.current?.scrollTo({ top: visIndex * rowH, behavior: 'smooth' });
  }

  const selectedOneIdx = useMemo(() => (selected.size === 1 ? [...selected][0] : null), [selected]);
  const selectedEntry = selectedOneIdx != null ? entries[selectedOneIdx] : null;

  // sortierte MDC-Paare für die Detailansicht
  const mdcPairs = useMemo(() => {
    const m = selectedEntry && selectedEntry.mdc ? selectedEntry.mdc : {};
    // Only exclude logger/thread from MDC details, keep traceId variants visible here
    const banned = new Set(['logger', 'thread']);
    const arr = Object.entries(m)
      .filter(([k]) => !banned.has(String(k)))
      .map(([k, v]) => [String(k), String(v)]);
    arr.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    return arr;
  }, [selectedEntry]);

  function addMdcToFilter(k, v) {
    try {
      DiagnosticContextFilter.addMdcEntry(k, v);
      DiagnosticContextFilter.setEnabled(true);
    } catch {}
  }

  // Initial Settings laden (inkl. CSS-Variablen und Historien)
  useEffect(() => {
    (async () => {
      try {
        const result = await window.api.settingsGet?.();
        if (!result || !result.ok) {
          console.warn('Failed to load settings:', result?.error);
          return;
        }
        const r = result.settings;
        if (!r) return;

        // Apply settings
        if (r.tcpPort != null) setTcpPort(Number(r.tcpPort) || 5000);
        if (typeof r.httpUrl === 'string') setHttpUrl(r.httpUrl);
        if (r.httpInterval != null) setHttpInterval(Number(r.httpInterval) || 5000);
        if (Array.isArray(r.histLogger)) setHistLogger(r.histLogger);
        if (Array.isArray(r.histTrace)) setHistTrace(r.histTrace);
        if (typeof r.themeMode === 'string') {
          const mode = ['light', 'dark', 'system'].includes(r.themeMode) ? r.themeMode : 'system';
          setThemeMode(mode);
          applyThemeMode(mode);
        }

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
      } catch (e) {
        console.error('Error loading settings:', e);
      }
    })();
  }, []);

  function openSettingsModal(initialTab) {
    setForm({
      tcpPort,
      httpUrl,
      httpInterval,
      logToFile,
      logFilePath,
      logMaxMB: Math.max(1, Math.round((logMaxBytes || 5 * 1024 * 1024) / (1024 * 1024))),
      logMaxBackups,
      themeMode,
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
    try {
      await window.api.settingsSet({
        tcpPort: port,
        httpUrl: String(form.httpUrl || '').trim(),
        httpInterval: interval,
        logToFile: toFile,
        logFilePath: path,
        logMaxBytes: maxBytes,
        logMaxBackups: backups,
        themeMode: mode,
      });
      setTcpPort(port);
      setHttpUrl(String(form.httpUrl || '').trim());
      setHttpInterval(interval);
      setLogToFile(toFile);
      setLogFilePath(path);
      setLogMaxBytes(maxBytes);
      setLogMaxBackups(backups);
      setThemeMode(mode);
      applyThemeMode(mode);
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
    if (kind === 'trace') {
      setHistTrace(arr);
      window.api.settingsSet({ histTrace: arr });
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
  function addTraceTokensToHistory(tokens) {
    const cur = histTrace.slice();
    const use = new Set(
      (filter.trace || '')
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean)
    );
    for (const t of tokens.map((s) => String(s || '').trim()).filter(Boolean)) {
      const i = cur.indexOf(t);
      if (i >= 0) cur.splice(i, 1);
      cur.unshift(t);
    }
    // trim auf 6, aber in-use Tokens nicht löschen
    const out = [];
    for (const item of cur) {
      if (out.length >= 6 && !use.has(item)) continue;
      if (!out.includes(item)) out.push(item);
    }
    setAndPersistHistory('trace', out);
  }

  // Toolbar HTTP Menü öffnen
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

  // Clicks außerhalb: schließe Menü (nutzt composedPath + Refs statt querySelector)
  useEffect(() => {
    function onDocClick(e) {
      if (!httpMenu.open) return;
      const btn = httpBtnRef.current;
      const menu = httpMenuRef.current;
      // Nutzen Sie composedPath, um DOM-Traversal zu vermeiden
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      if (btn && (btn === e.target || btn.contains(e.target) || (path && path.includes(btn))))
        return;
      if (menu && (menu === e.target || menu.contains(e.target) || (path && path.includes(menu))))
        return;
      setHttpMenu({ open: false, x: 0, y: 0 });
    }
    window.addEventListener('mousedown', onDocClick, { capture: true, passive: true });
    return () => window.removeEventListener('mousedown', onDocClick, { capture: true });
  }, [httpMenu.open]);

  // Poll-Countdown aktualisieren
  useEffect(() => {
    if (httpPollId == null || !pollMs) {
      setNextPollIn('');
      return;
    }
    let rafId = null;
    const tick = () => {
      const now = Date.now();
      let due = nextPollDueAt || now + pollMs;
      // rolle vor, falls vergangen
      while (due && now > due) due += pollMs;
      setNextPollDueAt(due);
      const remain = Math.max(0, (due || now) - now);
      const txt = (remain / 1000).toFixed(remain < 10000 ? 1 : 0) + 's';
      setNextPollIn(txt);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [httpPollId, pollMs]);

  // ESC: modal / Kontextmenü schließen
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (showSettings) setShowSettings(false);
        if (showHttpLoadDlg) setShowHttpLoadDlg(false);
        if (showHttpPollDlg) setShowHttpPollDlg(false);
        if (showMdcModal) setShowMdcModal(false);
        if (ctxMenu.open) setCtxMenu({ open: false, x: 0, y: 0 });
        if (httpMenu.open) setHttpMenu({ open: false, x: 0, y: 0 });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showSettings, showHttpLoadDlg, showHttpPollDlg, showMdcModal, ctxMenu.open, httpMenu.open]);

  // Drag & Drop
  useEffect(() => {
    const mgr = new DragAndDropManager({
      onFiles: async (paths) => {
        await withBusy(async () => {
          const res = await window.api.parsePaths(paths);
          if (res?.ok) appendEntries(res.entries);
          else alert('Fehler beim Laden (Drop): ' + (res?.error || 'unbekannt'));
        });
      },
      onActiveChange: (active) => setDragActive(active),
      onRawFiles: async (files) => {
        await withBusy(async () => {
          try {
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

  // Kontextmenü außerhalb schließen (Zeilenmenü)
  useEffect(() => {
    function onDocClick(e) {
      if (!ctxMenu.open) return;
      const el = ctxRef.current;
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      if (el && (el === e.target || el.contains(e.target) || (path && path.includes(el)))) return;
      setCtxMenu({ open: false, x: 0, y: 0 });
    }
    window.addEventListener('mousedown', onDocClick, { capture: true, passive: true });
    return () => window.removeEventListener('mousedown', onDocClick, { capture: true });
  }, [ctxMenu.open]);

  useEffect(() => {
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
      const dividerSize = 6;
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
                      window.api.settingsSet({ httpUrl: url });
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
                    window.api.settingsSet({ httpUrl: url, httpInterval: ms });
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
        <div className="modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
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

              {settingsTab === 'logging' && (
                <div className="tabpanel" role="tabpanel">
                  <div className="kv">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input
                        type="checkbox"
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
                  <div className="kv">
                    <span>Akzent</span>
                    <div>
                      <small style={{ color: '#6b7280' }}>
                        Akzentfarbe kann in styles.css über --accent / --accent-2 angepasst werden.
                      </small>
                    </div>
                  </div>
                </div>
              )}
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
            placeholder="Volltext in message…"
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
          <label>TraceId</label>
          <input
            id="filterTrace"
            list="traceHistoryList"
            type="text"
            value={filter.trace}
            onInput={(e) => setFilter({ ...filter, trace: e.currentTarget.value })}
            placeholder="TraceId (| getrennt)"
            disabled={!stdFiltersEnabled}
          />
          <datalist id="traceHistoryList">
            {histTrace.map((v, i) => (
              <option key={i} value={v} />
            ))}
          </datalist>
          <button
            id="btnClearFilters"
            onClick={() => {
              setSearch('');
              setFilter({ level: '', logger: '', thread: '', service: '', trace: '', message: '' });
            }}
          >
            Filter leeren
          </button>
        </div>
        <div className="section">
          <button ref={httpBtnRef} onClick={openHttpMenu}>
            HTTP ▾
          </button>
          <span id="httpStatus" className="status">
            {httpStatus}
            {httpPollId != null && nextPollIn ? ` • Nächstes in ${nextPollIn}` : ''}
          </span>
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

      {/* Aktive Filter-Chips */}
      {(() => {
        const traceTokens = (filter.trace || '')
          .split('|')
          .map((s) => s.trim())
          .filter(Boolean);
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
        const allChips = [
          ...stdFilterChips.map((c) => ({ ...c, type: 'std' })),
          ...traceTokens.map((t) => ({
            key: `trace:${t}`,
            type: 'trace',
            label: `TraceId: ${t}`,
            onRemove: () =>
              setFilter((f) => ({
                ...f,
                trace: (f.trace || '')
                  .split('|')
                  .filter((x) => x.trim() !== t)
                  .join('|'),
              })),
          })),
        ];
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
                  setFilter((f) => ({
                    ...f,
                    level: '',
                    logger: '',
                    thread: '',
                    message: '',
                    trace: '',
                  }))
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

      {/* Diagnostic Context Filter Panel */}
      <DCFilterPanel />

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
                  <div className="kv">
                    <span>Zeit</span>
                    <code id="dTime">{fmtTimestamp(selectedEntry.timestamp)}</code>
                  </div>
                  <div className="kv">
                    <span>Level</span>
                    <code id="dLevel">{fmt(selectedEntry.level)}</code>
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
                  <div className="kv">
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
                {mdcPairs.length > 0 && (
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
            TraceId(s) in Filter übernehmen
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
        </div>
      )}
    </div>
  );
}
