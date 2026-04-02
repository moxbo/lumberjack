/**
 * Virtualisierte MDC-Liste für das Detail-Panel.
 * Wird verwendet, wenn es viele MDC-Einträge gibt (> 20).
 */
import { memo, useRef } from "preact/compat";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { JSX } from "preact/jsx-runtime";
import { useI18n } from "../utils/i18n";

interface MDCPair {
  key: string;
  value: string;
}

interface VirtualizedMDCListProps {
  pairs: MDCPair[];
  onAddToFilter: (key: string, value: string) => void;
  maxHeight?: number;
}

// Threshold for switching to virtualized list
const VIRTUALIZATION_THRESHOLD = 20;
const ROW_HEIGHT = 32;

const MDCRowComponent = ({
  pair,
  onAddToFilter,
  style,
  t,
}: {
  pair: MDCPair;
  onAddToFilter: (key: string, value: string) => void;
  style: JSX.CSSProperties;
  t: (key: string) => string;
}): JSX.Element => {
  return (
    <div className="mdc-grid-row" style={style}>
      <span className="mdc-key" title={pair.key}>
        {pair.key}
      </span>
      <span className="mdc-val">
        <code title={pair.value}>{pair.value || t("details.emptyValue")}</code>
      </span>
      <span className="mdc-act">
        <button
          type="button"
          onClick={() => onAddToFilter(pair.key, pair.value)}
          title={t("details.addToFilter")}
          style={{ padding: "2px 6px", fontSize: "11px" }}
        >
          {t("details.addFilterButton")}
        </button>
      </span>
    </div>
  );
};

const MDCRow = memo(MDCRowComponent);

const VirtualizedMDCListComponent = ({
  pairs,
  onAddToFilter,
  maxHeight = 300,
}: VirtualizedMDCListProps): JSX.Element => {
  const { t } = useI18n();
  const parentRef = useRef<HTMLDivElement>(null);

  // Use virtualization only for large lists
  const useVirtualization = pairs.length > VIRTUALIZATION_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: pairs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();

  // For small lists, render directly
  if (!useVirtualization) {
    return (
      <div className="mdc-grid">
        {pairs.map((pair, index) => (
          <div key={`${pair.key}-${index}`} className="mdc-grid-row-inline">
            <span className="mdc-key" title={pair.key}>
              {pair.key}
            </span>
            <span className="mdc-val">
              <code title={pair.value}>
                {pair.value || t("details.emptyValue")}
              </code>
            </span>
            <span className="mdc-act">
              <button
                type="button"
                onClick={() => onAddToFilter(pair.key, pair.value)}
                title={t("details.addToFilter")}
                style={{ padding: "2px 6px", fontSize: "11px" }}
              >
                {t("details.addFilterButton")}
              </button>
            </span>
          </div>
        ))}
      </div>
    );
  }

  // For large lists, use virtualization
  return (
    <div
      ref={parentRef}
      className="mdc-virtual-container"
      style={{
        height: Math.min(maxHeight, totalHeight),
        overflow: "auto",
        overscrollBehavior: "contain",
      }}
    >
      <div
        style={{
          height: totalHeight,
          position: "relative",
        }}
      >
        {virtualItems.map((virtualItem) => {
          const pair = pairs[virtualItem.index];
          if (!pair) return null;

          return (
            <MDCRow
              key={virtualItem.key}
              pair={pair}
              onAddToFilter={onAddToFilter}
              t={t}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${virtualItem.start}px)`,
                height: ROW_HEIGHT,
                display: "grid",
                gridTemplateColumns: "140px 1fr auto",
                gap: "6px 12px",
                alignItems: "center",
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

export const VirtualizedMDCList = memo(VirtualizedMDCListComponent);

// Export threshold for use in parent components
export { VIRTUALIZATION_THRESHOLD };
