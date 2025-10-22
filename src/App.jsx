import {useEffect, useMemo, useRef, useState} from 'preact/hooks'
import {useVirtualizer} from '@tanstack/react-virtual'
import moment from 'moment'
import { highlightAll } from './utils/highlight.js'
import { DragAndDropManager } from './utils/dnd.js'

function levelClass(level) {
    const l = (level || '').toUpperCase()
    return { TRACE: 'lev-trace', DEBUG: 'lev-debug', INFO: 'lev-info', WARN: 'lev-warn', ERROR: 'lev-error', FATAL: 'lev-fatal' }[l] || 'lev-unk'
}
function fmt(v) { return v == null ? '' : String(v) }
function fmtTimestamp(ts) { return ts ? moment(ts).format('YYYY-MM-DD HH:mm:ss.SSS') : '-' }

// Message-Filter: expr mit | (ODER) und & (UND), case-insensitive Teilstringvergleich
function msgMatches(message, expr) {
    const m = String(message || '').toLowerCase()
    const q = String(expr || '').toLowerCase().trim()
    if (!q) return true
    const orGroups = q.split('|').map(s => s.trim()).filter(Boolean).map(g => g.split('&').map(t => t.trim()).filter(Boolean))
    if (!orGroups.length) return true
    return orGroups.some(andGroup => andGroup.every(tok => m.includes(tok)))
}

export default function App() {
    const [entries, setEntries] = useState([])
    const [nextId, setNextId] = useState(1)
    const [selected, setSelected] = useState(new Set())
    const lastClicked = useRef(null)

    const [search, setSearch] = useState('')
    const [filter, setFilter] = useState({level: '', logger: '', service: '', trace: '', message: ''})

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
    function appendEntries(arr) { ensureIds(arr); setEntries((prev) => prev.concat(arr)) }

    const filteredIdx = useMemo(() => {
        const level = filter.level.trim().toUpperCase()
        const logger = filter.logger.trim().toLowerCase()
        const service = (filter.service ?? '').trim().toLowerCase()
        const traceList = (filter.trace.trim().toLowerCase() || '').split('|').map(t => t.trim()).filter(Boolean)
        const msgExpr = filter.message || ''
        const out = []
        for (let i = 0; i < entries.length; i++) {
            const e = entries[i]
            if (level && (String(e.level || '').toUpperCase() !== level)) continue
            if (logger && !String(e.logger || '').toLowerCase().includes(logger)) continue
            if (service && !String(e.service || '').toLowerCase().includes(service)) continue
            if (traceList.length) {
                const et = String(e.traceId || '').toLowerCase(); let ok = false
                for (const t of traceList) { if (et.includes(t)) { ok = true; break } }
                if (!ok) continue
            }
            if (!msgMatches(e?.message, msgExpr)) continue
            out.push(i)
        }
        return out
    }, [entries, filter])

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

    useEffect(() => {
        const off = window.api.onAppend((arr) => appendEntries(arr))
        const offTcp = window.api.onTcpStatus((s) => setTcpStatus(s.message || ''))
        const offMenu = window.api.onMenu(async (cmd) => {
            switch (cmd?.type) {
                case 'open-files': { const files = await window.api.openFiles(); if (!files?.length) return; await withBusy(async () => { const res = await window.api.parsePaths(files); if (res?.ok) appendEntries(res.entries); else alert('Fehler beim Laden: ' + (res?.error || '')) }); break }
                case 'open-settings': { openSettingsModal(); break }
                case 'http-load': { const url = (httpUrl || '').trim(); if (!url) { openSettingsModal(); return } await withBusy(async () => { const res = await window.api.httpLoadOnce(url); if (res.ok) appendEntries(res.entries); else setHttpStatus('Fehler: ' + res.error) }); break }
                case 'http-start-poll': { const url = (httpUrl || '').trim(); const ms = Math.max(500, Number(httpInterval || 5000)); if (!url) { openSettingsModal(); return } const r = await window.api.httpStartPoll({url, intervalMs: ms}); if (r.ok) { setHttpPollId(r.id); setHttpStatus(`Polling #${r.id}`) } else setHttpStatus('Fehler: ' + r.error); break }
                case 'http-stop-poll': { if (httpPollId == null) { setHttpStatus('Kein aktives Polling'); return } const r = await window.api.httpStopPoll(httpPollId); if (r.ok) { setHttpStatus('Poll gestoppt'); setHttpPollId(null) } break }
                case 'tcp-configure': { openSettingsModal(); break }
                case 'tcp-start': { const port = Number(tcpPort || 5000); if (!port) return; window.api.tcpStart(port); break }
                case 'tcp-stop': { window.api.tcpStop(); break }
            }
        })
        return () => { off?.(); offTcp?.(); offMenu?.() }
    }, [httpPollId, tcpPort, httpUrl, httpInterval])

    // ESC: modal / Kontextmenü schließen
    useEffect(() => { const onKey = (e) => { if (e.key === 'Escape') { if (showSettings) setShowSettings(false); if (ctxMenu.open) setCtxMenu({open: false, x: 0, y: 0}) } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [showSettings, ctxMenu.open])

    // Kontextmenü außerhalb schließen
    useEffect(() => { function onDocClick(e) { if (!ctxMenu.open) return; const el = ctxRef.current; if (el && el.contains(e.target)) return; setCtxMenu({open: false, x: 0, y: 0}) } window.addEventListener('mousedown', onDocClick, true); return () => window.removeEventListener('mousedown', onDocClick, true) }, [ctxMenu.open])

    // Tastatur: Navigation
    useEffect(() => {
        function isEditableTarget(el) { if (!el) return false; const t = (el.tagName || '').toLowerCase(); return t === 'input' || t === 'textarea' || t === 'select' || !!el.isContentEditable }
        function onKey(e) {
            if (isEditableTarget(e.target)) return
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                if (!filteredIdx.length) return
                const current = (selectedOneIdx != null ? selectedOneIdx : filteredIdx[0])
                const pos = filteredIdx.indexOf(current)
                let next = null
                if (e.key === 'ArrowDown') { if (pos < 0) next = filteredIdx[0]; else if (pos < filteredIdx.length - 1) next = filteredIdx[pos + 1] }
                else { if (pos > 0) next = filteredIdx[pos - 1]; else if (pos === -1) next = filteredIdx[0] }
                if (next != null) { e.preventDefault(); setSelected(new Set([next])); lastClicked.current = next; const visIndex = filteredIdx.indexOf(next); if (visIndex >= 0) parentRef.current?.scrollTo({top: visIndex * rowH, behavior: 'smooth'}) }
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                const dir = e.key === 'ArrowRight' ? 1 : -1
                if (search.trim() && searchMatchIdx.length > 0) { e.preventDefault(); gotoSearchMatch(dir) }
                else if (!search.trim() && markedIdx.length > 0) { e.preventDefault(); gotoMarked(dir) }
            }
        }
        window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
    }, [filteredIdx, selectedOneIdx, search, searchMatchIdx, markedIdx])

    // Drag & Drop
    useEffect(() => { const mgr = new DragAndDropManager({ onFiles: async (paths) => { await withBusy(async () => { const res = await window.api.parsePaths(paths); if (res?.ok) appendEntries(res.entries); else alert('Fehler beim Laden (Drop): ' + (res?.error || 'unbekannt')) }) }, onActiveChange: (active) => setDragActive(active) }); mgr.attach(window); return () => mgr.detach() }, [])

    // Settings initial laden (inkl. Historien)
    useEffect(() => { (async () => { try { const res = await window.api.settingsGet(); if (res) {
        if (res.tcpPort) setTcpPort(Number(res.tcpPort) || 5000)
        if (res.httpUrl != null) setHttpUrl(String(res.httpUrl))
        if (res.httpInterval != null) setHttpInterval(Number(res.httpInterval) || 5000)
        const root = document.documentElement.style
        if (res.detailHeight) root.setProperty('--detail-height', `${Math.round(res.detailHeight)}px`)
        if (res.colTs) root.setProperty('--col-ts', `${Math.round(res.colTs)}px`)
        if (res.colLvl) root.setProperty('--col-lvl', `${Math.round(res.colLvl)}px`)
        if (res.colLogger) root.setProperty('--col-logger', `${Math.round(res.colLogger)}px`)
        if (Array.isArray(res.histLogger)) setHistLogger(res.histLogger)
        if (Array.isArray(res.histTrace)) setHistTrace(res.histTrace)
    } } catch {} })() }, [])

    // Divider Drag
    useEffect(() => {
        function onMouseMove(e) {
            if (!dividerRef.current?._resizing) return
            const startY = dividerRef.current._startY
            const startH = dividerRef.current._startH
            const dy = e.clientY - startY
            let newH = startH + dy
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
        colResize.current = {active, startX: e.clientX, startW: curW}; document.body.style.userSelect = 'none'; document.body.style.cursor = 'col-resize'
        window.addEventListener('mousemove', onColMouseMove); window.addEventListener('mouseup', onColMouseUp)
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

    // Kontextmenü-Aktionen
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

                {/* Filter neu angeordnet */}
                <div class="section">
                    <label>Level</label>
                    <select id="filterLevel" value={filter.level} onChange={(e) => setFilter({...filter, level: e.currentTarget.value})}>
                        <option value="">Alle</option>
                        {['TRACE','DEBUG','INFO','WARN','ERROR','FATAL'].map(l => <option value={l}>{l}</option>)}
                    </select>

                    <label>Logger</label>
                    <input id="filterLogger" list="loggerHistoryList" type="text" value={filter.logger} onInput={(e) => setFilter({...filter, logger: e.currentTarget.value})} placeholder="Logger enthält…"/>
                    <datalist id="loggerHistoryList">{histLogger.map((v, i) => <option key={i} value={v} />)}</datalist>

                    <label>Message</label>
                    <input id="filterMessage" type="text" value={filter.message} onInput={(e) => setFilter({...filter, message: e.currentTarget.value})} placeholder="Message-Filter: & = UND, | = ODER"/>

                    <label>TraceId</label>
                    <input id="filterTrace" list="traceHistoryList" type="text" value={filter.trace} onInput={(e) => setFilter({...filter, trace: e.currentTarget.value})} placeholder="TraceId (| getrennt)"/>
                    <datalist id="traceHistoryList">{histTrace.map((v, i) => <option key={i} value={v} />)}</datalist>

                    <button id="btnClearFilters" onClick={() => { setSearch(''); setFilter({level:'',logger:'',service:'',trace:'',message:''}) }}>Reset</button>
                </div>

                <div class="section">
                    {busy && (<span class="busy"><span class="spinner"></span>Lädt…</span>)}
                    <span id="tcpStatus" class="status">{tcpStatus}</span>
                    <span id="httpStatus" class="status">{httpStatus}</span>
                </div>
            </header>

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
                        <div class="kv"><span>Logger</span><code id="dLogger">{fmt(selectedEntry.logger)}</code></div>
                        <div class="kv"><span>Thread</span><code id="dThread">{fmt(selectedEntry.thread)}</code></div>
                        <div class="kv"><span>TraceId</span><code id="dTrace">{fmt(selectedEntry.traceId)}</code></div>
                        <div class="kv"><span>Source</span><code id="dSource">{fmt(selectedEntry.source)}</code></div>
                        <div class="kv full"><span>Message</span><pre id="dMessage" dangerouslySetInnerHTML={{__html: highlightAll(selectedEntry.message, search)}}/></div>
                        <div class="kv full"><span>Raw</span><pre id="dRaw">{(() => { try { return JSON.stringify(selectedEntry.raw, null, 2) } catch { return String(selectedEntry.raw) } })()}</pre></div>
                        <div class="actions">
                            <button id="btnFilterByTrace" onClick={() => { const v = String(selectedEntry.traceId || ''); setFilter((f) => ({...f, trace: v})); addTraceTokensToHistory([v]) }}>Nach TraceId filtern</button>
                            <button id="btnFilterByLogger" onClick={() => { const v = String(selectedEntry.logger || ''); setFilter((f) => ({...f, logger: v})); addToHistory('logger', v) }}>Nach Logger filtern</button>
                            <button id="btnFilterByLevel" onClick={() => { const v = String(selectedEntry.level || ''); setFilter((f) => ({...f, level: v})) }}>Nach Level filtern</button>
                            <button id="btnCopyMessage" onClick={async () => { try { await navigator.clipboard.writeText(String(selectedEntry.message || '')) } catch {} }}>Message kopieren</button>
                        </div>
                        {/* Trace-Chips Darstellung unter den Filtern */}
                        </div>)}
                </section>
            </main>

            {/* Trace-Chips immer unter Toolbar anzeigen, wenn gesetzt */}
            {traceTokens.length > 0 && (
                <div style={{padding:'6px 12px'}}>
                    <div style={{fontSize:'12px', color:'#666', marginBottom:'4px'}}>Aktive TraceId-Filter:</div>
                    <div class="chips">
                        {traceTokens.map((t) => (<span class="chip" key={t}>{t}<button title="Entfernen" onClick={() => removeTraceToken(t)}>×</button></span>))}
                    </div>
                </div>
            )}

            {ctxMenu.open && (
                <div ref={ctxRef} class="context-menu" style={{left: ctxMenu.x + 'px', top: ctxMenu.y + 'px'}}>
                    <div class="item" onClick={() => applyMarkColor(undefined)}>Markierung entfernen</div>
                    <div class="colors">{colorChoices.map((c, i) => (<div key={i} class="swatch" style={{background: c}} onClick={() => applyMarkColor(c)} title={c}/>))}</div>
                    <div class="sep"/>
                    <div class="item" onClick={adoptTraceIds}>TraceId(s) übernehmen</div>
                    <div class="item" onClick={copyTsMsg}>Kopieren: Zeit + Message</div>
                </div>
            )}
        </div>
    )
}
