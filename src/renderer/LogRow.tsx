// Enhanced log row component with memoization and optimizations
import { memo, useMemo } from "preact/compat";
import type { JSX } from "preact/jsx-runtime";
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

// Cache for highlighted messages to avoid repeated regex operations
const highlightCache = new Map<string, string>();
const MAX_CACHE_SIZE = 500;
let lastSearchTerm = "";

// Clear cache when search term changes significantly
export function clearHighlightCache(): void {
  highlightCache.clear();
  lastSearchTerm = "";
}

function getCachedHighlight(
  text: string,
  search: string,
  highlightFn: (text: string, search: string) => string,
): string {
  // If search term changed, consider clearing old entries
  if (search !== lastSearchTerm) {
    // Only clear if the new search is not a prefix of the old one
    // This allows incremental typing to benefit from cache
    if (
      !search.startsWith(lastSearchTerm) &&
      !lastSearchTerm.startsWith(search)
    ) {
      highlightCache.clear();
    }
    lastSearchTerm = search;
  }

  if (!search.trim()) return highlightFn(text, search);

  const cacheKey = `${text}|${search}`;
  const cached = highlightCache.get(cacheKey);
  if (cached !== undefined) return cached;

  // Evict oldest entries if cache is too large
  if (highlightCache.size >= MAX_CACHE_SIZE) {
    // Delete the first 50 entries to avoid repeated evictions
    const keysToDelete = Array.from(highlightCache.keys()).slice(0, 50);
    for (const key of keysToDelete) {
      highlightCache.delete(key);
    }
  }

  const result = highlightFn(text, search);
  highlightCache.set(cacheKey, result);
  return result;
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
      background: markColor ? computeTint(markColor, 0.12) : undefined,
    }),
    [yOffset, rowHeight, markColor],
  );

  // Memoize the message text
  const messageText = getStr(entry, "message");

  // Use cached highlight for better performance
  const highlightedMessage = useMemo(
    () => getCachedHighlight(messageText, search, highlightFn),
    [messageText, search, highlightFn],
  );

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
      title={messageText}
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
    // Only re-render if the actual entry object changed
    prevProps.entry === nextProps.entry
  );
});
