/**
 * Hook for resizable panels and columns
 */
import { useState, useRef, useEffect, useCallback } from "preact/hooks";
import logger from "../utils/logger";
import { COLUMN_CONSTRAINTS, DETAIL_PANEL_CONSTRAINTS } from "../constants";

interface UseResizableOptions {
  layoutRef: React.RefObject<HTMLDivElement>;
}

export function useResizable({ layoutRef }: UseResizableOptions) {
  const [resizeHeight, setResizeHeight] = useState<number | null>(null);

  // Divider state
  const dividerElRef = useRef<HTMLElement | null>(null);
  const dividerStateRef = useRef<{
    _resizing: boolean;
    _startY: number;
    _startH: number;
  }>({
    _resizing: false,
    _startY: 0,
    _startH: 0,
  });

  // Column resize state
  const colResize = useRef<{
    active: null | string;
    startX: number;
    startW: number;
  }>({
    active: null,
    startX: 0,
    startW: 0,
  });

  // Divider drag effect
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dividerStateRef.current._resizing) return;
      const startY = dividerStateRef.current._startY;
      const startH = dividerStateRef.current._startH;
      const dy = e.clientY - startY;
      let newH = startH - dy;

      const layout = layoutRef.current;
      const total = layout
        ? (layout as any).clientHeight
        : document.body.clientHeight || window.innerHeight;

      const { minHeight: minDetail, minListHeight: minList } =
        DETAIL_PANEL_CONSTRAINTS;
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

    async function onMouseUp() {
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
        await window.api.settingsSet({ detailHeight: Math.round(num) });
      } catch (e) {
        logger.warn("Setting detailHeight via API failed:", e);
      }
    }

    function onMouseDown(e: MouseEvent) {
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

  // Column resize handlers
  const onColMouseDown = useCallback(
    (key: "ts" | "lvl" | "logger", e: MouseEvent) => {
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

      window.addEventListener("mousemove", onColMouseMove);
      window.addEventListener("mouseup", onColMouseUp);
    },
    [],
  );

  function onColMouseMove(e: MouseEvent) {
    const st = colResize.current;
    if (!st.active) return;

    let newW = st.startW + (e.clientX - st.startX);
    const clamp = (v: number, min: number, max: number) =>
      Math.max(min, Math.min(max, v));

    if (st.active === "--col-ts") {
      const { min, max } = COLUMN_CONSTRAINTS.timestamp;
      newW = clamp(newW, min, max);
    }
    if (st.active === "--col-lvl") {
      const { min, max } = COLUMN_CONSTRAINTS.level;
      newW = clamp(newW, min, max);
    }
    if (st.active === "--col-logger") {
      const { min, max } = COLUMN_CONSTRAINTS.logger;
      newW = clamp(newW, min, max);
    }

    document.documentElement.style.setProperty(
      st.active,
      `${Math.round(newW)}px`,
    );
  }

  async function onColMouseUp() {
    const st = colResize.current;
    colResize.current = { active: null, startX: 0, startW: 0 };
    document.body.style.userSelect = "";
    document.body.style.cursor = "";

    window.removeEventListener("mousemove", onColMouseMove);
    window.removeEventListener("mouseup", onColMouseUp);

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
      if (k) await window.api.settingsSet({ [k]: Math.round(num) } as any);
    } catch (e) {
      logger.warn("Column resize setting failed:", e);
    }
  }

  return {
    resizeHeight,
    dividerElRef,
    onColMouseDown,
  };
}
