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
  text: ComponentChildren;
  children: ComponentChildren;
  position?: "top" | "bottom";
  delay?: number;
  interactive?: boolean;
  label?: string;
}

export function Tooltip({
  text,
  children,
  position = "top",
  delay = 400,
  interactive = false,
  label,
}: TooltipProps): JSX.Element {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

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
    clearTimer();
    timerRef.current = setTimeout(updatePosition, delay);
  }, [clearTimer, delay, updatePosition]);

  const hide = useCallback(() => {
    clearTimer();
    setVisible(false);
  }, [clearTimer]);

  const contains = (target: EventTarget | null) =>
    target instanceof Node &&
    (wrapperRef.current?.contains(target) ||
      tooltipRef.current?.contains(target));

  const leave = () => {
    clearTimer();
    if (!interactive) {
      hide();
    } else if (!contains(document.activeElement)) {
      timerRef.current = setTimeout(hide, 150);
    }
  };

  const blur = (event: JSX.TargetedFocusEvent<HTMLElement>) => {
    if (!interactive || !contains(event.relatedTarget)) hide();
  };

  const dismiss = (event: JSX.TargetedKeyboardEvent<HTMLElement>) => {
    if (!interactive || event.key !== "Escape" || !visible) return;
    event.preventDefault();
    event.stopPropagation();
    if (tooltipRef.current?.contains(document.activeElement)) {
      triggerRef.current?.focus();
    }
    hide();
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <span
      ref={wrapperRef}
      onMouseEnter={show}
      onMouseLeave={leave}
      onFocus={(event) => {
        if (interactive) {
          if (event.target instanceof HTMLElement) {
            triggerRef.current = event.target;
          }
          clearTimer();
          updatePosition();
        } else {
          show();
        }
      }}
      onBlur={blur}
      onKeyDown={(event) => {
        dismiss(event);
        if (interactive && visible && event.key === "Tab" && !event.shiftKey) {
          const action = tooltipRef.current?.querySelector<HTMLElement>(
            "button:not(:disabled), a[href], [tabindex='0']",
          );
          if (action) {
            event.preventDefault();
            action.focus();
          }
        }
      }}
      style={{ display: "inline-flex" }}
    >
      {children}
      {visible &&
        coords &&
        text &&
        createPortal(
          <div
            ref={tooltipRef}
            className={`portal-tooltip portal-tooltip--${position}${interactive ? " portal-tooltip--interactive" : ""}`}
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              transform: "translateX(-50%)",
              zIndex: 10100,
            }}
            role={interactive ? "dialog" : "tooltip"}
            aria-label={interactive ? label : undefined}
            onMouseEnter={interactive ? clearTimer : undefined}
            onMouseLeave={interactive ? leave : undefined}
            onFocus={interactive ? clearTimer : undefined}
            onBlur={interactive ? blur : undefined}
            onKeyDown={(event) => {
              dismiss(event);
              if (interactive && event.key === "Tab") {
                triggerRef.current?.focus();
                if (event.shiftKey) event.preventDefault();
                else hide();
              }
            }}
          >
            {text}
          </div>,
          document.body,
        )}
    </span>
  );
}
