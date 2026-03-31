/**
 * SearchBar Component
 *
 * Encapsulates the search input, search history autocomplete dropdown,
 * search mode toggle (case-insensitive, case-sensitive, regex),
 * and prev/next match navigation buttons.
 */
import { createPortal } from "preact/compat";
import type { RefObject } from "preact";
import type { JSX } from "preact/jsx-runtime";

export interface SearchBarProps {
  search: string;
  setSearch: (v: string) => void;
  searchMode: "insensitive" | "sensitive" | "regex";
  setSearchMode: (v: "insensitive" | "sensitive" | "regex") => void;
  showSearchOptions: boolean;
  setShowSearchOptions: (v: boolean) => void;
  // Search history
  fltHistSearch: string[];
  showSearchHist: boolean;
  setShowSearchHist: (v: boolean) => void;
  searchHistHighlightIdx: number;
  setSearchHistHighlightIdx: (v: number) => void;
  searchPos: { left: number; top: number; width: number } | null;
  searchHistRef: RefObject<HTMLDivElement>;
  searchPopRef: RefObject<HTMLDivElement>;
  searchInputRef: RefObject<HTMLInputElement>;
  // Close other history popovers
  setShowLoggerHist: (v: boolean) => void;
  setShowThreadHist: (v: boolean) => void;
  setShowMessageHist: (v: boolean) => void;
  // Filter history
  addFilterHistory: (
    kind: "search" | "logger" | "thread" | "message",
    value: string,
  ) => void;
  // Search match navigation
  searchMatchIdx: number[];
  selectedOneIdx: number | null;
  filteredIdx: number[];
  gotoSearchMatch: (dir: number) => void;
  // i18n
  t: (key: string, params?: Record<string, string>) => string;
}

export function SearchBar({
  search,
  setSearch,
  searchMode,
  setSearchMode,
  showSearchOptions,
  setShowSearchOptions,
  fltHistSearch,
  showSearchHist,
  setShowSearchHist,
  searchHistHighlightIdx,
  setSearchHistHighlightIdx,
  searchPos,
  searchHistRef,
  searchPopRef,
  searchInputRef,
  setShowLoggerHist,
  setShowThreadHist,
  setShowMessageHist,
  addFilterHistory,
  searchMatchIdx,
  selectedOneIdx,
  filteredIdx,
  gotoSearchMatch,
  t,
}: SearchBarProps): JSX.Element {
  return (
    <div className="section">
      <div className="search-wrapper">
        <input
          id="searchText"
          ref={searchInputRef as any}
          type="search"
          value={search}
          onInput={(e) => setSearch(e.currentTarget.value)}
          onKeyDown={(e) => {
            const key = (e as any).key;
            // Handle Enter: select highlighted item or go to next match
            if (key === "Enter") {
              if (
                showSearchHist &&
                searchHistHighlightIdx >= 0 &&
                searchHistHighlightIdx < fltHistSearch.length
              ) {
                e.preventDefault();
                const selectedItem = fltHistSearch[searchHistHighlightIdx];
                if (selectedItem !== undefined) {
                  setSearch(selectedItem);
                  addFilterHistory("search", selectedItem);
                  setShowSearchHist(false);
                  setSearchHistHighlightIdx(-1);
                }
              } else {
                addFilterHistory(
                  "search",
                  (e.currentTarget as any).value as string,
                );
                gotoSearchMatch(1);
              }
              return;
            }
            // Arrow navigation when dropdown is open
            if (key === "ArrowDown") {
              if (showSearchHist && fltHistSearch.length > 0) {
                e.preventDefault();
                setSearchHistHighlightIdx(
                  Math.min(
                    searchHistHighlightIdx + 1,
                    fltHistSearch.length - 1,
                  ),
                );
              } else {
                setShowSearchHist(true);
                setSearchHistHighlightIdx(-1);
              }
              return;
            }
            if (key === "ArrowUp" && showSearchHist) {
              e.preventDefault();
              setSearchHistHighlightIdx(
                Math.max(searchHistHighlightIdx - 1, 0),
              );
              return;
            }
            if (key === "Escape" && showSearchHist) {
              e.preventDefault();
              setShowSearchHist(false);
              setSearchHistHighlightIdx(-1);
              return;
            }
            if (key === "Home" && showSearchHist) {
              e.preventDefault();
              setSearchHistHighlightIdx(0);
              return;
            }
            if (key === "End" && showSearchHist) {
              e.preventDefault();
              setSearchHistHighlightIdx(fltHistSearch.length - 1);
              return;
            }
            const keyLower = key?.toLowerCase?.() || "";
            if (
              keyLower === "a" &&
              ((e as any).ctrlKey || (e as any).metaKey)
            ) {
              e.preventDefault();
              try {
                (e.currentTarget as HTMLInputElement).select();
              } catch {}
            }
          }}
          onFocus={() => {
            setShowLoggerHist(false);
            setShowThreadHist(false);
            setShowMessageHist(false);
            setShowSearchHist(true);
            setSearchHistHighlightIdx(-1);
          }}
          onBlur={(e) => addFilterHistory("search", e.currentTarget.value)}
          placeholder={t("toolbar.searchPlaceholder")}
          autocomplete="off"
        />
      </div>
      {/* Search mode button with dropdown */}
      <div style={{ position: "relative" }} id="searchModeBtn">
        <button
          onClick={() => {
            setShowSearchOptions(!showSearchOptions);
          }}
          title="Suchmodus"
          style={{
            padding: "6px 10px",
            minWidth: "unset",
            background:
              searchMode !== "insensitive"
                ? "var(--accent-gradient)"
                : undefined,
            color: searchMode !== "insensitive" ? "white" : undefined,
            borderColor:
              searchMode !== "insensitive" ? "transparent" : undefined,
          }}
        >
          {searchMode === "insensitive" && "Aa ▾"}
          {searchMode === "sensitive" && "Aa ▾"}
          {searchMode === "regex" && ".* ▾"}
        </button>
        {showSearchOptions &&
          createPortal(
            <SearchModePortal
              searchMode={searchMode}
              onSelect={(mode) => {
                setSearchMode(mode);
                setShowSearchOptions(false);
              }}
            />,
            document.body,
          )}
      </div>
      {/* Hidden ref element for positioning */}
      <div
        ref={searchHistRef as any}
        style={{
          display: "none",
          position: "relative",
        }}
      />
      {/* Search history autocomplete dropdown */}
      {showSearchHist &&
        fltHistSearch.length > 0 &&
        searchPos &&
        createPortal(
          <div
            ref={searchPopRef as any}
            role="listbox"
            className="autocomplete-dropdown"
            style={{
              position: "fixed",
              left: searchPos.left + "px",
              top: searchPos.top + "px",
              width: Math.max(searchPos.width, 300) + "px",
            }}
          >
            {fltHistSearch.map((v, i) => (
              <div
                key={i}
                className={`autocomplete-item ${searchHistHighlightIdx === i ? "highlighted" : ""}`}
                onClick={() => {
                  setSearch(v);
                  addFilterHistory("search", v);
                  setShowSearchHist(false);
                  setSearchHistHighlightIdx(-1);
                }}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setSearchHistHighlightIdx(i)}
                title={v}
                role="option"
                aria-selected={searchHistHighlightIdx === i}
              >
                <span>🕐</span>
                {v}
              </div>
            ))}
            <div className="autocomplete-hint">
              <span>
                <kbd>↑↓</kbd> Navigation
              </span>
              <span>
                <kbd>Enter</kbd> Auswählen
              </span>
              <span>
                <kbd>Esc</kbd> Schließen
              </span>
            </div>
          </div>,
          document.body,
        )}
      {/* Prev / Next match buttons */}
      <button
        id="btnPrevMatch"
        title={`${t("toolbar.prevMatch")} (Shift+N)`}
        disabled={!search.trim() || searchMatchIdx.length === 0}
        onClick={() => gotoSearchMatch(-1)}
      >
        ▲
      </button>
      <span
        style={{
          fontSize: "11px",
          color: "var(--color-text-secondary)",
          minWidth: "50px",
          textAlign: "center",
        }}
      >
        {search.trim() && searchMatchIdx.length > 0
          ? (() => {
              const curVi =
                selectedOneIdx != null
                  ? filteredIdx.indexOf(selectedOneIdx)
                  : -1;
              const currentMatchPos =
                curVi >= 0 ? searchMatchIdx.indexOf(curVi) : -1;
              if (currentMatchPos >= 0) {
                return `${currentMatchPos + 1}/${searchMatchIdx.length}`;
              }
              return `–/${searchMatchIdx.length}`;
            })()
          : ""}
      </span>
      <button
        id="btnNextMatch"
        title={`${t("toolbar.nextMatch")} (N)`}
        disabled={!search.trim() || searchMatchIdx.length === 0}
        onClick={() => gotoSearchMatch(1)}
      >
        ▼
      </button>
    </div>
  );
}

/** Internal: Search mode dropdown portal content */
function SearchModePortal({
  searchMode,
  onSelect,
}: {
  searchMode: "insensitive" | "sensitive" | "regex";
  onSelect: (mode: "insensitive" | "sensitive" | "regex") => void;
}): JSX.Element {
  const btn = document.getElementById("searchModeBtn");
  const rect = btn?.getBoundingClientRect();
  const top = rect ? rect.bottom + 4 + "px" : "60px";
  const left = rect ? Math.max(0, rect.right - 180) + "px" : "auto";

  const modes: Array<{
    key: "insensitive" | "sensitive" | "regex";
    label: string;
    sub: string;
  }> = [
    { key: "insensitive", label: "Aa ignorieren", sub: "Case-insensitiv" },
    { key: "sensitive", label: "Aa beachten", sub: "Case-sensitiv" },
    { key: "regex", label: "Regex", sub: "Regulärer Ausdruck" },
  ];

  return (
    <div
      style={{
        position: "fixed",
        top,
        left,
        background: "var(--color-bg-paper)",
        border: "1px solid var(--color-border)",
        borderRadius: "8px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
        zIndex: 999999,
        minWidth: "180px",
        overflow: "hidden",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {modes.map((m) => (
        <div
          key={m.key}
          style={{
            padding: "8px 12px",
            cursor: "pointer",
            background:
              searchMode === m.key ? "var(--color-bg-hover)" : undefined,
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
          onClick={() => onSelect(m.key)}
        >
          <span style={{ width: "20px" }}>
            {searchMode === m.key ? "✓" : ""}
          </span>
          <div>
            <div style={{ fontWeight: "500" }}>{m.label}</div>
            <div
              style={{
                fontSize: "11px",
                color: "var(--color-text-secondary)",
              }}
            >
              {m.sub}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
