import { useMemo } from "preact/hooks";
import type { JSX } from "preact/jsx-runtime";
import {
  levelHistogram,
  summarise,
  timeBuckets,
  topLoggers,
  type AnalyticsEntry,
} from "../../utils/analytics";

interface Props {
  open: boolean;
  entries: AnalyticsEntry[];
  totalEntries: number;
  onClose: () => void;
  t: (key: string, params?: Record<string, string>) => string;
  fmtTimestamp: (v: unknown) => string;
}

const LEVEL_COLOR: Record<string, string> = {
  TRACE: "var(--color-level-trace, #8b5cf6)",
  DEBUG: "var(--color-level-debug, #06b6d4)",
  INFO: "var(--color-level-info, #10b981)",
  WARN: "var(--color-level-warn, #f59e0b)",
  WARNING: "var(--color-level-warn, #f59e0b)",
  ERROR: "var(--color-level-error, #ef4444)",
  FATAL: "var(--color-level-fatal, #dc2626)",
};

export function StatsDialog(props: Props): JSX.Element | null {
  const summary = useMemo(() => summarise(props.entries), [props.entries]);
  const histogram = useMemo(
    () => levelHistogram(props.entries),
    [props.entries],
  );
  const top = useMemo(() => topLoggers(props.entries, 10), [props.entries]);
  const buckets = useMemo(
    () => timeBuckets(props.entries, 40),
    [props.entries],
  );
  if (!props.open) return null;
  const t = props.t;
  const maxBucket = buckets.reduce((m, b) => Math.max(m, b.count), 1);
  const maxLevel = histogram.reduce((m, b) => Math.max(m, b.count), 1);
  const maxLogger = top.reduce((m, l) => Math.max(m, l.count), 1);

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        className="modal stats-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t("stats.title")}
      >
        <h3>{t("stats.title")}</h3>
        <p className="stats-meta">
          {t("stats.scope", {
            visible: String(summary.total),
            total: String(props.totalEntries),
          })}
        </p>

        <div className="stats-summary">
          <div className="stats-tile">
            <div className="stats-tile-value">{summary.total}</div>
            <div className="stats-tile-label">{t("stats.entries")}</div>
          </div>
          <div className="stats-tile">
            <div className="stats-tile-value">{summary.uniqueLoggers}</div>
            <div className="stats-tile-label">{t("stats.uniqueLoggers")}</div>
          </div>
          <div className="stats-tile">
            <div className="stats-tile-value stats-error">
              {summary.errorCount}
            </div>
            <div className="stats-tile-label">{t("stats.errors")}</div>
          </div>
          <div className="stats-tile">
            <div className="stats-tile-value stats-warn">
              {summary.warnCount}
            </div>
            <div className="stats-tile-label">{t("stats.warnings")}</div>
          </div>
        </div>

        {summary.startMs != null && summary.endMs != null && (
          <p className="stats-timespan">
            {props.fmtTimestamp(summary.startMs)} —{" "}
            {props.fmtTimestamp(summary.endMs)}
          </p>
        )}

        <h4>{t("stats.byLevel")}</h4>
        <div className="stats-bars" role="list">
          {histogram.map((b) => (
            <div key={b.level} className="stats-bar-row" role="listitem">
              <span className="stats-bar-label">{b.level}</span>
              <div className="stats-bar-track">
                <div
                  className="stats-bar-fill"
                  style={{
                    width:
                      Math.max(2, (b.count / maxLevel) * 100).toString() + "%",
                    background:
                      LEVEL_COLOR[b.level] || "var(--accent, #3b82f6)",
                  }}
                />
              </div>
              <span className="stats-bar-count">
                {b.count} <small>({Math.round(b.share * 100)}%)</small>
              </span>
            </div>
          ))}
        </div>

        <h4>{t("stats.topLoggers")}</h4>
        {top.length === 0 ? (
          <p className="stats-empty">{t("stats.noLoggers")}</p>
        ) : (
          <ol className="stats-loggers">
            {top.map((l) => (
              <li key={l.logger}>
                <span className="stats-bar-label" title={l.logger}>
                  {l.logger}
                </span>
                <div className="stats-bar-track">
                  <div
                    className="stats-bar-fill"
                    style={{
                      width:
                        Math.max(2, (l.count / maxLogger) * 100).toString() +
                        "%",
                      background: "var(--accent, #3b82f6)",
                    }}
                  />
                </div>
                <span className="stats-bar-count">{l.count}</span>
              </li>
            ))}
          </ol>
        )}

        {buckets.length > 0 && (
          <>
            <h4>{t("stats.overTime")}</h4>
            <div
              className="stats-sparkline"
              role="img"
              aria-label={t("stats.overTime")}
            >
              {buckets.map((b) => (
                <div
                  key={b.startMs}
                  className="stats-spark-bar"
                  title={props.fmtTimestamp(b.startMs) + ": " + String(b.count)}
                  style={{
                    height:
                      Math.max(2, (b.count / maxBucket) * 100).toString() + "%",
                  }}
                />
              ))}
            </div>
          </>
        )}

        <div className="modal-actions">
          <button type="button" onClick={props.onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
