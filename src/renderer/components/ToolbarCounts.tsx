/**
 * ToolbarCounts Component
 * Displays total, filtered, selected counts and clear button
 */
import type { FilterStats } from "../../types/renderer";

interface ToolbarCountsProps {
  countTotal: number;
  countFiltered: number;
  countSelected: number;
  lastFilterStats: FilterStats | null;
  entriesLength: number;
  onClearLogs: () => void;
  t: (key: string, params?: Record<string, string>) => string;
}

export function ToolbarCounts({
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
    ? `Gefiltert: ${countTotal - countFiltered} Einträge\n` +
      (lastFilterStats.rejectedByLevel > 0
        ? `• Level: ${lastFilterStats.rejectedByLevel}\n`
        : "") +
      (lastFilterStats.rejectedByLogger > 0
        ? `• Logger: ${lastFilterStats.rejectedByLogger}\n`
        : "") +
      (lastFilterStats.rejectedByThread > 0
        ? `• Thread: ${lastFilterStats.rejectedByThread}\n`
        : "") +
      (lastFilterStats.rejectedByMessage > 0
        ? `• Message: ${lastFilterStats.rejectedByMessage}\n`
        : "") +
      (lastFilterStats.rejectedByTime > 0
        ? `• Zeit: ${lastFilterStats.rejectedByTime}\n`
        : "") +
      (lastFilterStats.rejectedByDC > 0
        ? `• DC-Filter: ${lastFilterStats.rejectedByDC}\n`
        : "") +
      (lastFilterStats.rejectedByOnlyMarked > 0
        ? `• Nur Markierte: ${lastFilterStats.rejectedByOnlyMarked}\n`
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
