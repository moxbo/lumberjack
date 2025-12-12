/**
 * Hook for managing context menu state and mark colors
 */
import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "preact/hooks";
import { BASE_MARK_COLORS } from "../constants";
import { entrySignature } from "../utils/entryUtils";
import logger from "../utils/logger";

interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
}

interface UseContextMenuOptions {
  entries: any[];
  selected: Set<number>;
  setSelected: (fn: (prev: Set<number>) => Set<number>) => void;
  setEntries: (fn: (prev: any[]) => any[]) => void;
  parentRef: React.RefObject<HTMLDivElement>;
}

export function useContextMenu({
  entries,
  selected,
  setSelected,
  setEntries,
  parentRef,
}: UseContextMenuOptions) {
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState>({
    open: false,
    x: 0,
    y: 0,
  });
  const ctxRef = useRef<HTMLDivElement | null>(null);

  // Custom colors (user-added)
  const [customColors, setCustomColors] = useState<string[]>([]);

  // Color picker state
  const [pickerColor, setPickerColor] = useState<string>("#ffcc00");

  // Marks map (signature -> color)
  const [marksMap, setMarksMap] = useState<Record<string, string>>({});

  // Combined palette
  const palette = useMemo(
    () => [...BASE_MARK_COLORS, ...customColors],
    [customColors],
  );

  const closeContextMenu = useCallback(() => {
    setCtxMenu({ open: false, x: 0, y: 0 });
  }, []);

  const openContextMenu = useCallback(
    (ev: MouseEvent, idx: number) => {
      try {
        ev.preventDefault();
        setSelected((prev) => {
          if (prev && prev.has(idx)) return prev;
          return new Set([idx]);
        });
        setCtxMenu({ open: true, x: ev.clientX, y: ev.clientY });

        // Ensure list stays focused
        setTimeout(() => {
          if (
            parentRef.current &&
            !parentRef.current.contains(document.activeElement || null)
          ) {
            (parentRef.current as any)?.focus?.({ preventScroll: true });
          }
        }, 0);
      } catch (err) {
        logger.error("openContextMenu error:", err);
      }
    },
    [setSelected, parentRef],
  );

  // Close on outside click or escape
  useEffect(() => {
    if (!ctxMenu.open) return;

    const onMouseDown = (e: MouseEvent) => {
      try {
        if (!ctxRef.current) return closeContextMenu();
        if (!ctxRef.current.contains(e.target as Node)) closeContextMenu();
      } catch {
        closeContextMenu();
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeContextMenu();
    };

    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu.open, closeContextMenu]);

  const addCustomColor = useCallback((c: string) => {
    const color = String(c || "").trim();
    if (!color) return;
    setCustomColors((prev) => {
      const list = prev.includes(color) ? prev : [...prev, color];
      try {
        void window.api.settingsSet({ customMarkColors: list });
      } catch (e) {
        logger.error("Failed to save customMarkColors settings:", e);
      }
      return list;
    });
  }, []);

  const applyMarkColor = useCallback(
    (color?: string) => {
      setEntries((prev) => {
        if (!prev || !prev.length) return prev;
        const next = prev.slice();
        const newMap: Record<string, string> = { ...marksMap };

        for (const i of selected) {
          if (i >= 0 && i < next.length) {
            const e = next[i] || {};
            const n = { ...e };
            if (color) {
              n._mark = color;
              newMap[entrySignature(n)] = color;
            } else {
              if (n._mark) delete newMap[entrySignature(n)];
              delete n._mark;
            }
            (next as any)[i] = n;
          }
        }

        setMarksMap(newMap);
        try {
          void window.api.settingsSet({ marksMap: newMap });
        } catch {}

        return next;
      });
      closeContextMenu();
    },
    [selected, marksMap, setEntries, closeContextMenu],
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

  return {
    ctxMenu,
    ctxRef,
    palette,
    customColors,
    setCustomColors,
    pickerColor,
    setPickerColor,
    marksMap,
    setMarksMap,
    openContextMenu,
    closeContextMenu,
    addCustomColor,
    applyMarkColor,
  };
}
