/**
 * Virtualisierte Stack-Trace-Ansicht für lange Stack-Traces.
 * Wird verwendet, wenn der Stack-Trace mehr als 50 Zeilen hat.
 */
import { memo, useRef, useMemo } from "preact/compat";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { JSX } from "preact/jsx-runtime";

interface VirtualizedStackTraceProps {
  stackTrace: string;
  maxHeight?: number;
}

// Threshold for switching to virtualized view
const VIRTUALIZATION_THRESHOLD = 50;
const LINE_HEIGHT = 18;

const VirtualizedStackTraceComponent = ({
  stackTrace,
  maxHeight = 400,
}: VirtualizedStackTraceProps): JSX.Element => {
  const parentRef = useRef<HTMLDivElement>(null);

  // Split stack trace into lines
  const lines = useMemo(() => {
    if (!stackTrace) return [];
    return stackTrace.split("\n");
  }, [stackTrace]);

  // Use virtualization only for large stack traces
  const useVirtualization = lines.length > VIRTUALIZATION_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => LINE_HEIGHT,
    overscan: 10,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();

  // For small stack traces, render directly
  if (!useVirtualization) {
    return <pre className="stack-trace">{stackTrace}</pre>;
  }

  // For large stack traces, use virtualization
  return (
    <div
      ref={parentRef}
      className="stack-trace stack-trace-virtual"
      style={{
        height: Math.min(maxHeight, totalHeight + 16),
        overflow: "auto",
        overscrollBehavior: "contain",
        fontFamily: "var(--font-family-mono), monospace",
        fontSize: "12px",
        lineHeight: `${LINE_HEIGHT}px`,
        whiteSpace: "pre",
        padding: "8px 10px",
        background: "rgba(0, 0, 0, 0.04)",
        border: "1px solid var(--color-divider)",
        borderRadius: "8px",
      }}
    >
      <div
        style={{
          height: totalHeight,
          position: "relative",
        }}
      >
        {virtualItems.map((virtualItem) => {
          const line = lines[virtualItem.index];

          return (
            <div
              key={virtualItem.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${virtualItem.start}px)`,
                height: LINE_HEIGHT,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {line}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const VirtualizedStackTrace = memo(VirtualizedStackTraceComponent);

// Export threshold for use in parent components
export { VIRTUALIZATION_THRESHOLD as STACK_TRACE_VIRTUALIZATION_THRESHOLD };
