import { useEffect, useRef, useState } from "preact/hooks";
import { MDCListener } from "../store/mdcListener";
import { DiagnosticContextFilter, dcEntryId } from "../store/dcFilter";
import { LoggingStore } from "../store/loggingStore";

// Dialog-Inhalt für den Diagnostic Context Filter
export default function DCFilterDialog(): preact.JSX.Element {
  const [keys, setKeys] = useState<string[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [val, setVal] = useState<string>("");
  const [rows, setRows] = useState<
    { key: string; val: string; active: boolean }[]
  >(DiagnosticContextFilter.getDcEntries());
  const [sel, setSel] = useState<string[]>([]); // selected ids
  const [enabled, setEnabled] = useState<boolean>(
    DiagnosticContextFilter.isEnabled(),
  );

  // Stelle sicher, dass der MDCListener gestartet ist (idempotent)
  useEffect(() => {
    try {
      MDCListener.startListening();
    } catch {
      /* noop */
    }
  }, []);

  // Kontextmenü
  const [ctx, setCtx] = useState<{ open: boolean; x: number; y: number }>({
    open: false,
    x: 0,
    y: 0,
  });
  const ctxRef = useRef<HTMLDivElement | null>(null);
  // Ref auf den Key-Input (für Fokus nach Auswahl)
  const keyInputRef = useRef<HTMLInputElement | null>(null);
  const valueInputRef = useRef<HTMLInputElement | null>(null);
  // Fixed-Overlay Dropdown für Keys (verhindert Scrollen des gesamten Dialogs)
  const [keyDD, setKeyDD] = useState<{
    open: boolean;
    x: number;
    y: number;
    w: number;
  }>({ open: false, x: 0, y: 0, w: 0 });
  const keyDDRef = useRef<HTMLDivElement | null>(null);
  const keyBtnRef = useRef<HTMLButtonElement | null>(null);
  const keyWrapRef = useRef<HTMLDivElement | null>(null);
  const justOpenedRef = useRef<number>(0);
  useEffect(() => {
    function onDocClick(e: MouseEvent): void {
      if (!keyDD.open) return;
      // Ignore the very same event cycle right after opening to avoid race
      if (Date.now() - (justOpenedRef.current || 0) < 50) return;
      const el = keyDDRef.current;
      const btnEl = keyBtnRef.current;
      const inputEl = keyInputRef.current;
      const eventWithPath = e as unknown as { composedPath?: () => unknown[] };
      const path =
        typeof eventWithPath.composedPath === "function"
          ? eventWithPath.composedPath()
          : [];
      const tgt = e.target as Node | null;
      const isInside = (
        node: Node | null,
        container: HTMLElement | null,
      ): boolean =>
        !!container &&
        !!node &&
        (container === node || container.contains(node));
      const pathHas = (container: HTMLElement | null): boolean =>
        Array.isArray(path) && !!container && path.includes(container);
      if (
        (el && (isInside(tgt, el) || pathHas(el))) ||
        (btnEl && (isInside(tgt, btnEl) || pathHas(btnEl))) ||
        (inputEl && (isInside(tgt, inputEl) || pathHas(inputEl)))
      )
        return;
      setKeyDD({ open: false, x: 0, y: 0, w: 0 });
    }
    window.addEventListener("click", onDocClick as EventListener, {
      capture: true,
      passive: true,
    });
    return () =>
      window.removeEventListener("click", onDocClick as EventListener, {
        capture: true,
      });
  }, [keyDD.open]);

  useEffect(() => {
    function onDocClick(e: MouseEvent): void {
      if (!ctx.open) return;
      const el = ctxRef.current;
      const path =
        typeof (e as any).composedPath === "function"
          ? (e as any).composedPath()
          : [];
      const tgt = e.target as Node | null;
      if (
        el &&
        (el === tgt ||
          (tgt && el.contains(tgt)) ||
          (Array.isArray(path) && path.includes(el)))
      )
        return;
      setCtx({ open: false, x: 0, y: 0 });
    }
    window.addEventListener("click", onDocClick as EventListener, {
      capture: true,
      passive: true,
    });
    return () =>
      window.removeEventListener("click", onDocClick as EventListener, {
        capture: true,
      });
  }, [ctx.open]);

  // MDC-Keys laden & bei Store-Reset leeren
  useEffect(() => {
    const off1 = MDCListener.onChange(() =>
      setKeys(MDCListener.getSortedKeys()),
    );
    const off2 = LoggingStore.addLoggingStoreListener({
      loggingEventsAdded: () => setKeys(MDCListener.getSortedKeys()),
      loggingStoreReset: () => {
        setKeys([]);
        setSelectedKey("");
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

  function onAdd(): void {
    const key = String(selectedKey || "").trim();
    if (!key) return;
    const raw = String(val ?? "");
    const parts = raw
      .split("|")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length === 0) {
      // Wildcard: nur Key muss vorhanden sein
      DiagnosticContextFilter.addMdcEntry(key, "");
    } else {
      for (const p of parts) DiagnosticContextFilter.addMdcEntry(key, p);
    }
    setVal("");
  }
  function onRemoveSelected(): void {
    const cur = DiagnosticContextFilter.getDcEntries();
    const byId = new Map(cur.map((e) => [dcEntryId(e), e] as const));
    for (const id of sel) {
      const e = byId.get(id);
      if (e) DiagnosticContextFilter.removeMdcEntry(e.key, e.val);
    }
    setSel([]);
  }
  function onClear(): void {
    DiagnosticContextFilter.reset();
    setSel([]);
  }

  // Auswahl-Helper
  function toggleRow(id: string, extend: boolean, keep: boolean): void {
    setSel((prev) => {
      const arr = keep || extend ? [...prev] : [];
      const set = new Set(arr);
      if (extend && prev.length > 0) {
        const order = rows.map((e) => dcEntryId(e));
        const last = prev[prev.length - 1];
        const a = order.indexOf(last || "");
        const b = order.indexOf(id);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i++) set.add(order[i]!);
          return Array.from(set);
        }
      }
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return Array.from(set);
    });
  }
  function openCtx(ev: MouseEvent, id: string): void {
    ev.preventDefault();
    ev.stopPropagation();
    if (!sel.includes(id)) setSel([id]);
    setCtx({
      open: true,
      x: ev.clientX,
      y: ev.clientY,
    });
  }
  function activateSelected(active: boolean): void {
    const cur = DiagnosticContextFilter.getDcEntries();
    const byId = new Map(cur.map((e) => [dcEntryId(e), e] as const));
    for (const id of sel) {
      const e = byId.get(id);
      if (!e) continue;
      if (active) DiagnosticContextFilter.activateMdcEntry(e.key, e.val);
      else DiagnosticContextFilter.deactivateMdcEntry(e.key, e.val);
    }
    setCtx({ open: false, x: 0, y: 0 });
  }
  function toggleActive(
    e: { key: string; val: string },
    checked: boolean,
  ): void {
    if (checked) DiagnosticContextFilter.activateMdcEntry(e.key, e.val);
    else DiagnosticContextFilter.deactivateMdcEntry(e.key, e.val);
  }

  // F2: bekannte Werte anzeigen
  const [showValues, setShowValues] = useState<boolean>(false);
  const [values, setValues] = useState<string[]>([]);

  // Key-Dropdown öffnen (am Pfeil-Button verankert)
  function openKeyDropdownAt(target?: HTMLElement | null) {
    try {
      const wrap = keyWrapRef.current;
      const btn = target || keyBtnRef.current;
      if (!btn) return;
      const w = Math.max(
        220,
        Math.round((wrap || btn).getBoundingClientRect().width),
      );
      // mark as just opened to ignore the initiating click in the global closer
      justOpenedRef.current = Date.now();
      setKeyDD({ open: true, x: 0, y: 0, w });
    } catch {
      // noop
    }
  }

  // ESC schließt Dropdown
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && keyDD.open)
        setKeyDD({ open: false, x: 0, y: 0, w: 0 });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keyDD.open]);

  function onValueKeyDown(e: KeyboardEvent): void {
    if (e.key === "F2") {
      e.preventDefault();
      const k = String(selectedKey || "").trim();
      if (!k) return;
      const vals = MDCListener.getSortedValues(k);
      setValues(vals);
      setShowValues(true);
    }
  }
  function openValuePicker(): void {
    const k = String(selectedKey || "").trim();
    const vals = k ? MDCListener.getSortedValues(k) : [];
    setValues(vals);
    setShowValues(true);
  }
  function chooseValue(v: string): void {
    // Direkt zum Filter hinzufügen, statt über den Input-State zu gehen (vermeidet Race zu "(alle)")
    const key = String(selectedKey || "").trim();
    if (!key) {
      // Falls noch kein Key gesetzt ist, übernehme Wert nur in das Feld
      setVal(v);
      setShowValues(false);
      return;
    }
    DiagnosticContextFilter.addMdcEntry(key, v);
    setVal("");
    setShowValues(false);
  }
  function chooseKey(k: string): void {
    setSelectedKey(String(k || ""));
    setKeyDD({ open: false, x: 0, y: 0, w: 0 });
    try {
      valueInputRef.current?.focus();
    } catch {
      // No-op: focus may fail if ref not ready
    }
  }

  const addDisabled = !String(selectedKey || "").trim();

  return (
    <div class="dc-dialog" style="min-width:720px; max-width:100%;">
      {/* Kopfbereich: Eingaben + Aktiv-Schalter */}
      <div style="display:flex; gap:12px; align-items:end; flex-wrap:wrap; justify-content:space-between;">
        {/* Eingaben */}
        <div style="display:flex; gap:12px; align-items:end; flex-wrap:wrap;">
          <div class="form-field">
            <label>MDC Key</label>
            <div
              ref={keyWrapRef as any}
              style="position:relative; display:flex; gap:6px; align-items:center;"
            >
              <input
                class="bright-input"
                type="text"
                autocomplete="off"
                value={selectedKey}
                ref={keyInputRef as any}
                onInput={(e) => setSelectedKey(e.currentTarget.value)}
                onClick={(e) => e.stopPropagation()}
                placeholder="Key wählen oder tippen…"
                autoFocus
              />
              <button
                ref={keyBtnRef as any}
                title="MDC-Keys anzeigen"
                onClick={(e) => {
                  // Toggle auf Click und Event nicht nach oben lassen, damit der globale Click-Closer nicht sofort schließt
                  e.stopPropagation();
                  if (keyDD.open) setKeyDD({ open: false, x: 0, y: 0, w: 0 });
                  else openKeyDropdownAt(e.currentTarget);
                }}
              >
                ▼
              </button>
              {/* Dropdown unter dem Wrapper anheften */}
              {keyDD.open && (
                <div
                  ref={keyDDRef as any}
                  className="history-dropdown"
                  onClick={(e) => e.stopPropagation()}
                  onWheel={(e) => {
                    // verhindert Scrollen des übergeordneten Dialogs
                    e.stopPropagation();
                  }}
                  style={{
                    position: "absolute",
                    left: 0,
                    top: "calc(100% + 4px)",
                    minWidth: Math.max(220, keyDD.w || 0) + "px",
                    maxHeight: "220px",
                    overflow: "auto",
                    border:
                      "1px solid var(--glass-border, var(--color-border))",
                    borderRadius: "4px",
                    background: "var(--color-bg-paper)",
                    color: "var(--color-text-primary)",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
                    padding: "4px",
                    zIndex: "var(--z-dropdown)",
                  }}
                >
                  {(!keys || keys.length === 0) && (
                    <div
                      style={{
                        padding: "6px 8px",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      Keine bekannten Keys
                    </div>
                  )}
                  {keys.map((k, i) => (
                    <div
                      key={i}
                      role="button"
                      tabIndex={0}
                      onClick={() => chooseKey(String(k))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ")
                          chooseKey(String(k));
                      }}
                      style={{
                        padding: "6px 8px",
                        cursor: "pointer",
                        borderRadius: "4px",
                      }}
                      onMouseOver={(e) =>
                        (e.currentTarget.style.backgroundColor =
                          "var(--color-bg-hover)")
                      }
                      onMouseOut={(e) =>
                        (e.currentTarget.style.backgroundColor = "transparent")
                      }
                      title={String(k)}
                    >
                      {String(k)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div class="form-field" style="min-width:260px;">
            <label>MDC Value</label>
            <div style="display:flex; gap:6px; align-items:center;">
              <input
                class="bright-input"
                ref={valueInputRef as any}
                value={val}
                onInput={(e) => setVal(e.currentTarget.value)}
                onKeyDown={(e) => onValueKeyDown(e as unknown as KeyboardEvent)}
                title="Mehrere Werte mit | trennen. F2 oder Button öffnet Vorschläge. Leer = alle Werte dieses Keys."
                placeholder="Wert(e) oder leer für alle…"
              />
              <button
                title="Vorschläge anzeigen (F2)"
                onClick={openValuePicker}
              >
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
            onChange={(e) =>
              DiagnosticContextFilter.setEnabled(e.currentTarget.checked)
            }
          />
          <span style="font-size:12px; color:#333;">MDC-Filter aktiv</span>
        </label>
      </div>

      {/* Tabelle: Horizontal scrollfähig, Sticky Header */}
      {/* Quick-Add Sektion für häufig verwendete Keys */}
      {keys.length > 0 && rows.length === 0 && (
        <div class="quick-add-section" style="margin-top:12px;">
          <div class="section-label">
            Schnellauswahl - Klicke auf einen Key um ihn hinzuzufügen:
          </div>
          {keys.slice(0, 8).map((k) => (
            <button
              key={k}
              class="quick-add-btn"
              onClick={() => {
                setSelectedKey(k);
                DiagnosticContextFilter.addMdcEntry(k, "");
              }}
              title={`${k} hinzufügen (alle Werte)`}
            >
              + {k}
            </button>
          ))}
        </div>
      )}

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
              const rowCls =
                `${isSel ? "selected " : ""}${!e.active ? "inactive" : ""}`.trim();
              return (
                <tr
                  key={id}
                  class={rowCls}
                  onClick={(ev) =>
                    toggleRow(
                      id,
                      (ev as MouseEvent).shiftKey,
                      (ev as MouseEvent).ctrlKey || (ev as MouseEvent).metaKey,
                    )
                  }
                  onContextMenu={(ev) => openCtx(ev as MouseEvent, id)}
                  style="cursor: default;"
                >
                  <td class="cell-key">{e.key}</td>
                  <td class="cell-val">
                    {e.val ? (
                      <code>{e.val}</code>
                    ) : (
                      <span style="color:#888">(alle)</span>
                    )}
                  </td>
                  <td class="cell-act">
                    <div style="display:flex; align-items:center; gap:8px;">
                      <input
                        type="checkbox"
                        class="native-checkbox"
                        checked={e.active}
                        onChange={(ev) =>
                          toggleActive(e, ev.currentTarget.checked)
                        }
                        onClick={(ev) => ev.stopPropagation()}
                        onMouseDown={(ev) => ev.stopPropagation()}
                        onContextMenu={(ev) => ev.stopPropagation()}
                        aria-label={e.active ? "aktiv" : "aus"}
                        title={e.active ? "aktiv" : "aus"}
                      />
                      <span class={`badge ${e.active ? "on" : "off"}`}>
                        {e.active ? "Aktiv" : "Aus"}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && keys.length === 0 && (
              <tr>
                <td colSpan={3}>
                  <div class="empty-state" style="padding:40px 20px;">
                    <div class="empty-state-icon">📋</div>
                    <div class="empty-state-title">
                      Keine MDC-Keys verfügbar
                    </div>
                    <div class="empty-state-description">
                      Lade zunächst Log-Einträge mit MDC-Daten (Mapped
                      Diagnostic Context), um hier Filter hinzufügen zu können.
                    </div>
                  </div>
                </td>
              </tr>
            )}
            {rows.length === 0 && keys.length > 0 && (
              <tr>
                <td colSpan={3}>
                  <div class="empty-state" style="padding:30px 20px;">
                    <div class="empty-state-icon">🔍</div>
                    <div class="empty-state-title">
                      Noch keine Filter definiert
                    </div>
                    <div class="empty-state-description">
                      Wähle oben einen MDC-Key aus oder nutze die
                      Schnellauswahl, um Filter hinzuzufügen.
                    </div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Keyboard Hints */}
      <div class="keyboard-hints" style="margin-top:12px;">
        <span class="hint">
          <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+Klick: Mehrfachauswahl
        </span>
        <span class="hint">
          <kbd>Shift</kbd>+Klick: Bereichsauswahl
        </span>
        <span class="hint">Rechtsklick: Kontextmenü</span>
      </div>

      {/* Kontextmenü */}
      {ctx.open && (
        <div
          ref={ctxRef as any}
          class="context-menu"
          style={{ position: "fixed", left: ctx.x + "px", top: ctx.y + "px" }}
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
            <h3>Bekannte Werte für "{selectedKey}"</h3>
            <div style="max-height:260px; overflow:auto; border:1px solid var(--color-divider); border-radius:8px;">
              {values.length === 0 && (
                <div class="empty-state" style="padding:30px 20px;">
                  <div class="empty-state-icon">📭</div>
                  <div class="empty-state-title">Keine bekannten Werte</div>
                  <div class="empty-state-description">
                    Für diesen Key wurden noch keine Werte in den geladenen Logs
                    gefunden.
                  </div>
                </div>
              )}
              {values.map((v) => (
                <div
                  class="autocomplete-item"
                  onClick={() => chooseValue(v)}
                  title={`Wert "${v}" hinzufügen`}
                >
                  <span style="opacity:0.5;">→</span>
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
