import { useEffect, useRef, useState } from 'preact/hooks';
import { MDCListener } from './store/mdcListener.js';
import { DiagnosticContextFilter, dcEntryId } from './store/dcFilter.js';
import { LoggingStore } from './store/loggingStore.js';

export default function DCFilterPanel() {
  const [keys, setKeys] = useState([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [val, setVal] = useState('');
  const [rows, setRows] = useState(DiagnosticContextFilter.getDcEntries());
  const [sel, setSel] = useState([]); // selected ids
  const [enabled, setEnabled] = useState(DiagnosticContextFilter.isEnabled());

  // context menu
  const [ctx, setCtx] = useState({ open: false, x: 0, y: 0 });
  const ctxRef = useRef(null);
  useEffect(() => {
    function onDocClick(e) {
      if (!ctx.open) return;
      const el = ctxRef.current;
      if (el && el.contains(e.target)) return;
      setCtx({ open: false, x: 0, y: 0 });
    }
    window.addEventListener('mousedown', onDocClick, true);
    return () => window.removeEventListener('mousedown', onDocClick, true);
  }, [ctx.open]);

  // sync keys from MDCListener; clear on store reset
  useEffect(() => {
    const off1 = MDCListener.onChange(() => setKeys(MDCListener.getSortedKeys()));
    const off2 = LoggingStore.addLoggingStoreListener({
      loggingEventsAdded: () => setKeys(MDCListener.getSortedKeys()),
      loggingStoreReset: () => {
        setKeys([]);
        setSelectedKey('');
      },
    });
    setKeys(MDCListener.getSortedKeys());
    return () => {
      off1?.();
      off2?.();
    };
  }, []);

  // sync rows and enabled state from filter
  useEffect(() => {
    const off = DiagnosticContextFilter.onChange(() => {
      setRows(DiagnosticContextFilter.getDcEntries());
      setEnabled(DiagnosticContextFilter.isEnabled());
    });
    setRows(DiagnosticContextFilter.getDcEntries());
    setEnabled(DiagnosticContextFilter.isEnabled());
    return () => off?.();
  }, []);

  function onAdd() {
    const key = String(selectedKey || '').trim();
    if (!key) return;
    DiagnosticContextFilter.addMdcEntry(key, val);
    setVal('');
  }
  function onRemoveSelected() {
    const cur = DiagnosticContextFilter.getDcEntries();
    const byId = new Map(cur.map((e) => [dcEntryId(e), e]));
    for (const id of sel) {
      const e = byId.get(id);
      if (e) DiagnosticContextFilter.removeMdcEntry(e.key, e.val);
    }
    setSel([]);
  }
  function onClear() {
    DiagnosticContextFilter.reset();
    setSel([]);
  }

  // selection helpers
  function toggleRow(id, extend, keep) {
    setSel((prev) => {
      const arr = keep || extend ? [...prev] : [];
      const set = new Set(arr);
      if (extend && prev.length > 0) {
        // since rows are sorted, extend by range over current rows order
        const order = rows.map((e) => dcEntryId(e));
        const last = prev[prev.length - 1];
        const a = order.indexOf(last);
        const b = order.indexOf(id);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i++) set.add(order[i]);
          return Array.from(set);
        }
      }
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return Array.from(set);
    });
  }

  function openCtx(ev, id) {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sel.includes(id)) setSel([id]);
    setCtx({ open: true, x: ev.clientX, y: ev.clientY });
  }

  function activateSelected(active) {
    const cur = DiagnosticContextFilter.getDcEntries();
    const byId = new Map(cur.map((e) => [dcEntryId(e), e]));
    for (const id of sel) {
      const e = byId.get(id);
      if (!e) continue;
      if (active) DiagnosticContextFilter.activateMdcEntry(e.key, e.val);
      else DiagnosticContextFilter.deactivateMdcEntry(e.key, e.val);
    }
    setCtx({ open: false, x: 0, y: 0 });
  }

  // F2: show known values modal for selectedKey
  const [showValues, setShowValues] = useState(false);
  const [values, setValues] = useState([]);
  const valueInputRef = useRef(null);
  function onValueKeyDown(e) {
    if (e.key === 'F2') {
      e.preventDefault();
      const k = String(selectedKey || '').trim();
      if (!k) return;
      const vals = MDCListener.getSortedValues(k);
      setValues(vals);
      setShowValues(true);
    }
  }
  function chooseValue(v) {
    setVal(v);
    setShowValues(false);
    setTimeout(() => onAdd(), 0);
  }

  const addDisabled = !String(selectedKey || '').trim();

  return (
    <div class="dc-panel" style="border-top:1px solid #ddd; padding:8px 12px;">
      <div style="display:flex; gap:12px; align-items:end; flex-wrap:wrap; justify-content:space-between;">
        <div style="display:flex; gap:12px; align-items:end; flex-wrap:wrap;">
          <div style="display:flex; flex-direction:column;">
            <label style="font-size:12px; color:#555;">MDC Key</label>
            <input
              list="dc-keys"
              value={selectedKey}
              onInput={(e) => setSelectedKey(e.currentTarget.value)}
              placeholder="Key wählen oder tippen…"
            />
            <datalist id="dc-keys">
              {keys.map((k) => (
                <option value={k} />
              ))}
            </datalist>
          </div>
          <div style="display:flex; flex-direction:column; min-width:220px;">
            <label style="font-size:12px; color:#555;">MDC Value</label>
            <input
              ref={valueInputRef}
              value={val}
              onInput={(e) => setVal(e.currentTarget.value)}
              onKeyDown={onValueKeyDown}
              title="Mögliche Werte mit F2 (Kein Eintrag findet alle MDC-Einträge mit dem Schlüssel)"
              placeholder="Wert oder leer für alle…"
            />
          </div>
          <div style="display:flex; gap:6px; align-items:center; padding-bottom:2px;">
            <button onClick={onAdd} disabled={addDisabled}>
              Hinzufügen
            </button>
            <button onClick={onRemoveSelected} disabled={sel.length === 0}>
              Entfernen
            </button>
            <button onClick={onClear} disabled={rows.length === 0}>
              Leeren
            </button>
          </div>
        </div>
        <label style="display:inline-flex; gap:6px; align-items:center; white-space:nowrap;">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => DiagnosticContextFilter.setEnabled(e.currentTarget.checked)}
          />
          <span style="font-size:12px; color:#333;">MDC-Filter aktiv</span>
        </label>
      </div>

      <div style="margin-top:8px;">
        <div style="font-size:12px; color:#666; margin-bottom:4px;">Diagnostic Context Filter</div>
        <div class="dc-table" style="border:1px solid #ddd; max-height:200px; overflow:auto;">
          <div
            class="dc-header"
            style="display:grid; grid-template-columns: 1fr 1fr 70px; font-weight:600; background:#f8f8f8; border-bottom:1px solid #ddd; padding:4px 8px;"
          >
            <div>Key</div>
            <div>Value</div>
            <div>Active</div>
          </div>
          {rows.map((e) => {
            const id = dcEntryId(e);
            const isSel = sel.includes(id);
            return (
              <div
                key={id}
                class={`dc-row${isSel ? ' sel' : ''}`}
                style="display:grid; grid-template-columns: 1fr 1fr 70px; padding:4px 8px; border-bottom:1px solid #eee; cursor:default;"
                onClick={(ev) => toggleRow(id, ev.shiftKey, ev.ctrlKey || ev.metaKey)}
                onContextMenu={(ev) => openCtx(ev, id)}
              >
                <div>{e.key}</div>
                <div>{e.val}</div>
                <div>{e.active ? 'yes' : 'no'}</div>
              </div>
            );
          })}
          {rows.length === 0 && <div style="padding:8px; color:#777;">Keine Einträge</div>}
        </div>
      </div>

      {ctx.open && (
        <div
          ref={ctxRef}
          class="context-menu"
          style={{ position: 'fixed', left: ctx.x + 'px', top: ctx.y + 'px' }}
        >
          <div class="item" onClick={() => activateSelected(true)}>
            Aktiviere
          </div>
          <div class="item" onClick={() => activateSelected(false)}>
            Deaktiviere
          </div>
          <div
            class="item"
            onClick={() => {
              onRemoveSelected();
              setCtx({ open: false, x: 0, y: 0 });
            }}
          >
            Remove
          </div>
        </div>
      )}

      {showValues && (
        <div class="modal-backdrop" onClick={() => setShowValues(false)}>
          <div class="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Bekannte Werte</h3>
            <div style="max-height:260px; overflow:auto; border:1px solid #eee;">
              {values.length === 0 && (
                <div style="padding:8px; color:#777;">Keine bekannten Werte</div>
              )}
              {values.map((v) => (
                <div
                  class="item"
                  style="padding:6px 8px; border-bottom:1px solid #f0f0f0; cursor:pointer;"
                  onClick={() => chooseValue(v)}
                >
                  {v}
                </div>
              ))}
            </div>
            <div class="modal-actions">
              <button onClick={() => setShowValues(false)}>Abbrechen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
