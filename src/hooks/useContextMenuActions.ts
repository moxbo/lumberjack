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
import type { ContextMenuState } from "../types/renderer";
import type { RefObject } from "preact";
import { BASE_MARK_COLORS } from "../constants";
import { patchSettingsQuiet } from "../utils/typedApi";
import { fmtTimestamp } from "../utils/format";
import { DiagnosticContextFilter } from "../store/dcFilter";
import type { PagedEntryMetadata } from "./useEntryManagement";
import type { PagedLogRepository } from "../store/paged/PagedLogRepository";
import type { PagedTimestamp } from "../store/paged/types";
import { pagedLogRepository } from "../store/paged/session";
import logger from "../utils/logger";

type PayloadRepository = Pick<PagedLogRepository, "getPayloads">;

export interface UseContextMenuActionsOptions {
  entries: PagedEntryMetadata[];
  selected: Set<number>;
  setSelected: (fn: (prev: Set<number>) => Set<number>) => void;
  marksMap: Record<string, string>;
  setMarksMap: (map: Record<string, string>) => void;
  parentRef: RefObject<HTMLDivElement | null>;
  showAlert: (msg: string) => void;
  t: (key: string) => string;
  repository?: PayloadRepository;
  getMetadata?: (id: number) => PagedEntryMetadata | undefined;
}

export interface UseContextMenuActionsReturn {
  // Context menu state
  ctxMenu: ContextMenuState;
  ctxRef: RefObject<HTMLDivElement>;
  openContextMenu: (ev: MouseEvent, id: number) => void;
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
    repository = pagedLogRepository,
    getMetadata,
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
  const selectedIdsInVisualOrder = useMemo(
    () =>
      selected.size <= 1
        ? Array.from(selected)
        : entries
            .filter((entry) => selected.has(entry._id))
            .map((entry) => entry._id),
    [entries, selected],
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
    (ev: MouseEvent, id: number): void => {
      try {
        ev.preventDefault();
        setSelected((prev) => {
          if (prev && prev.has(id)) return prev;
          return new Set([id]);
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
      for (const id of selected) {
        const metadata =
          getMetadata?.(id) ?? entries.find((entry) => entry._id === id);
        if (!metadata) continue;
        if (color) {
          newMap[metadata.signature] = color;
        } else {
          delete newMap[metadata.signature];
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
    [entries, selected, getMetadata, marksMap, setMarksMap, closeContextMenu],
  );

  const adoptTraceIds = useCallback((): void => {
    void (async () => {
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
        for (
          let start = 0;
          start < selectedIdsInVisualOrder.length;
          start += 256
        ) {
          const ids = selectedIdsInVisualOrder.slice(start, start + 256);
          const payloads = await repository.getPayloads(ids);
          for (const id of ids) {
            const m = payloads.get(id)?.mdc;
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
        }
        if (added.size) DiagnosticContextFilter.setEnabled(true);
      } catch (e) {
        logger.warn("adoptTraceIds failed:", e);
        showAlert(e instanceof Error ? e.message : String(e));
      } finally {
        closeContextMenu();
      }
    })();
  }, [repository, selectedIdsInVisualOrder, showAlert, closeContextMenu]);

  const copyTsMsg = useCallback(async (): Promise<void> => {
    try {
      const lines: string[] = [];
      for (
        let start = 0;
        start < selectedIdsInVisualOrder.length;
        start += 256
      ) {
        const ids = selectedIdsInVisualOrder.slice(start, start + 256);
        const payloads = await repository.getPayloads(ids);
        for (const id of ids) {
          const entry = payloads.get(id);
          if (!entry) continue;
          lines.push(
            `${fmtTimestamp(entry.timestamp as PagedTimestamp)}\n${String(
              entry.message ?? "",
            )}`,
          );
        }
      }
      const text = lines.join("\n");
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
    } finally {
      closeContextMenu();
    }
  }, [repository, selectedIdsInVisualOrder, showAlert, t, closeContextMenu]);

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
