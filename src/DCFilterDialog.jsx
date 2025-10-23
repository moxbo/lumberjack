import { useEffect, useRef, useState } from 'preact/hooks';
import { MDCListener } from './store/mdcListener.js';
import { DiagnosticContextFilter, dcEntryId } from './store/dcFilter.js';
import { LoggingStore } from './store/loggingStore.js';

// Dialog-Inhalt für den Diagnostic Context Filter
export default function DCFilterDialog() {
  const [keys, setKeys] = useState([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [val, setVal] = useState('');
  const [rows, setRows] = useState(DiagnosticContextFilter.getDcEntries());
  const [sel, setSel] = useState([]); // selected ids
  const [enabled, setEnabled] = useState(DiagnosticContextFilter.isEnabled());

  // Kontextmenü
  const [ctx, setCtx] = useState({ open: false, x: 0, y: 0 });
  const ctxRef = useRef(null);
  useEffect(() => {
    function onDocClick(e) {
      if (!ctx.open) return;
      const el = ctxRef.current;
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      if (el && (el === e.target || el.contains(e.target) || (path && path.includes(el)))) return;
      setCtx({ open: false, x: 0, y: 0 });
    }
    window.addEventListener('mousedown', onDocClick, { capture: true, passive: true });
    return () => window.removeEventListener('mousedown', onDocClick, { capture: true });
  }, [ctx.open]);

  // MDC-Keys laden & bei Store-Reset leeren
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

  // Filter-Zeilen & Enabled-State synchronisieren
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
    const raw = String(val ?? '');
    const parts = raw
      .split('|')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length === 0) {
      // Wildcard: nur Key muss vorhanden sein
      DiagnosticContextFilter.addMdcEntry(key, '');
    } else {
      for (const p of parts) DiagnosticContextFilter.addMdcEntry(key, p);
    }
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

  // Auswahl-Helper
  function toggleRow(id, extend, keep) {
    setSel((prev) => {
      const arr = keep || extend ? [...prev] : [];
      const set = new Set(arr);
      if (extend && prev.length > 0) {
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
  function toggleActive(e, checked) {
    if (checked) DiagnosticContextFilter.activateMdcEntry(e.key, e.val);
    else DiagnosticContextFilter.deactivateMdcEntry(e.key, e.val);
  }

  // F2: bekannte Werte anzeigen
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
  function openValuePicker() {
    const k = String(selectedKey || '').trim();
    const vals = k ? MDCListener.getSortedValues(k) : [];
    setValues(vals);
    setShowValues(true);
  }
  function chooseValue(v) {
    setVal(v);
    setShowValues(false);
    setTimeout(() => onAdd(), 0);
  }

  const addDisabled = !String(selectedKey || '').trim();

  return (
    <div class="dc-dialog" style="min-width:720px; max-width:100%;">
      {/* Kopfbereich: Eingaben + Aktiv-Schalter */}
      <div style="display:flex; gap:12px; align-items:end; flex-wrap:wrap; justify-content:space-between;">
        {/* Eingaben */}
        <div style="display:flex; gap:12px; align-items:end; flex-wrap:wrap;">
          <div class="form-field">
            <label>MDC Key</label>
            <input
              class="bright-input"
              list="dc-keys"
              value={selectedKey}
              onInput={(e) => setSelectedKey(e.currentTarget.value)}
              placeholder="Key wählen oder tippen…"
              autoFocus
            />
            <datalist id="dc-keys">
              {keys.map((k) => (
                <option value={k} />
              ))}
            </datalist>
          </div>
          <div class="form-field" style="min-width:260px;">
            <label>MDC Value</label>
            <div style="display:flex; gap:6px; align-items:center;">
              <input
                class="bright-input"
                ref={valueInputRef}
                value={val}
                onInput={(e) => setVal(e.currentTarget.value)}
                onKeyDown={onValueKeyDown}
                title="Mehrere Werte mit | trennen. F2 oder Button öffnet Vorschläge. Leer = alle Werte dieses Keys."
                placeholder="Wert(e) oder leer für alle…"
              />
              <button title="Vorschläge anzeigen (F2)" onClick={openValuePicker}>
                Werte…
              </button>
            </div>
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
        {/* Aktiv-Schalter */}
        <label style="display:inline-flex; gap:6px; align-items:center; white-space:nowrap;">
          <input
            type="checkbox"
            class="native-checkbox"
            checked={enabled}
            onChange={(e) => DiagnosticContextFilter.setEnabled(e.currentTarget.checked)}
          />
          <span style="font-size:12px; color:#333;">MDC-Filter aktiv</span>
        </label>
      </div>

      {/* Tabelle: Horizontal scrollfähig, Sticky Header */}
      <div class="table-wrap" style="margin-top:8px;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Value</th>
              <th class="col-active">Aktiv</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const id = dcEntryId(e);
              const isSel = sel.includes(id);
              const rowCls = `${isSel ? 'selected ' : ''}${!e.active ? 'inactive' : ''}`.trim();
              return (
                <tr
                  key={id}
                  class={rowCls}
                  onClick={(ev) => toggleRow(id, ev.shiftKey, ev.ctrlKey || ev.metaKey)}
                  onContextMenu={(ev) => openCtx(ev, id)}
                  style="cursor: default;"
                >
                  <td class="cell-key">{e.key}</td>
                  <td class="cell-val">
                    {e.val ? <code>{e.val}</code> : <span style="color:#888">(alle)</span>}
                  </td>
                  <td class="cell-act">
                    <div style="display:flex; align-items:center; gap:8px;">
                      <input
                        type="checkbox"
                        class="native-checkbox"
                        checked={!!e.active}
                        onChange={(ev) => toggleActive(e, ev.currentTarget.checked)}
                        aria-label={e.active ? 'aktiv' : 'aus'}
                        title={e.active ? 'aktiv' : 'aus'}
                      />
                      <span class={`badge ${e.active ? 'on' : 'off'}`}>
                        {e.active ? 'Aktiv' : 'Aus'}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} style="padding:8px; color:#777;">
                  Keine Einträge
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Kontextmenü */}
      {ctx.open && (
        <div
          ref={ctxRef}
          class="context-menu"
          style={{ position: 'fixed', left: ctx.x + 'px', top: ctx.y + 'px' }}
        >
          <div class="item" onClick={() => activateSelected(true)}>
            Aktivieren
          </div>
          <div class="item" onClick={() => activateSelected(false)}>
            Deaktivieren
          </div>
          <div
            class="item"
            onClick={() => {
              onRemoveSelected();
              setCtx({ open: false, x: 0, y: 0 });
            }}
          >
            Entfernen
          </div>
        </div>
      )}

      {/* Werte-Picker */}
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
