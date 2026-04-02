import { useEffect, useRef, useState } from "preact/hooks";
import { MDCListener } from "../store/mdcListener";
import { DiagnosticContextFilter, dcEntryId } from "../store/dcFilter";
import { LoggingStore } from "../store/loggingStore";
import { useI18n } from "../utils/i18n";

export default function DCFilterPanel(): preact.JSX.Element {
  const { t } = useI18n();
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

  // context menu
  const [ctx, setCtx] = useState<{ open: boolean; x: number; y: number }>({
    open: false,
    x: 0,
    y: 0,
  });
  const ctxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ctx.open) return;
      const el = ctxRef.current;
      const eventWithPath = e as unknown as { composedPath?: () => unknown[] };
      const path =
        typeof eventWithPath.composedPath === "function"
          ? eventWithPath.composedPath()
          : [];
      const tgt = (e.target as Node) || null;
      if (
        el &&
        (el === tgt ||
          (tgt && el.contains(tgt)) ||
          (Array.isArray(path) && path.includes(el)))
      )
        return;
      setCtx({ open: false, x: 0, y: 0 });
    }
    window.addEventListener("mousedown", onDocClick as EventListener, {
      capture: true,
      passive: true,
    });
    return () =>
      window.removeEventListener("mousedown", onDocClick as EventListener, {
        capture: true,
      });
  }, [ctx.open]);

  // sync keys from MDCListener; clear on store reset
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

  // Key-Picker Modal
  const [showKeyPicker, setShowKeyPicker] = useState<boolean>(false);
  function openKeyPicker(): void {
    setShowKeyPicker(true);
  }
  const valueInputRef = useRef<HTMLInputElement | null>(null);
  function chooseKey(k: unknown): void {
    const keyStr = typeof k === "string" ? k : String(k || "");
    setSelectedKey(keyStr);
    setShowKeyPicker(false);
    // Fokus auf Value-Feld für schnellen Flow
    try {
      valueInputRef.current?.focus();
    } catch {
      // No-op: focus may fail if ref not ready
    }
  }

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

  // selection helpers
  function toggleRow(id: string, extend: boolean, keep: boolean): void {
    setSel((prev) => {
      const arr: string[] = keep || extend ? [...prev] : [];
      const set = new Set<string>(arr);
      if (extend && prev.length > 0) {
        // since rows are sorted, extend by range over current rows order
        const order: string[] = rows.map((e) => dcEntryId(e));
        const last = prev[prev.length - 1]!; // prev.length>0 garantiert
        const a = order.indexOf(last);
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
    setCtx({ open: true, x: ev.clientX, y: ev.clientY });
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

  // F2: show known values modal for selectedKey
  const [showValues, setShowValues] = useState<boolean>(false);
  const [values, setValues] = useState<string[]>([]);
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
    const key = String(selectedKey || "").trim();
    if (!key) {
      setVal(v);
      setShowValues(false);
      return;
    }
    // Direkt zum Filter, verhindert, dass val=='' als (alle) gerendert wird
    DiagnosticContextFilter.addMdcEntry(key, v);
    setVal("");
    setShowValues(false);
  }

  const addDisabled = !String(selectedKey || "").trim();

  return (
    <div class="dc-panel" style="border-top:1px solid #ddd; padding:8px 12px;">
      <div style="display:flex; gap:12px; align-items:end; flex-wrap:wrap; justify-content:space-between;">
        <div style="display:flex; gap:12px; align-items:end; flex-wrap:wrap;">
          <div class="form-field">
            <label>{t("dcFilterDialog.mdcKey")}</label>
            <div style="display:flex; gap:6px; align-items:center;">
              <input
                class="bright-input"
                list="dc-keys-panel"
                value={selectedKey}
                onInput={(e) => setSelectedKey(e.currentTarget.value)}
                placeholder={t("dcFilterDialog.keyPlaceholder")}
              />
              <button
                title={t("dcFilterDialog.showKeysTooltip")}
                onClick={openKeyPicker}
              >
                {t("dcFilterDialog.keysButton")}
              </button>
            </div>
            <datalist id="dc-keys-panel">
              {keys.map((k) => (
                <option key={String(k)} value={k}>
                  {String(k)}
                </option>
              ))}
            </datalist>
          </div>
          <div class="form-field" style="min-width:260px;">
            <label>{t("dcFilterDialog.mdcValue")}</label>
            <div style="display:flex; gap:6px; align-items:center;">
              <input
                class="bright-input"
                ref={valueInputRef as any}
                value={val}
                onInput={(e) => setVal(e.currentTarget.value)}
                onKeyDown={(e) => onValueKeyDown(e as unknown as KeyboardEvent)}
                title={t("dcFilterDialog.valueTooltip")}
                placeholder={t("dcFilterDialog.valuePlaceholder")}
              />
              <button
                title={t("dcFilterDialog.showValuesTooltip")}
                onClick={openValuePicker}
              >
                {t("dcFilterDialog.valuesButton")}
              </button>
            </div>
          </div>
          <div style="display:flex; gap:6px; align-items:center; padding-bottom:2px;">
            <button onClick={onAdd} disabled={addDisabled}>
              {t("dcFilterDialog.add")}
            </button>
            <button onClick={onRemoveSelected} disabled={sel.length === 0}>
              {t("dcFilterDialog.remove")}
            </button>
            <button onClick={onClear} disabled={rows.length === 0}>
              {t("dcFilterDialog.clear")}
            </button>
          </div>
        </div>
        <label style="display:inline-flex; gap:6px; align-items:center; white-space:nowrap;">
          <input
            type="checkbox"
            class="native-checkbox"
            checked={enabled}
            onChange={(e) =>
              DiagnosticContextFilter.setEnabled(e.currentTarget.checked)
            }
          />
          <span style="font-size:12px; color:#333;">
            {t("dcFilterDialog.filterActive")}
          </span>
        </label>
      </div>

      <div style="margin-top:8px;">
        <div style="font-size:12px; color:#666; margin-bottom:4px;">
          {t("dcFilterDialog.tableTitle")}
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>{t("dcFilterDialog.thKey")}</th>
                <th>{t("dcFilterDialog.thValue")}</th>
                <th class="col-active">{t("dcFilterDialog.thActive")}</th>
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
                        (ev as MouseEvent & { shiftKey: boolean }).shiftKey,
                        (
                          ev as MouseEvent & {
                            ctrlKey: boolean;
                            metaKey: boolean;
                          }
                        ).ctrlKey ||
                          (ev as MouseEvent & { metaKey: boolean }).metaKey,
                      )
                    }
                    onContextMenu={(ev) =>
                      openCtx(ev as unknown as MouseEvent, id)
                    }
                    style="cursor: default;"
                  >
                    <td>{e.key}</td>
                    <td>
                      {e.val || (
                        <span style="color:#888">
                          {t("dcFilterDialog.allValues")}
                        </span>
                      )}
                    </td>
                    <td>
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
                          aria-label={
                            e.active
                              ? t("dcFilterDialog.active")
                              : t("dcFilterDialog.inactive")
                          }
                          title={
                            e.active
                              ? t("dcFilterDialog.active")
                              : t("dcFilterDialog.inactive")
                          }
                        />
                        <span class={`badge ${e.active ? "on" : "off"}`}>
                          {e.active
                            ? t("dcFilterDialog.active")
                            : t("dcFilterDialog.inactive")}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3} style="padding:8px; color:#777;">
                    {t("dcFilterDialog.noEntries")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {ctx.open && (
        <div
          ref={ctxRef as any}
          class="context-menu"
          style={{ position: "fixed", left: ctx.x + "px", top: ctx.y + "px" }}
        >
          <div class="item" onClick={() => activateSelected(true)}>
            {t("dcFilterDialog.activate")}
          </div>
          <div class="item" onClick={() => activateSelected(false)}>
            {t("dcFilterDialog.deactivate")}
          </div>
          <div
            class="item"
            onClick={() => {
              onRemoveSelected();
              setCtx({ open: false, x: 0, y: 0 });
            }}
          >
            {t("dcFilterDialog.remove")}
          </div>
        </div>
      )}

      {showValues && (
        <div class="modal-backdrop" onClick={() => setShowValues(false)}>
          <div class="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t("dcFilterDialog.knownValues")}</h3>
            <div style="max-height:260px; overflow:auto; border:1px solid #eee;">
              {values.length === 0 && (
                <div style="padding:8px; color:#777;">
                  {t("dcFilterDialog.noKnownValues")}
                </div>
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
              <button onClick={() => setShowValues(false)}>
                {t("dcFilterDialog.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showKeyPicker && (
        <div class="modal-backdrop" onClick={() => setShowKeyPicker(false)}>
          <div class="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t("dcFilterDialog.knownMdcKeys")}</h3>
            <div style="max-height:260px; overflow:auto; border:1px solid #eee;">
              {(!keys || keys.length === 0) && (
                <div style="padding:8px; color:#777;">
                  {t("dcFilterDialog.noKnownKeys")}
                </div>
              )}
              {keys &&
                keys.map((k) => (
                  <div
                    class="item"
                    style="padding:6px 8px; border-bottom:1px solid #f0f0f0; cursor:pointer;"
                    onClick={() => chooseKey(k)}
                  >
                    {String(k)}
                  </div>
                ))}
            </div>
            <div class="modal-actions">
              <button onClick={() => setShowKeyPicker(false)}>
                {t("dcFilterDialog.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
