/**
 * useResizeHandlers Hook
 * Manages column and divider resize functionality
 */

import { useRef, useEffect, useCallback, useState } from "preact/hooks";
import type { ColumnResizeState, DividerResizeState } from "../types/renderer";
import logger from "../utils/logger";
import { patchSettingsQuiet } from "../utils/typedApi";

export interface UseResizeHandlersOptions {
  layoutRef: React.RefObject<HTMLDivElement | null>;
}

export interface UseResizeHandlersReturn {
  // Divider resize
  dividerElRef: React.RefObject<HTMLElement | null>;
  dividerStateRef: React.RefObject<DividerResizeState>;
  resizeHeight: number | null;

  // Column resize
  colResize: React.RefObject<ColumnResizeState>;
  onColMouseDown: (key: "ts" | "lvl" | "logger", e: MouseEvent) => void;
}

/**
 * Hook for managing column and divider resize operations
 */
export function useResizeHandlers(
  options: UseResizeHandlersOptions,
): UseResizeHandlersReturn {
  const { layoutRef } = options;

  // Resize feedback state
  const [resizeHeight, setResizeHeight] = useState<number | null>(null);

  // Divider refs
  const dividerElRef = useRef<HTMLElement | null>(null);
  const dividerStateRef = useRef<DividerResizeState>({
    _resizing: false,
    _startY: 0,
    _startH: 0,
  });

  // Column resize ref
  const colResize = useRef<ColumnResizeState>({
    active: null,
    startX: 0,
    startW: 0,
  });

  // Divider drag effect
  useEffect(() => {
    function onMouseMove(e: MouseEvent): void {
      if (!dividerStateRef.current._resizing) return;
      const startY = dividerStateRef.current._startY;
      const startH = dividerStateRef.current._startH;
      const dy = e.clientY - startY;
      let newH = startH - dy;
      const layout = layoutRef.current;
      const total = layout
        ? (layout as any).clientHeight
        : document.body.clientHeight || window.innerHeight;
      const minDetail = 150;
      const minList = 140;
      const csRoot = getComputedStyle(document.documentElement);
      const divVar = csRoot.getPropertyValue("--divider-h").trim();
      const dividerSize = Math.max(
        0,
        parseInt(divVar.replace("px", ""), 10) || 8,
      );
      const maxDetail = Math.max(minDetail, total - minList - dividerSize);
      if (newH < minDetail) newH = minDetail;
      if (newH > maxDetail) newH = maxDetail;
      document.documentElement.style.setProperty(
        "--detail-height",
        `${Math.round(newH)}px`,
      );
      setResizeHeight(Math.round(newH));
    }

    async function onMouseUp(): Promise<void> {
      dividerStateRef.current._resizing = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setResizeHeight(null);
      dividerElRef.current?.classList.remove("resizing");
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      try {
        const cs = getComputedStyle(document.documentElement);
        const h = cs.getPropertyValue("--detail-height").trim();
        const num = Number(h.replace("px", "")) || 300;
        patchSettingsQuiet({ detailHeight: Math.round(num) });
      } catch (e) {
        logger.warn("Setting detailHeight via API failed:", e);
      }
    }

    function onMouseDown(e: MouseEvent): void {
      dividerStateRef.current._resizing = true;
      dividerStateRef.current._startY = e.clientY;
      const cs = getComputedStyle(document.documentElement);
      const h = cs.getPropertyValue("--detail-height").trim();
      dividerStateRef.current._startH = Number(h.replace("px", "")) || 300;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "row-resize";
      dividerElRef.current?.classList.add("resizing");
      setResizeHeight(dividerStateRef.current._startH);
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    }

    const el = dividerElRef.current;
    if (el) el.addEventListener("mousedown", onMouseDown as any);
    return () => {
      if (el) el.removeEventListener("mousedown", onMouseDown as any);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [layoutRef]);

  // Column mouse move handler
  const onColMouseMove = useCallback((e: MouseEvent): void => {
    const st = colResize.current;
    if (!st.active) return;
    let newW = st.startW + (e.clientX - st.startX);
    const clamp = (v: number, min: number, max: number): number =>
      Math.max(min, Math.min(max, v));
    if (st.active === "--col-ts") newW = clamp(newW, 140, 600);
    if (st.active === "--col-lvl") newW = clamp(newW, 70, 200);
    if (st.active === "--col-logger") newW = clamp(newW, 160, 800);
    document.documentElement.style.setProperty(
      st.active,
      `${Math.round(newW)}px`,
    );
  }, []);

  // Column mouse up handler
  const onColMouseUp = useCallback(async (): Promise<void> => {
    const st = colResize.current;
    colResize.current = { active: null, startX: 0, startW: 0 };
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    window.removeEventListener("mousemove", onColMouseMove as any);
    window.removeEventListener("mouseup", onColMouseUp as any);
    try {
      if (!st.active) return;
      const cs = getComputedStyle(document.documentElement);
      const val = cs.getPropertyValue(st.active).trim();
      const num = Number(val.replace("px", "")) || 0;
      const keyMap: Record<string, string> = {
        "--col-ts": "colTs",
        "--col-lvl": "colLvl",
        "--col-logger": "colLogger",
      };
      const k = keyMap[st.active];
      if (k)
        patchSettingsQuiet({ [k]: Math.round(num) } as Partial<
          import("../types/ipc").Settings
        >);
    } catch (e) {
      logger.warn("Column resize setting failed:", e);
    }
  }, [onColMouseMove]);

  // Column mouse down handler
  const onColMouseDown = useCallback(
    (key: "ts" | "lvl" | "logger", e: MouseEvent): void => {
      const varMap: Record<string, string> = {
        ts: "--col-ts",
        lvl: "--col-lvl",
        logger: "--col-logger",
      };
      const active = varMap[key];
      if (!active) return;
      const cs = getComputedStyle(document.documentElement);
      const cur = cs.getPropertyValue(active).trim();
      const curW = Number(cur.replace("px", "")) || 0;
      colResize.current = { active, startX: e.clientX, startW: curW };
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
      window.addEventListener("mousemove", onColMouseMove as any);
      window.addEventListener("mouseup", onColMouseUp as any);
    },
    [onColMouseMove, onColMouseUp],
  );

  return {
    dividerElRef,
    dividerStateRef,
    resizeHeight,
    colResize,
    onColMouseDown,
  };
}
