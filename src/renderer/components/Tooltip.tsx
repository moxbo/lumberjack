/**
 * Portal-based Tooltip Component
 * Renders tooltip as a direct child of document.body via createPortal,
 * ensuring it is never clipped by overflow containers or stacking contexts.
 * Works reliably in Electron where native title attributes may not render.
 */
import type { JSX, ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useState, useRef, useCallback, useEffect } from "preact/hooks";

interface TooltipProps {
  text: string;
  children: ComponentChildren;
  position?: "top" | "bottom";
  delay?: number;
}

export function Tooltip({
  text,
  children,
  position = "top",
  delay = 400,
}: TooltipProps): JSX.Element {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updatePosition = useCallback(() => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const top = position === "top" ? rect.top - 4 : rect.bottom + 4;
    // Start centered on the trigger element
    const centerX = rect.left + rect.width / 2;
    setCoords({ top, left: centerX });
    setVisible(true);

    // After render, check if tooltip overflows viewport and adjust
    requestAnimationFrame(() => {
      if (!tooltipRef.current) return;
      const tipRect = tooltipRef.current.getBoundingClientRect();
      const pad = 8;
      const vw = window.innerWidth;
      let adjusted = centerX;

      if (tipRect.right > vw - pad) {
        adjusted = centerX - (tipRect.right - vw + pad);
      }
      if (tipRect.left < pad) {
        adjusted = centerX + (pad - tipRect.left);
      }
      if (adjusted !== centerX) {
        setCoords({ top, left: adjusted });
      }
    });
  }, [position]);

  const show = useCallback(() => {
    timerRef.current = setTimeout(updatePosition, delay);
  }, [delay, updatePosition]);

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <span
      ref={wrapperRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      style={{ display: "inline-flex" }}
    >
      {children}
      {visible &&
        coords &&
        text &&
        createPortal(
          <div
            ref={tooltipRef}
            className={`portal-tooltip portal-tooltip--${position}`}
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              transform: "translateX(-50%)",
              zIndex: 10100,
            }}
            role="tooltip"
          >
            {text}
          </div>,
          document.body,
        )}
    </span>
  );
}
