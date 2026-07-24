/**
 * ToolbarCounts Component
 * Displays total, filtered, selected counts and clear button
 */
import type { FilterStats } from "../../types/renderer";
import { memo } from "preact/compat";

export interface ToolbarCountsProps {
  countTotal: number;
  countFiltered: number;
  countSelected: number;
  lastFilterStats: FilterStats | null;
  entriesLength: number;
  onClearLogs: () => void;
  t: (key: string, params?: Record<string, string>) => string;
}

function ToolbarCountsComponent({
  countTotal,
  countFiltered,
  countSelected,
  lastFilterStats,
  entriesLength,
  onClearLogs,
  t,
}: ToolbarCountsProps) {
  const hasFiltered = lastFilterStats && countTotal > countFiltered;
  const filterTooltip = hasFiltered
    ? t("filterStats.filtered", { count: String(countTotal - countFiltered) }) +
      "\n" +
      (lastFilterStats.rejectedByLevel > 0
        ? `• ${t("filterStats.byLevel", { count: String(lastFilterStats.rejectedByLevel) })}\n`
        : "") +
      (lastFilterStats.rejectedByLogger > 0
        ? `• ${t("filterStats.byLogger", { count: String(lastFilterStats.rejectedByLogger) })}\n`
        : "") +
      (lastFilterStats.rejectedByThread > 0
        ? `• ${t("filterStats.byThread", { count: String(lastFilterStats.rejectedByThread) })}\n`
        : "") +
      (lastFilterStats.rejectedByMessage > 0
        ? `• ${t("filterStats.byMessage", { count: String(lastFilterStats.rejectedByMessage) })}\n`
        : "") +
      (lastFilterStats.rejectedByTime > 0
        ? `• ${t("filterStats.byTime", { count: String(lastFilterStats.rejectedByTime) })}\n`
        : "") +
      (lastFilterStats.rejectedByDC > 0
        ? `• ${t("filterStats.byDC", { count: String(lastFilterStats.rejectedByDC) })}\n`
        : "") +
      (lastFilterStats.rejectedByOnlyMarked > 0
        ? `• ${t("filterStats.byOnlyMarked", { count: String(lastFilterStats.rejectedByOnlyMarked) })}\n`
        : "")
    : undefined;

  return (
    <div className="section">
      <span className="counts">
        <span id="countTotal" className="count">
          {countTotal}
        </span>{" "}
        {t("toolbar.total")},{" "}
        <span
          id="countFiltered"
          className="count"
          title={filterTooltip}
          style={{
            cursor: hasFiltered ? "help" : undefined,
            textDecoration: hasFiltered ? "underline dotted" : undefined,
          }}
        >
          {countFiltered}
        </span>{" "}
        {t("toolbar.filtered")},{" "}
        <span id="countSelected" className="count">
          {countSelected}
        </span>{" "}
        {t("toolbar.selected")}
      </span>
      <button onClick={onClearLogs} disabled={entriesLength === 0}>
        {t("toolbar.clearLogs")}
      </button>
    </div>
  );
}

export const ToolbarCounts = memo(ToolbarCountsComponent);
