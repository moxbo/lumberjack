/**
 * TraceTimeline Component
 * Visualizes the request flow through services for a specific TraceID
 */
import type { JSX } from "preact";
import {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from "preact/hooks";
import { useI18n } from "../../utils/i18n";

interface LogEntry {
  _id?: number;
  timestamp: string | number | Date | null;
  level?: string | null;
  logger?: string | null;
  thread?: string | null;
  message: string;
  spanId?: string | null;
  traceId?: string | null;
  mdc?: Record<string, unknown>;
  source?: string;
}

interface TraceTimelineProps {
  entries: LogEntry[];
  traceId: string;
  onClose: () => void;
  onEntryClick?: (entry: LogEntry) => void;
}

interface TimelineSpan {
  id: string;
  service: string;
  startTime: number;
  endTime: number;
  duration: number;
  entries: LogEntry[];
  level: "INFO" | "WARN" | "ERROR" | "DEBUG" | "TRACE";
  parentSpanId?: string | null;
}

// Extract service name from logger or source
function extractServiceName(entry: LogEntry): string {
  // Try logger first (e.g., "com.company.payment.PaymentService" -> "PaymentService")
  if (entry.logger) {
    const parts = entry.logger.split(".");
    // Get last meaningful part
    const lastPart = parts[parts.length - 1];
    if (lastPart && lastPart.length > 2) {
      return lastPart;
    }
    // Try second-to-last if last is too short (e.g., class name)
    if (parts.length > 1) {
      const secondLast = parts[parts.length - 2];
      if (secondLast && secondLast.length > 2) {
        return secondLast;
      }
    }
  }

  // Try MDC for service name
  if (entry.mdc) {
    const serviceKeys = [
      "service",
      "serviceName",
      "service_name",
      "application",
      "app",
    ];
    for (const key of serviceKeys) {
      const val = entry.mdc[key];
      if (typeof val === "string" && val.length > 0) {
        return val;
      }
    }
  }

  // Fall back to source
  if (entry.source) {
    return entry.source;
  }

  return "Unknown";
}

// Parse timestamp to milliseconds
function parseTimestamp(ts: string | number | Date | null | undefined): number {
  if (ts === null || ts === undefined) return 0;
  if (typeof ts === "number") return ts;
  if (ts instanceof Date) return ts.getTime();

  // Try parsing ISO string
  const date = new Date(ts);
  if (!isNaN(date.getTime())) {
    return date.getTime();
  }

  return 0;
}

// Get highest severity level from entries
function getHighestLevel(entries: LogEntry[]): TimelineSpan["level"] {
  const levels = ["ERROR", "WARN", "INFO", "DEBUG", "TRACE"] as const;
  for (const level of levels) {
    if (entries.some((e) => e.level?.toUpperCase() === level)) {
      return level;
    }
  }
  return "INFO";
}

// Extract span ID from entry
function extractSpanId(entry: LogEntry): string {
  // Direct spanId field
  if (entry.spanId) return entry.spanId;

  // Try MDC
  if (entry.mdc) {
    const spanKeys = ["spanId", "span_id", "span.id", "span-id", "x-span-id"];
    for (const key of spanKeys) {
      const val = entry.mdc[key];
      if (typeof val === "string" && val.length > 0) {
        return val;
      }
    }
  }

  // Generate a pseudo-span based on service + thread
  const service = extractServiceName(entry);
  const thread = entry.thread || "main";
  return `${service}::${thread}`;
}

// Extract parent span ID
function extractParentSpanId(entry: LogEntry): string | null {
  if (entry.mdc) {
    const parentKeys = [
      "parentSpanId",
      "parent_span_id",
      "parentId",
      "parent_id",
    ];
    for (const key of parentKeys) {
      const val = entry.mdc[key];
      if (typeof val === "string" && val.length > 0) {
        return val;
      }
    }
  }
  return null;
}

export function TraceTimeline({
  entries,
  traceId,
  onClose,
  onEntryClick,
}: TraceTimelineProps): JSX.Element {
  const { t, locale } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedSpan, setSelectedSpan] = useState<string | null>(null);
  const [hoveredSpan, setHoveredSpan] = useState<string | null>(null);

  // Build timeline data
  const timelineData = useMemo(() => {
    if (entries.length === 0) {
      return {
        spans: [],
        minTime: 0,
        maxTime: 0,
        totalDuration: 0,
        services: [],
      };
    }

    // Group entries by span
    const spanMap = new Map<string, LogEntry[]>();

    for (const entry of entries) {
      const spanId = extractSpanId(entry);
      const existing = spanMap.get(spanId) || [];
      existing.push(entry);
      spanMap.set(spanId, existing);
    }

    // Build spans
    const spans: TimelineSpan[] = [];
    let minTime = Infinity;
    let maxTime = -Infinity;

    for (const [spanId, spanEntries] of spanMap) {
      // Sort entries by timestamp
      const sorted = [...spanEntries].sort(
        (a, b) => parseTimestamp(a.timestamp) - parseTimestamp(b.timestamp),
      );

      const startTime = parseTimestamp(sorted[0]?.timestamp);
      const endTime = parseTimestamp(sorted[sorted.length - 1]?.timestamp);

      if (startTime < minTime) minTime = startTime;
      if (endTime > maxTime) maxTime = endTime;

      const firstEntry = sorted[0];
      spans.push({
        id: spanId,
        service: firstEntry ? extractServiceName(firstEntry) : "Unknown",
        startTime,
        endTime: Math.max(endTime, startTime + 1), // Ensure minimum duration
        duration: Math.max(endTime - startTime, 1),
        entries: sorted,
        level: getHighestLevel(sorted),
        parentSpanId: firstEntry ? extractParentSpanId(firstEntry) : null,
      });
    }

    // Sort spans by start time
    spans.sort((a, b) => a.startTime - b.startTime);

    // Get unique services in order
    const services = [...new Set(spans.map((s) => s.service))];

    const totalDuration = maxTime - minTime;

    return { spans, minTime, maxTime, totalDuration, services };
  }, [entries]);

  // Format duration for display
  const formatDuration = useCallback((ms: number): string => {
    if (ms < 1) return "<1ms";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    return `${(ms / 60000).toFixed(2)}min`;
  }, []);

  // Format timestamp for display
  const formatTime = useCallback(
    (ts: number): string => {
      const date = new Date(ts);
      return date.toLocaleTimeString(locale === "de" ? "de-DE" : "en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
      });
    },
    [locale],
  );

  // Calculate span position as percentage
  const getSpanPosition = useCallback(
    (span: TimelineSpan): { left: string; width: string } => {
      const { minTime, totalDuration } = timelineData;
      if (totalDuration === 0) {
        return { left: "0%", width: "100%" };
      }
      const left = ((span.startTime - minTime) / totalDuration) * 100;
      const width = Math.max((span.duration / totalDuration) * 100, 1); // Min 1% width
      return { left: `${left}%`, width: `${width}%` };
    },
    [timelineData],
  );

  // Get level color
  const getLevelColor = useCallback((level: TimelineSpan["level"]): string => {
    switch (level) {
      case "ERROR":
        return "var(--color-error, #ff3b30)";
      case "WARN":
        return "var(--color-warning, #ff9500)";
      case "INFO":
        return "var(--color-info, #0a84ff)";
      case "DEBUG":
        return "var(--color-debug, #8e8e93)";
      case "TRACE":
        return "var(--color-trace, #aeaeb2)";
      default:
        return "var(--color-info, #0a84ff)";
    }
  }, []);

  // Handle span click
  const handleSpanClick = useCallback(
    (span: TimelineSpan) => {
      setSelectedSpan(span.id === selectedSpan ? null : span.id);
      if (onEntryClick && span.entries[0]) {
        onEntryClick(span.entries[0]);
      }
    },
    [selectedSpan, onEntryClick],
  );

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const { spans, minTime, maxTime, totalDuration, services } = timelineData;

  return (
    <div className="trace-timeline-overlay" onClick={onClose}>
      <div
        className="trace-timeline-container"
        ref={containerRef}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="trace-timeline-header">
          <div className="trace-timeline-title">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>
              {t("traceTimeline.title", { defaultValue: "Trace Timeline" })}
            </span>
          </div>
          <div className="trace-timeline-trace-id">
            <span className="label">TraceID:</span>
            <code>{traceId}</code>
          </div>
          <button
            className="trace-timeline-close"
            onClick={onClose}
            title={t("traceTimeline.close", { defaultValue: "Close" })}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Stats */}
        <div className="trace-timeline-stats">
          <div className="stat">
            <span className="stat-value">{formatDuration(totalDuration)}</span>
            <span className="stat-label">
              {t("traceTimeline.totalDuration", {
                defaultValue: "Total Duration",
              })}
            </span>
          </div>
          <div className="stat">
            <span className="stat-value">{services.length}</span>
            <span className="stat-label">
              {t("traceTimeline.services", { defaultValue: "Services" })}
            </span>
          </div>
          <div className="stat">
            <span className="stat-value">{spans.length}</span>
            <span className="stat-label">
              {t("traceTimeline.spans", { defaultValue: "Spans" })}
            </span>
          </div>
          <div className="stat">
            <span className="stat-value">{entries.length}</span>
            <span className="stat-label">
              {t("traceTimeline.entries", { defaultValue: "Log Entries" })}
            </span>
          </div>
        </div>

        {/* Time axis */}
        <div className="trace-timeline-axis">
          <span className="time-label start">{formatTime(minTime)}</span>
          <div className="time-ticks">
            {[0, 25, 50, 75, 100].map((pct) => (
              <div key={pct} className="time-tick" style={{ left: `${pct}%` }}>
                <span className="tick-label">
                  {pct > 0 &&
                    pct < 100 &&
                    formatTime(minTime + (totalDuration * pct) / 100)}
                </span>
              </div>
            ))}
          </div>
          <span className="time-label end">{formatTime(maxTime)}</span>
        </div>

        {/* Timeline */}
        <div className="trace-timeline-body">
          {services.map((service) => {
            const serviceSpans = spans.filter((s) => s.service === service);
            return (
              <div key={service} className="trace-timeline-row">
                <div className="trace-timeline-service">
                  <span className="service-name" title={service}>
                    {service}
                  </span>
                  <span className="service-count">
                    {serviceSpans.reduce((sum, s) => sum + s.entries.length, 0)}{" "}
                    {t("traceTimeline.entries")}
                  </span>
                </div>
                <div className="trace-timeline-spans">
                  {serviceSpans.map((span) => {
                    const pos = getSpanPosition(span);
                    const isSelected = selectedSpan === span.id;
                    const isHovered = hoveredSpan === span.id;
                    return (
                      <div
                        key={span.id}
                        className={`trace-span ${isSelected ? "selected" : ""} ${isHovered ? "hovered" : ""}`}
                        style={{
                          left: pos.left,
                          width: pos.width,
                          backgroundColor: getLevelColor(span.level),
                        }}
                        onClick={() => handleSpanClick(span)}
                        onMouseEnter={() => setHoveredSpan(span.id)}
                        onMouseLeave={() => setHoveredSpan(null)}
                        title={`${span.service}: ${formatDuration(span.duration)} (${span.entries.length} entries)`}
                      >
                        <span className="span-label">
                          {formatDuration(span.duration)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Selected span details */}
        {selectedSpan && (
          <div className="trace-timeline-details">
            {(() => {
              const span = spans.find((s) => s.id === selectedSpan);
              if (!span) return null;
              return (
                <>
                  <div className="details-header">
                    <h4>{span.service}</h4>
                    <span
                      className={`level-badge level-${span.level.toLowerCase()}`}
                    >
                      {span.level}
                    </span>
                    <span className="duration">
                      {formatDuration(span.duration)}
                    </span>
                  </div>
                  <div className="details-entries">
                    {span.entries.map((entry, idx) => (
                      <div
                        key={entry._id ?? idx}
                        className={`detail-entry level-${(entry.level || "info").toLowerCase()}`}
                        onClick={() => onEntryClick?.(entry)}
                      >
                        <span className="entry-time">
                          {formatTime(parseTimestamp(entry.timestamp))}
                        </span>
                        <span
                          className={`entry-level level-${(entry.level || "info").toLowerCase()}`}
                        >
                          {entry.level || "INFO"}
                        </span>
                        <span className="entry-message" title={entry.message}>
                          {entry.message.length > 100
                            ? entry.message.substring(0, 100) + "..."
                            : entry.message}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* Legend */}
        <div className="trace-timeline-legend">
          <span className="legend-title">
            {t("traceTimeline.legend", { defaultValue: "Legend" })}:
          </span>
          <div className="legend-item">
            <span
              className="legend-color"
              style={{ backgroundColor: "var(--color-error, #ff3b30)" }}
            />
            <span>ERROR</span>
          </div>
          <div className="legend-item">
            <span
              className="legend-color"
              style={{ backgroundColor: "var(--color-warning, #ff9500)" }}
            />
            <span>WARN</span>
          </div>
          <div className="legend-item">
            <span
              className="legend-color"
              style={{ backgroundColor: "var(--color-info, #0a84ff)" }}
            />
            <span>INFO</span>
          </div>
          <div className="legend-item">
            <span
              className="legend-color"
              style={{ backgroundColor: "var(--color-debug, #8e8e93)" }}
            />
            <span>DEBUG</span>
          </div>
        </div>
      </div>
    </div>
  );
}
