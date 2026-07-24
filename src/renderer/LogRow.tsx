// Enhanced log row component with memoization and optimizations
import { memo, useMemo } from "preact/compat";
import type { JSX } from "preact/jsx-runtime";
import {
  clearHighlightCaches,
  useHighlightedHtml,
} from "../hooks/useHighlightedHtml";
import {
  computeTint,
  fmtTimestamp,
  getStr,
  getTs,
  levelClass,
} from "../utils/format";

interface LogRowProps {
  index: number;
  globalIdx: number;
  entry: Record<string, unknown>;
  isSelected: boolean;
  rowHeight: number;
  yOffset: number;
  markColor?: string;
  search: string;
  onSelect: (globalIdx: number, shift: boolean, meta: boolean) => void;
  onContextMenu: (ev: MouseEvent, globalIdx: number) => void;
  highlightFn: (text: string, search: string) => string;
  t: (key: string) => string;
  compact?: boolean;
}

export function clearHighlightCache(): void {
  clearHighlightCaches();
}

const LogRowComponent = ({
  index,
  globalIdx,
  entry,
  isSelected,
  rowHeight,
  yOffset,
  markColor,
  search,
  onSelect,
  onContextMenu,
  compact = false,
}: LogRowProps): JSX.Element => {
  const rowCls = "row" + (isSelected ? " sel" : "");

  // Memoize style object to avoid recreation on every render
  const style = useMemo(
    () => ({
      position: "absolute" as const,
      top: 0,
      left: 0,
      right: 0,
      transform: `translateY(${yOffset}px)`,
      height: `${rowHeight}px`,
      borderLeft: `4px solid ${markColor || "transparent"}`,
      // Wenn die Zeile ausgewählt ist, soll die Auswahl-Hintergrundfarbe
      // (aus .row.sel) sichtbar bleiben. Daher hier keinen Inline-Hintergrund
      // für markierte Zeilen setzen – die Markierung bleibt durch den
      // farbigen linken Rand erkennbar.
      background:
        markColor && !isSelected ? computeTint(markColor, 0.12) : undefined,
    }),
    [yOffset, rowHeight, markColor, isSelected],
  );

  // Memoize the message text
  const messageText = getStr(entry, "message");

  // Use cached highlight for better performance
  const highlightedMessage = useHighlightedHtml(messageText, search);

  return (
    <div
      key={`row-${index}-${globalIdx}`}
      className={rowCls}
      style={style}
      role="option"
      aria-selected={isSelected}
      data-vi={index}
      onClick={(ev) => {
        const mouseEvent = ev as MouseEvent;
        onSelect(
          globalIdx,
          mouseEvent.shiftKey,
          mouseEvent.ctrlKey || mouseEvent.metaKey,
        );
      }}
      onContextMenu={(ev) => onContextMenu(ev as MouseEvent, globalIdx)}
      data-marked={markColor ? "1" : "0"}
    >
      <div className="col ts">{fmtTimestamp(getTs(entry, "timestamp"))}</div>
      <div className="col lvl">
        <span className={levelClass(entry.level as string | null | undefined)}>
          {entry.level ? String(entry.level) : ""}
        </span>
      </div>
      {!compact && <div className="col logger">{getStr(entry, "logger")}</div>}
      <div
        className="col msg"
        dangerouslySetInnerHTML={{
          __html: highlightedMessage,
        }}
      />
    </div>
  );
};

// Memoize the component to avoid re-renders when props don't change
export const LogRow = memo(LogRowComponent, (prevProps, nextProps) => {
  // Custom comparison to optimize re-renders
  return (
    prevProps.globalIdx === nextProps.globalIdx &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.search === nextProps.search &&
    prevProps.markColor === nextProps.markColor &&
    prevProps.yOffset === nextProps.yOffset &&
    prevProps.compact === nextProps.compact &&
    // Compare highlightFn reference to catch highlight function changes
    prevProps.highlightFn === nextProps.highlightFn &&
    // Only re-render if the actual entry object changed
    prevProps.entry === nextProps.entry
  );
});
