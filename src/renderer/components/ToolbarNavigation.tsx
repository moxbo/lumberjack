/**
 * ToolbarNavigation Component
 * Go-to-start/end and previous/next mark navigation buttons
 */

interface ToolbarNavigationProps {
  countFiltered: number;
  markedCount: number;
  onGotoStart: () => void;
  onGotoEnd: () => void;
  onGotoMarked: (direction: -1 | 1) => void;
  t: (key: string, params?: Record<string, string>) => string;
}

export function ToolbarNavigation({
  countFiltered,
  markedCount,
  onGotoStart,
  onGotoEnd,
  onGotoMarked,
  t,
}: ToolbarNavigationProps) {
  return (
    <div className="section" style={{ gap: "4px" }}>
      <div className="btn-group" title="Navigation">
        <button
          className="btn-icon"
          title={t("toolbar.gotoStartTooltip")}
          onClick={onGotoStart}
          disabled={countFiltered === 0}
        >
          ⏫
        </button>
        <button
          className="btn-icon"
          title={t("toolbar.gotoEndTooltip")}
          onClick={onGotoEnd}
          disabled={countFiltered === 0}
        >
          ⏬
        </button>
      </div>
      <div className="btn-group" title="Markierungen">
        <button
          className="btn-icon"
          title={t("toolbar.prevMarkTooltip")}
          onClick={() => onGotoMarked(-1)}
          disabled={markedCount === 0}
        >
          🔺
        </button>
        <button
          className="btn-icon"
          title={t("toolbar.nextMarkTooltip")}
          onClick={() => onGotoMarked(1)}
          disabled={markedCount === 0}
        >
          🔻
        </button>
        {markedCount > 0 && (
          <span className="badge-count" title={`${markedCount} Markierungen`}>
            {markedCount}
          </span>
        )}
      </div>
    </div>
  );
}
