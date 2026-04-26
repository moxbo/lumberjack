import type { JSX } from "preact/jsx-runtime";

export interface BookmarkItem {
  vi: number;
  color: string;
  timestamp: string;
  message: string;
}

interface Props {
  bookmarks: BookmarkItem[];
  onSelect: (vi: number) => void;
  emptyLabel: string;
  ariaLabel?: string;
}

export function BookmarksPopover(props: Props): JSX.Element {
  const items = props.bookmarks;
  const label = props.ariaLabel || "Lesezeichen";
  if (items.length === 0) {
    return (
      <div className="bookmarks-popover" role="dialog" aria-label={label}>
        <div className="bookmarks-popover-empty">{props.emptyLabel}</div>
      </div>
    );
  }
  return (
    <div className="bookmarks-popover" role="dialog" aria-label={label}>
      <ul className="bookmarks-list">
        {items.map((b) => (
          <li key={b.vi}>
            <button
              type="button"
              className="bookmarks-item"
              onClick={() => props.onSelect(b.vi)}
              title={b.message}
            >
              <span
                className="bookmarks-item-color"
                style={{ background: b.color }}
                aria-hidden="true"
              />
              <span className="bookmarks-item-time">{b.timestamp}</span>
              <span className="bookmarks-item-msg">{b.message}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
