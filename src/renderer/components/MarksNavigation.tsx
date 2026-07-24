import { memo } from "preact/compat";
import type { BookmarkItem } from "./BookmarksPopover";
import { BookmarksPopover } from "./BookmarksPopover";

interface MarksNavigationProps {
  countFiltered: number;
  markedCount: number;
  bookmarkItems: BookmarkItem[];
  showBookmarks: boolean;
  onGotoStart: () => void;
  onGotoEnd: () => void;
  onGotoMarked: (direction: number) => void;
  onToggleBookmarks: () => void;
  onSelectBookmark: (visualIndex: number) => void;
  t: (key: string, params?: Record<string, string>) => string;
}

function MarksNavigationComponent({
  countFiltered,
  markedCount,
  bookmarkItems,
  showBookmarks,
  onGotoStart,
  onGotoEnd,
  onGotoMarked,
  onToggleBookmarks,
  onSelectBookmark,
  t,
}: MarksNavigationProps) {
  return (
    <div className="section" style={{ gap: "4px" }}>
      <div className="btn-group" title={t("toolbar.navigation")}>
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
      <div className="btn-group" title={t("toolbar.marks")}>
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
          <div style={{ position: "relative", display: "inline-flex" }}>
            <button
              type="button"
              className="badge-count"
              onClick={onToggleBookmarks}
              aria-haspopup="dialog"
              aria-expanded={showBookmarks}
              title={t("toolbar.marksCount", {
                count: String(markedCount),
              })}
            >
              {markedCount}
            </button>
            {showBookmarks && (
              <BookmarksPopover
                bookmarks={bookmarkItems}
                onSelect={onSelectBookmark}
                emptyLabel={t("toolbar.noBookmarks") || "Keine Lesezeichen"}
                ariaLabel={t("toolbar.marks") || "Lesezeichen"}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export const MarksNavigation = memo(MarksNavigationComponent);
