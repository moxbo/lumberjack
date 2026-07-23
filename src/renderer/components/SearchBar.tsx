/**
 * SearchBar Component
 *
 * Encapsulates the search input, search history autocomplete dropdown,
 * search mode toggle (case-insensitive, case-sensitive, regex),
 * and prev/next match navigation buttons.
 */
import { createPortal } from "preact/compat";
import { useRef, useState } from "preact/hooks";
import type { RefObject } from "preact";
import type { JSX } from "preact/jsx-runtime";
import { useI18n } from "../../utils/i18n";

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
  // Called when the user submits the search (Enter) to apply it immediately
  // (skips the type-to-search debounce delay). An optional value can be passed
  // to apply a specific value right away (e.g. when picking a history entry).
  onSubmitSearch?: (value?: string) => void;
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
  onSubmitSearch,
  t,
}: SearchBarProps): JSX.Element {
  const [showSyntaxHelp, setShowSyntaxHelp] = useState(false);
  const syntaxHelpBtnRef = useRef<HTMLButtonElement | null>(null);
  return (
    <div className="section">
      <div className="search-wrapper" style={{ position: "relative" }}>
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
                  onSubmitSearch?.(selectedItem);
                }
              } else {
                addFilterHistory(
                  "search",
                  (e.currentTarget as any).value as string,
                );
                onSubmitSearch?.((e.currentTarget as any).value as string);
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
          style={{ paddingRight: "26px" }}
        />
        <button
          type="button"
          ref={syntaxHelpBtnRef as any}
          className="search-syntax-help-btn"
          aria-label={t("searchHelp.buttonTooltip")}
          title={t("searchHelp.buttonTooltip")}
          aria-expanded={showSyntaxHelp}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setShowSyntaxHelp((v) => !v)}
          onBlur={() => setTimeout(() => setShowSyntaxHelp(false), 200)}
          style={{
            position: "absolute",
            right: "4px",
            top: "50%",
            transform: "translateY(-50%)",
            background: "var(--color-bg-hover, rgba(127,127,127,0.15))",
            border: "1px solid var(--color-border, rgba(127,127,127,0.25))",
            cursor: "help",
            color: "var(--color-text-secondary)",
            fontSize: "12px",
            fontWeight: 700,
            width: "20px",
            height: "20px",
            padding: 0,
            borderRadius: "50%",
            lineHeight: "18px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1,
          }}
        >
          ?
        </button>
        {showSyntaxHelp &&
          (() => {
            const rect = syntaxHelpBtnRef.current?.getBoundingClientRect();
            const top = rect ? rect.bottom + 6 : 60;
            const right = rect
              ? Math.max(8, window.innerWidth - rect.right)
              : 16;
            return createPortal(
              <div
                role="dialog"
                aria-label={t("searchHelp.title")}
                className="search-syntax-popover"
                style={{
                  position: "fixed",
                  top: top + "px",
                  right: right + "px",
                  minWidth: "280px",
                  maxWidth: "360px",
                  padding: "10px 12px",
                  background: "var(--color-bg-paper)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "6px",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.28)",
                  zIndex: 999999,
                  fontSize: "12px",
                  lineHeight: 1.7,
                  color: "var(--color-text-primary)",
                }}
                onMouseDown={(e) => e.preventDefault()}
              >
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  {t("searchHelp.title")}
                </div>
                <div>
                  <code>{t("searchHelp.phrase")}</code>
                </div>
                <div>
                  <code>{t("searchHelp.and")}</code>
                </div>
                <div>
                  <code>{t("searchHelp.or")}</code>
                </div>
                <div>
                  <code>{t("searchHelp.not")}</code>
                </div>
                <div>
                  <code>{t("searchHelp.group")}</code>
                </div>
                <div>
                  <code>{t("searchHelp.escape")}</code>
                </div>
                <div
                  style={{
                    marginTop: 6,
                    paddingTop: 6,
                    borderTop: "1px solid var(--color-divider)",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  <kbd>F1</kbd> {t("searchHelp.moreHelp")}
                </div>
              </div>,
              document.body,
            );
          })()}
      </div>
      {/* Search mode button with dropdown */}
      <div style={{ position: "relative" }} id="searchModeBtn">
        <button
          onClick={() => {
            setShowSearchOptions(!showSearchOptions);
          }}
          title={t("searchMode.title")}
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
                  onSubmitSearch?.(v);
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
                <kbd>↑↓</kbd> {t("autocomplete.navigate")}
              </span>
              <span>
                <kbd>Enter</kbd> {t("autocomplete.select")}
              </span>
              <span>
                <kbd>Esc</kbd> {t("autocomplete.close")}
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

  // Note: SearchModePortal doesn't have access to useI18n since it's a simple function component
  // rendered via portal. We use the translation keys from the parent via a workaround.
  // For simplicity, we'll use the context directly.
  const { t } = useI18n();

  const modes: Array<{
    key: "insensitive" | "sensitive" | "regex";
    label: string;
    sub: string;
  }> = [
    {
      key: "insensitive",
      label: t("searchMode.caseInsensitive"),
      sub: t("searchMode.caseInsensitiveDesc"),
    },
    {
      key: "sensitive",
      label: t("searchMode.caseSensitive"),
      sub: t("searchMode.caseSensitiveDesc"),
    },
    {
      key: "regex",
      label: t("searchMode.regex"),
      sub: t("searchMode.regexDesc"),
    },
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
