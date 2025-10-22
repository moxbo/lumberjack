import {useEffect, useMemo, useRef, useState} from 'preact/hooks'
import { Fragment } from 'preact'
import {useVirtualizer} from '@tanstack/react-virtual'
import moment from 'moment'
import { highlightAll } from './utils/highlight.js'
import { msgMatches } from './utils/msgFilter.js'
import { DragAndDropManager } from './utils/dnd.js'
import DCFilterPanel from './DCFilterPanel.jsx'
import { LoggingStore } from './store/loggingStore.js'
import { DiagnosticContextFilter } from './store/dcFilter.js'

function levelClass(level) {
    const l = (level || '').toUpperCase()
    return { TRACE: 'lev-trace', DEBUG: 'lev-debug', INFO: 'lev-info', WARN: 'lev-warn', ERROR: 'lev-error', FATAL: 'lev-fatal' }[l] || 'lev-unk'
}
function fmt(v) { return v == null ? '' : String(v) }
function fmtTimestamp(ts) { return ts ? moment(ts).format('YYYY-MM-DD HH:mm:ss.SSS') : '-' }

// Message-Filter-Logik ausgelagert nach utils/msgFilter.js

export default function App() {
    const [entries, setEntries] = useState([])
    const [nextId, setNextId] = useState(1)
    const [selected, setSelected] = useState(new Set())
    const lastClicked = useRef(null)

    const [search, setSearch] = useState('')
    const [filter, setFilter] = useState({level: '', logger: '', thread: '', service: '', trace: '', message: ''})
    const [stdFiltersEnabled, setStdFiltersEnabled] = useState(true)

    // re-render trigger for MDC filter changes
    const [dcVersion, setDcVersion] = useState(0)
    useEffect(() => { const off = DiagnosticContextFilter.onChange(() => setDcVersion(v => v + 1)); return () => off?.() }, [])

    // Filter-Historien
    const [histLogger, setHistLogger] = useState([])
    const [histTrace, setHistTrace] = useState([]) // einzelne Trace-IDs

    const [tcpStatus, setTcpStatus] = useState('')
    const [httpStatus, setHttpStatus] = useState('')
    const [httpPollId, setHttpPollId] = useState(null)
    const [tcpPort, setTcpPort] = useState(5000)

    const [httpUrl, setHttpUrl] = useState('')
    const [httpInterval, setHttpInterval] = useState(5000)
    const [showSettings, setShowSettings] = useState(false)
    const [form, setForm] = useState({tcpPort: 5000, httpUrl: '', httpInterval: 5000})

    // HTTP Dropdown-Menü (toolbar)
    const [httpMenu, setHttpMenu] = useState({open:false, x:0, y:0})
    const httpBtnRef = useRef(null)

    // Countdown bis zum nächsten Intervall
    const [nextPollDueAt, setNextPollDueAt] = useState(null)
    const [pollMs, setPollMs] = useState(0)
    const [nextPollIn, setNextPollIn] = useState('')

    const dividerRef = useRef(null)
    const colResize = useRef({active: null, startX: 0, startW: 0})

    const [dragActive, setDragActive] = useState(false)

    // Fortschritt
    const [busyCount, setBusyCount] = useState(0)
    const busy = busyCount > 0
    const withBusy = async (fn) => { setBusyCount((c) => c + 1); try { return await fn() } finally { setBusyCount((c) => Math.max(0, c - 1)) } }

    // Kontextmenü
    const [ctxMenu, setCtxMenu] = useState({open: false, x: 0, y: 0})
    const ctxRef = useRef(null)

    const colorChoices = ['#fffbcc', '#d1fae5', '#bae6fd', '#fecaca', '#e9d5ff', '#f5f5f5']

    function ensureIds(arr) {
        let id = nextId; for (const e of arr) { if (e._id == null) e._id = id++ } if (id !== nextId) setNextId(id)
    }
    function appendEntries(arr) { ensureIds(arr); try { LoggingStore.addEvents(arr) } catch {} setEntries((prev) => prev.concat(arr)) }

    const filteredIdx = useMemo(() => {
        const level = filter.level.trim().toUpperCase()
        const logger = filter.logger.trim().toLowerCase()
        const thread = (filter.thread ?? '').trim().toLowerCase()
        const service = (filter.service ?? '').trim().toLowerCase()
        const traceList = (filter.trace.trim().toLowerCase() || '').split('|').map(t => t.trim()).filter(Boolean)
        const msgExpr = filter.message || ''
        const out = []
        for (let i = 0; i < entries.length; i++) {
            const e = entries[i]
            if (stdFiltersEnabled) {
                if (level && (String(e.level || '').toUpperCase() !== level)) continue
                if (logger && !String(e.logger || '').toLowerCase().includes(logger)) continue
                if (thread && !String(e.thread || '').toLowerCase().includes(thread)) continue
                if (service && !String(e.service || '').toLowerCase().includes(service)) continue
                if (traceList.length) {
                    const et = String(e.traceId || '').toLowerCase(); let ok = false
                    for (const t of traceList) { if (et.includes(t)) { ok = true; break } }
                    if (!ok) continue
                }
                if (!msgMatches(e?.message, msgExpr)) continue
            }
            // MDC filter muss matchen
            try { if (!DiagnosticContextFilter.matches(e?.mdc || {})) continue } catch {}
            out.push(i)
        }
        return out
    }, [entries, filter, dcVersion, stdFiltersEnabled])

    const searchMatchIdx = useMemo(() => {
        const s = search.trim().toLowerCase(); if (!s) return []
        const out = []; for (const idx of filteredIdx) { const e = entries[idx]; if (String(e?.message || '').toLowerCase().includes(s)) out.push(idx) }
        return out
    }, [search, filteredIdx, entries])

    const markedIdx = useMemo(() => { const out = []; for (const idx of filteredIdx) if (entries[idx]?._mark) out.push(idx); return out }, [entries, filteredIdx])

    useEffect(() => { if (lastClicked.current == null && selected.size === 0 && filteredIdx.length > 0) { const idx = filteredIdx[0]; setSelected(new Set([idx])); lastClicked.current = idx } }, [filteredIdx, selected])

    const countTotal = entries.length
    const countFiltered = filteredIdx.length
    const countSelected = selected.size

    const parentRef = useRef(null)
    const rowH = 28
    const virtualizer = useVirtualizer({ count: filteredIdx.length, getScrollElement: () => parentRef.current, estimateSize: () => rowH, overscan: 10 })
    const virtualItems = virtualizer.getVirtualItems()
    const totalHeight = virtualizer.getTotalSize()

    function toggleSelectIndex(idx, extendRange, keepOthers) {
        setSelected((prev) => {
            const next = keepOthers || extendRange ? new Set(prev) : new Set()
            if (extendRange && lastClicked.current != null) { const a = Math.min(lastClicked.current, idx); const b = Math.max(lastClicked.current, idx); for (let i = a; i <= b; i++) next.add(i) }
            else { if (next.has(idx)) next.delete(idx); else next.add(idx) }
            lastClicked.current = idx; return next
        })
    }

    function gotoSearchMatch(dir) {
        const order = searchMatchIdx; if (!order.length) return
        const current = [...selected][0] ?? -1
        const pos = order.indexOf(current)
        const target = current === -1 ? order[0] : (pos === -1 ? order[0] : order[(pos + (dir > 0 ? 1 : order.length - 1)) % order.length])
        setSelected(new Set([target])); lastClicked.current = target
        const visIndex = filteredIdx.indexOf(target); if (visIndex >= 0) parentRef.current?.scrollTo({top: visIndex * rowH, behavior: 'smooth'})
    }
    function gotoMarked(dir) {
        const order = markedIdx; if (!order.length) return
        const current = [...selected][0] ?? -1
        const pos = order.indexOf(current)
        const target = current === -1 ? order[0] : (pos === -1 ? order[0] : order[(pos + (dir > 0 ? 1 : order.length - 1)) % order.length])
        setSelected(new Set([target])); lastClicked.current = target
        const visIndex = filteredIdx.indexOf(target); if (visIndex >= 0) parentRef.current?.scrollTo({top: visIndex * rowH, behavior: 'smooth'})
    }

    const selectedOneIdx = useMemo(() => selected.size === 1 ? [...selected][0] : null, [selected])
    const selectedEntry = selectedOneIdx != null ? entries[selectedOneIdx] : null

    // sortierte MDC-Paare für die Detailansicht
    const mdcPairs = useMemo(() => {
        const m = selectedEntry && selectedEntry.mdc ? selectedEntry.mdc : {}
        // Only exclude logger/thread from MDC details, keep traceId variants visible here
        const banned = new Set(['logger','thread'])
        const arr = Object.entries(m).filter(([k]) => !banned.has(String(k))).map(([k, v]) => [String(k), String(v)])
        arr.sort((a,b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))
        return arr
    }, [selectedEntry])

    function addMdcToFilter(k, v) { try { DiagnosticContextFilter.addMdcEntry(k, v); DiagnosticContextFilter.setEnabled(true) } catch {} }

    function openSettingsModal() { setForm({tcpPort, httpUrl, httpInterval}); setShowSettings(true) }
    async function saveSettingsModal() {
        const port = Number(form.tcpPort || 0); if (!(port >= 1 && port <= 65535)) { alert('Ungültiger TCP-Port'); return }
        const interval = Math.max(500, Number(form.httpInterval || 5000))
        try { await window.api.settingsSet({ tcpPort: port, httpUrl: String(form.httpUrl || '').trim(), httpInterval: interval }); setTcpPort(port); setHttpUrl(String(form.httpUrl || '').trim()); setHttpInterval(interval); setShowSettings(false) } catch (e) { alert('Speichern fehlgeschlagen: ' + (e?.message || String(e))) }
    }

    // Historie-Utils (max 6, in-use Tokens nie entfernen)
    function setAndPersistHistory(kind, arr) {
        if (kind === 'logger') { setHistLogger(arr); window.api.settingsSet({ histLogger: arr }) }
        if (kind === 'trace') { setHistTrace(arr); window.api.settingsSet({ histTrace: arr }) }
    }
    function addToHistory(kind, value) {
        const v = String(value || '').trim(); if (!v) return
        if (kind === 'logger') {
            const cur = histLogger.slice(); const idx = cur.indexOf(v); if (idx >= 0) cur.splice(idx, 1); cur.unshift(v)
            setAndPersistHistory('logger', cur.slice(0, 6))
        }
    }
    function addTraceTokensToHistory(tokens) {
        const cur = histTrace.slice(); const use = new Set((filter.trace || '').split('|').map(s => s.trim()).filter(Boolean))
        for (const t of tokens.map(s => String(s || '').trim()).filter(Boolean)) { const i = cur.indexOf(t); if (i >= 0) cur.splice(i, 1); cur.unshift(t) }
        // trim auf 6, aber in-use Tokens nicht löschen
        const out = []
        for (const item of cur) { if (out.length >= 6 && !use.has(item)) continue; if (!out.includes(item)) out.push(item) }
        setAndPersistHistory('trace', out)
    }

    // Toolbar HTTP Menü öffnen
    function openHttpMenu(ev){ ev.preventDefault(); const btn = httpBtnRef.current; if (!btn) return; const r = btn.getBoundingClientRect(); setHttpMenu({open:true, x: Math.round(r.left), y: Math.round(r.bottom + 4)}) }

    // Clicks außerhalb: schließe Menü
    useEffect(() => { function onDocClick(e){ if (!httpMenu.open) return; const btn=httpBtnRef.current; const menu=document.querySelector('#httpMenu'); if (btn && (btn===e.target || btn.contains(e.target))) return; if (menu && menu.contains(e.target)) return; setHttpMenu({open:false, x:0, y:0}) } window.addEventListener('mousedown', onDocClick, true); return () => window.removeEventListener('mousedown', onDocClick, true) }, [httpMenu.open])

    // Poll-Countdown aktualisieren
    useEffect(() => {
        if (httpPollId == null || !pollMs) { setNextPollIn(''); return }
        let rafId = null
        const tick = () => {
            const now = Date.now()
            let due = nextPollDueAt || (now + pollMs)
            // rolle vor, falls vergangen
            while (due && now > due) due += pollMs
            setNextPollDueAt(due)
            const remain = Math.max(0, (due || now) - now)
            const txt = (remain/1000).toFixed(remain < 10000 ? 1 : 0) + 's'
            setNextPollIn(txt)
            rafId = requestAnimationFrame(tick)
        }
        rafId = requestAnimationFrame(tick)
        return () => { if (rafId) cancelAnimationFrame(rafId) }
    }, [httpPollId, pollMs])

    // ESC: modal / Kontextmenü schließen
    useEffect(() => { const onKey = (e) => { if (e.key === 'Escape') { if (showSettings) setShowSettings(false); if (ctxMenu.open) setCtxMenu({open: false, x: 0, y: 0}); if (httpMenu.open) setHttpMenu({open:false,x:0,y:0}) } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [showSettings, ctxMenu.open, httpMenu.open])

    // Drag & Drop
    useEffect(() => {
        const mgr = new DragAndDropManager({
            onFiles: async (paths) => {
                await withBusy(async () => {
                    const res = await window.api.parsePaths(paths)
                    if (res?.ok) appendEntries(res.entries); else alert('Fehler beim Laden (Drop): ' + (res?.error || 'unbekannt'))
                })
            },
            onActiveChange: (active) => setDragActive(active)
        })
        mgr.attach(window)
        return () => mgr.detach()
    }, [])

    // Kontextmenü außerhalb schließen (Zeilenmenü)
    useEffect(() => { function onDocClick(e) { if (!ctxMenu.open) return; const el = ctxRef.current; if (el && el.contains(e.target)) return; setCtxMenu({open: false, x: 0, y: 0}) } window.addEventListener('mousedown', onDocClick, true); return () => window.removeEventListener('mousedown', onDocClick, true) }, [ctxMenu.open])

    useEffect(() => {
        const off = window.api.onAppend((arr) => appendEntries(arr))
        const offTcp = window.api.onTcpStatus((s) => setTcpStatus(s.message || ''))
        const offMenu = window.api.onMenu(async (cmd) => {
            switch (cmd?.type) {
                case 'open-files': { const files = await window.api.openFiles(); if (!files?.length) return; await withBusy(async () => { const res = await window.api.parsePaths(files); if (res?.ok) appendEntries(res.entries); else alert('Fehler beim Laden: ' + (res?.error || '')) }); break }
                case 'open-settings': { openSettingsModal(); break }
                case 'http-load': { const url = (httpUrl || '').trim(); if (!url) { openSettingsModal(); return } await withBusy(async () => { const res = await window.api.httpLoadOnce(url); if (res.ok) appendEntries(res.entries); else setHttpStatus('Fehler: ' + res.error) }); break }
                case 'http-start-poll': { const url = (httpUrl || '').trim(); const ms = Math.max(500, Number(httpInterval || 5000)); if (!url) { openSettingsModal(); return } const r = await window.api.httpStartPoll({url, intervalMs: ms}); if (r.ok) { setHttpPollId(r.id); setHttpStatus(`Polling #${r.id}`); setPollMs(ms); setNextPollDueAt(Date.now()+ms) } else setHttpStatus('Fehler: ' + r.error); break }
                case 'http-stop-poll': { if (httpPollId == null) { setHttpStatus('Kein aktives Polling'); return } const r = await window.api.httpStopPoll(httpPollId); if (r.ok) { setHttpStatus('Poll gestoppt'); setHttpPollId(null); setNextPollIn(''); setNextPollDueAt(null) } break }
                case 'tcp-configure': { openSettingsModal(); break }
                case 'tcp-start': { const port = Number(tcpPort || 5000); if (!port) return; window.api.tcpStart(port); break }
                case 'tcp-stop': { window.api.tcpStop(); break }
            }
        })
        return () => { off?.(); offTcp?.(); offMenu?.() }
    }, [httpPollId, tcpPort, httpUrl, httpInterval])

    // Toolbar-Aktion: Logs leeren
    function clearLogs(){ setEntries([]); setSelected(new Set()); setNextId(1); try { LoggingStore.reset() } catch {} setHttpStatus(''); setTcpStatus('') }

    // Toolbar-HTTP-Menü Aktionen
    async function httpMenuLoadOnce(){ setHttpMenu({open:false,x:0,y:0}); const url=(httpUrl||'').trim(); if(!url){ openSettingsModal(); return } await withBusy(async () => { const res = await window.api.httpLoadOnce(url); if (res.ok) appendEntries(res.entries); else setHttpStatus('Fehler: ' + res.error) }) }
    async function httpMenuStartPoll(){ setHttpMenu({open:false,x:0,y:0}); const url=(httpUrl||'').trim(); const ms=Math.max(500, Number(httpInterval||5000)); if(!url){ openSettingsModal(); return } const r = await window.api.httpStartPoll({url, intervalMs: ms}); if (r.ok){ setHttpPollId(r.id); setHttpStatus(`Polling #${r.id}`); setPollMs(ms); setNextPollDueAt(Date.now()+ms) } else { setHttpStatus('Fehler: ' + r.error) } }
    async function httpMenuStopPoll(){ setHttpMenu({open:false,x:0,y:0}); if (httpPollId==null) return; const r = await window.api.httpStopPoll(httpPollId); if (r.ok){ setHttpStatus('Poll gestoppt'); setHttpPollId(null); setNextPollIn(''); setNextPollDueAt(null) } }

    // Divider Drag
    useEffect(() => {
        function onMouseMove(e) {
            if (!dividerRef.current?._resizing) return
            const startY = dividerRef.current._startY
            const startH = dividerRef.current._startH
            // Invertiertes Verhalten: nach oben ziehen => größere Detail-Höhe
            const dy = e.clientY - startY
            let newH = startH - dy
            const layout = document.querySelector('main.layout')
            const total = layout ? layout.clientHeight : (document.body.clientHeight || window.innerHeight)
            const minDetail = 150
            const minList = 140
            const dividerSize = 6
            const maxDetail = Math.max(minDetail, total - minList - dividerSize)
            if (newH < minDetail) newH = minDetail
            if (newH > maxDetail) newH = maxDetail
            document.documentElement.style.setProperty('--detail-height', `${Math.round(newH)}px`)
        }
        async function onMouseUp() {
            if (dividerRef.current) dividerRef.current._resizing = false
            document.body.style.userSelect = ''
            document.body.style.cursor = ''
            window.removeEventListener('mousemove', onMouseMove)
            window.removeEventListener('mouseup', onMouseUp)
            try {
                const cs = getComputedStyle(document.documentElement)
                const h = cs.getPropertyValue('--detail-height').trim()
                const num = Number(h.replace('px', '')) || 300
                await window.api.settingsSet({detailHeight: Math.round(num)})
            } catch {}
        }
        function onMouseDown(e) {
            dividerRef.current._resizing = true
            dividerRef.current._startY = e.clientY
            const cs = getComputedStyle(document.documentElement)
            const h = cs.getPropertyValue('--detail-height').trim()
            dividerRef.current._startH = Number(h.replace('px', '')) || 300
            document.body.style.userSelect = 'none'
            document.body.style.cursor = 'row-resize'
            window.addEventListener('mousemove', onMouseMove)
            window.addEventListener('mouseup', onMouseUp)
        }
        const el = dividerRef.current
        if (el) el.addEventListener('mousedown', onMouseDown)
        return () => { if (el) el.removeEventListener('mousedown', onMouseDown) }
    }, [])

    // Spalten-Resize
    function onColMouseDown(key, e) {
        const varMap = {ts: '--col-ts', lvl: '--col-lvl', logger: '--col-logger'}; const active = varMap[key]; if (!active) return
        const cs = getComputedStyle(document.documentElement); const cur = cs.getPropertyValue(active).trim(); const curW = Number(cur.replace('px', '')) || 0
        const onMove = (ev) => onColMouseMove(ev)
        const onUp = async () => { await onColMouseUp() }
        colResize.current = {active, startX: e.clientX, startW: curW}; document.body.style.userSelect = 'none'; document.body.style.cursor = 'col-resize'
        window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
    }
    function onColMouseMove(e) {
        const st = colResize.current; if (!st.active) return
        let newW = st.startW + (e.clientX - st.startX); const clamp = (v, min, max) => Math.max(min, Math.min(max, v))
        if (st.active === '--col-ts') newW = clamp(newW, 140, 600); if (st.active === '--col-lvl') newW = clamp(newW, 70, 200); if (st.active === '--col-logger') newW = clamp(newW, 160, 800)
        document.documentElement.style.setProperty(st.active, `${Math.round(newW)}px`)
    }
    async function onColMouseUp() {
        const st = colResize.current; colResize.current = {active: null, startX: 0, startW: 0}; document.body.style.userSelect = ''; document.body.style.cursor = ''
        window.removeEventListener('mousemove', onColMouseMove); window.removeEventListener('mouseup', onColMouseUp)
        try { if (!st.active) return; const cs = getComputedStyle(document.documentElement); const val = cs.getPropertyValue(st.active).trim(); const num = Number(val.replace('px', '')) || 0; const keyMap = {'--col-ts': 'colTs', '--col-lvl': 'colLvl', '--col-logger': 'colLogger'}; const k = keyMap[st.active]; if (k) await window.api.settingsSet({[k]: Math.round(num)}) } catch {}
    }

    // Kontextmenü-Aktionen (Zeilen)
    function openContextMenu(ev, idx) {
        ev.preventDefault(); ev.stopPropagation(); if (!selected.has(idx)) { setSelected(new Set([idx])); lastClicked.current = idx } setCtxMenu({open: true, x: ev.clientX, y: ev.clientY})
    }
    function applyMarkColor(color) { setEntries((prev) => { const next = prev.slice(); for (const idx of selected) { if (next[idx]) next[idx] = {...next[idx], _mark: color || undefined} } return next }); setCtxMenu({open: false, x: 0, y: 0}) }
    function adoptTraceIds() {
        const ids = []; for (const idx of selected) { const v = String(entries[idx]?.traceId || '').trim(); if (v) ids.push(v) }
        const uniq = Array.from(new Set(ids)); setFilter((f) => ({...f, trace: uniq.join('|')})); addTraceTokensToHistory(uniq); setCtxMenu({open: false, x: 0, y: 0})
    }
    async function copyTsMsg() {
        try { const lines = []; for (const idx of selected) { const e = entries[idx]; if (!e) continue; lines.push(`${fmtTimestamp(e.timestamp)}\n${String(e.message || '')}`) } const text = lines.join('\n'); if (text) await navigator.clipboard.writeText(text) } catch {}
        setCtxMenu({open: false, x: 0, y: 0})
    }

    // Trace-Chips
    const traceTokens = useMemo(() => (filter.trace || '').split('|').map(s => s.trim()).filter(Boolean), [filter.trace])
    function removeTraceToken(tok) {
        const rest = traceTokens.filter(t => t !== tok); setFilter((f) => ({...f, trace: rest.join('|')}))
    }

    // Aktive Standard-Filter als Chips zusammenstellen (Level/Logger/Thread/Message)
    const stdFilterChips = useMemo(() => {
        const chips = []
        if (filter.level) chips.push({ key: 'level', label: `Level: ${filter.level}`, onRemove: () => setFilter((f) => ({...f, level: ''})) })
        if (filter.logger) chips.push({ key: 'logger', label: `Logger: ${filter.logger}`, onRemove: () => setFilter((f) => ({...f, logger: ''})) })
        if (filter.thread) chips.push({ key: 'thread', label: `Thread: ${filter.thread}`, onRemove: () => setFilter((f) => ({...f, thread: ''})) })
        if (filter.message) chips.push({ key: 'message', label: `Message: ${filter.message}`, onRemove: () => setFilter((f) => ({...f, message: ''})) })
        return chips
    }, [filter.level, filter.logger, filter.thread, filter.message])

    // Kombinierte Chip-Liste (Standardfilter + Trace-Token)
    const allFilterChips = useMemo(() => {
        const base = stdFilterChips.map(c => ({...c, type: 'std'}))
        const trace = traceTokens.map(t => ({ key: `trace:${t}`, type: 'trace', label: `TraceId: ${t}`, onRemove: () => removeTraceToken(t) }))
        return [...base, ...trace]
    }, [stdFilterChips, traceTokens])

    function clearAllFilterChips() {
        // Löscht nur Standard-Filterfelder + Trace, nicht Suche/MDC
        setFilter((f) => ({...f, level: '', logger: '', thread: '', message: '', trace: ''}))
    }

    return (
        <div style="height:100%; display:flex; flex-direction:column;">
            {dragActive && (<div class="drop-overlay">Dateien hierher ziehen (.log, .json, .zip)</div>)}

            {showSettings && (
                <div class="modal-backdrop" onClick={() => setShowSettings(false)}>
                    <div class="modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Einstellungen</h3>
                        <div class="kv"><span>TCP Port</span><input type="number" min="1" max="65535" value={form.tcpPort} onInput={(e) => setForm({...form, tcpPort: Number(e.currentTarget.value || 0)})}/></div>
                        <div class="kv"><span>HTTP URL</span><input type="text" value={form.httpUrl} onInput={(e) => setForm({...form, httpUrl: e.currentTarget.value})} placeholder="https://…/logs.json"/></div>
                        <div class="kv"><span>Intervall (ms)</span><input type="number" min="500" step="500" value={form.httpInterval} onInput={(e) => setForm({...form, httpInterval: Number(e.currentTarget.value || 5000)})}/></div>
                        <div class="modal-actions"><button onClick={() => setShowSettings(false)}>Abbrechen</button><button onClick={saveSettingsModal}>Speichern</button></div>
                    </div>
                </div>
            )}

            <header class="toolbar">
                <div class="section">
                    <span class="counts"><span id="countTotal">{countTotal}</span> gesamt, <span id="countFiltered">{countFiltered}</span> gefiltert, <span id="countSelected">{countSelected}</span> selektiert</span>
                    <button onClick={clearLogs} disabled={entries.length===0}>Logs leeren</button>
                </div>

                {/* Navigation & Markierungen */}
                <div class="section">
                    <button title="Vorherige Markierung" onClick={() => gotoMarked(-1)} disabled={markedIdx.length === 0}>◀ Markierung</button>
                    <button title="Nächste Markierung" onClick={() => gotoMarked(1)} disabled={markedIdx.length === 0}>Markierung ▶</button>
                </div>

                {/* Suche */}
                <div class="section">
                    <label>Suche</label>
                    <input id="searchText" type="text" value={search} onInput={(e) => setSearch(e.currentTarget.value)} placeholder="Volltext in message…"/>
                    <button id="btnPrevMatch" title="Vorheriger Treffer" disabled={!search.trim() || searchMatchIdx.length === 0} onClick={() => gotoSearchMatch(-1)}>◀</button>
                    <button id="btnNextMatch" title="Nächster Treffer" disabled={!search.trim() || searchMatchIdx.length === 0} onClick={() => gotoSearchMatch(1)}>▶</button>
                </div>

                {/* Filter */}
                <div class="section">
                    <label><input type="checkbox" checked={stdFiltersEnabled} onChange={(e)=>setStdFiltersEnabled(e.currentTarget.checked)} /> Standard-Filter aktiv</label>
                    <label>Level</label>
                    <select id="filterLevel" value={filter.level} onChange={(e) => setFilter({...filter, level: e.currentTarget.value})} disabled={!stdFiltersEnabled}>
                        <option value="">Alle</option>
                        {['TRACE','DEBUG','INFO','WARN','ERROR','FATAL'].map(l => <option key={l} value={l}>{l}</option>)}
                    </select>

                    <label>Logger</label>
                    <input id="filterLogger" list="loggerHistoryList" type="text" value={filter.logger} onInput={(e) => setFilter({...filter, logger: e.currentTarget.value})} placeholder="Logger enthält…" disabled={!stdFiltersEnabled}/>
                    <datalist id="loggerHistoryList">{histLogger.map((v, i) => <option key={i} value={v} />)}</datalist>

                    <label>Thread</label>
                    <input id="filterThread" type="text" value={filter.thread} onInput={(e) => setFilter({...filter, thread: e.currentTarget.value})} placeholder="Thread enthält…" disabled={!stdFiltersEnabled}/>

                    <label>Message</label>
                    <input id="filterMessage" type="text" value={filter.message} onInput={(e) => setFilter({...filter, message: e.currentTarget.value})} placeholder="Message-Filter: & = UND, | = ODER, ! = NICHT" disabled={!stdFiltersEnabled}/>

                    <label>TraceId</label>
                    <input id="filterTrace" list="traceHistoryList" type="text" value={filter.trace} onInput={(e) => setFilter({...filter, trace: e.currentTarget.value})} placeholder="TraceId (| getrennt)" disabled={!stdFiltersEnabled}/>
                    <datalist id="traceHistoryList">{histTrace.map((v, i) => <option key={i} value={v} />)}</datalist>

                    <button id="btnClearFilters" onClick={() => { setSearch(''); setFilter({level:'',logger:'',thread:'',service:'',trace:'',message:''}) }}>Filter leeren</button>
                </div>

                {/* HTTP */}
                <div class="section">
                    <button ref={httpBtnRef} onClick={openHttpMenu}>HTTP ▾</button>
                    <span id="httpStatus" class="status">{httpStatus}{httpPollId!=null && nextPollIn ? ` • Nächstes in ${nextPollIn}` : ''}</span>
                </div>

                <div class="section">
                    {busy && (<span class="busy"><span class="spinner"></span>Lädt…</span>)}
                    <span id="tcpStatus" class="status">{tcpStatus}</span>
                </div>
            </header>

            {/* Aktive Filter-Chips (Standard-Filter + TraceIds) */}
            {allFilterChips.length > 0 && (
                <div style={{padding:'6px 12px'}} title={!stdFiltersEnabled ? 'Standard-Filter sind deaktiviert – Chips wirken erst nach Aktivierung.' : ''}>
                    <div style={{display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap'}}>
                        <div style={{fontSize:'12px', color:'#666'}}>Aktive Filter:</div>
                        <div class="chips" style={{display:'flex', gap:'6px', flexWrap:'wrap', opacity: !stdFiltersEnabled ? 0.8 : 1}}>
                            {allFilterChips.map((c) => (
                                <span class="chip" key={c.key}>
                                    {c.label}
                                    <button title="Entfernen" onClick={c.onRemove}>×</button>
                                </span>
                            ))}
                        </div>
                        <button onClick={clearAllFilterChips} title="Alle Filter-Chips löschen">Alle löschen</button>
                    </div>
                </div>
            )}

            {/* HTTP Dropdown Menü */}
            {httpMenu.open && (
                <div id="httpMenu" class="context-menu" style={{left: httpMenu.x + 'px', top: httpMenu.y + 'px'}}>
                    <div class="item" onClick={httpMenuLoadOnce}>Einmal laden</div>
                    <div class="item" onClick={httpMenuStartPoll}>Polling starten</div>
                    <div class="item" onClick={httpMenuStopPoll}>Polling stoppen</div>
                    <div class="sep"/>
                    <div class="item" onClick={openSettingsModal}>Einstellungen…</div>
                </div>
            )}

            {/* Diagnostic Context Filter Panel */}
            <DCFilterPanel />

            <main class="layout" style="min-height:0;">
                <aside class="list" id="listPane" ref={parentRef}>
                    {/* ...existing header... */}
                    <div class="list-header" role="row">
                        <div class="cell" role="columnheader">Zeit<span class="resizer" onMouseDown={(e) => onColMouseDown('ts', e)}/></div>
                        <div class="cell" role="columnheader">Level<span class="resizer" onMouseDown={(e) => onColMouseDown('lvl', e)}/></div>
                        <div class="cell" role="columnheader">Logger<span class="resizer" onMouseDown={(e) => onColMouseDown('logger', e)}/></div>
                        <div class="cell" role="columnheader">Message</div>
                    </div>
                    <ul id="logList" class="log-list" style={{position: 'relative', height: totalHeight + 'px'}}>
                        {virtualItems.map((vi) => { const idx = filteredIdx[vi.index]; const e = entries[idx]; const sel = selected.has(idx); const s = search.trim(); const msgHtml = highlightAll(String(e?.message || ''), s); const rowStyle = { position:'absolute', top:0, left:0, right:0, height: rowH + 'px', transform:`translateY(${vi.start}px)` }; if (!sel && e?._mark) Object.assign(rowStyle, {background: e._mark}); return (
                            <li key={vi.key} class={`row${sel ? ' sel' : ''}`} data-idx={idx} style={rowStyle} onClick={(ev) => { const shift = ev.shiftKey; const meta = ev.metaKey || ev.ctrlKey; toggleSelectIndex(idx, shift, meta) }} onContextMenu={(ev) => openContextMenu(ev, idx)}>
                                <span class="col ts">{fmtTimestamp(e?.timestamp)}</span>
                                <span class={`col lvl ${levelClass(e?.level)}`}>{fmt(e?.level || '')}</span>
                                <span class="col logger">{fmt(e?.logger)}</span>
                                <span class="col msg" dangerouslySetInnerHTML={{__html: msgHtml}}/>
                            </li>) })}
                    </ul>
                </aside>
                <div class="divider" ref={dividerRef} title="Höhe der Details ziehen"/>
                <section class="details" id="detailsPane">
                    {!selectedEntry && (<div id="detailsEmpty">Kein Eintrag ausgewählt.</div>)}
                    {selectedEntry && (<div id="detailsView">{/* ...bestehende Details... */}
                        {/* ...existing code... */}
                        <div class="kv"><span>Zeit</span><code id="dTime">{fmtTimestamp(selectedEntry.timestamp)}</code></div>
                        <div class="kv"><span>Level</span><code id="dLevel">{fmt(selectedEntry.level)}</code></div>
                        <div class="kv"><span>Logger</span>
                            <div style={{display:'grid', gridTemplateColumns:'1fr auto', alignItems:'center', gap:'6px'}}>
                                <code id="dLogger">{fmt(selectedEntry.logger)}</code>
                                <button title="Logger in Filter übernehmen" onClick={() => { const v = String(selectedEntry.logger || ''); setStdFiltersEnabled(true); setFilter((f) => ({...f, logger: v})); addToHistory('logger', v) }}>+ Filter</button>
                            </div>
                        </div>
                        <div class="kv"><span>Thread</span>
                            <div style={{display:'grid', gridTemplateColumns:'1fr auto', alignItems:'center', gap:'6px'}}>
                                <code id="dThread">{fmt(selectedEntry.thread)}</code>
                                <button title="Thread in Filter übernehmen" onClick={() => { const v = String(selectedEntry.thread || ''); setStdFiltersEnabled(true); setFilter((f) => ({...f, thread: v})) }}>+ Filter</button>
                            </div>
                        </div>
                        {/* TraceId Detailzeile entfernt, TraceId wird nur im MDC-Block angezeigt */}
                        <div class="kv"><span>Source</span><code id="dSource">{fmt(selectedEntry.source)}</code></div>
                        <div class="kv full"><span>Message</span><pre id="dMessage" dangerouslySetInnerHTML={{__html: highlightAll(selectedEntry.message, search)}}/></div>
                        {/* MDC-Liste statt Raw */}
                        {mdcPairs.length > 0 && (
                          <div class="kv full">
                            <span>MDC</span>
                            <div>
                              <div style={{display:'grid', gridTemplateColumns:'120px 1fr auto', gap:'6px', alignItems:'center'}}>
                                {mdcPairs.map(([k,v]) => (
                                  <Fragment key={`${k}|${v}`}>
                                    <div style={{color:'#555'}}>{k}</div>
                                    <div><code style={{display:'inline-flex', padding:'4px 6px', background:'#f7f7f7', borderRadius:'4px'}}>{v}</code></div>
                                    <div style={{textAlign:'right'}}><button title="Zum DC-Filter hinzufügen" onClick={() => addMdcToFilter(k, v)}>+ Filter</button></div>
                                  </Fragment>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                        <div class="actions">
                            <button id="btnFilterByTrace" onClick={() => { const v = String(selectedEntry.traceId || ''); setStdFiltersEnabled(true); setFilter((f) => ({...f, trace: v})); addTraceTokensToHistory([v]) }}>Nach TraceId filtern</button>
                            <button id="btnFilterByLogger" onClick={() => { const v = String(selectedEntry.logger || ''); setStdFiltersEnabled(true); setFilter((f) => ({...f, logger: v})); addToHistory('logger', v) }}>Nach Logger filtern</button>
                            <button id="btnFilterByLevel" onClick={() => { const v = String(selectedEntry.level || ''); setStdFiltersEnabled(true); setFilter((f) => ({...f, level: v})) }}>Nach Level filtern</button>
                            <button id="btnCopyMessage" onClick={async () => { try { await navigator.clipboard.writeText(String(selectedEntry.message || '')) } catch {} }}>Message kopieren</button>
                        </div>
                        {/* Trace-Chips Darstellung unter den Filtern */}
                        </div>)}
                </section>
            </main>


            {ctxMenu.open && (
                <div ref={ctxRef} class="context-menu" style={{left: ctxMenu.x + 'px', top: ctxMenu.y + 'px'}}>
                    <div class="item" onClick={() => applyMarkColor(undefined)}>Markierung löschen</div>
                    <div class="colors">{colorChoices.map((c, i) => (<div key={i} class="swatch" style={{background: c}} onClick={() => applyMarkColor(c)} title={c}/>))}</div>
                    <div class="sep"/>
                    <div class="item" onClick={adoptTraceIds}>TraceId(s) in Filter übernehmen</div>
                    <div class="item" onClick={copyTsMsg}>Kopieren: Zeit und Message</div>
                </div>
            )}
        </div>
    )
}
