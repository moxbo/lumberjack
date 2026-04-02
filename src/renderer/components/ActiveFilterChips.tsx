/**
 * ActiveFilterChips Component
 *
 * Renders inline filter chip badges showing the currently active filters
 * (level, logger, thread, message, only-marked, DC entries, trace timeline).
 * Includes a "clear all" button.
 */
import { DiagnosticContextFilter } from "../../store/dcFilter";
import { TimeFilter } from "../../store/timeFilter";
import { patchSettingsQuiet } from "../../utils/typedApi";
import type { JSX } from "preact/jsx-runtime";

export interface ActiveFilterChipsProps {
  filter: { level: string; logger: string; thread: string; message: string };
  stdFiltersEnabled: boolean;
  onlyMarked: boolean;
  setFilter: (fn: (prev: any) => any) => void;
  setOnlyMarked: (v: boolean) => void;
  setSearch: (v: string) => void;
  setTraceTimelineId: (v: string) => void;
  setShowTraceTimeline: (v: boolean) => void;
  /** Current DC filter version (used as render dependency) */
  dcVersion: number;
  t: (key: string, params?: Record<string, string>) => string;
}

interface ActiveFilter {
  type: string;
  label: string;
  value: string;
  onRemove: () => void;
  colorClass?: string;
}

export function ActiveFilterChips({
  filter,
  stdFiltersEnabled,
  onlyMarked,
  setFilter,
  setOnlyMarked,
  setSearch,
  setTraceTimelineId,
  setShowTraceTimeline,
  dcVersion: _dcVersion,
  t,
}: ActiveFilterChipsProps): JSX.Element | null {
  const activeFilters: ActiveFilter[] = [];

  if (filter.level && stdFiltersEnabled) {
    activeFilters.push({
      type: "level",
      label: "",
      value: filter.level,
      colorClass: `level-${filter.level.toLowerCase()}`,
      onRemove: () => setFilter((prev: any) => ({ ...prev, level: "" })),
    });
  }
  if (filter.logger && stdFiltersEnabled) {
    activeFilters.push({
      type: "logger",
      label: t("toolbar.logger"),
      value: filter.logger,
      onRemove: () => setFilter((prev: any) => ({ ...prev, logger: "" })),
    });
  }
  if (filter.thread && stdFiltersEnabled) {
    activeFilters.push({
      type: "thread",
      label: t("toolbar.thread"),
      value: filter.thread,
      onRemove: () => setFilter((prev: any) => ({ ...prev, thread: "" })),
    });
  }
  if (filter.message && stdFiltersEnabled) {
    activeFilters.push({
      type: "message",
      label: t("toolbar.message"),
      value:
        filter.message.length > 20
          ? filter.message.substring(0, 20) + "…"
          : filter.message,
      onRemove: () => setFilter((prev: any) => ({ ...prev, message: "" })),
    });
  }
  if (onlyMarked) {
    activeFilters.push({
      type: "marked",
      label: "",
      value: t("activeFilters.marked"),
      onRemove: () => {
        setOnlyMarked(false);
        try {
          patchSettingsQuiet({ onlyMarked: false });
        } catch {}
      },
    });
  }

  const dcEntries = DiagnosticContextFilter.getDcEntries().filter(
    (e) => e.active,
  );
  const activeTraceId = dcEntries.find(
    (e) => e.key === "TraceID" || e.key.toLowerCase().includes("trace"),
  );
  if (DiagnosticContextFilter.isEnabled() && dcEntries.length > 0) {
    if (activeTraceId) {
      activeFilters.push({
        type: "trace-timeline",
        label: "📊",
        value: t("traceTimeline.openTimeline"),
        colorClass: "trace-timeline-chip",
        onRemove: () => {
          setTraceTimelineId(activeTraceId.val);
          setShowTraceTimeline(true);
        },
      });
    }
    dcEntries.slice(0, 3).forEach((entry) => {
      activeFilters.push({
        type: "dc",
        label: entry.key,
        value: entry.val || "*",
        colorClass: "dc-filter",
        onRemove: () =>
          DiagnosticContextFilter.deactivateMdcEntry(entry.key, entry.val),
      });
    });
    if (dcEntries.length > 3) {
      activeFilters.push({
        type: "dc-more",
        label: "",
        value: `+${dcEntries.length - 3}`,
        colorClass: "dc-filter",
        onRemove: () => {},
      });
    }
  }

  if (activeFilters.length === 0) return null;

  return (
    <>
      {activeFilters.map((f, i) =>
        f.type === "trace-timeline" ? (
          <button
            key={`${f.type}-${i}`}
            className="filter-chip trace-timeline-chip"
            onClick={f.onRemove}
            title={t("traceTimeline.openTimelineTooltip")}
          >
            <span className="chip-label">{f.label}</span>
            <span className="chip-value">{f.value}</span>
          </button>
        ) : (
          <span
            key={`${f.type}-${i}`}
            className={`filter-chip ${f.colorClass || ""}`}
          >
            {f.label && <span className="chip-label">{f.label}:</span>}
            <span className="chip-value" title={f.value}>
              {f.value}
            </span>
            {f.type !== "dc-more" && (
              <button
                className="chip-remove"
                onClick={f.onRemove}
                title={t("activeFilters.removeFilter")}
              >
                ×
              </button>
            )}
          </span>
        ),
      )}
      {activeFilters.length > 0 && (
        <button
          style={{
            fontSize: "11px",
            padding: "2px 6px",
            marginLeft: "4px",
          }}
          onClick={() => {
            setSearch("");
            setFilter(() => ({
              level: "",
              logger: "",
              thread: "",
              service: "",
              message: "",
            }));
            setOnlyMarked(false);
            try {
              patchSettingsQuiet({ onlyMarked: false });
            } catch {}
            try {
              TimeFilter.reset();
            } catch {}
            try {
              DiagnosticContextFilter.reset();
            } catch {}
          }}
          title={t("activeFilters.clearAllTooltip")}
        >
          {t("activeFilters.clearAll")}
        </button>
      )}
    </>
  );
}
