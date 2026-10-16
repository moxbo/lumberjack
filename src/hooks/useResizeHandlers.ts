/**
 * useResizeHandlers Hook
 * Manages column and divider resize functionality
 */

import { useRef, useLayoutEffect, useCallback, useState } from "preact/hooks";
import type { ColumnResizeState, DividerResizeState } from "../types/renderer";
import logger from "../utils/logger";
import { patchSettingsQuiet } from "../utils/typedApi";

export interface UseResizeHandlersOptions {
  layoutRef: React.RefObject<HTMLDivElement | null>;
  detailLayout?: "bottom" | "right";
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
  const { layoutRef, detailLayout = "bottom" } = options;

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
  useLayoutEffect(() => {
    const side = detailLayout === "right";
    const sizeProperty = side ? "--detail-width" : "--detail-height";
    const defaultSize = side ? 420 : 300;
    function applySize(size: number): number {
      const layout = layoutRef.current;
      const total = side
        ? (layout?.clientWidth ?? window.innerWidth)
        : (layout?.clientHeight ?? window.innerHeight);
      const minDetail = side ? 280 : 150;
      const minList = side ? 320 : 140;
      const maxDetail = Math.max(
        0,
        Math.min(
          total - minList - 8,
          side ? total * 0.55 - 8 : 2000,
          side ? 1600 : 2000,
        ),
      );
      const next = Math.round(Math.min(maxDetail, Math.max(minDetail, size)));
      document.documentElement.style.setProperty(sizeProperty, `${next}px`);
      return next;
    }
    function renderedSize(): number {
      const overlay = dividerElRef.current?.parentElement;
      return overlay
        ? (side ? overlay.clientWidth : overlay.clientHeight) - 8
        : defaultSize;
    }
    function persistSize(): void {
      const value =
        parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            sizeProperty,
          ),
        ) || defaultSize;
      patchSettingsQuiet(
        side ? { detailWidth: value } : { detailHeight: value },
      );
    }
    function onMouseMove(e: MouseEvent): void {
      if (!dividerStateRef.current._resizing) return;
      const startY = dividerStateRef.current._startY;
      const startH = dividerStateRef.current._startH;
      const delta = (side ? e.clientX : e.clientY) - startY;
      setResizeHeight(applySize(startH - delta));
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
        persistSize();
      } catch (e) {
        logger.warn("Setting detailHeight via API failed:", e);
      }
    }

    function onMouseDown(e: MouseEvent): void {
      if (e.button !== 0) return;
      e.preventDefault();
      dividerStateRef.current._resizing = true;
      dividerStateRef.current._startY = side ? e.clientX : e.clientY;
      dividerStateRef.current._startH = renderedSize();
      document.body.style.userSelect = "none";
      document.body.style.cursor = side ? "col-resize" : "row-resize";
      dividerElRef.current?.classList.add("resizing");
      setResizeHeight(dividerStateRef.current._startH);
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    }

    function onKeyDown(e: KeyboardEvent): void {
      const grow = side ? "ArrowLeft" : "ArrowUp";
      const shrink = side ? "ArrowRight" : "ArrowDown";
      if (e.key !== grow && e.key !== shrink) return;
      e.preventDefault();
      applySize(renderedSize() + (e.key === grow ? 20 : -20));
      persistSize();
    }
    const el = dividerElRef.current;
    el?.addEventListener("mousedown", onMouseDown);
    el?.addEventListener("keydown", onKeyDown);
    return () => {
      el?.removeEventListener("mousedown", onMouseDown);
      el?.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      if (dividerStateRef.current._resizing) {
        dividerStateRef.current._resizing = false;
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        setResizeHeight(null);
      }
    };
  }, [layoutRef, detailLayout]);

  // Column mouse move handler
  const onColMouseMove = useCallback((e: MouseEvent): void => {
    const st = colResize.current;
    if (!st.active) return;
    let newW = st.startW + (e.clientX - st.startX);
    const clamp = (v: number, min: number, max: number): number =>
      Math.max(min, Math.min(max, v));
    if (st.active === "--col-ts") newW = clamp(newW, 100, st.maxW ?? 600);
    if (st.active === "--col-lvl") newW = clamp(newW, 50, st.maxW ?? 200);
    if (st.active === "--col-logger") newW = clamp(newW, 100, st.maxW ?? 800);
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
      const handle =
        e.currentTarget instanceof HTMLElement ? e.currentTarget : null;
      const cell = handle?.parentElement;
      const header = cell?.parentElement;
      const curW =
        cell?.getBoundingClientRect().width ?? (parseFloat(cur) || 0);
      const limit = cs.getPropertyValue(`${active}-max`).trim();
      const hardMax = key === "ts" ? 600 : key === "lvl" ? 200 : 800;
      let maxW = hardMax;
      if (header && limit.endsWith("%")) {
        const headerStyle = getComputedStyle(header);
        const contentWidth =
          header.clientWidth -
          parseFloat(headerStyle.paddingLeft) -
          parseFloat(headerStyle.paddingRight);
        maxW = Math.min(hardMax, (contentWidth * parseFloat(limit)) / 100);
      }
      colResize.current = { active, startX: e.clientX, startW: curW, maxW };
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
