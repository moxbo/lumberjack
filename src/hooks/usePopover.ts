/**
 * Hook for managing popover visibility and positioning
 */
import { useState, useRef, useCallback, useEffect } from "preact/hooks";

interface PopoverPosition {
  left: number;
  top: number;
  width: number;
}

function computePosFor(el: HTMLElement | null): PopoverPosition | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    left: Math.round(r.left),
    top: Math.round(r.bottom + 2),
    width: Math.round(r.width),
  };
}

export function usePopover<T extends string>(popoverKeys: T[]) {
  type VisibilityState = Record<T, boolean>;
  type PositionState = Record<T, PopoverPosition | null>;
  type RefState = Record<T, HTMLElement | null>;

  // Initialize states
  const initialVisibility = popoverKeys.reduce((acc, key) => {
    acc[key] = false;
    return acc;
  }, {} as VisibilityState);

  const initialPositions = popoverKeys.reduce((acc, key) => {
    acc[key] = null;
    return acc;
  }, {} as PositionState);

  const [visibility, setVisibility] =
    useState<VisibilityState>(initialVisibility);
  const [positions, setPositions] = useState<PositionState>(initialPositions);

  // Refs for anchor elements
  const refs = useRef<RefState>(
    popoverKeys.reduce((acc, key) => {
      acc[key] = null;
      return acc;
    }, {} as RefState),
  );

  // Refs for popover containers (for outside click detection)
  const containerRefs = useRef<RefState>(
    popoverKeys.reduce((acc, key) => {
      acc[key] = null;
      return acc;
    }, {} as RefState),
  );

  const setRef = useCallback((key: T, el: HTMLElement | null) => {
    refs.current[key] = el;
  }, []);

  const setContainerRef = useCallback((key: T, el: HTMLElement | null) => {
    containerRefs.current[key] = el;
  }, []);

  const show = useCallback((key: T) => {
    setVisibility((prev) => ({ ...prev, [key]: true }));
  }, []);

  const hide = useCallback((key: T) => {
    setVisibility((prev) => ({ ...prev, [key]: false }));
  }, []);

  const toggle = useCallback((key: T) => {
    setVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const closeAll = useCallback(() => {
    setVisibility(initialVisibility);
  }, [initialVisibility]);

  // Update positions when visibility changes
  const updatePositions = useCallback(() => {
    const newPositions = { ...positions };
    let changed = false;
    for (const key of popoverKeys) {
      if (visibility[key]) {
        const newPos = computePosFor(refs.current[key]);
        if (JSON.stringify(newPos) !== JSON.stringify(newPositions[key])) {
          newPositions[key] = newPos;
          changed = true;
        }
      }
    }
    if (changed) {
      setPositions(newPositions);
    }
  }, [visibility, positions, popoverKeys]);

  // Update positions on visibility change
  useEffect(() => {
    updatePositions();
  }, [visibility]);

  // Update positions on resize/scroll
  useEffect(() => {
    const anyVisible = Object.values(visibility).some(Boolean);
    if (!anyVisible) return;

    const onResize = () => updatePositions();
    const onScroll = () => updatePositions();

    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [visibility, updatePositions]);

  // Outside click detection
  useEffect(() => {
    const anyVisible = Object.values(visibility).some(Boolean);
    if (!anyVisible) return;

    const onDocDown = (ev: MouseEvent) => {
      const t = ev.target as Node;

      // Check if click is inside any anchor or container
      for (const key of popoverKeys) {
        if (visibility[key]) {
          const anchorEl = refs.current[key];
          const containerEl = containerRefs.current[key];
          if (
            (anchorEl && anchorEl.contains(t)) ||
            (containerEl && containerEl.contains(t))
          ) {
            return; // Click inside, don't close
          }
        }
      }

      // Click outside all visible popovers - close all
      closeAll();
    };

    window.addEventListener("mousedown", onDocDown, true);
    return () => window.removeEventListener("mousedown", onDocDown, true);
  }, [visibility, popoverKeys, closeAll]);

  return {
    visibility,
    positions,
    setRef,
    setContainerRef,
    show,
    hide,
    toggle,
    closeAll,
    isVisible: (key: T) => visibility[key],
    getPosition: (key: T) => positions[key],
  };
}
