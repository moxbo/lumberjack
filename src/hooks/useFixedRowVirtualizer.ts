import { flushSync } from "preact/compat";
import { useCallback, useLayoutEffect, useMemo, useState } from "preact/hooks";
import { fixedRowScroll, type ScrollAlign } from "./fixedRowScroll";

export function useFixedRowVirtualizer(
  element: HTMLDivElement | null,
  count: number,
  rowHeight: number,
  overscan: number,
) {
  const [viewport, setViewport] = useState({
    height: 0,
    top: 0,
    pixelRatio: 1,
    scrollTop: 0,
    adjustment: 0,
  });
  useLayoutEffect(() => {
    if (!element) return;
    const header = element.firstElementChild;
    const measure = () => {
      const headerRect = header?.getBoundingClientRect();
      const height = Math.max(
        0,
        element.clientHeight - (headerRect?.height ?? 0),
      );
      const top = headerRect?.bottom ?? element.getBoundingClientRect().top;
      const pixelRatio = window.devicePixelRatio;
      const scrollTop = element.scrollTop;
      setViewport((previous) =>
        previous.height === height &&
        previous.top === top &&
        previous.pixelRatio === pixelRatio &&
        previous.scrollTop === scrollTop
          ? previous
          : {
              height,
              top,
              pixelRatio,
              scrollTop,
              adjustment:
                previous.scrollTop === scrollTop ? previous.adjustment : 0,
            },
      );
    };
    const onScroll = () => flushSync(measure);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (header) observer.observe(header);
    const resolution = window.matchMedia(
      `(resolution: ${viewport.pixelRatio}dppx)`,
    );
    resolution.addEventListener("change", measure);
    element.addEventListener("scroll", onScroll);
    return () => {
      observer.disconnect();
      resolution.removeEventListener("change", measure);
      element.removeEventListener("scroll", onScroll);
    };
  }, [element, viewport.pixelRatio]);

  const geometry = useMemo(
    () => fixedRowScroll(count, rowHeight, viewport.height),
    [count, rowHeight, viewport.height],
  );
  const logicalOffset = useCallback(
    (scrollTop: number) =>
      Math.max(
        0,
        Math.min(
          geometry.maxOffset,
          geometry.toLogical(scrollTop) + viewport.adjustment,
        ),
      ),
    [geometry, viewport.adjustment],
  );
  const scrollOffset = logicalOffset(viewport.scrollTop);
  const getScrollOffset = useCallback(
    () => logicalOffset(element?.scrollTop ?? 0),
    [element, logicalOffset],
  );
  const scrollToOffset = useCallback(
    (offset: number) => {
      if (!element) return;
      element.scrollTop = geometry.toPhysical(offset);
      const scrollTop = element.scrollTop;
      // Chromium rounds scrollTop; retain the residual in logical coordinates.
      const adjustment =
        Math.max(0, Math.min(geometry.maxOffset, offset)) -
        geometry.toLogical(scrollTop);
      setViewport((previous) =>
        previous.scrollTop === scrollTop && previous.adjustment === adjustment
          ? previous
          : { ...previous, scrollTop, adjustment },
      );
    },
    [element, geometry],
  );
  const scrollToIndex = useCallback(
    (index: number, { align = "auto" }: { align?: ScrollAlign } = {}) => {
      scrollToOffset(
        geometry.offsetForIndex(
          index,
          logicalOffset(element?.scrollTop ?? 0),
          align,
        ),
      );
    },
    [element, geometry, logicalOffset, scrollToOffset],
  );

  useLayoutEffect(() => {
    if (!element || geometry.scale <= 1) return;
    // Keep wheel/trackpad movement in row pixels, not compressed scrollbar pixels.
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.deltaY === 0 || event.shiftKey) return;
      event.preventDefault();
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? rowHeight
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? viewport.height
            : 1;
      scrollToOffset(logicalOffset(element.scrollTop) + event.deltaY * unit);
      element.scrollLeft += event.deltaX * unit;
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [
    element,
    geometry,
    logicalOffset,
    rowHeight,
    scrollToOffset,
    viewport.height,
  ]);

  const virtualItems = useMemo(() => {
    if (!element || viewport.height <= 0) return [];
    const { start, end } = geometry.range(scrollOffset, overscan);
    const { top, scrollTop, pixelRatio } = viewport;
    const contentOrigin = top - scrollTop;
    return Array.from({ length: end - start }, (_, offset) => {
      const index = start + offset;
      // Snap in screen space for crisp text, not in logical scroll coordinates.
      const y = top + index * rowHeight - scrollOffset;
      const snappedY = Math.round(y * pixelRatio) / pixelRatio;
      return { index, start: snappedY - contentOrigin };
    });
  }, [element, geometry, overscan, rowHeight, scrollOffset, viewport]);

  return {
    virtualItems,
    totalHeight: geometry.height,
    viewportHeight: viewport.height,
    scrollOffset,
    getScrollOffset,
    getDistanceFromEnd: () => geometry.maxOffset - getScrollOffset(),
    scrollToOffset,
    scrollToIndex,
  };
}
