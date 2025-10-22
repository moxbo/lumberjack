(() => {
  const $ = (sel) => document.querySelector(sel);

  // State
  const state = {
    entries: [],
    filteredIdx: [],
    selectedIdx: new Set(),
    lastClicked: null,
    nextId: 1,
    httpPollId: null,
    search: '',
    filter: { level: '', logger: '', trace: '' },
    v: { rowH: 28, overscan: 10, start: 0, end: 0 }
  };

  // Rendering helpers
  function fmt(val) { return val == null ? '' : String(val); }
  function levelClass(level) {
    const l = (level || '').toUpperCase();
    return { TRACE: 'lev-trace', DEBUG: 'lev-debug', INFO: 'lev-info', WARN: 'lev-warn', ERROR: 'lev-error', FATAL: 'lev-fatal' }[l] || 'lev-unk';
  }
  function markStyle(color) { return color ? `background: ${color};` : ''; }

  function ensureIds(entries) {
    for (const e of entries) { if (!('_id' in e)) e._id = state.nextId++; }
  }

  function applyFilters() {
    const s = state.search.trim().toLowerCase();
    const level = state.filter.level.trim().toUpperCase();
    const logger = state.filter.logger.trim().toLowerCase();
    const traceRaw = state.filter.trace.trim().toLowerCase();
    const traceList = traceRaw ? traceRaw.split('|').map((t) => t.trim()).filter(Boolean) : [];

    state.filteredIdx = [];
    for (let i = 0; i < state.entries.length; i++) {
      const e = state.entries[i];
      if (level && (String(e.level || '').toUpperCase() !== level)) continue;
      if (logger && !String(e.logger || '').toLowerCase().includes(logger)) continue;
      if (traceList.length) {
        const et = String(e.traceId || '').toLowerCase();
        let ok = false; for (const t of traceList) { if (et.includes(t)) { ok = true; break; } }
        if (!ok) continue;
      }
      if (s && !String(e.message || '').toLowerCase().includes(s)) continue;
      state.filteredIdx.push(i);
    }
    updateCounts();
    renderList();
  }

  function updateCounts() {
    $('#countTotal').textContent = String(state.entries.length);
    $('#countFiltered').textContent = String(state.filteredIdx.length);
    $('#countSelected').textContent = String(state.selectedIdx.size);
  }

  function toggleSelectIndex(idx, extendRange, keepOthers) {
    if (!keepOthers && !extendRange) state.selectedIdx.clear();
    if (extendRange && state.lastClicked != null) {
      const a = Math.min(state.lastClicked, idx);
      const b = Math.max(state.lastClicked, idx);
      for (let i = a; i <= b; i++) state.selectedIdx.add(i);
    } else {
      if (state.selectedIdx.has(idx)) state.selectedIdx.delete(idx); else state.selectedIdx.add(idx);
    }
    state.lastClicked = idx;
    updateCounts();
    renderVirtualSlice();
    renderDetails();
  }

  // Virtual list
  const listPane = $('#listPane');
  const logList = $('#logList');

  function calcRange() {
    const { rowH, overscan } = state.v;
    const scrollTop = listPane.scrollTop;
    const viewH = listPane.clientHeight || 0;
    const total = state.filteredIdx.length;
    let start = Math.floor(scrollTop / rowH) - overscan; if (start < 0) start = 0;
    let end = Math.ceil((scrollTop + viewH) / rowH) + overscan; if (end > total) end = total;
    state.v.start = start; state.v.end = end;
  }

  function renderList() {
    // Set total height so scrollbar covers all items
    const totalH = state.filteredIdx.length * state.v.rowH;
    logList.style.height = totalH + 'px';
    logList.style.position = 'relative'; // wichtig für absolute positionierte Zeilen
    calcRange();
    renderVirtualSlice();
    renderDetails();
  }

  function renderVirtualSlice() {
    calcRange();
    const frag = document.createDocumentFragment();
    const { start, end, rowH } = state.v;

    // Clear existing children
    logList.innerHTML = '';

    for (let vis = start; vis < end; vis++) {
      const idx = state.filteredIdx[vis];
      const e = state.entries[idx];
      const li = document.createElement('li');
      li.className = 'row';
      li.dataset.idx = String(idx);
      li.style.position = 'absolute';
      li.style.top = '0';
      li.style.left = '0';
      li.style.right = '0';
      li.style.transform = `translateY(${vis * rowH}px)`;
      li.style.height = rowH + 'px';
      if (state.selectedIdx.has(idx)) li.classList.add('sel');
      if (e._mark) li.style.cssText += ';' + markStyle(e._mark);

      const ts = document.createElement('span'); ts.className = 'col ts'; ts.textContent = fmt(e.timestamp);
      const lvl = document.createElement('span'); lvl.className = `col lvl ${levelClass(e.level)}`; lvl.textContent = fmt(e.level || '');
      const logger = document.createElement('span'); logger.className = 'col logger'; logger.textContent = fmt(e.logger);
      const msg = document.createElement('span'); msg.className = 'col msg';
      const s = state.search.trim();
      if (s) {
        const lower = String(e.message || '');
        const i = lower.toLowerCase().indexOf(s.toLowerCase());
        if (i >= 0) {
          const before = lower.slice(0, i);
          const match = lower.slice(i, i + s.length);
          const after = lower.slice(i + s.length);
          msg.innerHTML = `${escapeHtml(before)}<mark>${escapeHtml(match)}</mark>${escapeHtml(after)}`;
        } else { msg.textContent = lower; }
      } else { msg.textContent = fmt(e.message); }

      li.append(ts, lvl, logger, msg);
      frag.appendChild(li);
    }

    logList.appendChild(frag);
  }

  function renderDetails() {
    const ids = Array.from(state.selectedIdx);
    const detailsEmpty = $('#detailsEmpty');
    const detailsView = $('#detailsView');
    if (ids.length !== 1) {
      detailsEmpty.classList.remove('hidden');
      detailsView.classList.add('hidden');
      return;
    }
    const e = state.entries[ids[0]];
    detailsEmpty.classList.add('hidden');
    detailsView.classList.remove('hidden');
    $('#dTime').textContent = fmt(e.timestamp);
    $('#dLevel').textContent = fmt(e.level);
    $('#dLogger').textContent = fmt(e.logger);
    $('#dThread').textContent = fmt(e.thread);
    $('#dTrace').textContent = fmt(e.traceId);
    $('#dSource').textContent = fmt(e.source);
    $('#dMessage').textContent = fmt(e.message);
    let raw = e.raw; try { raw = JSON.stringify(e.raw, null, 2); } catch (_) {}
    $('#dRaw').textContent = raw;
  }

  function escapeHtml(s) {
    return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  }

  function appendEntries(entries) { ensureIds(entries); for (const e of entries) state.entries.push(e); applyFilters(); }

  function allMarkedIdx() { const arr = []; for (let i = 0; i < state.entries.length; i++) if (state.entries[i]._mark) arr.push(i); return arr; }
  function gotoMark(dir) {
    const marks = allMarkedIdx(); if (!marks.length) return;
    const current = [...state.selectedIdx][0] ?? -1;
    const order = state.filteredIdx.length ? state.filteredIdx : state.entries.map((_, i) => i);
    const markedInOrder = order.filter((i) => state.entries[i]._mark);
    if (!markedInOrder.length) return;
    let target; if (current === -1) target = markedInOrder[0]; else { const pos = markedInOrder.findIndex((i) => i === current); target = pos === -1 ? markedInOrder[0] : markedInOrder[(pos + (dir > 0 ? 1 : markedInOrder.length - 1)) % markedInOrder.length]; }
    state.selectedIdx.clear(); state.selectedIdx.add(target); state.lastClicked = target;
    // scroll into view using virtual metrics
    const visIndex = state.filteredIdx.indexOf(target);
    if (visIndex >= 0) listPane.scrollTo({ top: visIndex * state.v.rowH, behavior: 'smooth' });
    renderVirtualSlice(); renderDetails();
  }

  // Wire UI events
  $('#btnOpen').addEventListener('click', async () => {
    const files = await window.api.openFiles(); if (!files || !files.length) return;
    const res = await window.api.parsePaths(files);
    if (res && res.ok) appendEntries(res.entries); else if (res && !res.ok) alert('Fehler beim Laden: ' + res.error);
  });

  $('#searchText').addEventListener('input', (e) => { state.search = e.target.value || ''; applyFilters(); });
  $('#filterLevel').addEventListener('change', (e) => { state.filter.level = e.target.value || ''; applyFilters(); });
  $('#filterLogger').addEventListener('input', (e) => { state.filter.logger = e.target.value || ''; applyFilters(); });
  $('#filterTrace').addEventListener('input', (e) => { state.filter.trace = e.target.value || ''; applyFilters(); });
  $('#btnClearFilters').addEventListener('click', () => {
    state.search = ''; state.filter = { level: '', logger: '',  trace: '' };
    $('#searchText').value = ''; $('#filterLevel').value = ''; $('#filterLogger').value = '';  $('#filterTrace').value = '';
    applyFilters();
  });

  $('#btnMarkSelected').addEventListener('click', () => {
    const color = $('#markColor').value; if (!state.selectedIdx.size) return;
    for (const idx of state.selectedIdx) state.entries[idx]._mark = color; renderVirtualSlice();
  });
  $('#btnClearMarks').addEventListener('click', () => { for (const e of state.entries) delete e._mark; renderVirtualSlice(); });
  $('#btnPrevMark').addEventListener('click', () => gotoMark(-1));
  $('#btnNextMark').addEventListener('click', () => gotoMark(1));

  // List interaction
    logList.addEventListener('click', (ev) => {
    const li = ev.target.closest('li.row'); if (!li) return; const idx = Number(li.dataset.idx);
    const shift = ev.shiftKey; const meta = ev.metaKey || ev.ctrlKey; toggleSelectIndex(idx, shift, meta);
  });
  listPane.addEventListener('scroll', () => { renderVirtualSlice(); });
  window.addEventListener('resize', () => { renderVirtualSlice(); });

  // Details actions
  $('#btnFilterByTrace').addEventListener('click', () => {
    const traces = new Set();
    if (state.selectedIdx.size > 0) { for (const idx of state.selectedIdx) { const t = state.entries[idx].traceId; if (t) traces.add(String(t)); } }
    const val = Array.from(traces).filter(Boolean).join('|');
    $('#filterTrace').value = val; state.filter.trace = val; applyFilters();
  });
  $('#btnFilterByLogger').addEventListener('click', () => {
    const idx = [...state.selectedIdx][0]; if (idx == null) return; const v = String(state.entries[idx].logger || '');
    $('#filterLogger').value = v; state.filter.logger = v; applyFilters();
  });
  $('#btnFilterByLevel').addEventListener('click', () => {
    const idx = [...state.selectedIdx][0]; if (idx == null) return; const v = String(state.entries[idx].level || '');
    $('#filterLevel').value = v; state.filter.level = v; applyFilters();
  });
  $('#btnCopyMessage').addEventListener('click', async () => {
    const idx = [...state.selectedIdx][0]; if (idx == null) return; const txt = String(state.entries[idx].message || '');
    try { await navigator.clipboard.writeText(txt); } catch (_) {}
  });

  // TCP controls
  $('#btnTcpStart').addEventListener('click', () => { const port = Number($('#tcpPort').value || 0); if (!port) return; window.api.tcpStart(port); });
  $('#btnTcpStop').addEventListener('click', () => window.api.tcpStop());
  window.api.onTcpStatus((s) => { $('#tcpStatus').textContent = s.message; });

  // HTTP controls
  $('#btnHttpLoad').addEventListener('click', async () => { const url = $('#httpUrl').value.trim(); if (!url) return; const res = await window.api.httpLoadOnce(url); if (res.ok) appendEntries(res.entries); else $('#httpStatus').textContent = 'Fehler: ' + res.error; });
  $('#btnHttpStartPoll').addEventListener('click', async () => { const url = $('#httpUrl').value.trim(); if (!url) return; const ms = Number($('#httpInterval').value || 5000); const res = await window.api.httpStartPoll({ url, intervalMs: ms }); if (res.ok) { state.httpPollId = res.id; $('#httpStatus').textContent = `Polling #${res.id}`; } else $('#httpStatus').textContent = 'Fehler: ' + res.error; });
  $('#btnHttpStopPoll').addEventListener('click', async () => { if (state.httpPollId == null) return; const res = await window.api.httpStopPoll(state.httpPollId); if (res.ok) { $('#httpStatus').textContent = 'Poll gestoppt'; state.httpPollId = null; } });

  // Append events from main (TCP/HTTP)
  window.api.onAppend((entries) => { appendEntries(entries); });

  // initial
  applyFilters();
})();
