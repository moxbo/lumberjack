// Enhanced log row component with memoization and optimizations
import { memo } from 'preact/compat';

interface LogRowProps {
  index: number;
  globalIdx: number;
  entry: any;
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

function levelClass(level: string | null | undefined): string {
  const l = (level || '').toUpperCase();
  return (
    {
      TRACE: 'lev-trace',
      DEBUG: 'lev-debug',
      INFO: 'lev-info',
      WARN: 'lev-warn',
      ERROR: 'lev-error',
      FATAL: 'lev-fatal',
    }[l] || 'lev-unk'
  );
}

function fmt(v: unknown): string {
  return v == null ? '' : String(v);
}

function fmtTimestamp(ts: string | number | Date | null | undefined): string {
  if (!ts) return '-';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
  } catch (e) {
    return String(ts);
  }
}

function computeTint(color: string | null | undefined, alpha = 0.4): string {
  if (!color) return '';
  const c = String(color).trim();
  const hexRaw = c.startsWith('#') ? c.slice(1) : '';
  const hex = String(hexRaw);
  if (hex.length === 3) {
    const [h0, h1, h2] = hex as unknown as [string, string, string];
    const r = parseInt(h0 + h0, 16);
    const g = parseInt(h1 + h1, 16);
    const b = parseInt(h2 + h2, 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (hex.length === 6) {
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return c;
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
  t,
  compact = false,
}: LogRowProps) => {
  const rowCls = 'row' + (isSelected ? ' sel' : '');
  const style = {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    transform: `translateY(${yOffset}px)`,
    height: `${rowHeight}px`,
    borderLeft: `4px solid ${markColor || 'transparent'}`,
    background: markColor ? computeTint(markColor, 0.12) : undefined,
    // Enable content-visibility for better performance
    contentVisibility: 'auto' as const,
  };

  return (
    <div
      key={`row-${index}-${globalIdx}`}
      className={rowCls}
      style={style}
      role="option"
      aria-selected={isSelected}
      onClick={(ev) => {
        onSelect(
          globalIdx,
          (ev as any).shiftKey,
          (ev as any).ctrlKey || (ev as any).metaKey
        );
      }}
      onContextMenu={(ev) => onContextMenu(ev as any, globalIdx)}
      title={String(entry.message || '')}
      data-marked={markColor ? '1' : '0'}
    >
      <div className="col ts">{fmtTimestamp(entry.timestamp)}</div>
      <div className="col lvl">
        <span className={levelClass(entry.level)}>{fmt(entry.level)}</span>
      </div>
      {!compact && <div className="col logger">{fmt(entry.logger)}</div>}
      <div
        className="col msg"
        dangerouslySetInnerHTML={{ __html: highlightFn(entry.message, search) }}
      />
    </div>
  );
};

// Memoize the component to avoid re-renders when props don't change
export const LogRow = memo(
  LogRowComponent,
  (prevProps, nextProps) => {
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
  }
);
