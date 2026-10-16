import { Tooltip } from "./Tooltip";

interface LiveIntakeStatusProps {
  count: number;
  limit: number;
  locale: string;
  onOpenSettings: () => void;
  t: (key: string, params?: Record<string, string>) => string;
}

export function LiveIntakeStatus({
  count,
  limit,
  locale,
  onOpenSettings,
  t,
}: LiveIntakeStatusProps) {
  const paused = count >= limit;
  const number = new Intl.NumberFormat(locale);
  const usage = t("liveIntake.usage", {
    count: number.format(count),
    limit: number.format(limit),
  });
  const label = t("liveIntake.label");
  const value = Math.min(count, limit);
  return (
    <div
      className="live-intake-status"
      data-paused={paused}
      data-warning={count >= limit * 0.9}
    >
      <Tooltip
        position="bottom"
        interactive
        label={label}
        text={
          <div className="live-intake-tooltip">
            <strong>{usage}</strong>
            {paused && <p>{t("liveIntake.pausedHint")}</p>}
            <button type="button" onClick={onOpenSettings}>
              {t("liveIntake.settings")}
            </button>
          </div>
        }
      >
        <button
          type="button"
          className="live-intake-trigger"
          aria-label={`${usage}. ${t("liveIntake.settings")}`}
          onClick={onOpenSettings}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle className="live-intake-track" cx="12" cy="12" r="9" />
            <circle
              className="live-intake-value"
              cx="12"
              cy="12"
              r="9"
              pathLength="100"
              stroke-dasharray="100"
              stroke-dashoffset={100 - (value / limit) * 100}
              transform="rotate(-90 12 12)"
            />
            {paused && <path d="M10 9v6m4-6v6" />}
          </svg>
        </button>
      </Tooltip>
      <meter
        className="live-intake-meter"
        min={0}
        max={limit}
        value={value}
        high={limit * 0.9}
        optimum={0}
        aria-label={label}
        aria-valuetext={usage}
      />
      {paused && (
        <span className="live-intake-paused" role="status">
          {t("liveIntake.paused")}
        </span>
      )}
    </div>
  );
}
