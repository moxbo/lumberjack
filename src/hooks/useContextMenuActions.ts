/**
 * useContextMenuActions Hook
 *
 * Manages the log-list context menu: menu state, color palette / custom
 * colors, mark application, "adopt trace IDs", and clipboard copy.
 *
 * Performance note: marks are stored exclusively in `marksMap`
 * (signature -> color) which is owned by the caller. This hook never writes
 * a `_mark` field into entry objects and never rebuilds the `entries` array,
 * so marking a selection does not trigger a full scan / re-filter.
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "preact/hooks";
import type { ContextMenuState, RendererLogEntry } from "../types/renderer";
import type { RefObject } from "preact";
import { BASE_MARK_COLORS } from "../constants";
import { entrySignature } from "../utils/entryUtils";
import { patchSettingsQuiet } from "../utils/typedApi";
import { fmtTimestamp } from "../utils/format";
import { DiagnosticContextFilter } from "../store/dcFilter";
import logger from "../utils/logger";

export interface UseContextMenuActionsOptions {
  entries: RendererLogEntry[];
  selected: Set<number>;
  setSelected: (fn: (prev: Set<number>) => Set<number>) => void;
  marksMap: Record<string, string>;
  setMarksMap: (map: Record<string, string>) => void;
  parentRef: RefObject<HTMLDivElement | null>;
  showAlert: (msg: string) => void;
  t: (key: string) => string;
}

export interface UseContextMenuActionsReturn {
  // Context menu state
  ctxMenu: ContextMenuState;
  ctxRef: RefObject<HTMLDivElement>;
  openContextMenu: (ev: MouseEvent, idx: number) => void;
  closeContextMenu: () => void;

  // Color palette
  customColors: string[];
  setCustomColors: (fn: string[] | ((prev: string[]) => string[])) => void;
  pickerColor: string;
  setPickerColor: (color: string) => void;
  palette: string[];
  addCustomColor: (color: string) => void;

  // Marking actions
  applyMarkColor: (color?: string) => void;

  // Clipboard actions
  copyTsMsg: () => Promise<void>;

  // MDC actions
  adoptTraceIds: () => void;
}

export function useContextMenuActions(
  options: UseContextMenuActionsOptions,
): UseContextMenuActionsReturn {
  const {
    entries,
    selected,
    setSelected,
    marksMap,
    setMarksMap,
    parentRef,
    showAlert,
    t,
  } = options;

  const [ctxMenu, setCtxMenu] = useState<ContextMenuState>({
    open: false,
    x: 0,
    y: 0,
  });
  const ctxRef = useRef<HTMLDivElement | null>(null);
  const [customColors, setCustomColors] = useState<string[]>([]);
  const [pickerColor, setPickerColor] = useState<string>("#ffcc00");

  const palette = useMemo(
    () => [...BASE_MARK_COLORS, ...customColors],
    [customColors],
  );

  const addCustomColor = useCallback((c: string): void => {
    const color = String(c || "").trim();
    if (!color) return;
    setCustomColors((prev) => {
      const list = prev.includes(color) ? prev : [...prev, color];
      try {
        patchSettingsQuiet({ customMarkColors: list });
      } catch (e) {
        logger.error("Failed to save customMarkColors settings:", e);
      }
      return list;
    });
  }, []);

  const closeContextMenu = useCallback((): void => {
    setCtxMenu({ open: false, x: 0, y: 0 });
  }, []);

  useEffect(() => {
    if (!ctxMenu.open) return;
    const onMouseDown = (e: MouseEvent): void => {
      try {
        if (!ctxRef.current) return closeContextMenu();
        if (!ctxRef.current.contains(e.target as Node)) closeContextMenu();
      } catch {
        closeContextMenu();
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") closeContextMenu();
    };
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu.open, closeContextMenu]);

  const openContextMenu = useCallback(
    (ev: MouseEvent, idx: number): void => {
      try {
        ev.preventDefault();
        setSelected((prev) => {
          if (prev && prev.has(idx)) return prev;
          return new Set([idx]);
        });
        setCtxMenu({ open: true, x: ev.clientX, y: ev.clientY });
        // Keep the list focused even after opening the context menu
        try {
          setTimeout(() => {
            if (
              parentRef.current &&
              !parentRef.current.contains(document.activeElement || null)
            ) {
              parentRef.current?.focus({ preventScroll: true });
            }
          }, 0);
        } catch (err) {
          logger.warn("Failed to restore focus after context menu:", err);
        }
      } catch (err) {
        logger.error("openContextMenu error:", err);
      }
    },
    [setSelected, parentRef],
  );

  const applyMarkColor = useCallback(
    (color?: string): void => {
      if (!entries.length) {
        closeContextMenu();
        return;
      }
      const newMap: Record<string, string> = { ...marksMap };
      for (const i of selected) {
        if (i >= 0 && i < entries.length) {
          const e = entries[i];
          if (!e) continue;
          const sig = entrySignature(e);
          if (color) {
            newMap[sig] = color;
          } else {
            delete newMap[sig];
          }
        }
      }
      setMarksMap(newMap);
      try {
        patchSettingsQuiet({ marksMap: newMap });
      } catch {
        /* ignore */
      }
      closeContextMenu();
    },
    [entries, selected, marksMap, setMarksMap, closeContextMenu],
  );

  const adoptTraceIds = useCallback((): void => {
    try {
      const variants = [
        "TraceID",
        "traceId",
        "trace_id",
        "trace.id",
        "trace-id",
        "x-trace-id",
        "x_trace_id",
        "x.trace.id",
        "trace",
      ];
      const added = new Set<string>();
      for (const i of selected) {
        const e = entries[i];
        const m = e && e.mdc;
        if (!m || typeof m !== "object") continue;
        for (const k of variants) {
          if (Object.prototype.hasOwnProperty.call(m, k)) {
            const v = String((m as Record<string, unknown>)[k] ?? "");
            if (v && !added.has(v)) {
              DiagnosticContextFilter.addMdcEntry("TraceID", v);
              added.add(v);
            }
          }
        }
      }
      if (added.size) DiagnosticContextFilter.setEnabled(true);
    } catch (e) {
      logger.warn("adoptTraceIds failed:", e);
    }
    closeContextMenu();
  }, [selected, entries, closeContextMenu]);

  const copyTsMsg = useCallback(async (): Promise<void> => {
    const list = Array.from(selected).sort((a, b) => a - b);
    const lines = list.map((i) => {
      const e: RendererLogEntry | undefined = entries[i];
      if (!e) return "";
      return `${fmtTimestamp(e.timestamp)}\n${String(e.message ?? "")}`;
    });
    const text = lines.join("\n");
    try {
      if ((navigator as any)?.clipboard?.writeText)
        await (navigator as any).clipboard.writeText(text);
      else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
    } catch (e) {
      logger.error("Failed to copy to clipboard:", e);
      showAlert(t("errors.copyFailed"));
    }
    closeContextMenu();
  }, [selected, entries, showAlert, t, closeContextMenu]);

  return {
    ctxMenu,
    ctxRef,
    openContextMenu,
    closeContextMenu,
    customColors,
    setCustomColors,
    pickerColor,
    setPickerColor,
    palette,
    addCustomColor,
    applyMarkColor,
    copyTsMsg,
    adoptTraceIds,
  };
}
