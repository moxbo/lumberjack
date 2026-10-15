// Stay below browser layout limits; the logical list can be much taller.
export const MAX_SCROLL_HEIGHT = 8_000_000;

export type ScrollAlign = "auto" | "center" | "end" | "start";

export function fixedRowScroll(
  count: number,
  rowHeight: number,
  viewportHeight: number,
) {
  const logicalHeight = count * rowHeight;
  const height = Math.min(logicalHeight, MAX_SCROLL_HEIGHT);
  const maxOffset = Math.max(0, logicalHeight - viewportHeight);
  const maxPhysicalOffset = Math.max(0, height - viewportHeight);
  const scale = maxPhysicalOffset > 0 ? maxOffset / maxPhysicalOffset : 1;
  const clamp = (offset: number) => Math.max(0, Math.min(maxOffset, offset));
  return {
    height,
    maxOffset,
    scale,
    toLogical: (offset: number) => clamp(offset * scale),
    toPhysical: (offset: number) => clamp(offset) / scale,
    offsetForIndex(index: number, offset: number, align: ScrollAlign) {
      const start = Math.max(0, Math.min(count - 1, index)) * rowHeight;
      const end = start + rowHeight;
      if (align === "auto") {
        if (start < offset) return clamp(start);
        if (end > offset + viewportHeight) return clamp(end - viewportHeight);
        return clamp(offset);
      }
      return clamp(
        align === "center"
          ? start - (viewportHeight - rowHeight) / 2
          : align === "end"
            ? end - viewportHeight
            : start,
      );
    },
    range(offset: number, overscan: number) {
      return {
        start: Math.max(0, Math.floor(clamp(offset) / rowHeight) - overscan),
        end: Math.min(
          count,
          Math.ceil((clamp(offset) + viewportHeight) / rowHeight) + overscan,
        ),
      };
    },
  };
}
