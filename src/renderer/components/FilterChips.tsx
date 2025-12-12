/**
 * Active Filter Chips Component
 */
import { useMemo } from "preact/hooks";
import { DiagnosticContextFilter } from "../../store/dcFilter";
import type { FilterState } from "../../hooks";

interface ActiveFilter {
  type: string;
  label: string;
  value: string;
  onRemove: () => void;
  colorClass?: string;
}

interface FilterChipsProps {
  filter: FilterState;
  stdFiltersEnabled: boolean;
  onlyMarked: boolean;
  onFilterChange: (partial: Partial<FilterState>) => void;
  onOnlyMarkedChange: (value: boolean) => void;
  onClearAll: () => void;
}

export function FilterChips({
  filter,
  stdFiltersEnabled,
  onlyMarked,
  onFilterChange,
  onOnlyMarkedChange,
  onClearAll,
}: FilterChipsProps) {
  const activeFilters = useMemo(() => {
    const filters: ActiveFilter[] = [];

    if (filter.level && stdFiltersEnabled) {
      filters.push({
        type: "level",
        label: "",
        value: filter.level,
        colorClass: `level-${filter.level.toLowerCase()}`,
        onRemove: () => onFilterChange({ level: "" }),
      });
    }

    if (filter.logger && stdFiltersEnabled) {
      filters.push({
        type: "logger",
        label: "Logger",
        value: filter.logger,
        onRemove: () => onFilterChange({ logger: "" }),
      });
    }

    if (filter.thread && stdFiltersEnabled) {
      filters.push({
        type: "thread",
        label: "Thread",
        value: filter.thread,
        onRemove: () => onFilterChange({ thread: "" }),
      });
    }

    if (filter.message && stdFiltersEnabled) {
      filters.push({
        type: "message",
        label: "Msg",
        value:
          filter.message.length > 20
            ? filter.message.substring(0, 20) + "…"
            : filter.message,
        onRemove: () => onFilterChange({ message: "" }),
      });
    }

    if (onlyMarked) {
      filters.push({
        type: "marked",
        label: "",
        value: "Markierte",
        onRemove: () => {
          onOnlyMarkedChange(false);
          try {
            void window.api.settingsSet({ onlyMarked: false });
          } catch {}
        },
      });
    }

    // DC Filter entries
    const dcEntries = DiagnosticContextFilter.getDcEntries().filter(
      (e) => e.active,
    );
    if (DiagnosticContextFilter.isEnabled() && dcEntries.length > 0) {
      dcEntries.slice(0, 3).forEach((entry) => {
        filters.push({
          type: "dc",
          label: entry.key,
          value: entry.val || "*",
          colorClass: "dc-filter",
          onRemove: () =>
            DiagnosticContextFilter.deactivateMdcEntry(entry.key, entry.val),
        });
      });
      if (dcEntries.length > 3) {
        filters.push({
          type: "dc-more",
          label: "",
          value: `+${dcEntries.length - 3}`,
          colorClass: "dc-filter",
          onRemove: () => {},
        });
      }
    }

    return filters;
  }, [
    filter,
    stdFiltersEnabled,
    onlyMarked,
    onFilterChange,
    onOnlyMarkedChange,
  ]);

  if (activeFilters.length === 0) return null;

  return (
    <>
      {activeFilters.map((f, i) => (
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
              title="Filter entfernen"
            >
              ×
            </button>
          )}
        </span>
      ))}
      {activeFilters.length > 0 && (
        <button
          style={{
            fontSize: "11px",
            padding: "2px 6px",
            marginLeft: "4px",
          }}
          onClick={onClearAll}
          title="Alle Filter löschen"
        >
          ✕ Alle
        </button>
      )}
    </>
  );
}
