/**
 * Filter Section Component - Ausklappbarer Filter-Bereich
 */
import { createPortal } from "preact/compat";
import type { RefObject } from "preact";
import { useI18n } from "../../utils/i18n";
import type { FilterState } from "../../hooks";

interface FilterSectionProps {
  expanded: boolean;
  stdFiltersEnabled: boolean;
  filter: FilterState;
  onlyMarked: boolean;
  markedCount: number;

  // History
  fltHistLogger: string[];
  fltHistThread: string[];
  fltHistMessage: string[];

  // Popover visibility
  showLoggerHist: boolean;
  showThreadHist: boolean;
  showMessageHist: boolean;

  // Popover positions
  loggerPos: { left: number; top: number; width: number } | null;
  threadPos: { left: number; top: number; width: number } | null;
  messagePos: { left: number; top: number; width: number } | null;

  // Refs
  loggerHistRef: RefObject<HTMLDivElement>;
  threadHistRef: RefObject<HTMLDivElement>;
  messageHistRef: RefObject<HTMLDivElement>;
  loggerPopRef: RefObject<HTMLDivElement>;
  threadPopRef: RefObject<HTMLDivElement>;
  messagePopRef: RefObject<HTMLDivElement>;

  // Callbacks
  onStdFiltersEnabledChange: (enabled: boolean) => void;
  onFilterChange: (filter: FilterState) => void;
  onOnlyMarkedChange: (onlyMarked: boolean) => void;
  onShowLoggerHistChange: (show: boolean) => void;
  onShowThreadHistChange: (show: boolean) => void;
  onShowMessageHistChange: (show: boolean) => void;
  addFilterHistory: (
    kind: "logger" | "thread" | "message",
    val: string,
  ) => void;
  onShowDcDialog: () => void;
  onShowTimeDialog: () => void;
  onClearAllFilters: () => void;

  // Busy state for elastic
  esBusy: boolean;
}

export function FilterSection({
  expanded,
  stdFiltersEnabled,
  filter,
  onlyMarked,
  markedCount,
  fltHistLogger,
  fltHistThread,
  fltHistMessage,
  showLoggerHist,
  showThreadHist,
  showMessageHist,
  loggerPos,
  threadPos,
  messagePos,
  loggerHistRef,
  threadHistRef,
  messageHistRef,
  loggerPopRef,
  threadPopRef,
  messagePopRef,
  onStdFiltersEnabledChange,
  onFilterChange,
  onOnlyMarkedChange,
  onShowLoggerHistChange,
  onShowThreadHistChange,
  onShowMessageHistChange,
  addFilterHistory,
  onShowDcDialog,
  onShowTimeDialog,
  onClearAllFilters,
  esBusy,
}: FilterSectionProps) {
  const { t } = useI18n();

  return (
    <div className={`filter-section ${expanded ? "expanded" : "collapsed"}`}>
      <div className="section" style={{ paddingTop: 0 }}>
        <label>
          <input
            type="checkbox"
            className="native-checkbox"
            checked={stdFiltersEnabled}
            onChange={(e) => onStdFiltersEnabledChange(e.currentTarget.checked)}
          />{" "}
          {t("toolbar.filterActive")}
        </label>

        <label>{t("toolbar.level")}</label>
        <select
          id="filterLevel"
          value={filter.level}
          onChange={(e) =>
            onFilterChange({ ...filter, level: e.currentTarget.value })
          }
          disabled={!stdFiltersEnabled}
        >
          <option value="">{t("toolbar.levelAll")}</option>
          {["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"].map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>

        <label>{t("toolbar.logger")}</label>
        <div
          ref={loggerHistRef as any}
          style={{
            display: "inline-flex",
            alignItems: "center",
            position: "relative",
          }}
        >
          <input
            id="filterLogger"
            type="text"
            value={filter.logger}
            onInput={(e) =>
              onFilterChange({ ...filter, logger: e.currentTarget.value })
            }
            onKeyDown={(e) => {
              if (e.key === "Enter")
                addFilterHistory("logger", e.currentTarget.value);
              if (e.key === "ArrowDown") onShowLoggerHistChange(true);
              if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                e.currentTarget.select();
              }
            }}
            onFocus={() => onShowLoggerHistChange(true)}
            onBlur={(e) => addFilterHistory("logger", e.currentTarget.value)}
            placeholder={t("toolbar.loggerPlaceholder")}
            disabled={!stdFiltersEnabled}
            style={{ minWidth: "150px" }}
          />
        </div>
        {showLoggerHist &&
          fltHistLogger.length > 0 &&
          loggerPos &&
          createPortal(
            <HistoryDropdown
              items={fltHistLogger}
              position={loggerPos}
              popRef={loggerPopRef}
              onSelect={(v) => {
                onFilterChange({ ...filter, logger: v });
                addFilterHistory("logger", v);
                onShowLoggerHistChange(false);
              }}
            />,
            document.body,
          )}

        <label>{t("toolbar.thread")}</label>
        <div
          ref={threadHistRef as any}
          style={{
            display: "inline-flex",
            alignItems: "center",
            position: "relative",
          }}
        >
          <input
            id="filterThread"
            type="text"
            value={filter.thread}
            onInput={(e) =>
              onFilterChange({ ...filter, thread: e.currentTarget.value })
            }
            onKeyDown={(e) => {
              if (e.key === "Enter")
                addFilterHistory("thread", e.currentTarget.value);
              if (e.key === "ArrowDown") onShowThreadHistChange(true);
              if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                e.currentTarget.select();
              }
            }}
            onFocus={() => onShowThreadHistChange(true)}
            onBlur={(e) => addFilterHistory("thread", e.currentTarget.value)}
            placeholder={t("toolbar.threadPlaceholder")}
            disabled={!stdFiltersEnabled}
            style={{ minWidth: "130px" }}
          />
        </div>
        {showThreadHist &&
          fltHistThread.length > 0 &&
          threadPos &&
          createPortal(
            <HistoryDropdown
              items={fltHistThread}
              position={threadPos}
              popRef={threadPopRef}
              onSelect={(v) => {
                onFilterChange({ ...filter, thread: v });
                addFilterHistory("thread", v);
                onShowThreadHistChange(false);
              }}
            />,
            document.body,
          )}

        <label>{t("toolbar.message")}</label>
        <div
          ref={messageHistRef as any}
          style={{
            display: "inline-flex",
            alignItems: "center",
            position: "relative",
          }}
        >
          <input
            id="filterMessage"
            type="text"
            value={filter.message}
            onInput={(e) =>
              onFilterChange({ ...filter, message: e.currentTarget.value })
            }
            onKeyDown={(e) => {
              if (e.key === "Enter")
                addFilterHistory("message", e.currentTarget.value);
              if (e.key === "ArrowDown") onShowMessageHistChange(true);
              if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                e.currentTarget.select();
              }
            }}
            onFocus={() => onShowMessageHistChange(true)}
            onBlur={(e) => addFilterHistory("message", e.currentTarget.value)}
            placeholder={t("toolbar.messagePlaceholder")}
            disabled={!stdFiltersEnabled}
            style={{ minWidth: "200px" }}
          />
        </div>
        {showMessageHist &&
          fltHistMessage.length > 0 &&
          messagePos &&
          createPortal(
            <HistoryDropdown
              items={fltHistMessage}
              position={messagePos}
              popRef={messagePopRef}
              onSelect={(v) => {
                onFilterChange({ ...filter, message: v });
                addFilterHistory("message", v);
                onShowMessageHistChange(false);
              }}
            />,
            document.body,
          )}

        <span className="filter-divider" />

        {/* Nur markierte Checkbox */}
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            cursor:
              markedCount === 0 && !onlyMarked ? "not-allowed" : "pointer",
            opacity: markedCount === 0 && !onlyMarked ? 0.5 : 1,
          }}
          title={
            !onlyMarked && markedCount === 0
              ? t("toolbar.toggleMarkedDisabled")
              : t("toolbar.toggleMarkedTooltip")
          }
        >
          <input
            type="checkbox"
            className="native-checkbox"
            checked={onlyMarked}
            disabled={!onlyMarked && markedCount === 0}
            onChange={(e) => onOnlyMarkedChange(e.currentTarget.checked)}
          />
          <span>{t("toolbar.toggleMarkedOff")}</span>
        </label>

        <span className="filter-divider" />

        <button onClick={onShowDcDialog} title={t("toolbar.dcFilterTooltip")}>
          {t("toolbar.dcFilter")}
        </button>

        <button
          disabled={esBusy}
          onClick={onShowTimeDialog}
          title={t("toolbar.elasticSearchTooltip")}
        >
          {t("toolbar.elasticSearch")}
        </button>

        <span className="filter-divider" />

        <button id="btnClearFilters" onClick={onClearAllFilters}>
          {t("toolbar.clearFilters")}
        </button>
      </div>
    </div>
  );
}

// Helper component for history dropdowns
interface HistoryDropdownProps {
  items: string[];
  position: { left: number; top: number; width: number };
  popRef: RefObject<HTMLDivElement>;
  onSelect: (value: string) => void;
}

function HistoryDropdown({
  items,
  position,
  popRef,
  onSelect,
}: HistoryDropdownProps) {
  return (
    <div
      ref={popRef as any}
      role="listbox"
      className="autocomplete-dropdown"
      style={{
        position: "fixed",
        left: position.left + "px",
        top: position.top + "px",
        width: Math.max(position.width, 250) + "px",
      }}
    >
      {items.map((v, i) => (
        <div
          key={i}
          className="autocomplete-item"
          onClick={() => onSelect(v)}
          onMouseDown={(e) => e.preventDefault()}
          title={v}
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
    </div>
  );
}
