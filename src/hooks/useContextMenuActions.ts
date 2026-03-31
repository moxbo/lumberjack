/**
 * useContextMenuActions Hook
 * Manages context menu state, markings, and clipboard operations
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "preact/hooks";
import type { ContextMenuState, RendererLogEntry } from "../types/renderer";
import { BASE_MARK_COLORS } from "../constants";
import { entrySignature } from "../utils/entryUtils";
import { patchSettingsQuiet } from "../utils/typedApi";
import { fmtTimestamp } from "../utils/format";
import { DiagnosticContextFilter } from "../store/dcFilter";
import logger from "../utils/logger";

export interface UseContextMenuActionsOptions {
  entries: RendererLogEntry[];
  setEntries: (fn: (prev: RendererLogEntry[]) => RendererLogEntry[]) => void;
  selected: Set<number>;
  setSelected: (fn: Set<number> | ((prev: Set<number>) => Set<number>)) => void;
  marksMap: Record<string, string>;
  setMarksMap: (map: Record<string, string>) => void;
  parentRef: React.RefObject<HTMLDivElement | null>;
  showAlert: (msg: string) => void;
  t: (key: string) => string;
}

export interface UseContextMenuActionsReturn {
  // Context menu state
  ctxMenu: ContextMenuState;
  ctxRef: React.RefObject<HTMLDivElement | null>;
  openContextMenu: (ev: MouseEvent, idx: number) => void;
  closeContextMenu: () => void;

  // Color palette
  customColors: string[];
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

/**
 * Hook for context menu, markings, and clipboard operations
 */
export function useContextMenuActions(
  options: UseContextMenuActionsOptions,
): UseContextMenuActionsReturn {
  const {
    entries,
    setEntries,
    selected,
    setSelected,
    marksMap,
    setMarksMap,
    parentRef,
    showAlert,
    t,
  } = options;

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState>({
    open: false,
    x: 0,
    y: 0,
  });
  const ctxRef = useRef<HTMLDivElement | null>(null);

  // Custom colors
  const [customColors, setCustomColors] = useState<string[]>([]);
  const [pickerColor, setPickerColor] = useState<string>("#ffcc00");

  const palette = useMemo(
    () => [...BASE_MARK_COLORS, ...customColors],
    [customColors],
  );

  // Close context menu
  const closeContextMenu = useCallback((): void => {
    setCtxMenu({ open: false, x: 0, y: 0 });
  }, []);

  // Add custom color
  const addCustomColor = useCallback((c: string): void => {
    const color = String(c || "").trim();
    if (!color) return;
    setCustomColors((prev) => {
      const list = prev.includes(color) ? prev : [...prev, color];
      patchSettingsQuiet({ customMarkColors: list });
      return list;
    });
  }, []);

  // Close context menu on outside click or Escape
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

  // Open context menu
  const openContextMenu = useCallback(
    (ev: MouseEvent, idx: number): void => {
      try {
        ev.preventDefault();
        setSelected((prev) => {
          if (prev && prev.has(idx)) return prev;
          return new Set([idx]);
        });
        setCtxMenu({ open: true, x: ev.clientX, y: ev.clientY });
        // Restore focus to list
        try {
          setTimeout(() => {
            if (
              parentRef.current &&
              !parentRef.current.contains(document.activeElement || null)
            ) {
              (parentRef.current as any)?.focus?.({ preventScroll: true });
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

  // Apply mark color to selected entries
  const applyMarkColor = useCallback(
    (color?: string): void => {
      setEntries((prev) => {
        if (!prev || !prev.length) return prev;
        const next = prev.slice();
        const newMap: Record<string, string> = { ...marksMap };
        for (const i of selected) {
          if (i >= 0 && i < next.length) {
            const e = next[i];
            if (!e) continue;
            const n: RendererLogEntry = { ...e };
            if (color) {
              n._mark = color;
              newMap[entrySignature(n)] = color;
            } else {
              if (n._mark) delete newMap[entrySignature(n)];
              delete n._mark;
            }
            next[i] = n;
          }
        }
        setMarksMap(newMap);
        patchSettingsQuiet({ marksMap: newMap });
        return next;
      });
      closeContextMenu();
    },
    [setEntries, selected, marksMap, setMarksMap, closeContextMenu],
  );

  // Sync marks when marksMap changes
  useEffect(() => {
    if (!entries.length) return;
    setEntries((prev) =>
      prev.map((e) => {
        const sig = entrySignature(e);
        const c = marksMap[sig];
        if (c && e._mark !== c) return { ...e, _mark: c };
        if (!c && e._mark) {
          const n = { ...e };
          delete n._mark;
          return n;
        }
        return e;
      }),
    );
  }, [marksMap]);

  // Copy timestamp + message to clipboard
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

  // Adopt trace IDs from selected entries to DC filter
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
              added.add(v);
              (DiagnosticContextFilter as any).addMdcEntry("TraceID", v);
            }
          }
        }
      }
      if (added.size) (DiagnosticContextFilter as any).setEnabled(true);
    } catch (e) {
      logger.warn("adoptTraceIds failed:", e as any);
    }
  }, [selected, entries]);

  return {
    ctxMenu,
    ctxRef,
    openContextMenu,
    closeContextMenu,
    customColors,
    pickerColor,
    setPickerColor,
    palette,
    addCustomColor,
    applyMarkColor,
    copyTsMsg,
    adoptTraceIds,
  };
}
