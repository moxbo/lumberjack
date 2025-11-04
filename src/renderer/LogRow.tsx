// Enhanced log row component with memoization and optimizations
import { memo } from "preact/compat";
import type { JSX } from "preact/jsx-runtime";
import {
  computeTint,
  fmtTimestamp,
  getStr,
  getTs,
  levelClass,
  renderLoggerNameList,
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
  highlightFn,
  compact = false,
}: LogRowProps): JSX.Element => {
  const rowCls = "row" + (isSelected ? " sel" : "");
  const style = {
    position: "absolute" as const,
    top: 0,
    left: 0,
    right: 0,
    transform: `translateY(${yOffset}px)`,
    height: `${rowHeight}px`,
    borderLeft: `4px solid ${markColor || "transparent"}`,
    background: markColor ? computeTint(markColor, 0.12) : undefined,
    // Enable content-visibility for better performance
    contentVisibility: "auto" as const,
  };

  return (
    <div
      key={`row-${index}-${globalIdx}`}
      className={rowCls}
      style={style}
      role="option"
      aria-selected={isSelected}
      onClick={(ev) => {
        const mouseEvent = ev as MouseEvent;
        onSelect(
          globalIdx,
          mouseEvent.shiftKey,
          mouseEvent.ctrlKey || mouseEvent.metaKey,
        );
      }}
      onContextMenu={(ev) => onContextMenu(ev as MouseEvent, globalIdx)}
      title={getStr(entry, "message")}
      data-marked={markColor ? "1" : "0"}
    >
      <div className="col ts">{fmtTimestamp(getTs(entry, "timestamp"))}</div>
      <div className="col lvl">
        <span className={levelClass(getStr(entry, "level"))}>
          {getStr(entry, "level")}
        </span>
      </div>
      {!compact && (
        <div className="col logger">
          {renderLoggerNameList(getStr(entry, "logger"))}
        </div>
      )}
      <div
        className="col msg"
        dangerouslySetInnerHTML={{
          __html: highlightFn(getStr(entry, "message"), search),
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
    // Only re-render if the actual entry object changed
    prevProps.entry === nextProps.entry
  );
});
